const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, clipboard, systemPreferences, desktopCapturer, Notification, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { exec } = require('child_process')
const Store = require('electron-store')
const store = new Store({
  defaults: {
    auto_paste: true,
    auto_transcribe: true,
    screen_context_enabled: false,
    enable_ai_caveat: true
  }
})
const logger = require('./lib/logger')
const dependencyManager = require('./lib/dependency-manager')
const { BIN_DIR, MODELS_DIR, WHISPER_PATH, PIPER_PATH, VOICE_MODEL_PATH } = require('./lib/paths')
const { shell } = require('electron')
const ttsUtils = require('./lib/tts-utils');

// Resolve a usable `fetch` in the main process.
let fetch;
(async () => {
  if (global.fetch) {
    fetch = global.fetch;
  } else if (typeof globalThis.fetch === 'function') {
    fetch = globalThis.fetch.bind(globalThis);
  } else {
    try {
      const nf = require('node-fetch');
      fetch = nf && (nf.default || nf);
    } catch (errRequire) {
      try {
        const nodeFetch = await import('node-fetch');
        fetch = nodeFetch && (nodeFetch.default || nodeFetch);
      } catch (errImport) {
        try {
          const undici = require('undici');
          fetch = undici && undici.fetch;
        } catch (errUndici) {
          console.error('Failed to load any fetch implementation:', errRequire, errImport, errUndici);
        }
      }
    }
  }
})();

const whisperServerManager = require('./lib/whisper-server-manager');
const memoryManager = require('./lib/memory-manager');
const TTS_HOTKEY = 'CommandOrControl+Shift+D';

async function performMacOCR(dataUrl) {
  try {
    if (process.platform !== 'darwin') return null;
    
    // Save base64 to temp file
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');
    const tmpPath = path.join(os.tmpdir(), `ocr_tmp_${Date.now()}.jpg`);
    fs.writeFileSync(tmpPath, buffer);
    
    // Compile and run swift script
    const scriptPath = path.join(__dirname, 'lib', 'mac-ocr.swift');
    const ocrText = await new Promise((resolve) => {
      exec(`swift "${scriptPath}" "${tmpPath}"`, (error, stdout) => {
        if (error) {
          console.error('OCR execution failed:', error);
          resolve(null);
        } else {
          resolve(stdout.trim());
        }
      });
    });
    
    // Cleanup
    try { fs.unlinkSync(tmpPath); } catch(e) {}
    
    return ocrText;
  } catch (err) {
    console.error('performMacOCR error:', err);
    return null;
  }
}

// Helper: Clean up temporary files
async function cleanupTempFiles(forceAll = false) {
  try {
    const tmpDir = os.tmpdir();
    const files = await fs.promises.readdir(tmpDir);
    const now = Date.now();
    const maxAge = forceAll ? 0 : 24 * 60 * 60 * 1000; // 24 hours

    for (const file of files) {
      if (file.startsWith('voicehotkey-') || file.startsWith('streaming-')) {
        const filePath = path.join(tmpDir, file);
        const stats = await fs.promises.stat(filePath);
        if (now - stats.mtimeMs > maxAge) {
          await fs.promises.unlink(filePath).catch(() => {});
        }
      }
    }
    console.log(`Cleanup complete${forceAll ? ' (forced)' : ''}`);
  } catch (err) {
    console.error('Cleanup failed:', err);
  }
}

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
const SUGGESTED_TRANSCRIBE_CMD = `"${WHISPER_PATH}" -m models/ggml-small.en.bin -f {wav} --language en --temperature 0 --best-of 5 --beam-size 5 --split-on-word --word-thold 0.6 -nt`

