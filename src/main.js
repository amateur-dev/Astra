const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, clipboard } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { exec } = require('child_process')
const Store = require('electron-store')
let store = new Store()

// Defensive fallback: some packaged environments may not expose electron-store
// correctly. If `store.set` is missing, replace `store` with a simple file-backed
// shim that persists settings to ~/.voicehotkey-settings.json to avoid runtime
// TypeErrors and provide sensible defaults.
try {
  if (!store || typeof store.set !== 'function') {
    const fallbackPath = path.join(os.homedir() || process.env.HOME || '.', '.voicehotkey-settings.json')
    let _cache = {}
    try {
      if (fs.existsSync(fallbackPath)) {
        _cache = JSON.parse(fs.readFileSync(fallbackPath, 'utf8') || '{}')
      }
    } catch (e) { _cache = {} }
    const shim = {
      get: (k) => (_cache && Object.prototype.hasOwnProperty.call(_cache, k) ? _cache[k] : undefined),
      set: (k, v) => {
        try {
          _cache[k] = v
          fs.writeFileSync(fallbackPath, JSON.stringify(_cache, null, 2), 'utf8')
        } catch (e) {
          console.error('fallback store write failed', e)
        }
      }
    }
    store = shim
    console.warn('electron-store unavailable; using fallback file store at', fallbackPath)
  }
} catch (e) {
  console.warn('store initialization check failed', e)
}

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
// Import pure helpers from lib so they can be unit-tested independently
const { cleanTranscript, extractTimestampFromText } = require('./lib/transcript-utils')
const { checkWhisperAvailability } = require('./lib/whisper-utils')

// Enforce Whisper usage when available
const ENFORCE_WHISPER = true
let whisperStatus = null
let forcedTranscribeCmd = null

// Note: whisper availability is determined by `src/lib/whisper-utils.js`

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
  })
  if (!ret) console.log('Global shortcut registration failed')

  if (app && typeof app.on === 'function') {
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  } else {
    console.warn('app.on is not available in this runtime; skipping activate handler')
  }
  // Check for Whisper availability at startup, enforce if requested, and notify renderer.
  (async () => {
    try {
      const ws = await checkWhisperAvailability()
      whisperStatus = ws
      if (ws && ws.ok) {
        // Prefer the detected whisper binary as the forced transcribe command
        forcedTranscribeCmd = `${ws.path} {wav}`
        // If the user hasn't configured a transcription template, try to
        // auto-detect a ggml model file near common locations and persist
        // a fuller template including `-m <model>` so whisper-cli won't try
        // to load a relative 'models/...' path that doesn't exist.
        try {
          const existingTpl = store.get('transcribe_cmd') || ''
          if (!existingTpl || String(existingTpl).trim().length === 0) {
            const model = findLocalWhisperModel(ws.path)
            if (model) {
              const autoTpl = `${ws.path} -m ${model} -f {wav}`
              store.set('transcribe_cmd', autoTpl)
              forcedTranscribeCmd = autoTpl
              console.log('Auto-saved transcribe_cmd with detected model:', autoTpl)
            }
          }
        } catch (e) {
          console.warn('auto-save whisper model failed', e)
        }
      }
      try { if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('whisper-status', ws) } catch (e) { /* ignore */ }
    } catch (e) {
      whisperStatus = { ok: false, error: String(e) }
      try { if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('whisper-status', { ok: false, error: String(e) }) } catch (ee) {}
    }
  })()
})

