const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  onRecordToggle: (cb) => ipcRenderer.on('record-toggle', (event, state) => cb(state)),
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
  // open system microphone privacy settings
  openMicrophoneSettings: () => ipcRenderer.invoke('open-microphone-settings')
  ,
  // automation / apple events helpers
  testAutomation: () => ipcRenderer.invoke('test-automation'),
  openAutomationSettings: () => ipcRenderer.invoke('open-automation-settings')
})