let mainWindow = null
let recordingWindow = null
let processingWindow = null
let transcriptWindow = null
let logWindow = null
let overlayWindows = []
let tray = null
let isRecording = false
let isCopilotMode = false
let copilotContext = null
let screenContext = null
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

  mainWindow.on('closed', () => {
    mainWindow = null
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
    { label: 'Open', click: () => { 
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show() 
      } else {
        createWindow()
      }
    }},
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

function createOverlayWindows () {
  if (overlayWindows.length > 0) return

  const displays = screen.getAllDisplays()
  displays.forEach(display => {
    const { width, height, x, y } = display.bounds

    let win = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    win.setIgnoreMouseEvents(true, { forward: true })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    win.loadFile(path.join(__dirname, 'renderer', 'overlay.html'))
    
    win.on('closed', () => {
      overlayWindows = overlayWindows.filter(w => w !== win)
    })
    
    overlayWindows.push(win)
  })
}

async function captureScreen() {
  try {
    const sources = await desktopCapturer.getSources({ 
      types: ['screen'], 
      thumbnailSize: { width: 800, height: 450 } // Resolution tuned for fast LLM processing
    });
    if (sources && sources.length > 0) {
      // Use the first screen as primary. Convert to JPEG with 50% quality for maximum speed.
      const dataUrl = sources[0].thumbnail.toDataURL('image/jpeg', 50);
      console.log('Screen captured successfully (Heavily Optimized JPEG)');
      return dataUrl;
    }
  } catch (err) {
    console.error('Failed to capture screen:', err);
  }
  return null;
}

async function captureSelectedText() {
  const script = `
    tell application "System Events"
      set frontApp to first application process whose frontmost is true
      set frontAppName to name of frontApp
      tell process frontAppName
        keystroke "c" using {command down}
      end tell
      return frontAppName
    end tell
  `;
  
  clipboard.clear();
  
  return new Promise((resolve) => {
    exec(`osascript -e '${script}'`, (err, stdout, stderr) => {
      if (err) {
        console.error('Failed to copy text', err)
        return resolve(null);
      }
      
      let attempts = 0;
      const checkClipboard = setInterval(() => {
        const text = clipboard.readText();
        attempts++;
        
        if (text) {
          clearInterval(checkClipboard);
          resolve(text);
        } else if (attempts > 10) {
           clearInterval(checkClipboard);
           resolve(null);
        }
      }, 100);
    });
  });
}

function toggleRecording(visionMode = false) {
  console.log('toggleRecording called, visionMode:', visionMode, 'current isRecording:', isRecording)
  
  if (!isRecording) {
    // Warm up Ollama in the background (fire and forget)
    if (store.get('ollama_enabled') === true) {
      const ollamaUrl = store.get('ollama_url') || 'http://localhost:11434';
      const ollamaModel = store.get('ollama_model') || 'qwen2.5:1.5b';
      const url = `${ollamaUrl.trim().replace(/\/+$/, '')}/api/generate`;
      
      // We use dynamic import for node-fetch to ensure it works in Electron main process
      import('node-fetch').then(nodeFetch => {
        const localFetch = nodeFetch.default;
        localFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Sending an empty prompt with keep_alive loads the model into RAM without generating text
          body: JSON.stringify({ model: ollamaModel, prompt: '', keep_alive: '5m' })
        }).then(() => console.log('Ollama warmup triggered successfully'))
          .catch(e => console.log('Ollama warmup failed silently:', e.message));
      }).catch(e => console.log('Could not load node-fetch for warmup:', e.message));
    }

    if (visionMode) {
      captureScreen().then(async (dataUrl) => {
        if (dataUrl) {
          console.log('Running native macOS OCR for vision context...');
          const ocrText = await performMacOCR(dataUrl);
          if (ocrText && ocrText.length > 5) {
            screenContext = ocrText;
            console.log('OCR extracted text successfully.');
          } else {
            console.log('OCR extracted no meaningful text, falling back to pure image data.');
            screenContext = dataUrl; // Fallback to sending raw image to Ollama if OCR fails
          }
        }
      });
    } else {
      screenContext = null;
    }

    // Always attempt to capture selected text for better context
    captureSelectedText().then(text => {
      copilotContext = text;
      // If we have selected text or we are in vision mode, treat this as a "Copilot/Instruction" task
      isCopilotMode = !!text || visionMode;
      console.log('Text context captured:', text ? text.substring(0, 50) + '...' : 'NONE', 'isCopilotMode:', isCopilotMode);
    });
  }

  isRecording = !isRecording
  console.log('Toggled isRecording to:', isRecording)
  
  // Show/hide recording window and update tray icon
  if (isRecording) {
    // Register Escape key to cancel recording
    globalShortcut.register('Escape', () => {
      handleCancelRecording()
    })

    // Hide main window when recording starts
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.hide()
    }
    showRecordingWindow()
    updateTrayIcon('recording')
    // Notify recording window that recording has started
    if (recordingWindow && recordingWindow.webContents) {
      recordingWindow.webContents.send('recording-start', { isCopilot: isCopilotMode })
    }

    const screenEnabled = store.get('screen_context_enabled') === true;
    const hasScreenContext = screenEnabled || copilot;
    overlayWindows.forEach(win => {
      if (!win.isDestroyed()) {
        win.showInactive();
        win.webContents.send('recording-started', { hasContext: hasScreenContext });
      }
    });
  } else {
    // Unregister Escape key
    globalShortcut.unregister('Escape')

    overlayWindows.forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('recording-stopped');
        setTimeout(() => {
          if (!win.isDestroyed() && !isRecording) {
            win.hide();
          }
        }, 350);
      }
    });

    // Keep recording window visible, just change its state to processing
    updateTrayIcon('processing') // Will change to idle after transcription completes
    // Notify recording window to switch to processing mode
    if (recordingWindow && recordingWindow.webContents) {
      recordingWindow.webContents.send('recording-stop')
      recordingWindow.webContents.send('show-processing')
    }
  }
  
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send('record-toggle', isRecording)
  }
}

