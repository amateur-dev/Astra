const status = document.getElementById('status')
const btn = document.getElementById('recordBtn')
let recording = false
let mediaRecorder = null
let chunks = []
let currentStream = null
let liveMediaRecorder = null
// Live UI/logging removed for hotkey mode. Live capture will run in background when recording is started via hotkey.
// PCM capture variables
let audioCtx = null
let sourceNode = null
let processorNode = null
let pcmBuffer = []
// Increase PCM chunk size to ~10 seconds per user request for larger background chunks
const PCM_TARGET_SECONDS = 10.0 // build ~10s WAVs

// mock STT removed for hotkey/background flow

// Encode Float32Array PCM to 16-bit WAV Uint8Array
function encodeWAV (samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  function writeString (view, offset, string) {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i))
  }

  /* RIFF identifier */ writeString(view, 0, 'RIFF')
  /* file length */ view.setUint32(4, 36 + samples.length * 2, true)
  /* RIFF type */ writeString(view, 8, 'WAVE')
  /* format chunk identifier */ writeString(view, 12, 'fmt ')
  /* format chunk length */ view.setUint32(16, 16, true)
  /* sample format (raw) */ view.setUint16(20, 1, true)
  /* channel count */ view.setUint16(22, 1, true)
  /* sample rate */ view.setUint32(24, sampleRate, true)
  /* byte rate (sampleRate * blockAlign) */ view.setUint32(28, sampleRate * 2, true)
  /* block align (channel count * bytes per sample) */ view.setUint16(32, 2, true)
  /* bits per sample */ view.setUint16(34, 16, true)
  /* data chunk identifier */ writeString(view, 36, 'data')
  /* data chunk length */ view.setUint32(40, samples.length * 2, true)

  // write PCM samples
  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, samples[i]))
    s = s < 0 ? s * 0x8000 : s * 0x7FFF
    view.setInt16(offset, s, true)
  }
  return new Uint8Array(buffer)
}


// Keep existing record button behavior for manual testing, but hotkey toggles will drive recording in normal use.
btn.addEventListener('click', () => toggleRecording())

