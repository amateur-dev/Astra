const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, clipboard } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { exec } = require('child_process')
const Store = require('electron-store')
const store = new Store()

// Dynamic import for fetch (node-fetch v3 is ESM only)
let fetch
;(async () => {
  try {
    const nodeFetch = await import('node-fetch')
    fetch = nodeFetch.default
  } catch (err) {
    console.error('Failed to import node-fetch:', err)
  }
})()

let mainWindow = null
let tray = null
let isRecording = false

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

function createTray () {
  const iconPath = path.join(__dirname, 'tray-icon.png')
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
  const ollamaUrl = store.get('ollama_url') || 'http://localhost:11434'
  const ollamaModel = store.get('ollama_model') || 'llama3.2'
  const ollamaEnabled = store.get('ollama_enabled') === true
  const autoPaste = store.get('auto_paste') === true
  return { 
    transcribe_cmd: tpl, 
    auto_transcribe: auto,
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
          
          if (ollamaEnabled && tx.text) {
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

// helper: convert webm -> wav and run configured transcription command template
async function transcribeWebm (webmPath) {
  try {
    const ffmpegCmd = 'ffmpeg'
    const wavPath = path.join(os.tmpdir(), `voicehotkey-${Date.now()}.wav`)
    await new Promise((resolve, reject) => {
      const cmd = `${ffmpegCmd} -y -i ${JSON.stringify(webmPath)} -ar 16000 -ac 1 ${JSON.stringify(wavPath)}`
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

    return { ok: true, text: transcript, wav: wavPath }
  } catch (err) {
    console.error('transcribeWebm error', err)
    return { ok: false, error: String(err) }
  }
}

// helper: polish transcript text using Ollama API
async function polishWithOllama (text) {
  try {
    if (!fetch) {
      throw new Error('fetch not available - node-fetch import failed')
    }

    const configuredUrl = store.get('ollama_url') || 'http://localhost:11434'
    const ollamaModel = store.get('ollama_model') || 'llama3.2'
    const prompt = `Please clean up and improve this voice transcript. Fix any grammar, punctuation, and formatting issues while preserving the original meaning:\n\n${text}`

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
