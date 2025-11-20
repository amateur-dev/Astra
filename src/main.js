const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, clipboard } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { exec } = require('child_process')
const Store = require('electron-store')
const store = new Store()
const logger = require('./lib/logger')
const dependencyManager = require('./lib/dependency-manager')
const { BIN_DIR, MODELS_DIR } = require('./lib/paths')
const { shell } = require('electron')

// Add BIN_DIR to PATH so child_process can find ffmpeg/whisper
process.env.PATH = `${BIN_DIR}${path.delimiter}${process.env.PATH}`

// Redirect console logging to our logger
const originalConsoleLog = console.log
const originalConsoleError = console.error
const originalConsoleWarn = console.warn

console.log = (...args) => {
  logger.info(...args)
  // originalConsoleLog(...args) // logger already writes to stdout
}
console.error = (...args) => {
  logger.error(...args)
  // originalConsoleError(...args) // logger already writes to stderr
}
console.warn = (...args) => {
  logger.warn(...args)
  // originalConsoleWarn(...args) // logger already writes to stdout
}

// Suggested recommended default transcription command (does NOT overwrite user settings)
const SUGGESTED_TRANSCRIBE_CMD = `whisper-cli -m models/ggml-small.en.bin -f {wav} --language en --temperature 0 --best-of 5 --beam-size 5 --split-on-word --word-thold 0.6 -otxt -`

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
let recordingWindow = null
let processingWindow = null
let transcriptWindow = null
let logWindow = null
let tray = null
let isRecording = false
let isCancelled = false
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
  
  // Check dependencies and decide which page to load
  dependencyManager.checkDependencies().then(status => {
    // Check if we have FFmpeg, Whisper, and at least one model
    const hasModel = Object.values(status.models).some(v => v)
    if (status.ffmpeg && status.whisper && hasModel) {
      mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
    } else {
      // Resize for setup wizard
      mainWindow.setSize(700, 600)
      mainWindow.center()
      mainWindow.loadFile(path.join(__dirname, 'renderer', 'setup.html'))
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
  // mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html')) // Handled by checkDependencies above
}

// Define tray icons
const TRAY_ICON_DIR = path.join(__dirname, 'renderer', 'icons')

const makeTrayImage = (fileName) => {
  const imagePath = path.join(TRAY_ICON_DIR, fileName)
  const img = nativeImage.createFromPath(imagePath)
  if (process.platform === 'darwin') {
    img.setTemplateImage(true) // macOS template image (auto invert)
  }
  return img
}

// Preload tray images
const trayImages = {
  idle: makeTrayImage('tray-icon-template.png'),
  recording: makeTrayImage('tray-icon-recording-template.png'),
  processing: makeTrayImage('tray-icon-processing-template.png')
}

function createTray () {
  // Start with idle image
  tray = new Tray(trayImages.idle)
  updateTrayIcon('idle')
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open', click: () => { mainWindow.show() } },
    { label: 'Quit', click: () => { app.quit() } }
  ])
  tray.setToolTip('Voice Hotkey')
  tray.setContextMenu(contextMenu)
}

function updateTrayIcon(state) {
  if (!tray) return
  
  // Update icon image
  const img = trayImages[state] || trayImages.idle
  tray.setImage(img)
  
  // Update tooltip
  const tooltips = {
    idle: 'Voice Hotkey - Ready',
    recording: 'Voice Hotkey - Recording',
    processing: 'Voice Hotkey - Processing'
  }
  tray.setToolTip(tooltips[state] || 'Voice Hotkey')
  console.log(`Tray state updated to: ${state}`)
}