async function startRecording () {
  try {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  currentStream = stream
  mediaRecorder = new MediaRecorder(stream)
    chunks = []
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data) }
    mediaRecorder.onstop = async () => {
      // If no chunks were captured, the user likely denied microphone access
      // or the stream had no data. Show a clear status and skip saving.
      if (!chunks || chunks.length === 0) {
        status.textContent = 'No audio captured — microphone permission denied, or input was silent. Please grant Microphone access in System Settings → Privacy & Security → Microphone.'
        btn.disabled = false
        return
      }
      const blob = new Blob(chunks, { type: 'audio/webm' })
      if (blob.size === 0) {
        status.textContent = 'Recorded audio appears empty. Please check microphone access and try again.'
        btn.disabled = false
        return
      }
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
          // If main already auto-transcribed, show transcript immediately.
          // Otherwise, run a final transcribe step now so stopping via hotkey auto-finalizes.
          const transcriptEl = document.getElementById('transcript')
          const pasteBtn = document.getElementById('pasteBtn')
          if (result.autoTranscribed) {
            if (result.text) {
              if (transcriptEl) {
                transcriptEl.textContent = result.text || '(empty)'
                transcriptEl.style.display = 'block'
              }
              if (pasteBtn) pasteBtn.disabled = false
              let statusMsg = `Auto-transcribed (wav: ${result.wav || 'unknown'})`
              if (result.originalText && result.originalText !== result.text) statusMsg += ' [Polished by Ollama]'
              if (result.polishError) statusMsg += ` [Polish error: ${result.polishError}]`
              if (result.polishError && result.polishTriedHosts) {
                const tried = result.polishTriedHosts.join(', ')
                statusMsg += ` — Ollama unreachable at configured host; tried ${tried}. Start Ollama (ollama serve) or set Ollama URL to http://127.0.0.1:11434 in Settings.`
              }
              status.textContent = statusMsg
            } else if (result.error) {
              status.textContent = `Auto-transcribe error: ${result.error}`
            }
          } else {
            // Run a final transcription now (this ensures hotkey stop finalizes)
            try {
              status.textContent = 'Finalizing transcription...'
              const r = await window.electronAPI.transcribeFile(result.path)
              if (r && r.ok) {
                if (r.text && String(r.text).trim().length > 0) {
                  status.textContent = `Transcribed (wav: ${r.wav})`
                  if (transcriptEl) {
                    transcriptEl.textContent = r.text
                    transcriptEl.style.display = 'block'
                    if (pasteBtn) pasteBtn.disabled = false
                  }
                } else {
                  status.textContent = 'No speech detected in recording (transcript empty).'
                  if (transcriptEl) {
                    transcriptEl.textContent = '(empty)'
                    transcriptEl.style.display = 'block'
                  }
                }
              } else {
                status.textContent = `Transcription failed: ${r && r.error ? r.error : 'unknown'}`
              }
            } catch (err) {
              status.textContent = 'Transcription failed: ' + err
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
  // show progress indicator in capturing state
  const progressEl = document.getElementById('progress')
  const progressText = document.getElementById('progressText')
  if (progressEl) progressEl.style.display = 'block'
  if (progressText) progressText.textContent = 'capturing'
    btn.textContent = 'Stop Recording'
    // Also start background PCM capture so the app can send larger WAV chunks while recording.
    try {
      // reset buffers/state
      pcmBuffer = []
      // create an AudioContext + ScriptProcessor to capture raw PCM for robust transcription
      audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      sourceNode = audioCtx.createMediaStreamSource(stream)
      processorNode = audioCtx.createScriptProcessor(4096, 1, 1)
      processorNode.onaudioprocess = (ev) => {
        try {
          const ch = ev.inputBuffer.getChannelData(0)
          // copy floats
          pcmBuffer.push(new Float32Array(ch))
          // estimate collected seconds
          const collected = pcmBuffer.reduce((s, a) => s + a.length, 0) / (audioCtx.sampleRate || 48000)
          if (collected >= PCM_TARGET_SECONDS) {
            // merge and encode to WAV
            const totalLen = pcmBuffer.reduce((s, a) => s + a.length, 0)
            const merged = new Float32Array(totalLen)
            let offset = 0
            for (const part of pcmBuffer) { merged.set(part, offset); offset += part.length }
            pcmBuffer = []
            const wavBytes = encodeWAV(merged, audioCtx.sampleRate || 48000)
            // send WAV bytes to main (non-blocking); background-only (no UI shown)
            try {
              window.electronAPI.sendAudioChunk && window.electronAPI.sendAudioChunk(wavBytes).catch(() => {})
            } catch (e) { /* ignore */ }
          }
        } catch (e) { console.warn('processor error', e) }
      }
      sourceNode.connect(processorNode)
      processorNode.connect(audioCtx.destination)
    } catch (e) {
      console.warn('AudioContext setup failed', e)
    }
  } catch (err) {
    status.textContent = 'Microphone access denied or unavailable'
    console.error('startRecording error', err)
  }
}

function stopRecording () {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    // stop tracks immediately to release microphone indicator
    try {
      if (currentStream) {
        currentStream.getTracks().forEach(t => {
          try { t.stop() } catch (e) { /* ignore */ }
        })
        currentStream = null
      }
    } catch (e) {
      console.warn('Error stopping media tracks', e)
    }
    mediaRecorder.stop()
  }
  // shutdown background AudioContext and flush any remaining PCM as a final WAV chunk
  try {
    if (processorNode) {
      try { processorNode.disconnect() } catch (e) {}
      try { processorNode.onaudioprocess = null } catch (e) {}
      processorNode = null
    }
    if (sourceNode) { try { sourceNode.disconnect() } catch (e) {} sourceNode = null }
    if (audioCtx) {
      // flush pcmBuffer
      if (pcmBuffer && pcmBuffer.length > 0) {
        const totalLen = pcmBuffer.reduce((s, a) => s + a.length, 0)
        const merged = new Float32Array(totalLen)
        let offset = 0
        for (const part of pcmBuffer) { merged.set(part, offset); offset += part.length }
        pcmBuffer = []
        const wavBytes = encodeWAV(merged, audioCtx.sampleRate || 48000)
        try {
          window.electronAPI.sendAudioChunk && window.electronAPI.sendAudioChunk(wavBytes).catch(() => {})
        } catch (e) { /* ignore */ }
      }
      try { audioCtx.close() } catch (e) {}
      audioCtx = null
    }
  } catch (e) {
    console.warn('AudioContext shutdown failed', e)
  }
  recording = false
  status.textContent = 'Stopping...'
  // indicate we're finalizing; keep transcript hidden until final result
  const progressEl = document.getElementById('progress')
  const progressText = document.getElementById('progressText')
  if (progressEl) progressEl.style.display = 'block'
  if (progressText) progressText.textContent = 'finalizing...'
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

// Apply live patches sent from main (rolling transcription)
// Suppress live partials in the UI: do not display incremental live patches to avoid confusion.
if (window.electronAPI && window.electronAPI.onLivePatch) {
  window.electronAPI.onLivePatch((patch) => {
    try {
      // Only log for debugging; do not update the visible transcript.
      console.debug('live-patch (hidden):', patch)
      // Allow paste button to be enabled only after finalization — do not enable here.
    } catch (e) { console.error('onLivePatch handler error', e) }
  })
}

  // Listen for centralized finalize result emitted by main and update UI + paste availability
  if (window.electronAPI && window.electronAPI.onFinalizeResult) {
    window.electronAPI.onFinalizeResult((res) => {
      try {
        const transcriptEl = document.getElementById('transcript')
        const pasteBtn = document.getElementById('pasteBtn')
        const copyBtn = document.getElementById('copyBtn')
        const progressEl = document.getElementById('progress')
        const progressText = document.getElementById('progressText')
        // hide progress UI
        if (progressEl) progressEl.style.display = 'none'

        if (res && res.ok && res.text) {
          // show only the polished final text
          if (transcriptEl) {
            transcriptEl.textContent = res.text
            transcriptEl.style.display = 'block'
          }
          // enable copy and paste controls
          if (pasteBtn) pasteBtn.disabled = false
          if (copyBtn) copyBtn.disabled = false

          // Update status depending on whether main already attempted auto-paste
          const status = document.getElementById('status')
          if (res.pasteResult && res.pasteResult.ok) {
            if (status) status.textContent = 'Finalized — pasted into front app.'
          } else if (res.pasteResult && !res.pasteResult.ok) {
            if (status) status.textContent = `Finalized — paste failed: ${res.pasteResult.error}`
          } else {
            // attempt to auto-paste from renderer as a fallback
            (async () => {
              try {
                if (pasteBtn) {
                  // call main paste handler via preload
                  const pasteRes = await window.electronAPI.pasteToFront(res.text)
                  if (pasteRes && pasteRes.ok) {
                    if (status) status.textContent = 'Finalized — pasted into front app.'
                  } else {
                    if (status) status.textContent = 'Finalized — ready to paste'
                  }
                }
              } catch (e) {
                if (status) status.textContent = 'Finalized — ready to paste'
              }
            })()
          }

          // show confetti via emoji markers around the transcript
          if (transcriptEl) transcriptEl.textContent = '\n🎉 ' + transcriptEl.textContent + ' 🎉\n'

        } else {
          const status = document.getElementById('status')
          if (status) status.textContent = `Finalize failed: ${res && res.error ? res.error : 'unknown'}`
        }
      } catch (e) { console.error('onFinalizeResult handler', e) }
    })
  }

// Live capture UI removed: background PCM capture is started/stopped with the normal record hotkey flow.

// Transcribe button handler
;(function setupTranscribe () {
  const transBtn = document.getElementById('transcribeBtn')
  const transcriptEl = document.getElementById('transcript')
  const pasteBtn = document.getElementById('pasteBtn')
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
        if (r.text && String(r.text).trim().length > 0) {
          status.textContent = `Transcribed (wav: ${r.wav})`
          if (transcriptEl) {
            transcriptEl.textContent = r.text
            transcriptEl.style.display = 'block'
            if (pasteBtn) pasteBtn.disabled = false
          }
        } else {
          status.textContent = 'No speech detected in recording (transcript empty).'
          if (transcriptEl) {
            transcriptEl.textContent = '(empty)'
            transcriptEl.style.display = 'block'
          }
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
  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      const transcriptEl = document.getElementById('transcript')
      if (!transcriptEl) return
      const text = transcriptEl.textContent || ''
      if (!text) return
      pasteBtn.disabled = true
      status.textContent = 'Pasting into front app...'
      try {
        const r = await window.electronAPI.pasteToFront(text)
        if (r && r.ok) {
          status.textContent = 'Pasted into front app.'
        } else {
          status.textContent = `Paste failed: ${r && r.error ? r.error : 'unknown'}`
        }
      } catch (err) {
        status.textContent = 'Paste failed: ' + err
      } finally {
        pasteBtn.disabled = false
      }
    })
  }
  // Copy button wiring (separate from finalize handler so it remains usable)
  const copyBtnStatic = document.getElementById('copyBtn')
  if (copyBtnStatic) {
    copyBtnStatic.addEventListener('click', async () => {
      try {
        const transcriptEl = document.getElementById('transcript')
        if (!transcriptEl) return
        const text = transcriptEl.textContent || ''
        if (!text) return
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text)
        } else {
          try { await window.electronAPI.pasteToFront(text) } catch (e) { /* ignore */ }
        }
        status.textContent = 'Copied to clipboard.'
      } catch (err) {
        status.textContent = 'Copy failed: ' + err
      }
    })
  }
})()

