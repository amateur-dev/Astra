const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  onRecordToggle: (cb) => ipcRenderer.on('record-toggle', (event, state) => cb(state)),
  onLivePatch: (cb) => ipcRenderer.on('live-patch', (event, patch) => cb(patch)),
  getAppVersion: () => ipcRenderer.invoke('app-version')
  ,
  saveRecording: (uint8Array) => ipcRenderer.invoke('save-recording', uint8Array)
  ,
  // transcribeFile accepts an optional options object: { polishNow: boolean }
  transcribeFile: (webmPath, options = {}) => ipcRenderer.invoke('transcribe', webmPath, options),
  // settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  testTranscribe: () => ipcRenderer.invoke('test-transcribe')
  ,
  // paste integration
  pasteToFront: (text) => ipcRenderer.invoke('paste-into-front', text)
  ,
  // send live audio chunk (Uint8Array) to main for relaying or saving
  sendAudioChunk: (uint8Array) => ipcRenderer.invoke('send-audio-chunk', uint8Array)
  ,
  // open system microphone privacy settings
  openMicrophoneSettings: () => ipcRenderer.invoke('open-microphone-settings')
  ,
  // polish a transcript with Ollama on-demand
  polishTranscript: (text, options = {}) => ipcRenderer.invoke('polish-transcript', text, options),
  // Hotkey: set or get
  setHotkey: (hotkey) => ipcRenderer.invoke('set-hotkey', hotkey),
  // automation / apple events helpers
  testAutomation: () => ipcRenderer.invoke('test-automation'),
  openAutomationSettings: () => ipcRenderer.invoke('open-automation-settings'),
  // Recording window specific
  onRecordingStart: (cb) => ipcRenderer.on('recording-start', (event, stream) => cb(stream)),
  onRecordingStop: (cb) => ipcRenderer.on('recording-stop', () => cb()),
  cancelRecording: () => ipcRenderer.invoke('cancel-recording'),
  isRecording: () => ipcRenderer.invoke('is-recording'),
  // Processing window specific
  onProcessingProgress: (cb) => ipcRenderer.on('processing-progress', (event, data) => cb(data)),
  onProcessingComplete: (cb) => ipcRenderer.on('processing-complete', () => cb()),
  cancelTranscription: () => ipcRenderer.invoke('cancel-transcription')
})
