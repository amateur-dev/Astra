const status = document.getElementById('status')
const btn = document.getElementById('recordBtn')
let recording = false
let mediaRecorder = null
let chunks = []
let currentStream = null
let liveRecording = false
let liveMediaRecorder = null
let liveContainer = document.getElementById('liveContainer')
let liveLog = document.getElementById('liveLog')
let mockChunkCount = 0
const _sampleSentence = 'I need to schedule a meeting with Dr. Patel next Monday at 3 pm.'
const _sampleWords = _sampleSentence.split(/\s+/)
// buffer to aggregate small MediaRecorder fragments into a larger valid webm blob
let liveChunkBuffer = []
// Use a smaller aggregate window so users see faster rolling updates (~1s)
const LIVE_AGGREGATE_CHUNKS = 4 // ~4 * 250ms = ~1s window
const LIVE_SLIDE_BY = 2 // sliding window overlap
// PCM capture variables
let audioCtx = null
let sourceNode = null
let processorNode = null
let pcmBuffer = []
const PCM_TARGET_SECONDS = 1.0 // build ~1s WAVs

// Helper to lazily create or find the transcript element. The app's UI is
// minimal by default; this function will inject a small Transcript header and
// a <pre id="transcript"> into the left card when createIfMissing is true.
function getTranscriptElement (createIfMissing) {
  try {
    let el = document.getElementById('transcript')
    if (el) return el
    if (!createIfMissing) return null
    const left = document.getElementById('leftCard')
    if (!left) return null
    // create container so we can remove the whole transcript block easily
    const container = document.createElement('div')
    container.id = 'transcriptContainer'
    // heading
    const h3 = document.createElement('h3')
    h3.textContent = 'Transcript'
    h3.style.marginTop = '12px'
    // preformatted transcript area
    const pre = document.createElement('pre')
    pre.id = 'transcript'
    pre.style.whiteSpace = 'pre-wrap'
    pre.style.background = '#f6f6f6'
    pre.style.padding = '8px'
    pre.style.borderRadius = '4px'
    pre.style.display = 'block'
    // toolbar (Copy button) below transcript
    const toolbar = document.createElement('div')
    toolbar.style.display = 'flex'
    toolbar.style.justifyContent = 'flex-start'
    toolbar.style.gap = '8px'
    toolbar.style.marginTop = '8px'
    const copyBtn = document.createElement('button')
    copyBtn.id = 'copyBtn'
    copyBtn.className = 'btn'
    copyBtn.textContent = 'Copy'
    toolbar.appendChild(copyBtn)

    container.appendChild(h3)
    container.appendChild(pre)
    container.appendChild(toolbar)
    left.appendChild(container)

    // copy handler
    copyBtn.addEventListener('click', async () => {
      const text = pre.textContent || ''
      if (!text) return
      try {
        if (window.electronAPI && window.electronAPI.writeToClipboard) {
          await window.electronAPI.writeToClipboard(text)
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text)
        } else {
          // fallback: create temporary textarea
          const ta = document.createElement('textarea')
          ta.value = text
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          ta.remove()
        }
        copyBtn.textContent = 'Copied!'
        setTimeout(() => { copyBtn.textContent = 'Copy' }, 1200)
      } catch (e) {
        console.warn('copy failed', e)
      }
    })

    // enable global clear button if present
    const globalClear = document.getElementById('clearBtn')
    if (globalClear) globalClear.disabled = false

    return pre
  } catch (e) {
    console.error('getTranscriptElement error', e)
    return null
  }
}

// Remove the transcript container if present and update UI state.
function removeTranscript () {
  try {
    const c = document.getElementById('transcriptContainer')
    if (c && c.parentNode) c.parentNode.removeChild(c)
    const pasteBtn = document.getElementById('pasteBtn')
    if (pasteBtn) pasteBtn.disabled = true
    const clear = document.getElementById('clearBtn')
    if (clear) clear.disabled = true
    // reset status if desired
    // status.textContent = 'Ready'
  } catch (e) { console.warn('removeTranscript error', e) }
}