function registerHotkey (hotkey) {
  try {
    // Remove any existing shortcut
    globalShortcut.unregisterAll()

    // --- TTS Functionality Integration ---
    if (hotkey !== TTS_HOTKEY) {
      globalShortcut.register(TTS_HOTKEY, () => {
        console.log('TTS Hotkey pressed')
        captureSelectedText().then(text => {
          if (text) {
            console.log(`TTS: Speaking ${text.length} chars`);
            ttsUtils.speak(text).catch(e => console.error('TTS Speak Error:', e));
          } else {
            console.warn('TTS: No text selected');
          }
        });
      });
      console.log('TTS Hotkey registered:', TTS_HOTKEY)
    }

    // --- Vision/Copilot Hotkey Integration ---
    const visionHotkey = store.get('vision_hotkey') || 'CommandOrControl+Option+Shift+V';
    if (hotkey !== visionHotkey && TTS_HOTKEY !== visionHotkey) {
      globalShortcut.register(visionHotkey, () => {
        console.log('Vision Hotkey pressed')
        toggleRecording(true);
      });
      console.log('Vision Hotkey registered:', visionHotkey)
    }

    if (!hotkey) {
      // empty hotkey: unregister and return success
      try { store.delete('hotkey') } catch (e) {}
      console.log('Hotkey cleared')
      return true
    }
    const ok = globalShortcut.register(hotkey, () => {
      toggleRecording(false);
    })
    console.log(`Hotkey registration for '${hotkey}': ${ok ? 'SUCCESS' : 'FAILED'}`)
    return ok
  } catch (e) {
    console.error('registerHotkey error', e)
    return false
  }
}