function createRecordingWindow () {
  if (recordingWindow) {
    recordingWindow.show();
    return;
  }
  
  recordingWindow = new BrowserWindow({
    width: 320,
    height: 160,
    type: 'panel', // Helps with floating behavior
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    visibleOnAllWorkspaces: false, // We set this explicitly below with options
    fullscreenable: false,
    focusable: false, // Prevent stealing focus from current app
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  
  recordingWindow.loadFile(path.join(__dirname, 'renderer', 'recording-window.html'))
  
  // Set window level to float above fullscreen apps on macOS
  // 'screen-saver' is the highest level and should appear above everything
  recordingWindow.setAlwaysOnTop(true, 'screen-saver')
  // Crucial for appearing over fullscreen apps without switching spaces
  recordingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  
  // Position on the screen where the cursor currently is (supports multi-monitor and fullscreen apps)
  const { screen } = require('electron')
  const cursorPoint = screen.getCursorScreenPoint()
  const currentDisplay = screen.getDisplayNearestPoint(cursorPoint)
  const { x, y, width, height } = currentDisplay.workArea
  const winBounds = recordingWindow.getBounds()
  recordingWindow.setPosition(
    x + Math.floor((width - winBounds.width) / 2),
    y + Math.floor((height - winBounds.height) / 3)
  )
  
  recordingWindow.on('closed', () => {
    recordingWindow = null
  })
}

function showRecordingWindow () {
  if (!recordingWindow) {
    createRecordingWindow()
  }
  // Use showInactive() to display without stealing focus from current app
  if (recordingWindow) {
    recordingWindow.showInactive()
  }
}

function hideRecordingWindow () {
  if (recordingWindow) {
    recordingWindow.hide()
  }
}

function createProcessingWindow () {
  if (processingWindow) {
    processingWindow.show()
    return
  }

  processingWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  processingWindow.loadFile(path.join(__dirname, 'renderer', 'processing-overlay.html'))

  // Center the window on screen
  const { screen } = require('electron')
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize
  const winBounds = processingWindow.getBounds()
  processingWindow.setPosition(
    Math.round((screenWidth - winBounds.width) / 2),
    Math.round((screenHeight - winBounds.height) / 2)
  )

  processingWindow.on('closed', () => {
    processingWindow = null
  })
}

function showProcessingWindow () {
  if (!processingWindow) {
    createProcessingWindow()
  }
  processingWindow.show()
}

function hideProcessingWindow () {
  if (processingWindow) {
    processingWindow.hide()
  }
}

function createTranscriptWindow () {
  if (transcriptWindow) {
    transcriptWindow.show()
    return
  }

  transcriptWindow = new BrowserWindow({
    width: 680,
    height: 520,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  transcriptWindow.loadFile(path.join(__dirname, 'renderer', 'transcript-result.html'))

  // Center the window on screen
  const { screen } = require('electron')
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize
  const winBounds = transcriptWindow.getBounds()
  transcriptWindow.setPosition(
    Math.round((screenWidth - winBounds.width) / 2),
    Math.round((screenHeight - winBounds.height) / 2)
  )

  transcriptWindow.on('closed', () => {
    transcriptWindow = null
  })
}

function showTranscriptWindow (text) {
  if (!transcriptWindow) {
    createTranscriptWindow()
  }
  
  // Wait for window to be ready, then send transcript data
  if (transcriptWindow.webContents.isLoading()) {
    transcriptWindow.webContents.once('did-finish-load', () => {
      transcriptWindow.webContents.send('transcript-data', text)
    })
  } else {
    transcriptWindow.webContents.send('transcript-data', text)
  }
  
  transcriptWindow.show()
}

function hideTranscriptWindow () {
  if (transcriptWindow) {
    transcriptWindow.hide()
  }
}

function createLogWindow () {
  if (logWindow) {
    logWindow.show()
    return
  }
  
  logWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Application Logs',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  })
  
  logWindow.loadFile(path.join(__dirname, 'renderer', 'logs.html'))
  
  logWindow.on('closed', () => {
    logWindow = null
  })
}


function registerHotkey (hotkey) {
  try {
    // Remove any existing shortcut
    globalShortcut.unregisterAll()
    if (!hotkey) {
      // empty hotkey: unregister and return success
      try { store.delete('hotkey') } catch (e) {}
      console.log('Hotkey cleared')
      return true
    }
    const ok = globalShortcut.register(hotkey, () => {
      console.log('Hotkey pressed:', hotkey, 'current isRecording:', isRecording)
      isRecording = !isRecording
      console.log('Toggled isRecording to:', isRecording)
      
      // Show/hide recording window and update tray icon
      if (isRecording) {
        // Register Escape key to cancel recording
        globalShortcut.register('Escape', () => {
          handleCancelRecording()
        })

        // Hide main window when recording starts
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.hide()
        }
        showRecordingWindow()
        updateTrayIcon('recording')
        // Notify recording window that recording has started
        if (recordingWindow && recordingWindow.webContents) {
          recordingWindow.webContents.send('recording-start')
        }
      } else {
        // Unregister Escape key
        globalShortcut.unregister('Escape')

        // Keep recording window visible, just change its state to processing
        updateTrayIcon('processing') // Will change to idle after transcription completes
        // Notify recording window to switch to processing mode
        if (recordingWindow && recordingWindow.webContents) {
          recordingWindow.webContents.send('recording-stop')
          recordingWindow.webContents.send('show-processing')
        }
      }
      
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('record-toggle', isRecording)
        console.log('Sent record-toggle event to renderer')
        
        // Ensure recording window is shown/hidden correctly
        if (isRecording) {
          showRecordingWindow()
          // Note: 'recording-start' is already sent above, do not send it again here
        } else {
          // Note: 'recording-stop' and 'show-processing' are already sent above
          // We don't want to hide it here because it needs to show processing state
          // hideRecordingWindow() // Removed to allow processing state to show
        }
      } else {
        console.warn('mainWindow not available to send record-toggle')
      }
    })
    console.log(`Hotkey registration for '${hotkey}': ${ok ? 'SUCCESS' : 'FAILED'}`)
    return ok
  } catch (e) {
    console.error('registerHotkey error', e)
    return false
  }
}

app.whenReady().then(() => {
  // Hide from dock to prevent space switching when app is active
  if (process.platform === 'darwin') {
    app.dock.hide()
  }
  createWindow()
  createTray()

  // register a simple global shortcut: Cmd+Shift+V to toggle recording
  // Get stored hotkey or default
  const savedHotkey = store.get('hotkey') || process.env.HOTKEY || 'CommandOrControl+Shift+V'
  console.log('Attempting to register hotkey:', savedHotkey)
  const ret = registerHotkey(savedHotkey)
  if (!ret) {
    console.error('ERROR: Global shortcut registration failed for hotkey:', savedHotkey)
  } else {
    console.log('Global shortcut registered successfully:', savedHotkey)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

ipcMain.handle('app-version', () => app.getVersion())

ipcMain.handle('open-log-viewer', () => {
  createLogWindow()
})

ipcMain.handle('get-logs', () => {
  return logger.getLogs()
})

ipcMain.handle('clear-logs', () => {
  logger.clearLogs()
  return true
})

ipcMain.handle('check-ollama', async () => {
  try {
    const ollamaUrl = store.get('ollama_url') || 'http://localhost:11434'
    if (!fetch) {
      return { installed: false, running: false, error: 'No fetch implementation available' }
    }
    const response = await fetch(`${ollamaUrl}/api/tags`, { 
      method: 'GET',
      signal: AbortSignal.timeout(2000) // 2 second timeout
    })
    return { installed: true, running: response.ok }
  } catch (err) {
    return { installed: false, running: false, error: String(err) }
  }
})

// Dependency Management IPC
ipcMain.handle('check-dependencies', async () => {
  return await dependencyManager.checkDependencies()
})

ipcMain.handle('download-dependency', async (event, type, param) => {
  const onProgress = (progress) => {
    // If downloading a model, include the model key in the type so UI can track specific downloads
    const progressType = type === 'model' ? `model:${param}` : type
    event.sender.send('download-progress', { type: progressType, progress })
  }
  
  try {
    if (type === 'ffmpeg') {
      await dependencyManager.installFFmpeg(onProgress)
    } else if (type === 'whisper') {
      await dependencyManager.installWhisper(onProgress)
    } else if (type === 'model') {
      await dependencyManager.downloadModel(param, onProgress)
    }
    return true
  } catch (e) {
    console.error('Download failed:', e)
    throw e
  }
})

ipcMain.handle('finish-setup', () => {
  if (mainWindow) {
    mainWindow.setSize(400, 300)
    mainWindow.center()
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  }
})

ipcMain.handle('get-available-models', async () => {
  try {
    const currentModelFilename = store.get('model') || 'ggml-small.en.bin'
    const modelsList = []
    
    // Use the defined MODELS from dependency-manager to return rich info
    for (const [key, info] of Object.entries(dependencyManager.MODELS)) {
      const isInstalled = fs.existsSync(path.join(MODELS_DIR, info.filename))
      modelsList.push({
        key: key, // e.g. 'tiny.en'
        filename: info.filename,
        size: info.size,
        ram: info.ram,
        desc: info.desc,
        installed: isInstalled,
        active: info.filename === currentModelFilename
      })
    }
    
    return { models: modelsList, current: currentModelFilename }
  } catch (e) {
    console.error('get-available-models error', e)
    return { models: [], current: '' }
  }
})

ipcMain.handle('set-model', async (event, model) => {
  store.set('model', model)
  return true
})

ipcMain.handle('set-hotkey', async (event, hotkey) => {
  store.set('hotkey', hotkey)
  const ok = registerHotkey(hotkey)
  if (ok) return { ok: true, hotkey }
  return { ok: false, error: 'Failed to register hotkey' }
})

ipcMain.handle('open-external', async (event, url) => {
  await shell.openExternal(url)
})

ipcMain.handle('get-settings', async () => {
  return {
    transcribe_cmd: store.get('transcribe_cmd'),
    auto_transcribe: store.get('auto_transcribe'),
    ollama_url: store.get('ollama_url'),
    ollama_model: store.get('ollama_model'),
    ollama_enabled: store.get('ollama_enabled'),
    auto_paste: store.get('auto_paste'),
    ffmpeg_path: store.get('ffmpeg_path'),
    hotkey: store.get('hotkey'),
    model: store.get('model')
  }
})

ipcMain.handle('save-settings', async (event, settings) => {
  if (settings.transcribe_cmd !== undefined) store.set('transcribe_cmd', settings.transcribe_cmd)
  if (settings.auto_transcribe !== undefined) store.set('auto_transcribe', settings.auto_transcribe)
  if (settings.ollama_url !== undefined) store.set('ollama_url', settings.ollama_url)
  if (settings.ollama_model !== undefined) store.set('ollama_model', settings.ollama_model)
  if (settings.ollama_enabled !== undefined) store.set('ollama_enabled', settings.ollama_enabled)
  if (settings.auto_paste !== undefined) store.set('auto_paste', settings.auto_paste)
  if (settings.ffmpeg_path !== undefined) store.set('ffmpeg_path', settings.ffmpeg_path)
  if (settings.hotkey !== undefined) {
    store.set('hotkey', settings.hotkey)
    registerHotkey(settings.hotkey)
  }
  if (settings.model !== undefined) store.set('model', settings.model)
  return true
})

// Helper to handle recording cancellation
async function handleCancelRecording() {
  try {
    console.log('Cancelling recording...')
    isCancelled = true
    isRecording = false
    globalShortcut.unregister('Escape') // Unregister Escape shortcut
    hideRecordingWindow()
    updateTrayIcon('idle')
    
    // Stop recording in main window (stops actual recording)
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('record-toggle', false)
    }
    
    // Stop recording in recording window (stops waveform and releases mic)
    if (recordingWindow && recordingWindow.webContents) {
      recordingWindow.webContents.send('recording-stop')
    }
    
    return { ok: true }
  } catch (err) {
    console.error('handleCancelRecording error:', err)
    return { ok: false, error: String(err) }
  }
}

// Recording window handlers
ipcMain.handle('cancel-recording', async () => {
  return handleCancelRecording()
})

ipcMain.handle('is-recording', async () => {
  return isRecording
})

// Cancel ongoing transcription and hide processing window
ipcMain.handle('cancel-transcription', async () => {
  try {
    hideProcessingWindow()
    updateTrayIcon('idle')
    console.log('Transcription cancelled by user')
    return { ok: true }
  } catch (err) {
    console.error('cancel-transcription error:', err)
    return { ok: false, error: String(err) }
  }
})

// Close transcript result window
ipcMain.handle('close-transcript-window', async () => {
  try {
    hideTranscriptWindow()
    console.log('Transcript window closed')
    return { ok: true }
  } catch (err) {
    console.error('close-transcript-window error:', err)
    return { ok: false, error: String(err) }
  }
})

// Test the configured transcription command. This will try to locate the binary and check the model file if present.
ipcMain.handle('test-transcribe', async (event) => {
  try {
    let tpl = store.get('transcribe_cmd') || process.env.TRANSCRIBE_CMD || process.env.WHISPER_CMD
    
    if (!tpl) {
       const modelName = store.get('model') || 'ggml-small.en.bin'
       const modelPath = path.join(MODELS_DIR, modelName)
       tpl = `whisper-cli -m "${modelPath}" -f {wav} --language en --temperature 0 --best-of 5 --beam-size 5 --split-on-word --word-thold 0.6 -otxt -`
    }

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
    // Check if recording was cancelled
    if (isCancelled) {
      console.log('Recording was cancelled, discarding data')
      isCancelled = false // Reset flag
      hideRecordingWindow()
      updateTrayIcon('idle')
      return { ok: true, cancelled: true }
    }

    const buffer = Buffer.from(uint8Array)
    // If the incoming buffer looks like WAV (RIFF), name it as .wav; otherwise use .webm
    const isWav = buffer.length >= 4 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    const ext = isWav ? 'wav' : 'webm'
    const filename = path.join(os.tmpdir(), `voicehotkey-${Date.now()}.${ext}`)
    await fs.promises.writeFile(filename, buffer)
    console.log('Saved recording to:', filename)
    // If auto_transcribe is enabled in settings (defaults to true), run transcription now and return transcript
    const auto = store.get('auto_transcribe') !== false
    console.log('Auto-transcribe enabled:', auto)
    if (auto) {
      try {
        console.log('Starting auto-transcription...')
        
        // Send initial progress update
        if (processingWindow && processingWindow.webContents) {
          processingWindow.webContents.send('processing-progress', {
            progress: 10,
            status: 'transcribing',
            subStatus: 'Preparing audio...'
          })
        }
        
        let tx = null
        // If the file is a WAV, call transcribeWav directly; else transcribeWebm
        const fileIsWav = buffer.length >= 4 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
        if (fileIsWav) {
          console.log('Transcribing WAV file...')
          
          if (processingWindow && processingWindow.webContents) {
            processingWindow.webContents.send('processing-progress', {
              progress: 30,
              status: 'transcribing',
              subStatus: 'Running Whisper...'
            })
          }
          
          tx = await transcribeWav(filename)
        } else {
          console.log('Transcribing WebM file...')
          
          if (processingWindow && processingWindow.webContents) {
            processingWindow.webContents.send('processing-progress', {
              progress: 30,
              status: 'transcribing',
              subStatus: 'Converting and transcribing...'
            })
          }
          
          tx = await transcribeWebm(filename)
        }
        console.log('Transcription result:', tx)
        if (tx && tx.ok) {
          // Send progress update for cleaning
          if (processingWindow && processingWindow.webContents) {
            processingWindow.webContents.send('processing-progress', {
              progress: 80,
              status: 'finalizing',
              subStatus: 'Cleaning transcript...'
            })
          }
          
          // Check if Ollama polishing is enabled
          const ollamaEnabled = store.get('ollama_enabled') === true
          let finalText = tx.text
          let polishError = null
          // Track metadata about whether polishing was attempted/used and any errors
          let polishUsed = null
          let polishTried = null
          let polishErrors = null
          
          // Only attempt polishing if there is non-empty transcript text
            // Do not auto-polish with Ollama during save-recording auto-transcribe.
            // Keep polish optional and on-demand: use explicit 'polish-transcript' IPC.
          // Clean the final text (strip timestamps/caveat) before any further actions
          finalText = cleanTranscript(finalText)
          console.log('Final cleaned text:', finalText)

          // Send progress update for pasting
          if (processingWindow && processingWindow.webContents) {
            processingWindow.webContents.send('processing-progress', {
              progress: 95,
              status: 'finalizing',
              subStatus: 'Preparing to paste...'
            })
          }

          // If auto_paste is enabled, attempt to paste the final text into the front app
          let pasteResult = null
          const autoPaste = store.get('auto_paste') !== false
          console.log('Auto-paste enabled:', autoPaste)
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

          // Reset tray icon to idle and hide recording window after successful transcription
          hideRecordingWindow()
          updateTrayIcon('idle')
          
          // Only show main window if paste failed or auto-paste is disabled
          // If paste succeeded, stay in background to avoid desktop switching
          const shouldShowMainWindow = !autoPaste || (pasteResult && !pasteResult.ok)
          
          if (shouldShowMainWindow && mainWindow && !mainWindow.isVisible()) {
            mainWindow.show()
          }

          // If paste failed and we have text, show transcript window
          if (autoPaste && finalText && pasteResult && !pasteResult.ok) {
            console.log('Paste failed, showing transcript window')
            showTranscriptWindow(finalText)
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
        console.error('Transcription failed or returned no data:', tx)
        hideRecordingWindow()
        updateTrayIcon('idle') // Reset even on failure
        // Only show main window on error (user needs to see something went wrong)
        if (mainWindow && !mainWindow.isVisible()) mainWindow.show()
        return { ok: true, path: filename, autoTranscribed: true, error: tx && tx.error ? tx.error : 'transcription failed' }
      } catch (err) {
        console.error('Auto-transcription exception:', err)
        hideRecordingWindow()
        updateTrayIcon('idle') // Reset even on error
        if (mainWindow && !mainWindow.isVisible()) mainWindow.show()
        return { ok: true, path: filename, autoTranscribed: true, error: String(err) }
      }
    }
    console.log('Auto-transcribe disabled, returning saved path only')
    hideRecordingWindow()
    updateTrayIcon('idle')
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show()
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

    // Don't auto-polish rolling transcription. Keep polishing opt-in; polishing
    // can be invoked by the renderer via 'polish-transcript' if needed.

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
ipcMain.handle('transcribe', async (event, webmPath, options = {}) => {
  try {
    if (!webmPath || typeof webmPath !== 'string') return { ok: false, error: 'Invalid path' }
    // ensure ffmpeg exists
    const ffmpegCmd = 'ffmpeg'
    // create wav path
    const wavPath = path.join(os.tmpdir(), `voicehotkey-${Date.now()}.wav`)
    // delegate to shared helper
    const tx = await transcribeWebm(webmPath, options)
    return tx
  } catch (err) {
    console.error('transcribe handler error', err)
    return { ok: false, error: String(err) }
  }
})

// Explicit on-demand polish for a transcript using Ollama.
ipcMain.handle('polish-transcript', async (event, text, options = {}) => {
  try {
    if (!text || String(text).trim().length === 0) return { ok: false, error: 'No text to polish' }
    const held = await polishWithOllama(text)
    if (held && held.ok) return { ok: true, text: held.text, used: held.used, tried: held.tried }
    return { ok: false, error: held && held.error ? held.error : 'polish failed', tried: held && held.tried ? held.tried : null }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

// helper: convert webm -> wav and run configured transcription command template
async function transcribeWebm (webmPath, options = {}) {
  try {
    // find ffmpeg executable (bundled, user-configured, or system)
    const ffmpegCmd = await findFfmpeg()
    const wavPath = path.join(os.tmpdir(), `voicehotkey-${Date.now()}.wav`)
    let finalWav = wavPath
    if (!ffmpegCmd) {
      return { ok: false, error: 'ffmpeg not found. Install ffmpeg (Homebrew: `brew install ffmpeg`) or bundle ffmpeg in the app.' }
    }
    await new Promise((resolve, reject) => {
      // Convert and apply a lightweight silence-trim filter to remove long
      // leading/trailing pauses which can confuse the decoder. This reduces
      // total decoder time and hallucinations.
      const cmd = `${JSON.stringify(ffmpegCmd)} -y -i ${JSON.stringify(webmPath)} -af "silenceremove=start_periods=1:start_duration=0.5:start_threshold=-50dB:stop_periods=1:stop_duration=0.5:stop_threshold=-50dB" -ar 16000 -ac 1 -sample_fmt s16 ${JSON.stringify(wavPath)}`
      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          console.error('ffmpeg failed', err, stderr)
          return reject(new Error('ffmpeg failed: ' + (stderr || err.message)))
        }
        resolve()
      })
    })

    let tpl = store.get('transcribe_cmd') || process.env.TRANSCRIBE_CMD || process.env.WHISPER_CMD
    
    if (!tpl) {
       const modelName = store.get('model') || 'ggml-small.en.bin'
       const modelPath = path.join(MODELS_DIR, modelName)
       // Use absolute path for model to be safe
       tpl = `whisper-cli -m "${modelPath}" -f {wav} --language en --temperature 0 --best-of 5 --beam-size 5 --split-on-word --word-thold 0.6 -otxt -`
    }

    const cmd = tpl.replace(/{wav}/g, JSON.stringify(finalWav))

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
    // If options.polishNow, perform an on-demand Ollama polish and include under `polished` key
    if (options && options.polishNow === true) {
      try {
        const polished = await polishWithOllama(finalText)
        if (polished && polished.ok) {
          return { ok: true, text: finalText, raw: transcript, wav: wavPath, polished: polished.text, polishedUsed: polished.used }
        } else {
          return { ok: true, text: finalText, raw: transcript, wav: wavPath, polished: null, polishedError: polished && polished.error ? polished.error : 'unknown' }
        }
      } catch (err) {
        return { ok: true, text: finalText, raw: transcript, wav: wavPath, polished: null, polishedError: String(err) }
      }
    }
    return { ok: true, text: finalText, raw: transcript, wav: wavPath }
  } catch (err) {
    console.error('transcribeWebm error', err)
    return { ok: false, error: String(err) }
  }
}

// helper: run transcription on an existing WAV file with configured transcription command
async function transcribeWav (wavPath, options = {}) {
  try {
    if (!wavPath || typeof wavPath !== 'string') return { ok: false, error: 'Invalid wav path' }
    
    let tpl = store.get('transcribe_cmd') || process.env.TRANSCRIBE_CMD || process.env.WHISPER_CMD
    
    if (!tpl) {
       const modelName = store.get('model') || 'ggml-small.en.bin'
       const modelPath = path.join(MODELS_DIR, modelName)
       // Use absolute path for model to be safe
       tpl = `whisper-cli -m "${modelPath}" -f {wav} --language en --temperature 0 --best-of 5 --beam-size 5 --split-on-word --word-thold 0.6 -otxt -`
    }

    console.log('Transcribe command template:', tpl)
    if (!tpl) {
      return { ok: false, error: 'No transcription command configured. Set TRANSCRIBE_CMD env variable or save settings in app.' }
    }
    // If ffmpeg is available, create a trimmed temporary WAV to avoid
    // passing long silences to the decoder which can reduce accuracy.
    let finalWav = wavPath
    try {
      const ffmpegCmd = await findFfmpeg()
      console.log('FFmpeg command:', ffmpegCmd)
      if (ffmpegCmd) {
        const trimmed = path.join(os.tmpdir(), `voicehotkey-trimmed-${Date.now()}.wav`)
        // Use silenceremove to drop long leading/trailing silence.
        await new Promise((resolve, reject) => {
          const cmd = `${JSON.stringify(ffmpegCmd)} -y -i ${JSON.stringify(wavPath)} -af "silenceremove=start_periods=1:start_duration=0.5:start_threshold=-50dB:stop_periods=1:stop_duration=0.5:stop_threshold=-50dB" -ar 16000 -ac 1 -sample_fmt s16 ${JSON.stringify(trimmed)}`
          console.log('FFmpeg trim command:', cmd)
          exec(cmd, (err, stdout, stderr) => {
            if (err) return reject(new Error('ffmpeg trim failed: ' + (stderr || err.message)))
            resolve()
          })
        })
        finalWav = trimmed
        console.log('Trimmed WAV created:', trimmed)
      }
    } catch (e) {
      // If trimming fails, fall back to original WAV
      console.warn('silence trim failed, proceeding with original WAV', e)
      finalWav = wavPath
    }

    const cmd = tpl.replace(/{wav}/g, JSON.stringify(finalWav))
    console.log('Executing transcription command:', cmd)
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
    if (options && options.polishNow === true) {
      try {
        const polished = await polishWithOllama(finalText)
        if (polished && polished.ok) return { ok: true, text: finalText, raw: transcript, wav: wavPath, polished: polished.text, polishedUsed: polished.used }
        return { ok: true, text: finalText, raw: transcript, wav: wavPath, polished: null, polishedError: polished && polished.error ? polished.error : 'unknown' }
      } catch (err) {
        return { ok: true, text: finalText, raw: transcript, wav: wavPath, polished: null, polishedError: String(err) }
      }
    }
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
    // First, remove timestamp patterns like [00:00:00.000 --> 00:00:07.000] from the text
    // This handles both inline timestamps and standalone timestamp lines
    let cleaned = text.replace(/\[\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\s*-->\s*\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\]/g, '')
    // Also remove standalone timestamp patterns without brackets
    cleaned = cleaned.replace(/\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\s*-->\s*\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?/g, '')
    
    // Split into lines and clean each line
    const rawLines = cleaned.split(/\r?\n/)
    const lines = []
    for (let i = 0; i < rawLines.length; i++) {
      let line = rawLines[i].trim()
      if (!line) continue
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