// Try to locate a local ggml Whisper model near the given whisper binary
// or in common locations. Returns an absolute path to the model file or
// null when nothing is found.
function findLocalWhisperModel (whisperBinaryPath) {
  try {
    const candidates = []
    const home = process.env.HOME || ''
    // model next to whisper.cpp build: ../models/*.bin
    if (whisperBinaryPath) {
      try {
        const binDir = path.dirname(whisperBinaryPath)
        candidates.push(path.join(binDir, '..', 'models'))
        candidates.push(path.join(binDir, '..', '..', 'models'))
      } catch (e) {}
    }
    // common build location in user's home (when building whisper.cpp)
    if (home) candidates.push(path.join(home, 'whisper.cpp', 'models'))
    // repository-local models folder
    candidates.push(path.join(process.cwd(), 'models'))

    for (const dir of candidates) {
      try {
        if (!dir) continue
        if (!fs.existsSync(dir)) continue
        const files = fs.readdirSync(dir)
        for (const f of files) {
          if (/ggml.*\.bin$/i.test(f)) return path.join(dir, f)
        }
      } catch (e) { /* ignore */ }
    }
    return null
  } catch (err) {
    console.warn('findLocalWhisperModel error', err)
    return null
  }
}

// Download a ggml model file from known URLs into the user's
// ~/whisper.cpp/models or app models folder. Returns the absolute path on success.
ipcMain.handle('download-model', async (event, modelId) => {
  try {
    const urls = {
      tiny: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
      small: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
      base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin'
    }
    const url = urls[modelId]
    if (!url) return { ok: false, error: 'unknown model id' }

    const destDir = path.join(process.env.HOME || os.homedir(), 'whisper.cpp', 'models')
    await fs.promises.mkdir(destDir, { recursive: true })
    const dest = path.join(destDir, path.basename(url))
    const tmp = dest + '.download'

    // simple redirect-following downloader using https
    const https = require('https')
    const maxRedirects = 5
    let current = url
    let redirects = 0
    const download = () => new Promise((resolve, reject) => {
      const doRequest = (u) => {
        const req = https.get(u, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < maxRedirects) {
            redirects++
            current = res.headers.location
            doRequest(current)
            return
          }
          if (res.statusCode !== 200) return reject(new Error('Download failed: ' + res.statusCode))
          const total = parseInt(res.headers['content-length'] || '0', 10)
          const file = fs.createWriteStream(tmp)
          let downloaded = 0
          res.on('data', (chunk) => {
            downloaded += chunk.length
            // emit progress to renderer
            try { if (event && event.sender) event.sender.send('download-model-progress', { modelId, total, downloaded }) } catch (e) {}
          })
          res.pipe(file)
          file.on('finish', () => file.close(() => resolve()))
          file.on('error', (err) => reject(err))
        })
        req.on('error', (err) => reject(err))
      }
      doRequest(current)
    })

    await download()
    // move tmp -> dest (overwrite)
    await fs.promises.rename(tmp, dest)
    // notify final progress
    try { if (event && event.sender) event.sender.send('download-model-progress', { modelId, total: (await fs.promises.stat(dest)).size, downloaded: (await fs.promises.stat(dest)).size }) } catch (e) {}

    // update store transcribe_cmd if none exists
    try {
      const existing = store.get('transcribe_cmd') || ''
      if (!existing || String(existing).trim().length === 0) {
        const defaultCmd = `whisper-cli -m ${dest} -f {wav}`
        store.set('transcribe_cmd', defaultCmd)
      }
    } catch (e) { /* ignore store errors */ }

    return { ok: true, path: dest }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

ipcMain.handle('app-version', () => app.getVersion())

// Allow renderer to query whisper availability on demand
ipcMain.handle('whisper-status', async () => {
  try {
    const ws = await checkWhisperAvailability()
    return ws
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

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
    // After saving settings, re-check Whisper availability so the UI can update immediately
    (async () => {
      try {
        const ws = await checkWhisperAvailability(store.get('transcribe_cmd'))
        whisperStatus = ws
        if (ws && ws.ok) {
          forcedTranscribeCmd = `${ws.path} {wav}`
        }
        try { if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('whisper-status', ws) } catch (e) {}
      } catch (e) {
        whisperStatus = { ok: false, error: String(e) }
        try { if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('whisper-status', whisperStatus) } catch (ee) {}
      }
    })()
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

// Return the current frontmost application name (macOS) for diagnostics
ipcMain.handle('get-frontmost-app', async () => {
  try {
    const name = await getFrontmostApp()
    return { ok: true, name }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// Accept live audio WAV chunks (Uint8Array) from the renderer and save to
// a temp file. This avoids a runtime 'No handler registered for
// "send-audio-chunk"' error when the renderer invokes the channel.
ipcMain.handle('send-audio-chunk', async (event, uint8Array) => {
  try {
    if (!uint8Array) return { ok: false, error: 'No data' }
    const buffer = Buffer.from(uint8Array)
    const filename = path.join(os.tmpdir(), `voicehotkey-chunk-${Date.now()}-${Math.floor(Math.random() * 1000000)}.wav`)
    await fs.promises.writeFile(filename, buffer)
    return { ok: true, path: filename }
  } catch (err) {
    console.error('send-audio-chunk handler error', err)
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

// Transcribe the given webm file: convert to WAV with ffmpeg, then run a configured transcription command.
ipcMain.handle('transcribe', async (event, webmPath) => {
  try {
    if (!webmPath || typeof webmPath !== 'string') return { ok: false, error: 'Invalid path' }
    // Enforce Whisper availability if configured
    if (ENFORCE_WHISPER && (!whisperStatus || !whisperStatus.ok)) {
      return { ok: false, error: 'Whisper is required but not available on this system.' }
    }
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

    // If Whisper is enforced, require it to be available
    if (ENFORCE_WHISPER && (!whisperStatus || !whisperStatus.ok)) {
      return { ok: false, error: 'Whisper is required but not available. Please install or configure Whisper.' }
    }

    // Resolve transcription command template.
    // Preference order: saved setting (user), TRANSCRIBE_CMD env, WHISPER_CMD env, then any forcedTranscribeCmd detected earlier.
    let tpl = store.get('transcribe_cmd') || process.env.TRANSCRIBE_CMD || process.env.WHISPER_CMD || forcedTranscribeCmd || null
    if (!tpl) {
      return { ok: false, error: 'No transcription command configured. Set TRANSCRIBE_CMD env variable or save settings in app.' }
    }

    // If the template doesn't include an explicit model (-m), try to find a local ggml model and inject it.
    try {
      if (!/\-m\s+/i.test(tpl)) {
        const detectedModel = findLocalWhisperModel(tpl && typeof tpl === 'string' ? tpl : null)
        if (detectedModel) {
          // prefer to insert before the {wav} placeholder if possible
          if (/{wav}/.test(tpl)) tpl = tpl.replace(/{wav}/g, `-m ${JSON.stringify(detectedModel)} {wav}`)
          else tpl = `${tpl} -m ${JSON.stringify(detectedModel)} {wav}`
        }
      }
    } catch (e) {
      console.warn('model injection failed', e)
    }

    const cmd = tpl.replace(/{wav}/g, JSON.stringify(wavPath))
    // Log the final command for easier debugging (safe: paths only)
    try { console.log('Running transcription command:', cmd) } catch (e) {}

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
        let polishedText = data.response || text

        // If Ollama removed timestamps and inserted a placeholder like
        // "[removed timestamp]", try to recover a timestamp-like token
        // from the original transcript and re-insert it. This helps when
        // the LLM aggressively strips timecodes but the raw ASR captured
        // a human-readable datetime that should be preserved.
        try {
          const placeholderRE = /\[removed timestamp\]|\[removed time\]|\[timestamp removed\]|\[removed\s?time\]/i
          if (placeholderRE.test(polishedText)) {
            const found = extractTimestampFromText(text)
            if (found) {
              polishedText = polishedText.replace(placeholderRE, found)
            }
          }
        } catch (e) {
          // non-fatal — continue with the polished text
          console.warn('Timestamp reinsertion failed', e)
        }

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

// NOTE: `cleanTranscript` and `extractTimestampFromText` are provided by
// `src/lib/transcript-utils.js` to allow unit testing without loading the
// entire Electron main process.

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