app.whenReady().then(async () => {
  // Check Accessibility Permissions (MacOS)
  if (process.platform === 'darwin') {
      const isTrusted = systemPreferences.isTrustedAccessibilityClient(true);
      if (!isTrusted) {
          console.warn('WARNING: Accessibility permissions missing. Prompting user...');
      } else {
          console.log('Accessibility permissions: GRANTED');
      }

      // Explicitly request microphone access to avoid silent failures
      try {
        const micStatus = systemPreferences.getMediaAccessStatus('microphone');
        console.log(`Initial Microphone Status: ${micStatus}`);
        if (micStatus !== 'granted') {
          console.log('Prompting for microphone access...');
          const granted = await systemPreferences.askForMediaAccess('microphone');
          console.log(`Microphone access granted: ${granted}`);
        }
      } catch (err) {
        console.error('Failed to request microphone access:', err);
      }
  }

  // Hide from dock to prevent space switching when app is active
  if (process.platform === 'darwin') {
    app.dock.hide()
  }
  createWindow()
  createTray()
  createOverlayWindows()

  // Run cleanup on startup to remove old voice notes
  // First, do a deep cleanup of everything from previous sessions
  cleanupTempFiles(true);

  // Run OpenClaw-style memory compaction
  setTimeout(() => {
    memoryManager.compactMemory(callOllama).catch(err => {
      console.error('Startup memory compaction failed:', err);
    });
  }, 5000); // Wait 5s after startup to not block UI

  // register a simple global shortcut: Cmd+Shift+V to toggle recording
  // Get stored hotkey or default
  let savedHotkey = store.get('hotkey') || process.env.HOTKEY || 'CommandOrControl+Shift+V'
  
  console.log('Attempting to register hotkey:', savedHotkey)
  const ret = registerHotkey(savedHotkey)
  if (!ret) {
    console.error('ERROR: Global shortcut registration failed for hotkey:', savedHotkey)
  } else {
    console.log('Global shortcut registered successfully:', savedHotkey)
  }

// Start Whisper Server for real-time streaming
  const modelName = store.get('model') || 'ggml-small.en.bin'
  const modelPath = path.join(MODELS_DIR, modelName)
  whisperServerManager.start(modelPath).catch(err => {
    console.error('Failed to start Whisper Server:', err)
  })

  // Background check/install for Piper + Voice Model
  setTimeout(async () => {
    logger.info('Starting background dependency check (Piper + Voice Model)...')
    try {
      if (!fs.existsSync(PIPER_PATH)) {
        logger.info('Piper missing. Installing now...')
        await dependencyManager.installPiper()
      }
      if (!fs.existsSync(VOICE_MODEL_PATH)) {
        logger.info('Voice Model missing. Installing now...')
        await dependencyManager.installVoiceModel()
      }
      logger.info('Background dependency check complete.')
    } catch (err) {
      logger.error('Background dependency check failed:', err)
    }
  }, 1000)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  ttsUtils.stop()
  whisperServerManager.stop()
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
    let localFetch = fetch;
    if (!localFetch) {
      const nodeFetch = await import('node-fetch');
      localFetch = nodeFetch.default;
    }

    const ollamaUrl = store.get('ollama_url') || 'http://localhost:11434'
    const configuredModel = store.get('ollama_model') || 'qwen2.5:1.5b'

    if (!localFetch) {
      return { installed: false, running: false, error: 'No fetch implementation available' }
    }

    // Try configured URL, then fallback to 127.0.0.1 if it's localhost
    const candidates = [ollamaUrl];
    if (ollamaUrl.includes('localhost') && !ollamaUrl.includes('127.0.0.1')) {
       candidates.push(ollamaUrl.replace('localhost', '127.0.0.1'));
    }

    let lastError = null;
    for (const url of candidates) {
        try {
            const response = await localFetch(`${url}/api/tags`, {
              method: 'GET',
            });

            if (response.ok) {
              const data = await response.json()
              const models = data.models || []

              const hasConfiguredModel = models.some(m => m.name.includes(configuredModel))
              const hasVisionModel = models.some(m => 
                m.name.includes('vision') || 
                m.name.includes('llava') || 
                m.name.includes('llama3.2') ||
                m.name.includes('qwen') || 
                m.name.includes('gemma') ||
                m.name.includes('bakllava') ||
                m.name.includes('moondream')
              )

              return { 
                installed: true,
                running: true, 
                models: models.map(m => m.name),
                hasConfiguredModel,
                hasVisionModel,
                configuredModel
              }
            }
        } catch (e) {
            lastError = e;
        }
    }
    
    console.error('Ollama check failed:', lastError);
    return { installed: true, running: false }
  } catch (err) {
    console.error('Ollama check exception:', err);
    return { installed: false, running: false, error: String(err) }
  }
})// Dependency Management IPC
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
    enable_ai_caveat: store.get('enable_ai_caveat'),
    auto_paste: store.get('auto_paste') !== undefined ? store.get('auto_paste') : true, // Default to true if undefined
    ffmpeg_path: store.get('ffmpeg_path'),
    hotkey: store.get('hotkey'),
    vision_hotkey: store.get('vision_hotkey'),
    model: store.get('model')
  }
})