// Permission UI wiring
;(function setupPermissionUI() {
  const micStatus = document.getElementById('micStatus')
  const openBtn = document.getElementById('openMicSettingsBtn')
  async function updateStatus() {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const s = await navigator.permissions.query({ name: 'microphone' })
        if (micStatus) micStatus.textContent = s.state || 'unknown'
        s.onchange = () => { if (micStatus) micStatus.textContent = s.state }
      } else {
        if (micStatus) micStatus.textContent = 'unknown'
      }
    } catch (e) {
      if (micStatus) micStatus.textContent = 'unknown'
    }
  }
  if (openBtn) openBtn.addEventListener('click', async () => {
    try { await window.electronAPI.openMicrophoneSettings(); } catch (e) { console.error(e) }
  })
  updateStatus()
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
  const autoPaste = r && r.auto_paste === true
  const ffmpegPath = r && r.ffmpeg_path ? r.ffmpeg_path : ''
      
      // try to split into binary and model if possible
      const whisperBin = document.getElementById('whisperBin')
      const modelPath = document.getElementById('modelPath')
      const autoCheckbox = document.getElementById('autoTranscribe')
      const ollamaEnabledCheckbox = document.getElementById('ollamaEnabled')
      const ollamaUrlInput = document.getElementById('ollamaUrl')
  const ollamaModelInput = document.getElementById('ollamaModel')
  const autoPasteCheckbox = document.getElementById('autoPaste')
      
  if (autoCheckbox) autoCheckbox.checked = !!auto
  if (ollamaEnabledCheckbox) ollamaEnabledCheckbox.checked = !!ollamaEnabled
  if (ollamaUrlInput) ollamaUrlInput.value = ollamaUrl
  if (ollamaModelInput) ollamaModelInput.value = ollamaModel
  if (autoPasteCheckbox) autoPasteCheckbox.checked = !!autoPaste
      
      if (tpl) {
        // crude parsing: first token is binary, -m <path> for model
        const binMatch = tpl.match(/^\s*(?:"|')?(.*?)(?:"|')?(?:\s|$)/)
        if (binMatch && whisperBin) whisperBin.value = binMatch[1]
        const mMatch = tpl.match(/-m\s+(?:"|')?([^"'\s]+)(?:"|')?/) 
        if (mMatch && modelPath) modelPath.value = mMatch[1]
      // ffmpeg path
      const ffmpegInput = document.getElementById('ffmpegPath')
      if (ffmpegInput) ffmpegInput.value = ffmpegPath
      }
    } catch (err) {
      console.error('loadSettings error', err)
    }
  }

  async function saveSettings () {
    const whisperBin = document.getElementById('whisperBin').value.trim()
    const modelPath = document.getElementById('modelPath').value.trim()
    const ffmpegPath = document.getElementById('ffmpegPath').value.trim()
    const autoCheckbox = document.getElementById('autoTranscribe')
    const auto = autoCheckbox ? !!autoCheckbox.checked : false
    const ollamaEnabledCheckbox = document.getElementById('ollamaEnabled')
    const ollamaEnabled = ollamaEnabledCheckbox ? !!ollamaEnabledCheckbox.checked : false
    const ollamaUrl = document.getElementById('ollamaUrl').value.trim() || 'http://localhost:11434'
  const ollamaModel = document.getElementById('ollamaModel').value.trim() || 'llama3.2'
  const autoPaste = document.getElementById('autoPaste') ? !!document.getElementById('autoPaste').checked : false
    
    if (!whisperBin || !modelPath) {
      document.getElementById('settingsResult').textContent = 'Please provide both binary and model path.'
      return
    }
    const tpl = `${whisperBin} -m ${modelPath} -f {wav}`
    const r = await window.electronAPI.saveSettings({ 
      transcribe_cmd: tpl, 
      auto_transcribe: auto,
      ffmpeg_path: ffmpegPath,
      ollama_enabled: ollamaEnabled,
      ollama_url: ollamaUrl,
      ollama_model: ollamaModel,
      auto_paste: autoPaste
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
    // add automation test UI (if not already present)
    try { setupAutomationTest() } catch (e) { /* ignore */ }
  })
})()