function mockProcessChunk (chunk) {
  // Very small mock STT: reveal more words with each received chunk.
  try {
    mockChunkCount += 1
    const wordsToShow = Math.min(_sampleWords.length, mockChunkCount * 2)
    const text = _sampleWords.slice(0, wordsToShow).join(' ')
    return wordsToShow < _sampleWords.length ? text + '…' : text
  } catch (e) {
    console.error('mockProcessChunk error', e)
    return ''
  }
}

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
          // if main auto-transcribed, show transcript immediately
          if (result.autoTranscribed) {
            if (result.text) {
              const transcriptEl = getTranscriptElement(true)
              if (transcriptEl) {
                transcriptEl.textContent = result.text || '(empty)'
                transcriptEl.style.display = 'block'
              }
              // enable paste button when transcript appears
              const pasteBtn = document.getElementById('pasteBtn')
              if (pasteBtn) pasteBtn.disabled = false
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

// Apply live patches sent from main (rolling transcription)
  if (window.electronAPI && window.electronAPI.onLivePatch) {
  window.electronAPI.onLivePatch((patch) => {
    try {
      const transcriptEl = getTranscriptElement(true)
      if (transcriptEl) {
        transcriptEl.style.display = 'block'
        transcriptEl.textContent = patch && patch.text ? patch.text : '(listening...)'
      }
      // log live patch arrival for debugging (prepend to liveLog UI if present)
      try {
        const liveLogEl = document.getElementById('liveLog')
        const now = new Date().toLocaleTimeString()
        if (liveLogEl) liveLogEl.textContent = `${now} — Live patch received (seq=${patch && patch.seq ? patch.seq : 'n/a'})\n` + liveLogEl.textContent
        else console.log('Live patch received', patch)
      } catch (e) {}
  const pasteBtn = document.getElementById('pasteBtn')
  if (pasteBtn) pasteBtn.disabled = false
    } catch (e) {
      console.error('onLivePatch handler error', e)
    }
  })
}

// Live capture: record short chunks and display/log them for testing
;(function setupLiveCapture() {
  const liveBtn = document.getElementById('liveBtn')
  if (!liveBtn) return

  function appendLiveLog (msg) {
    console.log('[live]', msg)
    if (!liveLog) return
    const now = new Date().toLocaleTimeString()
    liveLog.textContent = `${now} — ${msg}\n` + liveLog.textContent
  }

  async function startLive () {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // reset buffers/state
      pcmBuffer = []
      liveChunkBuffer = []
      mockChunkCount = 0
      // Also create an AudioContext + ScriptProcessor to capture raw PCM for robust transcription
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)()
        sourceNode = audioCtx.createMediaStreamSource(stream)
        // bufferSize 4096 is fine: on some browsers other sizes apply
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
              // send WAV bytes to main (non-blocking)
              try {
                window.electronAPI.sendAudioChunk && window.electronAPI.sendAudioChunk(wavBytes).then((res) => {
                  if (res && res.ok) appendLiveLog(`PCM WAV saved: ${res.path || '(unknown)'}`)
                }).catch((err) => { /* ignore */ })
              } catch (e) { /* ignore */ }
            }
          } catch (e) { console.warn('processor error', e) }
        }
        sourceNode.connect(processorNode)
        processorNode.connect(audioCtx.destination)
      } catch (e) {
        console.warn('AudioContext setup failed', e)
      }
      liveMediaRecorder = new MediaRecorder(stream)
      // keep tracks reference so we can stop them
      currentStream = stream
      liveContainer.style.display = 'block'
      liveLog.textContent = ''
      liveMediaRecorder.ondataavailable = (e) => {
        try {
          if (e.data && e.data.size > 0) {
            const sizeKB = Math.round(e.data.size / 1024)
            appendLiveLog(`Chunk received: ${sizeKB} KB`)
            // (removed mock STT): rely on PCM WAV -> main -> live-patch pipeline
            // Aggregation of MediaRecorder webm fragments is disabled.
            // We're capturing raw PCM via AudioContext and sending WAV bytes to main for robust transcription.
          }
        } catch (err) {
          console.error('live ondataavailable error', err)
        }
      }
      liveMediaRecorder.onstart = () => { appendLiveLog('Live recorder started') }
      liveMediaRecorder.onstop = () => { appendLiveLog('Live recorder stopped') }
      // Start with timeslice to force periodic ondataavailable events (250ms)
      liveMediaRecorder.start(250)
      liveRecording = true
      liveBtn.textContent = 'Stop Live Capture'
      appendLiveLog('Started (250ms chunks)')
    } catch (err) {
      appendLiveLog('Failed to start live capture: ' + String(err))
      console.error('startLive error', err)
    }
  }

  function stopLive () {
    try {
      if (liveMediaRecorder && liveMediaRecorder.state !== 'inactive') liveMediaRecorder.stop()
      // Aggregated webm flushing disabled. PCM WAVs (if any) are flushed below.
      if (currentStream) {
        currentStream.getTracks().forEach(t => { try { t.stop() } catch (e) {} })
        currentStream = null
      }
      // shutdown AudioContext and flush any remaining PCM
      try {
        if (processorNode) {
          processorNode.disconnect()
          processorNode.onaudioprocess = null
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
              window.electronAPI.sendAudioChunk && window.electronAPI.sendAudioChunk(wavBytes).then((res) => {
                if (res && res.ok) appendLiveLog(`Final PCM WAV saved: ${res.path || '(unknown)'}`)
              }).catch((err) => { /* ignore */ })
            } catch (e) { /* ignore */ }
          }
          try { audioCtx.close() } catch (e) {}
          audioCtx = null
        }
      } catch (e) { console.warn('AudioContext shutdown failed', e) }
    } catch (err) {
      console.warn('stopLive error', err)
    }
    liveRecording = false
    liveBtn.textContent = 'Start Live Capture'
  }

  liveBtn.addEventListener('click', () => {
    if (!liveRecording) startLive()
    else stopLive()
  })
})()

// Transcribe button handler
;(function setupTranscribe () {
  const transBtn = document.getElementById('transcribeBtn')
  const pasteBtn = document.getElementById('pasteBtn')
  if (!transBtn) return
  transBtn.addEventListener('click', async () => {
    const p = transBtn.dataset.path
    if (!p) return
    transBtn.disabled = true
    status.textContent = 'Transcribing...'
  const _tHide = getTranscriptElement(false)
  if (_tHide) _tHide.style.display = 'none'
      try {
      const r = await window.electronAPI.transcribeFile(p)
      if (r && r.ok) {
        const tEl = getTranscriptElement(true)
        if (r.text && String(r.text).trim().length > 0) {
          status.textContent = `Transcribed (wav: ${r.wav})`
          if (tEl) {
            tEl.textContent = r.text
            tEl.style.display = 'block'
            if (pasteBtn) pasteBtn.disabled = false
          }
        } else {
          status.textContent = 'No speech detected in recording (transcript empty).'
          if (tEl) {
            tEl.textContent = '(empty)'
            tEl.style.display = 'block'
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
      const transcriptEl = getTranscriptElement(false)
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

  // Clear & Re-Record button: remove transcript and reset UI so the user can record again
  const clearBtn = document.getElementById('clearBtn')
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      removeTranscript()
      // ensure record button is enabled and text resets
      try { btn.disabled = false; btn.textContent = 'Start Recording'; } catch (e) {}
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