ipcMain.handle('save-settings', async (event, settings) => {
  if (settings.transcribe_cmd !== undefined) store.set('transcribe_cmd', settings.transcribe_cmd)
  if (settings.auto_transcribe !== undefined) store.set('auto_transcribe', settings.auto_transcribe)
  if (settings.ollama_url !== undefined) store.set('ollama_url', settings.ollama_url)
  if (settings.ollama_model !== undefined) store.set('ollama_model', settings.ollama_model)
  if (settings.ollama_enabled !== undefined) store.set('ollama_enabled', settings.ollama_enabled)
  if (settings.enable_ai_caveat !== undefined) store.set('enable_ai_caveat', settings.enable_ai_caveat)
  if (settings.auto_paste !== undefined) store.set('auto_paste', settings.auto_paste)
  if (settings.ffmpeg_path !== undefined) store.set('ffmpeg_path', settings.ffmpeg_path)
  
  if (settings.vision_hotkey !== undefined) {
    store.set('vision_hotkey', settings.vision_hotkey)
  }
  
  if (settings.hotkey !== undefined) {
    store.set('hotkey', settings.hotkey)
  }
  
  // Re-register hotkeys if either one changed
  if (settings.hotkey !== undefined || settings.vision_hotkey !== undefined) {
    registerHotkey(store.get('hotkey'))
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
    
    overlayWindows.forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('recording-stopped');
        setTimeout(() => {
          if (!win.isDestroyed() && !isRecording) {
            win.hide();
          }
        }, 350);
      }
    });

    hideRecordingWindow()
    updateTrayIcon('idle')
    
    // Stop recording in main window (stops actual recording)
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
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