// Automation test helper: creates buttons under the Settings panel to run
// a diagnostic osascript paste test and to open the Automation settings.
function setupAutomationTest () {
  const settingsResult = document.getElementById('settingsResult')
  if (!settingsResult) return
  // create container
  const container = document.createElement('div')
  container.style.marginTop = '8px'
  container.style.display = 'flex'
  container.style.gap = '8px'

  const testBtn = document.createElement('button')
  testBtn.id = 'testAutomationBtn'
  testBtn.textContent = 'Test Automation'

  const openBtn = document.createElement('button')
  openBtn.id = 'openAutomationSettingsBtn'
  openBtn.textContent = 'Open Automation Settings'

  container.appendChild(testBtn)
  container.appendChild(openBtn)
  settingsResult.parentNode.insertBefore(container, settingsResult.nextSibling)

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true
    settingsResult.textContent = 'Running automation test... (ensure a text field is focused in the target app)'
    try {
      const r = await window.electronAPI.testAutomation()
      if (!r) {
        settingsResult.textContent = 'No response from automation test.'
      } else {
        // show concise output
        if (r.ok) settingsResult.textContent = `Automation test OK (code: ${r.code || 0}). stdout: ${r.stdout || '(none)'} stderr: ${r.stderr || '(none)'} `
        else settingsResult.textContent = `Automation test FAILED (code: ${r.code || 'n/a'}). message: ${r.message || r.error || JSON.stringify(r)}`
      }
    } catch (err) {
      settingsResult.textContent = 'Automation test error: ' + err
    } finally {
      testBtn.disabled = false
    }
  })

  openBtn.addEventListener('click', async () => {
    try {
      await window.electronAPI.openAutomationSettings()
    } catch (e) {
      console.error('openAutomationSettings failed', e)
    }
  })
}

