const status = document.getElementById('status')
const btn = document.getElementById('recordBtn')
let recording = false
let mediaRecorder = null
let chunks = []

btn.addEventListener('click', () => toggleRecording())

async function startRecording () {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaRecorder = new MediaRecorder(stream)
    chunks = []
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data) }
    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: 'audio/webm' })
      const arrayBuffer = await blob.arrayBuffer()
      // send to main to save
      status.textContent = 'Saving...'
      btn.disabled = true
      try {
        const result = await window.electronAPI.saveRecording(new Uint8Array(arrayBuffer))
        if (result && result.ok) {
          // always show saved path
          status.textContent = `Saved: ${result.path}`
          // enable transcribe button and record path
          const transBtn = document.getElementById('transcribeBtn')
          if (transBtn) {
            transBtn.disabled = false
            transBtn.dataset.path = result.path
          }
          // if main auto-transcribed, show transcript immediately
          if (result.autoTranscribed) {
            if (result.text) {
              const transcriptEl = document.getElementById('transcript')
              if (transcriptEl) {
                transcriptEl.textContent = result.text || '(empty)'
                transcriptEl.style.display = 'block'
              }
              let statusMsg = `Auto-transcribed (wav: ${result.wav || 'unknown'})`
              if (result.originalText && result.originalText !== result.text) {
                statusMsg += ' [Polished by Ollama]'
              }
              if (result.polishError) {
                statusMsg += ` [Polish error: ${result.polishError}]`
              }
              // If polishing failed and we have retry info, show an actionable hint
              if (result.polishError && result.polishTriedHosts) {
                const tried = result.polishTriedHosts.join(', ')
                statusMsg += ` — Ollama unreachable at configured host; tried ${tried}. Start Ollama (ollama serve) or set Ollama URL to http://127.0.0.1:11434 in Settings.`
              }
              status.textContent = statusMsg
            } else if (result.error) {
              status.textContent = `Auto-transcribe error: ${result.error}`
            }
          }
        } else {
          status.textContent = `Save failed: ${result && result.error ? result.error : 'unknown'}`
        }
      } catch (err) {
        status.textContent = 'Save failed: ' + err
      } finally {
        btn.disabled = false
      }
    }
    mediaRecorder.start()
    recording = true
    status.textContent = 'Recording...'
    btn.textContent = 'Stop Recording'
  } catch (err) {
    status.textContent = 'Microphone access denied or unavailable'
    console.error('startRecording error', err)
  }
}

function stopRecording () {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
  }
  recording = false
  status.textContent = 'Stopping...'
  btn.textContent = 'Start Recording'
}

function toggleRecording () {
  if (!recording) startRecording()
  else stopRecording()
}

window.electronAPI.onRecordToggle((state) => {
  // hotkey toggles recording state in main; reflect in UI
  if (state && !recording) startRecording()
  else if (!state && recording) stopRecording()
})

// Transcribe button handler
;(function setupTranscribe () {
  const transBtn = document.getElementById('transcribeBtn')
  const transcriptEl = document.getElementById('transcript')
  if (!transBtn) return
  transBtn.addEventListener('click', async () => {
    const p = transBtn.dataset.path
    if (!p) return
    transBtn.disabled = true
    status.textContent = 'Transcribing...'
    if (transcriptEl) transcriptEl.style.display = 'none'
    try {
      const r = await window.electronAPI.transcribeFile(p)
      if (r && r.ok) {
        status.textContent = `Transcribed (wav: ${r.wav})`
        if (transcriptEl) {
          transcriptEl.textContent = r.text || '(empty)'
          transcriptEl.style.display = 'block'
        }
      } else {
        status.textContent = `Transcription failed: ${r && r.error ? r.error : 'unknown'}`
      }
    } catch (err) {
      status.textContent = 'Transcription failed: ' + err
    } finally {
      transBtn.disabled = false
    }
  })
})()