ipcMain.handle('get-streaming-transcript', async (event, uint8Array) => {
  try {
    if (!whisperServerManager.isRunning()) {
      return { ok: false, error: 'Whisper server is not running' }
    }

    const buffer = Buffer.from(uint8Array)
    const webmPath = path.join(os.tmpdir(), `streaming-${Date.now()}.webm`)
    const wavPath = path.join(os.tmpdir(), `streaming-${Date.now()}.wav`)
    
    await fs.promises.writeFile(webmPath, buffer)
    
    const ffmpegCmd = await findFfmpeg()
    if (!ffmpegCmd) return { ok: false, error: 'ffmpeg not found' }

    // Convert to 16kHz mono WAV for whisper-server
    await new Promise((resolve, reject) => {
      exec(`"${ffmpegCmd}" -y -i "${webmPath}" -ar 16000 -ac 1 -sample_fmt s16 "${wavPath}"`, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    // Use curl to hit the local whisper-server (easiest way to handle multipart/form-data without extra dependencies)
    const result = await new Promise((resolve) => {
      const port = 8080
      exec(`curl -s http://localhost:${port}/inference -F "file=@${wavPath}"`, (err, stdout) => {
        if (err) return resolve({ ok: false, error: String(err) })
        try {
          const json = JSON.parse(stdout)
          resolve({ ok: true, text: json.text })
        } catch (e) {
          resolve({ ok: false, error: 'Failed to parse whisper-server response' })
        }
      })
    })

    // Clean up temp files
    fs.promises.unlink(webmPath).catch(() => {})
    fs.promises.unlink(wavPath).catch(() => {})

    return result
  } catch (err) {
    console.error('get-streaming-transcript error', err)
    return { ok: false, error: String(err) }
  }
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
       tpl = `"${WHISPER_PATH}" -m "${modelPath}" -f {wav} --language en --temperature 0 --best-of 5 --beam-size 5 --split-on-word --word-thold 0.6 -nt`
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
          
          if ((isCopilotMode || (ollamaEnabled && screenContext)) && finalText) {
            if (processingWindow && processingWindow.webContents) {
              processingWindow.webContents.send('processing-progress', {
                progress: 85,
                status: 'finalizing',
                subStatus: 'Processing with AI...'
              })
            }
            
            // Fetch semantic context first for smarter polishing
            const currentEmbedding = await generateEmbedding(finalText);
            const semanticContext = memoryManager.getSemanticContext(currentEmbedding);

            const polished = await polishWithOllama(finalText, semanticContext)
            if (polished && polished.ok) {
              // Learn from the correction if text was selected
              if (copilotContext) {
                memoryManager.addCorrection(copilotContext, polished.text);
              }
              finalText = polished.text
              polishUsed = polished.used
              polishTried = polished.tried
            } else {
              polishError = polished ? polished.error : 'AI polish failed'
              polishErrors = polished ? polished.errors : null
              console.error('AI polishing failed:', polishError, polishErrors)
            }
          }
          
          // Only attempt polishing if there is non-empty transcript text
            // Do not auto-polish with Ollama during save-recording auto-transcribe.
            // Keep polish optional and on-demand: use explicit 'polish-transcript' IPC.
          // Clean the final text (strip timestamps/caveat) before any further actions
          if (!isCopilotMode) {
            finalText = cleanTranscript(finalText)
          }
          console.log('Final text:', finalText)

          // Reset copilot mode for next run
          isCopilotMode = false
          copilotContext = null
          const hadScreenContext = !!screenContext;
          screenContext = null;

          // Generate final embedding for storage
          generateEmbedding(finalText).then(embedding => {
            memoryManager.logTranscript(tx.text, finalText, embedding);
          });

          // Append caveat if enabled
          if (store.get('enable_ai_caveat') !== false && finalText) {
            let contextMsg = '';
            if (hadScreenContext && !polishError) {
              contextMsg = ' + Screen Context';
            } else if (hadScreenContext && polishError) {
              contextMsg = ' (Screen Context Failed)';
            }
            finalText = finalText.trim() + ` [Voice Note Transcribed Using AI${contextMsg}]`;
          }

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
          
          // Only show main window if auto-paste is explicitly disabled
          // If auto-paste is enabled, stay in background to avoid desktop switching.
          const shouldShowMainWindow = !autoPaste;
          
          if (shouldShowMainWindow && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
            mainWindow.show()
            showTranscriptWindow(finalText)
          }

          // If auto-paste was enabled but failed, notify the user silently instead of popping up windows
          if (autoPaste && pasteResult && !pasteResult.ok) {
            console.log('Paste failed, sending notification instead of breaking UX')
            new Notification({
              title: 'Voice Hotkey: Paste Failed',
              body: 'Text copied to clipboard. (Check Accessibility permissions for auto-paste)'
            }).show()
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
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show()
        return { ok: true, path: filename, autoTranscribed: true, error: tx && tx.error ? tx.error : 'transcription failed' }
      } catch (err) {
        console.error('Auto-transcription exception:', err)
        hideRecordingWindow()
        updateTrayIcon('idle') // Reset even on error
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show()
        return { ok: true, path: filename, autoTranscribed: true, error: String(err) }
      }
    }
    console.log('Auto-transcribe disabled, returning saved path only')
    hideRecordingWindow()
    updateTrayIcon('idle')
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show()
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
      // Convert to 16kHz mono WAV for Whisper.
      // Removed silenceremove filter as it was truncating the start of speech.
      const cmd = `${JSON.stringify(ffmpegCmd)} -y -i ${JSON.stringify(webmPath)} -ar 16000 -ac 1 -sample_fmt s16 ${JSON.stringify(wavPath)}`
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
       tpl = `"${WHISPER_PATH}" -m "${modelPath}" -f {wav} --language en --temperature 0 --best-of 5 --beam-size 5 --split-on-word --word-thold 0.6 -nt`
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
       tpl = `"${WHISPER_PATH}" -m "${modelPath}" -f {wav} --language en --temperature 0 --best-of 5 --beam-size 5 --split-on-word --word-thold 0.6 -nt`
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
        // Resample to 16kHz mono for Whisper.
        // Removed silenceremove filter as it was truncating the start of speech.
        await new Promise((resolve, reject) => {
          const cmd = `${JSON.stringify(ffmpegCmd)} -y -i ${JSON.stringify(wavPath)} -ar 16000 -ac 1 -sample_fmt s16 ${JSON.stringify(trimmed)}`
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

// Generic helper to call Ollama generate API
async function callOllama(prompt) {
  try {
    let localFetch = fetch;
    if (!localFetch) {
      const nodeFetch = await import('node-fetch');
      localFetch = nodeFetch.default;
    }

    const configuredUrl = store.get('ollama_url') || 'http://localhost:11434'
    const ollamaModel = store.get('ollama_model') || 'qwen2.5:1.5b'
    
    const url = `${configuredUrl.trim().replace(/\/+$/, '')}/api/generate`
    const response = await localFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ollamaModel, prompt, stream: false }),
    })
    
    if (response.ok) {
      const data = await response.json()
      return { ok: true, text: data.response }
    }
    return { ok: false, error: `HTTP ${response.status}` }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// helper: polish transcript text using Ollama API
async function polishWithOllama (text, semanticContext = "") {
  try {
    let localFetch = fetch;
    if (!localFetch) {
      const nodeFetch = await import('node-fetch');
      localFetch = nodeFetch.default;
    }
    if (!localFetch) {
      console.error('polishWithOllama: no fetch implementation available in main process')
      throw new Error('fetch not available in the main process; Ollama polishing is disabled.')
    }

    const configuredUrl = store.get('ollama_url') || 'http://localhost:11434'
    const ollamaModel = store.get('ollama_model') || 'qwen2.5:1.5b'
    const memoryContext = memoryManager.getMemoryContext();
    
    let prompt = '';
    
    // Check if screenContext is actual OCR text or a fallback image dataURL
    const isOCRText = screenContext && !screenContext.startsWith('data:image/');
    const screenPromptString = isOCRText ? `\nTEXT VISIBLE ON THE USER'S SCREEN (USE THIS TO FIX JARGON/APP NAMES):\n"""\n${screenContext}\n"""\n` : (screenContext ? 'A screenshot of the user\'s screen is provided for visual context. Use it to correctly identify jargon, app names, or UI elements mentioned in the instruction.' : '');

    if (isCopilotMode) {
      if (copilotContext) {
        prompt = `You are an AI writing assistant.
Your task is to edit, rewrite, or fulfill the following USER INSTRUCTION based on the provided TEXT.
${screenPromptString}

${memoryContext}
${semanticContext}

TEXT:
"""
${copilotContext}
"""

USER INSTRUCTION:
"""
${text}
"""

IMPORTANT:
1) Return ONLY the modified text.
2) Do NOT include any introductory phrases like "Here is the rewritten text:".
3) Do NOT include any caveats or explanations.
4) Maintain the same format (e.g. if the input is code, return code; if it is an email, return an email).`;
      } else {
        prompt = `You are an AI writing assistant.
The user has provided a voice instruction, but NO text was selected. 
${screenPromptString}

${memoryContext}
${semanticContext}

USER INSTRUCTION:
"""
${text}
"""

TASK:
1) Fulfill the user's instruction. If they asked to "write a React component", write it. If they asked a question, answer it concisely.
2) Return ONLY the result.
3) Do NOT include any introductory phrases or caveats.`;
      }
    } else {
      prompt = `Please perform the following on the transcript below:
  1) Remove any timestamps or timecodes.
  2) Remove any editorial caveats.
  3) Fix grammar, punctuation, and formatting.
  ${screenPromptString ? `4) Use the following screen context to correct any spelling errors of jargon, names, or apps:\n${screenPromptString}` : ''}
  
  ${memoryContext}
  ${semanticContext}

  Return ONLY the cleaned paragraph.

  Transcript:
  ${text}`;
    }

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
        
        const body = { model: ollamaModel, prompt, stream: true };
        
        // Only attach images array if it's a fallback base64 image, NOT if it's OCR text
        if (screenContext && !isOCRText) {
          body.images = [screenContext.split(',')[1] || screenContext];
        }

        // Add a 60 second timeout so the app doesn't hang infinitely if Ollama is stuck
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const txt = await response.text().catch(() => '')
          errors[base] = `HTTP ${response.status} ${response.statusText} ${txt}`
          continue
        }

        let polishedText = '';
        let streamSeq = 0;
        
        // Ensure processing window is visible and showing transcript UI
        if (processingWindow && processingWindow.webContents) {
            processingWindow.webContents.send('processing-progress', {
                progress: 90,
                status: 'finalizing',
                subStatus: 'AI is streaming response...'
            });
        }
        
        // Process the streaming response
        if (response.body && typeof response.body.on === 'function') {
           // Node.js stream API (from node-fetch)
           await new Promise((resolve, reject) => {
               response.body.on('data', (chunk) => {
                   const lines = chunk.toString().split('\n');
                   for (const line of lines) {
                       if (!line.trim()) continue;
                       try {
                           const parsed = JSON.parse(line);
                           if (parsed.response) {
                               polishedText += parsed.response;
                               streamSeq++;
                               // Send partial text to both potential active windows
                               if (transcriptWindow && transcriptWindow.webContents) {
                                  transcriptWindow.webContents.send('transcript-data', polishedText);
                               }
                               if (mainWindow && mainWindow.webContents) {
                                  mainWindow.webContents.send('live-patch', { seq: streamSeq, text: polishedText });
                               }
                           }
                       } catch (e) {
                           console.warn('Error parsing JSON from stream:', e);
                       }
                   }
               });
               response.body.on('end', () => resolve());
               response.body.on('error', (err) => reject(err));
           });
        } else {
            // Fallback for environments where body isn't an EventEmitter
            const data = await response.json();
            polishedText = data.response || text;
        }

        // Hide processing window once streaming is done
        hideProcessingWindow();
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

// helper: generate embedding for text using Ollama
async function generateEmbedding (text) {
  try {
    let localFetch = fetch;
    if (!localFetch) {
      const nodeFetch = await import('node-fetch');
      localFetch = nodeFetch.default;
    }

    if (!text || !localFetch) return null;

    const configuredUrl = store.get('ollama_url') || 'http://localhost:11434'
    const ollamaModel = store.get('ollama_model') || 'qwen2.5:1.5b' // Most modern models support embedding

    const candidates = [configuredUrl];
    if (configuredUrl.includes('localhost') && !configuredUrl.includes('127.0.0.1')) {
       candidates.push(configuredUrl.replace('localhost', '127.0.0.1'));
    }

    for (const base of candidates) {
        try {
            const url = `${base.trim().replace(/\/+$/, '')}/api/embeddings`
            const response = await localFetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: ollamaModel, prompt: text }),
            })

            if (response.ok) {
              const data = await response.json()
              if (data.embedding) {
                // Convert float array to Buffer for storage in SQLite BLOB
                return Buffer.from(new Float32Array(data.embedding).buffer);
              }
            }
        } catch (e) {
            // Ignore and try next candidate
        }
    }
  } catch (err) {
    console.error('generateEmbedding error', err)
  }
  return null
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
