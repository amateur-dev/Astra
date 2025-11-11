const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  onRecordToggle: (cb) => ipcRenderer.on('record-toggle', (event, state) => cb(state)),
  onLivePatch: (cb) => ipcRenderer.on('live-patch', (event, patch) => cb(patch)),
  getAppVersion: () => ipcRenderer.invoke('app-version')
  ,
  saveRecording: (uint8Array) => ipcRenderer.invoke('save-recording', uint8Array)
  ,
  transcribeFile: (webmPath) => ipcRenderer.invoke('transcribe', webmPath),
  // settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  testTranscribe: () => ipcRenderer.invoke('test-transcribe')
  ,
  // paste integration
  pasteToFront: (text) => ipcRenderer.invoke('paste-into-front', text)
  ,
  getFrontmostApp: () => ipcRenderer.invoke('get-frontmost-app')
  ,
  // write text to system clipboard via main process (fallback when navigator.clipboard is unavailable)
  writeToClipboard: (text) => ipcRenderer.invoke('write-to-clipboard', text)
  ,
  // send live audio chunk (Uint8Array) to main for relaying or saving
  sendAudioChunk: (uint8Array) => ipcRenderer.invoke('send-audio-chunk', uint8Array)
  ,
  // finalize the buffered live audio for a sender and get the polished text
  finalizeLive: (senderId) => ipcRenderer.invoke('finalize-live', senderId),
  // listen for finalize results emitted by main after hotkey stop
  onFinalizeResult: (cb) => ipcRenderer.on('finalize-result', (event, res) => cb(res)),
  // clear buffered live audio for a sender (delete temp files and reset state)
  clearLiveBuffer: (senderId) => ipcRenderer.invoke('clear-live-buffer', senderId),
  // listen for Ollama/LLM availability status from main
  onOllamaStatus: (cb) => ipcRenderer.on('ollama-status', (event, status) => cb(status)),
  // open system microphone privacy settings
  openMicrophoneSettings: () => ipcRenderer.invoke('open-microphone-settings')
  ,
  // Whisper availability status (main will emit at startup)
  onWhisperStatus: (cb) => ipcRenderer.on('whisper-status', (event, status) => cb(status)),
  getWhisperStatus: () => ipcRenderer.invoke('whisper-status'),
  // automation / apple events helpers
  testAutomation: () => ipcRenderer.invoke('test-automation'),
  openAutomationSettings: () => ipcRenderer.invoke('open-automation-settings')
})