// Clear & Re-record button
;(function setupClearButton() {
  const clearBtn = document.getElementById('clearBtn')
  if (!clearBtn) return
  clearBtn.addEventListener('click', async () => {
    try {
      clearBtn.disabled = true
      const statusEl = document.getElementById('status')
      if (statusEl) statusEl.textContent = 'Clearing buffered audio...'
      const res = await window.electronAPI.clearLiveBuffer()
      if (res && res.ok) {
        // clear UI transcript and re-enable recording
        const transcriptEl = document.getElementById('transcript')
        if (transcriptEl) { transcriptEl.textContent = ''; transcriptEl.style.display = 'none' }
        if (statusEl) statusEl.textContent = `Cleared ${res.cleared || 0} files. Ready to record.`
        // restart recording if not currently recording (trigger record button)
        const recordBtn = document.getElementById('recordBtn')
        if (recordBtn && recordBtn.textContent && recordBtn.textContent.includes('Start')) {
          // start recording programmatically
          recordBtn.click()
        }
      } else {
        if (statusEl) statusEl.textContent = `Clear failed: ${res && res.error ? res.error : 'unknown'}`
      }
    } catch (err) {
      console.error('clearBtn error', err)
      const statusEl = document.getElementById('status')
      if (statusEl) statusEl.textContent = 'Clear failed: ' + err
    } finally {
      clearBtn.disabled = false
    }
  })
})()