// Settings UI wiring
;(function setupSettings () {
  async function loadSettings () {
    try {
      const r = await window.electronAPI.getSettings()
      const tpl = r && r.transcribe_cmd ? r.transcribe_cmd : ''
      const auto = r && r.auto_transcribe === true
      const ollamaUrl = r && r.ollama_url ? r.ollama_url : 'http://localhost:11434'
      const ollamaModel = r && r.ollama_model ? r.ollama_model : 'llama3.2'
      const ollamaEnabled = r && r.ollama_enabled === true
      
      // try to split into binary and model if possible
      const whisperBin = document.getElementById('whisperBin')
      const modelPath = document.getElementById('modelPath')
      const autoCheckbox = document.getElementById('autoTranscribe')
      const ollamaEnabledCheckbox = document.getElementById('ollamaEnabled')
      const ollamaUrlInput = document.getElementById('ollamaUrl')
      const ollamaModelInput = document.getElementById('ollamaModel')
      
      if (autoCheckbox) autoCheckbox.checked = !!auto
      if (ollamaEnabledCheckbox) ollamaEnabledCheckbox.checked = !!ollamaEnabled
      if (ollamaUrlInput) ollamaUrlInput.value = ollamaUrl
      if (ollamaModelInput) ollamaModelInput.value = ollamaModel
      
      if (tpl) {
        // crude parsing: first token is binary, -m <path> for model
        const binMatch = tpl.match(/^\s*(?:"|')?(.*?)(?:"|')?(?:\s|$)/)
        if (binMatch && whisperBin) whisperBin.value = binMatch[1]
        const mMatch = tpl.match(/-m\s+(?:"|')?([^"'\s]+)(?:"|')?/) 
        if (mMatch && modelPath) modelPath.value = mMatch[1]
      }
    } catch (err) {
      console.error('loadSettings error', err)
    }
  }

  async function saveSettings () {
    const whisperBin = document.getElementById('whisperBin').value.trim()
    const modelPath = document.getElementById('modelPath').value.trim()
    const autoCheckbox = document.getElementById('autoTranscribe')
    const auto = autoCheckbox ? !!autoCheckbox.checked : false
    const ollamaEnabledCheckbox = document.getElementById('ollamaEnabled')
    const ollamaEnabled = ollamaEnabledCheckbox ? !!ollamaEnabledCheckbox.checked : false
    const ollamaUrl = document.getElementById('ollamaUrl').value.trim() || 'http://localhost:11434'
    const ollamaModel = document.getElementById('ollamaModel').value.trim() || 'llama3.2'
    
    if (!whisperBin || !modelPath) {
      document.getElementById('settingsResult').textContent = 'Please provide both binary and model path.'
      return
    }
    const tpl = `${whisperBin} -m ${modelPath} -f {wav}`
    const r = await window.electronAPI.saveSettings({ 
      transcribe_cmd: tpl, 
      auto_transcribe: auto,
      ollama_enabled: ollamaEnabled,
      ollama_url: ollamaUrl,
      ollama_model: ollamaModel
    })
    if (r && r.ok) document.getElementById('settingsResult').textContent = 'Saved.'
    else document.getElementById('settingsResult').textContent = `Save failed: ${r && r.error ? r.error : 'unknown'}`
  }

  async function testSettings () {
    document.getElementById('settingsResult').textContent = 'Testing...'
    const r = await window.electronAPI.testTranscribe()
    if (!r) {
      document.getElementById('settingsResult').textContent = 'No response from test.'
      return
    }
    if (!r.ok) {
      document.getElementById('settingsResult').textContent = `Test failed: ${r.error || JSON.stringify(r)}`
      return
    }
    let out = `Template: ${r.tpl}\nBinary: ${r.binary || '(none)'}\nResolved: ${r.binaryPath || '(not found)'}\nModel: ${r.modelPath || '(none)'}\nModel exists: ${r.modelExists}`
    if (r.binaryHelp) {
      if (r.binaryHelp.ok) out += `\n\nBinary --help output:\n${r.binaryHelp.out}`
      else out += `\n\nBinary help error: ${r.binaryHelp.error}`
    }
    document.getElementById('settingsResult').textContent = out
  }

  document.addEventListener('DOMContentLoaded', () => {
    const saveBtn = document.getElementById('saveSettingsBtn')
    const testBtn = document.getElementById('testSettingsBtn')
    if (saveBtn) saveBtn.addEventListener('click', saveSettings)
    if (testBtn) testBtn.addEventListener('click', testSettings)
    loadSettings()
  })
})()
