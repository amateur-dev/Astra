const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, clipboard } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { exec } = require('child_process')
const Store = require('electron-store')
const store = new Store()

// Resolve a usable `fetch` in the main process.
// Prefer a built-in/global fetch (available in newer Node/Electron), then try
// CommonJS `require('node-fetch')`, then dynamic import of ESM `node-fetch`,
// and finally `undici.fetch` as a last resort. This makes the packaged DMG
// more resilient when the environment differs from the dev machine.
let fetch = null
try {
  if (typeof globalThis.fetch === 'function') {
    fetch = globalThis.fetch.bind(globalThis)
  }
} catch (e) {
  // ignore
}
if (!fetch) {
  try {
    // Try commonjs require (works if node-fetch installed as CJS or has default export)
    // This will throw if node-fetch is ESM-only in this runtime, which we catch below.
    // eslint-disable-next-line global-require
    const nf = require('node-fetch')
    fetch = nf && (nf.default || nf)
  } catch (errRequire) {
    // try dynamic import of ESM package as a fallback
    ;(async () => {
      try {
        const nodeFetch = await import('node-fetch')
        fetch = nodeFetch && (nodeFetch.default || nodeFetch)
      } catch (errImport) {
        try {
          // Last resort: try undici if available
          // eslint-disable-next-line global-require
          const undici = require('undici')
          fetch = undici && undici.fetch
        } catch (errUndici) {
          console.error('Failed to load any fetch implementation (global, node-fetch, undici):', errRequire, errImport, errUndici)
        }
      }
    })()
  }
}

let mainWindow = null
let tray = null
let isRecording = false
// Live mock state per renderer sender (used for incremental patch simulation)
const liveMockState = {}

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })
  // Ensure the session will handle permission requests from the renderer.
  // On macOS this lets the renderer request microphone access which will
  // trigger the system prompt (assuming NSMicrophoneUsageDescription is present
  // in the app's Info.plist). We accept 'media' permission requests.
  try {
    const ses = mainWindow.webContents.session
    ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
      console.log('Permission request for', permission, 'details=', details)
      if (permission === 'media') return callback(true)
      // default: deny other permissions
      return callback(false)
    })
  } catch (e) {
    console.warn('Permission handler setup failed', e)
  }
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

function createTray () {
  // tray icon lives in the renderer directory in source; when packaged the
  // relative path should include 'renderer'. Use that path so the icon shows
  // up in the menu bar when running the packaged app.
  const iconPath = path.join(__dirname, 'renderer', 'tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open', click: () => { mainWindow.show() } },
    { label: 'Quit', click: () => { app.quit() } }
  ])
  tray.setToolTip('Voice Hotkey')
  tray.setContextMenu(contextMenu)
}

app.whenReady().then(() => {
  createWindow()
  createTray()

  // register a simple global shortcut: Cmd+Shift+V to toggle recording
  const ret = globalShortcut.register('CommandOrControl+Shift+V', () => {
    isRecording = !isRecording
    mainWindow.webContents.send('record-toggle', isRecording)
    // If we've just stopped recording, trigger a centralized finalize flow that
    // concatenates buffered WAVs, transcribes, optionally polishes with Ollama,
    // and returns the final text. Also send the result to the renderer so it can
    // display the final transcript and enable paste.
    if (!isRecording) {
      (async () => {
        try {
          const senderId = mainWindow && mainWindow.webContents ? String(mainWindow.webContents.id) : 'unknown'
          const res = await finalizeLiveForSender(senderId)
          try {
            mainWindow.webContents.send('finalize-result', res)
          } catch (e) { console.warn('failed to send finalize-result', e) }
        } catch (e) {
          console.error('finalize on stop failed', e)
        }
      })()
    }
  })
  if (!ret) console.log('Global shortcut registration failed')

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

ipcMain.handle('app-version', () => app.getVersion())

// Settings persistence: store a transcription command template under key 'transcribe_cmd'
ipcMain.handle('get-settings', () => {
  const tpl = store.get('transcribe_cmd') || process.env.TRANSCRIBE_CMD || process.env.WHISPER_CMD || ''
  const auto = store.get('auto_transcribe') === true
  const ffmpegPath = store.get('ffmpeg_path') || ''
  const ollamaUrl = store.get('ollama_url') || 'http://localhost:11434'
  const ollamaModel = store.get('ollama_model') || 'llama3.2'
  const ollamaEnabled = store.get('ollama_enabled') === true
  const autoPaste = store.get('auto_paste') === true
  return { 
    transcribe_cmd: tpl, 
    auto_transcribe: auto,
    ffmpeg_path: ffmpegPath,
    ollama_url: ollamaUrl,
    ollama_model: ollamaModel,
    ollama_enabled: ollamaEnabled,
    auto_paste: autoPaste
  }
})

ipcMain.handle('save-settings', (event, settings) => {
  try {
    if (!settings || typeof settings !== 'object') return { ok: false, error: 'Invalid settings' }
    if (typeof settings.transcribe_cmd === 'string') store.set('transcribe_cmd', settings.transcribe_cmd)
    if (typeof settings.auto_transcribe === 'boolean') store.set('auto_transcribe', settings.auto_transcribe)
  if (typeof settings.ffmpeg_path === 'string') store.set('ffmpeg_path', settings.ffmpeg_path)
    if (typeof settings.ollama_url === 'string') store.set('ollama_url', settings.ollama_url)
    if (typeof settings.ollama_model === 'string') store.set('ollama_model', settings.ollama_model)
    if (typeof settings.ollama_enabled === 'boolean') store.set('ollama_enabled', settings.ollama_enabled)
    if (typeof settings.auto_paste === 'boolean') store.set('auto_paste', settings.auto_paste)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

// Test the configured transcription command. This will try to locate the binary and check the model file if present.
ipcMain.handle('test-transcribe', async (event) => {
  try {
    const tpl = store.get('transcribe_cmd') || process.env.TRANSCRIBE_CMD || process.env.WHISPER_CMD || ''
    if (!tpl) return { ok: false, error: 'No transcription command configured' }

    // Attempt to extract the binary (first token) and -m model path
    // Binary extraction: first non-space token (may be quoted)
    let binary = null
    const binMatch = tpl.match(/^\s*(?:"|')?(.*?)(?:"|')?(?:\s|$)/)
    if (binMatch) binary = binMatch[1]

    // model path after -m
    let modelPath = null
    const mMatch = tpl.match(/-m\s+(?:"|')?([^"'\s]+)(?:"|')?/) 
    if (mMatch) modelPath = mMatch[1]

    let binaryPath = null
    let binaryHelp = null
    // Try to resolve binary path via which if not absolute or not exists
    const resolveBinary = () => new Promise((resolve) => {
      if (!binary) return resolve(null)
      if (fs.existsSync(binary)) return resolve(binary)
      // try which
      exec(`which ${binary}`, (err, stdout) => {
        if (!err) resolve(stdout.toString().trim() || null)
        else resolve(null)
      })
    })

    binaryPath = await resolveBinary()

    if (binaryPath) {
      // run --help to get some output (non-destructive)
      binaryHelp = await new Promise((resolve) => {
        exec(`${JSON.stringify(binaryPath)} --help`, { timeout: 5000 }, (err, stdout, stderr) => {
          if (err) return resolve({ ok: false, error: (stderr || err.message).toString() })
          resolve({ ok: true, out: stdout.toString() })
        })
      })
    }

    const modelExists = modelPath ? fs.existsSync(modelPath) : false

    return { ok: true, tpl, binary, binaryPath, binaryHelp, modelPath, modelExists }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

// Open the macOS Microphone privacy settings so users can grant access.
ipcMain.handle('open-microphone-settings', async () => {
  try {
    // macOS System Settings URL for Privacy → Microphone
    const cmd = `open "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"`
    exec(cmd, (err) => {
      if (err) console.error('Failed to open Microphone settings', err)
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

// Open Automation (AppleEvents) settings panel
ipcMain.handle('open-automation-settings', async () => {
  try {
    // macOS System Settings URL for Privacy → Automation
    const cmd = `open "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"`
    exec(cmd, (err) => {
      if (err) console.error('Failed to open Automation settings', err)
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

// Test automation: run a harmless osascript keystroke test and return stdout/stderr/exit code
ipcMain.handle('test-automation', async () => {
  try {
    const as = 'tell application "System Events" to keystroke "v" using {command down}'
    return await new Promise((resolve) => {
      exec(`osascript -e ${JSON.stringify(as)}`, (err, stdout, stderr) => {
        const out = (stdout || '').toString()
        const errOut = (stderr || '').toString()
        if (err) {
          // include exit code if present
          const code = err && err.code ? err.code : null
          resolve({ ok: false, code, stdout: out, stderr: errOut, message: (errOut || err.message || String(err)).toString() })
          return
        }
        resolve({ ok: true, code: 0, stdout: out, stderr: errOut })
      })
    })
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

// Paste integration: write to clipboard and simulate Cmd+V via AppleScript (osascript)
ipcMain.handle('paste-into-front', async (event, text) => {
  try {
    if (typeof text !== 'string') return { ok: false, error: 'Invalid text' }
    // write to clipboard using Electron API
    try {
      clipboard.writeText(text)
    } catch (err) {
      console.error('clipboard write failed', err)
      // continue; still try AppleScript
    }

    // Use osascript to send Cmd+V to the frontmost app. This requires Accessibility permission for the host app.
    const as = 'tell application "System Events" to keystroke "v" using {command down}'
    return await new Promise((resolve) => {
      exec(`osascript -e ${JSON.stringify(as)}`, (err, stdout, stderr) => {
        if (err) {
          // provide an actionable hint for the user
          const errMsg = (stderr || err.message || String(err)).toString()
          console.error('osascript paste failed', errMsg)
          resolve({ ok: false, error: 'Paste failed: ' + errMsg + '. If this is macOS, please grant Accessibility permission to Terminal or the app hosting this process (System Settings → Privacy & Security → Accessibility).' })
          return
        }
        resolve({ ok: true })
      })
    })
  } catch (err) {
    console.error('paste-into-front handler error', err)
    return { ok: false, error: String(err) }
  }
})

// Save a recording sent from renderer (Uint8Array) to a temp file and return its path
ipcMain.handle('save-recording', async (event, uint8Array) => {
  try {
    const buffer = Buffer.from(uint8Array)
    const filename = path.join(os.tmpdir(), `voicehotkey-${Date.now()}.webm`)
    await fs.promises.writeFile(filename, buffer)
    // If auto_transcribe is enabled in settings, run transcription now and return transcript
    const auto = store.get('auto_transcribe') === true
    if (auto) {
      try {
        const tx = await transcribeWebm(filename)
        if (tx && tx.ok) {
          // Check if Ollama polishing is enabled
          const ollamaEnabled = store.get('ollama_enabled') === true
          let finalText = tx.text
          let polishError = null
          // Track metadata about whether polishing was attempted/used and any errors
          let polishUsed = null
          let polishTried = null
          let polishErrors = null
          
          // Only attempt polishing if there is non-empty transcript text
          if (ollamaEnabled && tx.text && String(tx.text).trim().length > 0) {
            try {
              const polished = await polishWithOllama(tx.text)
              if (polished && polished.ok) {
                finalText = polished.text
                // include metadata about polishing
                polishUsed = polished.used || null
                polishTried = polished.tried || null
                polishErrors = polished.errors || null
              } else {
                polishError = polished && polished.error ? polished.error : 'Ollama polish failed'
                polishTried = polished && polished.tried ? polished.tried : null
                polishErrors = polished && polished.errors ? polished.errors : null
              }
            } catch (err) {
              polishError = String(err)
            }
          }
          // Clean the final text (strip timestamps/caveat) before any further actions
          finalText = cleanTranscript(finalText)

          // If auto_paste is enabled, attempt to paste the final text into the front app
          let pasteResult = null
          const autoPaste = store.get('auto_paste') === true
          if (autoPaste && finalText) {
            try {
              try { clipboard.writeText(finalText) } catch (e) { /* ignore */ }
              const as = 'tell application "System Events" to keystroke "v" using {command down}'
              pasteResult = await new Promise((resolve) => {
                exec(`osascript -e ${JSON.stringify(as)}`, (err, stdout, stderr) => {
                  if (err) return resolve({ ok: false, error: (stderr || err.message || String(err)).toString() })
                  resolve({ ok: true })
                })
              })
            } catch (err) {
              pasteResult = { ok: false, error: String(err) }
            }
          }

          return { 
            ok: true, 
            path: filename, 
            autoTranscribed: true, 
            text: finalText, 
            originalText: ollamaEnabled ? tx.text : undefined,
            polishError,
            polishUsed: polishUsed || null,
            polishTriedHosts: polishTried || null,
            polishErrors: polishErrors || null,
            pasteResult,
            wav: tx.wav 
          }
        }
        return { ok: true, path: filename, autoTranscribed: true, error: tx && tx.error ? tx.error : 'transcription failed' }
      } catch (err) {
        return { ok: true, path: filename, autoTranscribed: true, error: String(err) }
      }
    }
    return { ok: true, path: filename }
  } catch (err) {
    console.error('Failed to save recording:', err)
    return { ok: false, error: String(err) }
  }
})

// Receive live audio chunks from renderer and write to temp files (accepts WAV or webm)
ipcMain.handle('send-audio-chunk', async (event, uint8Array) => {
  try {
    if (!uint8Array) return { ok: false, error: 'No data' }
    const buffer = Buffer.from(uint8Array)
    const senderId = event && event.sender && event.sender.id ? String(event.sender.id) : 'unknown'
    if (!liveMockState[senderId]) liveMockState[senderId] = { chunkWavs: [], debounce: null, seq: 0, prevTranscript: '' }

    // Heuristic: WAV files start with 'RIFF'
    const isWav = buffer.length >= 4 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    if (isWav) {
      const filename = path.join(os.tmpdir(), `voicehotkey-chunk-${Date.now()}.wav`)
      await fs.promises.writeFile(filename, buffer)
      liveMockState[senderId].chunkWavs.push(filename)
      const MAX_WAVS = 8
      if (liveMockState[senderId].chunkWavs.length > MAX_WAVS) liveMockState[senderId].chunkWavs.splice(0, liveMockState[senderId].chunkWavs.length - MAX_WAVS)
    } else {
      // fallback: write webm and try converting to wav
      const filename = path.join(os.tmpdir(), `voicehotkey-chunk-${Date.now()}.webm`)
      await fs.promises.writeFile(filename, buffer)
      try {
        const ffmpegCmd = await findFfmpeg()
        if (ffmpegCmd) {
          const wavPath = path.join(os.tmpdir(), `voicehotkey-chunk-${Date.now()}.wav`)
          await new Promise((resolve, reject) => {
            const cmd = `${JSON.stringify(ffmpegCmd)} -y -i ${JSON.stringify(filename)} -ar 16000 -ac 1 ${JSON.stringify(wavPath)}`
            exec(cmd, (err, stdout, stderr) => {
              if (err) return reject(new Error('ffmpeg convert failed: ' + (stderr || err.message)))
              resolve()
            })
          })
          liveMockState[senderId].chunkWavs.push(wavPath)
          const MAX_WAVS = 8
          if (liveMockState[senderId].chunkWavs.length > MAX_WAVS) liveMockState[senderId].chunkWavs.splice(0, liveMockState[senderId].chunkWavs.length - MAX_WAVS)
        }
      } catch (e) {
        console.warn('chunk convert failed', e)
      }
    }

    // Debounce transcription so we provide incremental updates with context
    try {
      if (liveMockState[senderId].debounce) clearTimeout(liveMockState[senderId].debounce)
      liveMockState[senderId].debounce = setTimeout(() => {
        // run async transcription, don't block the handler
        (async () => {
          try {
            await runRollingTranscription(senderId, event && event.sender)
          } catch (e) {
            console.error('runRollingTranscription error', e)
          }
        })()
      }, 800)
    } catch (e) {
      console.warn('debounce setup failed', e)
    }

    return { ok: true }
  } catch (err) {
    console.error('send-audio-chunk handler error', err)
    return { ok: false, error: String(err) }
  }
})

// Helper: run rolling-window transcription for a sender and emit a live patch to renderer
async function runRollingTranscription (senderId, sender) {
  try {
    const state = liveMockState[senderId]
    if (!state || !state.chunkWavs || state.chunkWavs.length === 0) return

    const ffmpegCmd = await findFfmpeg()
    if (!ffmpegCmd) {
      console.warn('ffmpeg not found; cannot run rolling transcription')
      return
    }

    // Use last N wavs to build a combined input
    const take = 6
    const wavs = state.chunkWavs.slice(-take)
    if (wavs.length === 0) return

    const listFile = path.join(os.tmpdir(), `voicehotkey-concat-${Date.now()}.txt`)
    // Only include wavs that still exist (avoid race conditions)
    const existing = []
    for (const p of wavs) {
      try {
        if (fs.existsSync(p)) existing.push(p)
      } catch (e) {
        // ignore
      }
    }
    if (existing.length === 0) return
    // concat expects lines like: file '/path/to/file.wav'
    // Use single-quoted paths and escape any single quotes in the path
    const listContents = existing.map(p => `file '${String(p).replace(/'/g, "'\\\''")}'`).join('\n')
    await fs.promises.writeFile(listFile, listContents)

    const combinedPath = path.join(os.tmpdir(), `voicehotkey-rolling-${Date.now()}.wav`)
    // concat and resample to 16k mono
    await new Promise((resolve, reject) => {
      // Use ffmpeg with a concat list file. Wrap paths properly.
      const cmd = `${JSON.stringify(ffmpegCmd)} -y -f concat -safe 0 -i ${JSON.stringify(listFile)} -ar 16000 -ac 1 ${JSON.stringify(combinedPath)}`
      exec(cmd, (err, stdout, stderr) => {
        if (err) return reject(new Error('ffmpeg concat failed: ' + (stderr || err.message)))
        resolve()
      })
    })

  // Run existing transcription pipeline on the combined WAV file.
  const tx = await transcribeWav(combinedPath)
  let finalText = ''
  if (tx && tx.ok) finalText = tx.text || ''
  else if (tx && tx.error) finalText = `⚠ Transcribe error: ${String(tx.error).slice(0,200)}`

    // Optionally run Ollama polishing if enabled
    try {
      const ollamaEnabled = store.get('ollama_enabled') === true
      if (ollamaEnabled && finalText && finalText.trim().length > 0) {
        const polished = await polishWithOllama(finalText)
        if (polished && polished.ok && polished.text) finalText = polished.text
      }
    } catch (e) {
      console.warn('Ollama polish failed', e)
    }

    // Compare and emit patch if different
    if (String(finalText || '').trim() !== String(state.prevTranscript || '').trim()) {
      state.seq = (state.seq || 0) + 1
      state.prevTranscript = finalText
      try {
        if (sender && sender.send) {
          sender.send('live-patch', { seq: state.seq, text: finalText })
        } else if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('live-patch', { seq: state.seq, text: finalText })
        }
      } catch (e) {
        console.warn('failed to send live patch', e)
      }
    }
  } catch (err) {
    console.error('runRollingTranscription error', err)
  }
}

// Transcribe the given webm file: convert to WAV with ffmpeg, then run a configured transcription command.
ipcMain.handle('transcribe', async (event, webmPath) => {
  try {
    if (!webmPath || typeof webmPath !== 'string') return { ok: false, error: 'Invalid path' }
    // ensure ffmpeg exists
    const ffmpegCmd = 'ffmpeg'
    // create wav path
    const wavPath = path.join(os.tmpdir(), `voicehotkey-${Date.now()}.wav`)
    // delegate to shared helper
    const tx = await transcribeWebm(webmPath)
    return tx
  } catch (err) {
    console.error('transcribe handler error', err)
    return { ok: false, error: String(err) }
  }
})

// Centralized finalize: concatenate buffered WAVs for a sender, run transcription and optional Ollama polish.
ipcMain.handle('finalize-live', async (event, senderId) => {
  try {
    const id = senderId || (event && event.sender && String(event.sender.id)) || 'unknown'
    const res = await finalizeLiveForSender(id)
    return res
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

async function finalizeLiveForSender (senderId) {
  try {
    const state = liveMockState[senderId]
    if (!state || !state.chunkWavs || state.chunkWavs.length === 0) return { ok: false, error: 'No audio buffered' }

    const ffmpegCmd = await findFfmpeg()
    if (!ffmpegCmd) return { ok: false, error: 'ffmpeg not found' }

    // Use all available buffered wavs to build a combined final WAV.
    const existing = []
    for (const p of state.chunkWavs) {
      try { if (fs.existsSync(p)) existing.push(p) } catch (e) {}
    }
    if (existing.length === 0) return { ok: false, error: 'No existing buffered WAVs' }

    const listFile = path.join(os.tmpdir(), `voicehotkey-finalize-${Date.now()}.txt`)
    const listContents = existing.map(p => `file '${String(p).replace(/'/g, "'\\\''")}'`).join('\n')
    await fs.promises.writeFile(listFile, listContents)

    const combinedPath = path.join(os.tmpdir(), `voicehotkey-final-${Date.now()}.wav`)
    await new Promise((resolve, reject) => {
      const cmd = `${JSON.stringify(ffmpegCmd)} -y -f concat -safe 0 -i ${JSON.stringify(listFile)} -ar 16000 -ac 1 ${JSON.stringify(combinedPath)}`
      exec(cmd, (err, stdout, stderr) => {
        if (err) return reject(new Error('ffmpeg concat failed: ' + (stderr || err.message)))
        resolve()
      })
    })

    // Run transcription on combined WAV
    const tx = await transcribeWav(combinedPath)
    let finalText = ''
    if (tx && tx.ok) finalText = tx.text || ''
    else if (tx && tx.error) finalText = `⚠ Transcribe error: ${String(tx.error).slice(0,200)}`

    // Optional Ollama polish
    let polishMeta = null
    try {
      const ollamaEnabled = store.get('ollama_enabled') === true
      if (ollamaEnabled && finalText && finalText.trim().length > 0) {
        const polished = await polishWithOllama(finalText)
        if (polished && polished.ok && polished.text) finalText = polished.text
        polishMeta = polished || null
      }
    } catch (e) {
      console.warn('Ollama polish failed during finalize', e)
    }

    const cleaned = cleanTranscript(finalText)

    // If auto_paste is enabled, attempt paste
    let pasteResult = null
    try {
      const autoPaste = store.get('auto_paste') === true
      if (autoPaste && cleaned) {
        try { clipboard.writeText(cleaned) } catch (e) {}
        const as = 'tell application "System Events" to keystroke "v" using {command down}'
        pasteResult = await new Promise((resolve) => {
          exec(`osascript -e ${JSON.stringify(as)}`, (err, stdout, stderr) => {
            if (err) return resolve({ ok: false, error: (stderr || err.message || String(err)).toString() })
            resolve({ ok: true })
          })
        })
      }
    } catch (e) {
      pasteResult = { ok: false, error: String(e) }
    }

    return { ok: true, text: cleaned, original: tx && tx.text ? tx.text : null, polish: polishMeta, pasteResult }
  } catch (err) {
    console.error('finalizeLiveForSender error', err)
    return { ok: false, error: String(err) }
  }
}

// helper: convert webm -> wav and run configured transcription command template
async function transcribeWebm (webmPath) {
  try {
    // find ffmpeg executable (bundled, user-configured, or system)
    const ffmpegCmd = await findFfmpeg()
    const wavPath = path.join(os.tmpdir(), `voicehotkey-${Date.now()}.wav`)
    if (!ffmpegCmd) {
      return { ok: false, error: 'ffmpeg not found. Install ffmpeg (Homebrew: `brew install ffmpeg`) or bundle ffmpeg in the app.' }
    }
    await new Promise((resolve, reject) => {
      const cmd = `${JSON.stringify(ffmpegCmd)} -y -i ${JSON.stringify(webmPath)} -ar 16000 -ac 1 ${JSON.stringify(wavPath)}`
      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          console.error('ffmpeg failed', err, stderr)
          return reject(new Error('ffmpeg failed: ' + (stderr || err.message)))
        }
        resolve()
      })
    })

    const tpl = store.get('transcribe_cmd') || process.env.TRANSCRIBE_CMD || process.env.WHISPER_CMD || null
    if (!tpl) {
      return { ok: false, error: 'No transcription command configured. Set TRANSCRIBE_CMD env variable or save settings in app.' }
    }

    const cmd = tpl.replace(/{wav}/g, JSON.stringify(wavPath))

    const transcript = await new Promise((resolve, reject) => {
      exec(cmd, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          console.error('transcription command failed', err, stderr)
          return reject(new Error('transcription failed: ' + (stderr || err.message)))
        }
        resolve(stdout.toString())
      })
    })

  // Clean the raw transcript before returning to the renderer
    const cleaned = cleanTranscript(transcript)
    // If cleaning removed everything but the raw transcript had content,
    // fall back to returning the raw transcript to avoid losing information.
    let finalText = ''
    if (cleaned && String(cleaned).trim().length > 0) {
      finalText = cleaned
    } else if (transcript && String(transcript).trim().length > 0) {
      console.warn('cleanTranscript removed all content; returning raw transcript as fallback')
      finalText = transcript
    } else {
      finalText = ''
    }
    return { ok: true, text: finalText, raw: transcript, wav: wavPath }
  } catch (err) {
    console.error('transcribeWebm error', err)
    return { ok: false, error: String(err) }
  }
}

// helper: run transcription on an existing WAV file with configured transcription command
async function transcribeWav (wavPath) {
  try {
    if (!wavPath || typeof wavPath !== 'string') return { ok: false, error: 'Invalid wav path' }
    const tpl = store.get('transcribe_cmd') || process.env.TRANSCRIBE_CMD || process.env.WHISPER_CMD || null
    if (!tpl) {
      return { ok: false, error: 'No transcription command configured. Set TRANSCRIBE_CMD env variable or save settings in app.' }
    }
    const cmd = tpl.replace(/{wav}/g, JSON.stringify(wavPath))
    const transcript = await new Promise((resolve, reject) => {
      exec(cmd, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          console.error('transcription command failed', err, stderr)
          return reject(new Error('transcription failed: ' + (stderr || err.message)))
        }
        resolve(stdout.toString())
      })
    })
    const cleaned = cleanTranscript(transcript)
    let finalText = ''
    if (cleaned && String(cleaned).trim().length > 0) finalText = cleaned
    else if (transcript && String(transcript).trim().length > 0) finalText = transcript
    else finalText = ''
    return { ok: true, text: finalText, raw: transcript, wav: wavPath }
  } catch (err) {
    console.error('transcribeWav error', err)
    return { ok: false, error: String(err) }
  }
}

// helper: polish transcript text using Ollama API
async function polishWithOllama (text) {
  try {
    if (!fetch) {
      // If fetch couldn't be resolved at startup, surface a clearer message and
      // avoid throwing the raw import failure. The caller will receive a
      // structured error so the UI can show a helpful message.
      console.error('polishWithOllama: no fetch implementation available in main process')
      throw new Error('fetch not available in the main process; Ollama polishing is disabled. Make sure node-fetch or undici is packaged, or run a newer Electron with global fetch support.')
    }

    const configuredUrl = store.get('ollama_url') || 'http://localhost:11434'
    const ollamaModel = store.get('ollama_model') || 'llama3.2'
    // Instruct Ollama to both polish and remove unwanted artifacts like
    // timestamps and the common 'I made the following changes' caveat, and
    // to return the result as a single paragraph.
  const prompt = `Please perform the following on the transcript below:
  1) Remove any timestamps or timecodes (examples: "00:00:00", "00:00:00.000", "00:00:00 --> 00:00:16.500", or any bracketed timecodes).
  2) Remove any editorial caveat or checklist that begins with phrases like "I made the following changes" and any bullet/list that follows it.
  3) Fix grammar, punctuation, and formatting while preserving the original meaning.
  4) Return the cleaned transcript as a single paragraph with normalized whitespace.

  IMPORTANT: Do NOT include any heading, label, or introductory phrase such as "Here is the cleaned transcript:" — return only the cleaned paragraph.

  Transcript:

  ${text}`

    // Build an ordered list of candidate base URLs to try.
    // If the configured URL uses localhost, add an explicit 127.0.0.1 fallback.
    const candidates = []
    const normalized = configuredUrl.trim().replace(/\/+$/, '')
    candidates.push(normalized)
    try {
      const urlObj = new URL(normalized)
      if (urlObj.hostname === 'localhost' && !normalized.includes('127.0.0.1')) {
        const ipv4 = normalized.replace('localhost', '127.0.0.1')
        candidates.push(ipv4)
      }
    } catch (e) {
      // if malformed, still try the raw configured value
    }

    const errors = {}
    for (const base of candidates) {
      try {
        const url = `${base.replace(/\/$/, '')}/api/generate`
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: ollamaModel, prompt, stream: false }),
          // small timeout not directly supported by node-fetch v3; rely on default
        })
        if (!response.ok) {
          const txt = await response.text().catch(() => '')
          errors[base] = `HTTP ${response.status} ${response.statusText} ${txt}`
          continue
        }
        const data = await response.json()
        const polishedText = data.response || text
        return { ok: true, text: polishedText, used: base, tried: candidates }
      } catch (err) {
        // record the error and try next candidate
        errors[base] = String(err && err.message ? err.message : err)
        continue
      }
    }

    // none succeeded
    return { ok: false, error: `All Ollama attempts failed`, tried: candidates, errors }
  } catch (err) {
    console.error('polishWithOllama error', err)
    return { ok: false, error: String(err) }
  }
}

// helper: clean transcript text by removing common timestamp lines, any
// trailing 'I made the following changes' caveat and list items, and
// collapse everything into a single paragraph. This is a best-effort
// normalizer to make transcripts more user-friendly.
function cleanTranscript (text) {
  try {
    if (!text || typeof text !== 'string') return text
    // Split into lines and drop lines that look like timestamps or are empty
    const rawLines = text.split(/\r?\n/)
    const lines = []
    for (let i = 0; i < rawLines.length; i++) {
      let line = rawLines[i].trim()
      if (!line) continue
      // If the line contains a timestamp pattern like 00:00:00 or 00:00:00.000 or an arrow -->, drop it
      if (/\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?/.test(line)) continue
      if (/-->|→/.test(line)) continue
      // Remove common bullet markers
      line = line.replace(/^\s*[-*•]\s+/, '')
      // If this line starts the caveat about changes, stop processing further lines
      if (/^I made the following changes/i.test(line) || /^I made some changes/i.test(line)) break
      lines.push(line)
    }

  if (lines.length === 0) return ''
  // Join into a single paragraph and normalize whitespace
  let paragraph = lines.join(' ').replace(/\s+/g, ' ').trim()
  // Strip common leading labels that models sometimes add, e.g. "Here is the cleaned transcript:"
  paragraph = paragraph.replace(/^(?:here\s+is(?:\s+the)?|here'?s(?:\s+the)?|cleaned\s+transcript)[:\-\s]*/i, '')
  return paragraph
  } catch (err) {
    console.error('cleanTranscript error', err)
    return text
  }
}

// helper: locate ffmpeg binary. Checks user-configured path, system paths, and bundled resources
async function findFfmpeg () {
  try {
    const configured = store.get('ffmpeg_path') || process.env.FFMPEG_PATH || ''
    const candidates = []
    if (configured) candidates.push(configured)

    // prefer which if available
    const whichPath = await new Promise((resolve) => {
      exec('which ffmpeg', (err, stdout) => {
        if (!err && stdout) return resolve(stdout.toString().trim())
        resolve(null)
      })
    })
    if (whichPath) candidates.push(whichPath)

    // common Homebrew /usr/local locations
    candidates.push('/opt/homebrew/bin/ffmpeg')
    candidates.push('/usr/local/bin/ffmpeg')
    candidates.push('/usr/bin/ffmpeg')
    candidates.push('/bin/ffmpeg')

    // check for bundled ffmpeg in the app resources (extraResources -> Resources/ffmpeg)
    try {
      const res1 = path.join(process.resourcesPath || '', 'ffmpeg', 'ffmpeg')
      candidates.push(res1)
      const res2 = path.join(process.resourcesPath || '', 'build', 'ffmpeg', 'ffmpeg')
      candidates.push(res2)
    } catch (e) {
      // ignore
    }

    for (const c of candidates) {
      if (!c) continue
      try {
        if (fs.existsSync(c)) return c
      } catch (e) {
        // ignore
      }
    }
    return null
  } catch (err) {
    console.error('findFfmpeg error', err)
    return null
  }
}
