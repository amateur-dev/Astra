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
    // preformatted transcript area
    const pre = document.createElement('pre')
    pre.id = 'transcript'
    // toolbar (Copy button) below transcript
    const toolbar = document.createElement('div')
    toolbar.className = 'toolbar'
    const copyBtn = document.createElement('button')
    copyBtn.id = 'copyBtn'
    copyBtn.className = 'btn-small'
    copyBtn.textContent = 'Copy'
    toolbar.appendChild(copyBtn)
    // Polish (Ollama) button - hidden by default (enabled if user has Ollama configured)
    const polishBtn = document.createElement('button')
    polishBtn.id = 'polishBtn'
    polishBtn.className = 'btn-small'
    polishBtn.textContent = 'Polish (Ollama)'
    polishBtn.style.display = 'none'
    toolbar.appendChild(polishBtn)
    // Toggle: Raw / Polished
    const toggleBtn = document.createElement('button')
    toggleBtn.id = 'toggleRawBtn'
    toggleBtn.className = 'btn-small'
    toggleBtn.textContent = 'Show Raw'
    toggleBtn.style.display = 'none'
    toolbar.appendChild(toggleBtn)

    container.appendChild(h3)
    container.appendChild(pre)
    container.appendChild(toolbar)
    left.appendChild(container)

    // copy handler
    copyBtn.addEventListener('click', async () => {
      const text = pre.textContent || ''
      if (!text) return
      
      let success = false
      try {
        // Try Electron API first
        if (window.electronAPI && window.electronAPI.pasteToFront) {
          try {
            await window.electronAPI.pasteToFront(text)
            success = true
          } catch (e) {
            console.log('pasteToFront failed, trying clipboard', e)
          }
        }
        
        // Try clipboard API
        if (!success && navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text)
          success = true
        }
        
        // Fallback to execCommand
        if (!success) {
          const ta = document.createElement('textarea')
          ta.value = text
          ta.style.position = 'fixed'
          ta.style.top = '-9999px'
          document.body.appendChild(ta)
          ta.select()
          success = document.execCommand('copy')
          ta.remove()
        }
        
        // Show appropriate feedback
        const originalText = copyBtn.textContent
        const originalClass = copyBtn.className
        
        if (success) {
          copyBtn.textContent = '✓ Copied!'
          copyBtn.className = 'btn btn-primary'
          copyBtn.style.background = '#34c759'
          copyBtn.style.borderColor = '#34c759'
          copyBtn.style.color = '#fff'
        } else {
          copyBtn.textContent = '✗ Failed'
          copyBtn.style.background = '#ff3b30'
          copyBtn.style.borderColor = '#ff3b30'
          copyBtn.style.color = '#fff'
        }
        
        setTimeout(() => { 
          copyBtn.textContent = originalText
          copyBtn.className = originalClass
          copyBtn.style.background = ''
          copyBtn.style.borderColor = ''
          copyBtn.style.color = ''
        }, 2000)
      } catch (e) {
        console.error('copy error', e)
        copyBtn.textContent = '✗ Error'
        copyBtn.style.background = '#ff3b30'
        copyBtn.style.color = '#fff'
        setTimeout(() => { 
          copyBtn.textContent = 'Copy'
          copyBtn.style.background = ''
          copyBtn.style.color = ''
        }, 2000)
      }
    })

    // polish handler: call main IPC to polish transcript on-demand
    polishBtn.addEventListener('click', async () => {
      const t = document.getElementById('transcript')
      if (!t) return
      const text = t.textContent || ''
      if (!text) return
      polishBtn.disabled = true
      polishBtn.textContent = 'Polishing...'
      try {
        const r = await window.electronAPI.polishTranscript(text)
        if (r && r.ok && r.text) {
          // store polished in dataset
          t.dataset.rawText = t.textContent || ''
          t.dataset.polishedText = r.text
          t.textContent = r.text
          toggleBtn.style.display = 'inline-block'
          toggleBtn.textContent = 'Show Raw'
        } else {
          alert('Polish failed: ' + (r && r.error ? r.error : 'unknown'))
        }
      } catch (err) {
        console.error('polishTranscript failed', err)
        alert('Polish failed: ' + err)
      } finally {
        polishBtn.disabled = false
        polishBtn.textContent = 'Polish (Ollama)'
      }
    })

    // toggle handler
    toggleBtn.addEventListener('click', () => {
      const t = document.getElementById('transcript')
      if (!t) return
      const raw = t.dataset.rawText || ''
      const polished = t.dataset.polishedText || ''
      if (toggleBtn.textContent === 'Show Raw') {
        if (raw) t.textContent = raw
        toggleBtn.textContent = 'Show Polished'
      } else {
        if (polished) t.textContent = polished
        toggleBtn.textContent = 'Show Raw'
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
    // Ensure any previous stream is stopped before starting a new one
    if (currentStream) {
      currentStream.getTracks().forEach(t => {
        try { t.stop() } catch (e) { /* ignore */ }
      })
      currentStream = null
    }
    
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 48000, channelCount: 1, noiseSuppression: false, echoCancellation: false, autoGainControl: false } })
    currentStream = stream
    chunks = []
    // Prefer AudioContext PCM capture so we can write a clean 16-bit WAV.
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      sourceNode = audioCtx.createMediaStreamSource(stream)
      processorNode = audioCtx.createScriptProcessor(4096, 1, 1)
      pcmBuffer = []
      processorNode.onaudioprocess = (ev) => {
        try {
          const ch = ev.inputBuffer.getChannelData(0)
          pcmBuffer.push(new Float32Array(ch))
        } catch (e) { console.warn('processor error', e) }
      }
      sourceNode.connect(processorNode)
      processorNode.connect(audioCtx.destination)
      mediaRecorder = null
    } catch (e) {
      // Fallback to MediaRecorder (webm) if AudioContext capture fails
      console.warn('AudioContext capture failed; falling back to MediaRecorder', e)
      mediaRecorder = new MediaRecorder(stream)
    }
    chunks = []
    if (mediaRecorder) {
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
    }
    recording = true
    status.textContent = 'Recording...'
    btn.classList.add('recording')
  } catch (err) {
    status.textContent = 'Microphone access denied or unavailable'
    console.error('startRecording error', err)
  }
}

async function stopRecording () {
  // Update UI immediately
  recording = false
  status.textContent = 'Stopping...'
  btn.classList.remove('recording')
  
  // Stop the media stream tracks first
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
  
  // If we are capturing via MediaRecorder, stop it (onstop handler will process)
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
    // MediaRecorder's onstop handler will handle the rest
    return
  }
  
  // If we engaged AudioContext PCM capture, flush buffer and send WAV
  if (audioCtx) {
    try {
      // Disconnect and clean up AudioContext resources
      if (processorNode) {
        processorNode.disconnect()
        if (sourceNode) sourceNode.disconnect()
        processorNode = null
        sourceNode = null
      }
      if (audioCtx.state !== 'closed') {
        await audioCtx.close()
      }
      audioCtx = null
      
      // Process captured PCM data if any
      if (pcmBuffer && pcmBuffer.length > 0) {
        // merge Float32Array parts
        const totalLen = pcmBuffer.reduce((s, a) => s + a.length, 0)
        const merged = new Float32Array(totalLen)
        let offset = 0
        for (const part of pcmBuffer) { merged.set(part, offset); offset += part.length }
        const sampleRate = 48000 // we requested 48kHz
        pcmBuffer = []
        const wavBytes = encodeWAV(merged, sampleRate)
        // send WAV bytes to main to save
        status.textContent = 'Saving...'
        try {
          const result = await window.electronAPI.saveRecording(wavBytes)
          if (result && result.ok) {
            status.textContent = `Saved: ${result.path}`
            const transBtn = document.getElementById('transcribeBtn')
            if (transBtn) { transBtn.disabled = false; transBtn.dataset.path = result.path }
            if (result.autoTranscribed && result.text) {
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
              status.textContent = statusMsg
            }
          } else {
            status.textContent = `Save failed: ${result && result.error ? result.error : 'unknown'}`
          }
        } catch (err) {
          console.error('saveRecording failed', err)
          status.textContent = 'Save failed: ' + err
        }
      } else {
        status.textContent = 'No audio captured'
      }
    } catch (e) {
      console.error('stopRecording cleanup failed', e)
      status.textContent = 'Error stopping recording'
    }
  } else {
    status.textContent = 'Ready'
  }
}

async function toggleRecording () {
  if (!recording) await startRecording()
  else await stopRecording()
}

window.electronAPI.onRecordToggle(async (state) => {
  // hotkey toggles recording state in main; reflect in UI
  console.log('onRecordToggle received, state:', state, 'current recording:', recording)
  if (state && !recording) {
    console.log('Starting recording from hotkey')
    await startRecording()
  } else if (!state && recording) {
    console.log('Stopping recording from hotkey')
    await stopRecording()
  } else {
    console.log('No action taken - state/recording mismatch or already in desired state')
  }
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
        // Check settings for polishNow behavior
        const settings = await window.electronAPI.getSettings()
        const polishNow = settings && settings.polish_while_transcribe === true
        const r = await window.electronAPI.transcribeFile(p, { polishNow })
      if (r && r.ok) {
        const tEl = getTranscriptElement(true)
        // store raw and cleaned versions for toggling and polishing
        if (tEl) {
          tEl.dataset.rawText = r.raw || ''
          tEl.dataset.cleanedText = r.text || ''
          // show polish option if Ollama enabled in settings
          try {
            const settings = await window.electronAPI.getSettings()
            const ollamaEnabledLocal = settings && settings.ollama_enabled === true
            const polishBtnLocal = document.getElementById('polishBtn')
            if (polishBtnLocal) polishBtnLocal.style.display = ollamaEnabledLocal ? 'inline-block' : 'none'
            const toggleBtnLocal = document.getElementById('toggleRawBtn')
            if (toggleBtnLocal) toggleBtnLocal.style.display = 'none'
          } catch (e) { /* ignore */ }
        }
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
      try { btn.disabled = false; btn.classList.remove('recording'); } catch (e) {}
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
      const ollamaModel = r && r.ollama_model ? r.ollama_model : 'qwen2.5:0.5b'
  const ollamaEnabled = r && r.ollama_enabled === true
  const enableAiCaveat = (r && r.enable_ai_caveat !== undefined) ? r.enable_ai_caveat : true
  const autoPaste = (r && r.auto_paste !== undefined) ? r.auto_paste : true // Default to true if undefined
  const ffmpegPath = r && r.ffmpeg_path ? r.ffmpeg_path : ''
  const hotkey = r && r.hotkey ? r.hotkey : (process.env.HOTKEY || 'CommandOrControl+Shift+V')
  const suggestedCmd = r && r.suggested_transcribe_cmd ? r.suggested_transcribe_cmd : ''

      // try to split into binary and model if possible
      const whisperBin = document.getElementById('whisperBin')
      const modelPath = document.getElementById('modelPath')
      const autoCheckbox = document.getElementById('autoTranscribe')
      const ollamaEnabledCheckbox = document.getElementById('ollamaEnabled')
      const enableAiCaveatCheckbox = document.getElementById('enableAiCaveat')
      const ollamaUrlInput = document.getElementById('ollamaUrl')
      const ollamaModelInput = document.getElementById('ollamaModel')
      const autoPasteCheckbox = document.getElementById('autoPaste')

      if (autoCheckbox) autoCheckbox.checked = !!auto
      if (ollamaEnabledCheckbox) ollamaEnabledCheckbox.checked = !!ollamaEnabled
      if (enableAiCaveatCheckbox) enableAiCaveatCheckbox.checked = !!enableAiCaveat
      if (ollamaUrlInput) ollamaUrlInput.value = ollamaUrl
      if (ollamaModelInput) ollamaModelInput.value = ollamaModel
      if (autoPasteCheckbox) autoPasteCheckbox.checked = !!autoPaste      
      
      if (tpl) {
        // crude parsing: first token is binary, -m <path> for model
        const binMatch = tpl.match(/^\s*(?:"|')?(.*?)(?:"|')?(?:\s|$)/)
        if (binMatch && whisperBin) whisperBin.value = binMatch[1]
        const mMatch = tpl.match(/-m\s+(?:"|')?([^"'\s]+)(?:"|')?/) 
        if (mMatch && modelPath) modelPath.value = mMatch[1]
      }
      
      // ffmpeg path
      const ffmpegInput = document.getElementById('ffmpegPath')
      if (ffmpegInput) ffmpegInput.value = ffmpegPath
      
      const hotkeyInput = document.getElementById('hotkeyInput')
      if (hotkeyInput) hotkeyInput.value = hotkey
      
      const visionHotkeyInput = document.getElementById('visionHotkeyInput')
      const visionHotkey = r && r.vision_hotkey ? r.vision_hotkey : 'CommandOrControl+Option+Shift+V'
      if (visionHotkeyInput) visionHotkeyInput.value = visionHotkey
      // suggested command display & UI wiring
      const suggestedInput = document.getElementById('suggestedCmd')
      const useSuggestedBtn = document.getElementById('useSuggestedBtn')
      const copySuggestedBtn = document.getElementById('copySuggestedBtn')
      if (suggestedInput) suggestedInput.value = suggestedCmd
      if (useSuggestedBtn) {
        useSuggestedBtn.addEventListener('click', () => {
          // populate whisperBin and modelPath from suggested command (crude parsing)
          if (!suggestedCmd) return
          const binMatch = suggestedCmd.match(/^\s*(?:"|')?(.*?)(?:"|')?(?:\s|$)/)
          const mMatch = suggestedCmd.match(/-m\s+(?:"|')?([^"'\s]+)(?:"|')?/) 
          if (binMatch && document.getElementById('whisperBin')) document.getElementById('whisperBin').value = binMatch[1]
          if (mMatch && document.getElementById('modelPath')) document.getElementById('modelPath').value = mMatch[1]
        })
      }
      if (copySuggestedBtn) {
        copySuggestedBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(suggestedCmd)
            copySuggestedBtn.textContent = 'Copied'
            setTimeout(() => { copySuggestedBtn.textContent = 'Copy suggested' }, 1200)
          } catch (e) { console.warn('copy suggested failed', e) }
        })
      }
    } catch (err) {
      console.error('loadSettings error', err)
    }
  }

  async function saveSettings () {
    const whisperBin = document.getElementById('whisperBin').value.trim()
    const modelPath = document.getElementById('modelPath').value.trim()
    const ffmpegPath = document.getElementById('ffmpegPath').value.trim()
    const hotkeyValue = document.getElementById('hotkeyInput').value.trim()
    const autoCheckbox = document.getElementById('autoTranscribe')
    const auto = autoCheckbox ? !!autoCheckbox.checked : false
    const polishWhile = document.getElementById('polishWhileTranscribe')
    const polishWhileValue = polishWhile ? !!polishWhile.checked : false
    const ollamaEnabledCheckbox = document.getElementById('ollamaEnabled')
    const ollamaEnabled = ollamaEnabledCheckbox ? !!ollamaEnabledCheckbox.checked : false
    const enableAiCaveatCheckbox = document.getElementById('enableAiCaveat')
    const enableAiCaveat = enableAiCaveatCheckbox ? !!enableAiCaveatCheckbox.checked : true
    const ollamaUrl = document.getElementById('ollamaUrl').value.trim() || 'http://localhost:11434'
    const ollamaModel = document.getElementById('ollamaModel').value.trim() || 'qwen2.5:0.5b'
    const autoPaste = document.getElementById('autoPaste') ? !!document.getElementById('autoPaste').checked : false
    const visionHotkeyValue = document.getElementById('visionHotkeyInput') ? document.getElementById('visionHotkeyInput').value.trim() : '';

    // Build the transcribe command template if legacy fields are present, else fallback
    let tpl = undefined;
    if (whisperBin && modelPath) {
      tpl = `${whisperBin} -m ${modelPath} -f {wav}`
    }

    // include hotkey in saved settings if present
    const payload = { 
      auto_transcribe: auto, 
      ffmpeg_path: ffmpegPath, 
      ollama_enabled: ollamaEnabled, 
      enable_ai_caveat: enableAiCaveat,
      ollama_url: ollamaUrl, 
      ollama_model: ollamaModel, 
      auto_paste: autoPaste 
    };
    if (tpl !== undefined) payload.transcribe_cmd = tpl;
    if (hotkeyValue) payload.hotkey = hotkeyValue;
    if (visionHotkeyValue) payload.vision_hotkey = visionHotkeyValue;
    const payloadWithPolish = Object.assign({}, payload, { polish_while_transcribe: polishWhileValue })
    const r = await window.electronAPI.saveSettings(payloadWithPolish)
    if (r && r.ok) {
      document.getElementById('settingsResult').textContent = 'Saved.'
      const hotkeyInput = document.getElementById('hotkeyInput')
      const hotkeyLabel = document.getElementById('hotkeyLabel')
      if (hotkeyInput && hotkeyLabel) hotkeyLabel.textContent = `Hotkey: ${hotkeyInput.value || 'Unset'}`
    }
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
    
    // Auto-save settings when checkboxes or inputs are changed in the new UI
    const autoSaveElements = [
      'autoPaste', 'ollamaEnabled', 'enableAiCaveat',
      'ollamaUrl', 'ollamaModel', 'hotkeyInput'
    ];
    autoSaveElements.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', saveSettings);
        if (el.tagName === 'INPUT' && el.type === 'text') {
          // Also save on blur for text inputs
          el.addEventListener('blur', saveSettings);
        }
      }
    });

    loadSettings()
        // Load settings
    loadSettings()
    
    // Load available models
    if (window.electronAPI && window.electronAPI.getAvailableModels) {
      const container = document.getElementById('modelListContainer')
      if (container) {
        // Global progress listener for models
        window.electronAPI.onDownloadProgress(({ type, progress }) => {
            if (type.startsWith('model:')) {
                const modelKey = type.split(':')[1]
                const btn = document.getElementById(`btn-download-${modelKey}`)
                if (btn) {
                    const pct = Math.round(progress * 100)
                    btn.textContent = `${pct}%`
                    // Visual progress bar effect on the button background
                    btn.style.background = `linear-gradient(90deg, #0b79ff ${pct}%, #ccc ${pct}%)`
                    btn.style.color = '#fff'
                    btn.style.border = 'none'
                }
            }
        })

        const refreshModels = async () => {
            try {
                const { models, current } = await window.electronAPI.getAvailableModels()
                container.innerHTML = ''
                
                if (!models || models.length === 0) {
                    container.innerHTML = '<div style="padding:12px; text-align:center;">No models found</div>'
                    return
                }

                models.forEach(m => {
                    const row = document.createElement('div')
                    row.style.display = 'flex'
                    row.style.alignItems = 'center'
                    row.style.padding = '10px'
                    row.style.borderBottom = '1px solid #f0f0f0'
                    row.style.gap = '10px'
                    
                    // Icon/Status
                    const statusIcon = document.createElement('div')
                    statusIcon.style.width = '24px'
                    statusIcon.style.textAlign = 'center'
                    statusIcon.style.fontSize = '16px'
                    statusIcon.textContent = m.active ? '🟢' : (m.installed ? '✓' : '○')
                    statusIcon.title = m.active ? 'Active' : (m.installed ? 'Installed' : 'Not Installed')
                    statusIcon.style.cursor = 'help'
                    
                    // Info
                    const infoDiv = document.createElement('div')
                    infoDiv.style.flex = '1'
                    
                    const titleLine = document.createElement('div')
                    titleLine.style.fontWeight = m.active ? 'bold' : 'normal'
                    titleLine.style.fontSize = '14px'
                    titleLine.style.color = '#333'
                    titleLine.textContent = m.key
                    
                    const metaLine = document.createElement('div')
                    metaLine.style.fontSize = '11px'
                    metaLine.style.color = '#888'
                    metaLine.style.marginTop = '2px'
                    metaLine.textContent = `${m.size} • ${m.ram} • ${m.desc}`
                    
                    infoDiv.appendChild(titleLine)
                    infoDiv.appendChild(metaLine)
                    
                    // Action Button
                    const actionBtn = document.createElement('button')
                    actionBtn.className = 'btn'
                    actionBtn.style.fontSize = '12px'
                    actionBtn.style.padding = '4px 10px'
                    actionBtn.style.minWidth = '80px'
                    actionBtn.id = `btn-download-${m.key}` // ID for progress updates
                    
                    const isComingSoon = ['tiny.en', 'base.en', 'medium.en'].includes(m.key)

                    if (m.active) {
                        actionBtn.textContent = 'Active'
                        actionBtn.disabled = true
                        actionBtn.style.opacity = '0.6'
                        actionBtn.style.background = '#e6e6e6'
                        actionBtn.style.color = '#666'
                        actionBtn.style.border = '1px solid #ccc'
                    } else if (isComingSoon) {
                        actionBtn.textContent = 'Coming Soon'
                        actionBtn.disabled = true
                        actionBtn.style.opacity = '0.6'
                        actionBtn.style.background = '#f0f0f0'
                        actionBtn.style.color = '#999'
                        actionBtn.style.border = '1px solid #ddd'
                    } else if (m.installed) {
                        actionBtn.textContent = 'Switch'
                        actionBtn.style.background = '#fff'
                        actionBtn.style.color = '#333'
                        actionBtn.style.border = '1px solid #ccc'
                        actionBtn.onclick = async () => {
                            actionBtn.textContent = '...'
                            actionBtn.disabled = true
                            await window.electronAPI.setModel(m.filename)
                            await refreshModels()
                        }
                    } else {
                        actionBtn.textContent = 'Download'
                        actionBtn.style.background = '#0b79ff'
                        actionBtn.style.color = 'white'
                        actionBtn.style.border = 'none'
                        actionBtn.onclick = async () => {
                            actionBtn.textContent = '0%'
                            actionBtn.disabled = true
                            try {
                                await window.electronAPI.downloadDependency('model', m.key)
                                await refreshModels()
                            } catch (e) {
                                alert('Download failed: ' + e)
                                actionBtn.textContent = 'Retry'
                                actionBtn.disabled = false
                                actionBtn.style.background = '#dc3545'
                            }
                        }
                    }
                    
                    row.appendChild(statusIcon)
                    row.appendChild(infoDiv)
                    row.appendChild(actionBtn)
                    container.appendChild(row)
                })
                
                // Remove border from last item
                if (container.lastChild) container.lastChild.style.borderBottom = 'none'
            } catch (e) {
                console.error('Failed to refresh models', e)
                container.innerHTML = `<div style="padding:12px; color:red;">Error loading models: ${e.message}</div>`
            }
        }
        
        refreshModels()
      }
    }

    // generic hotkey set logic
    function attachHotkeyListener(btnId, inputId, isVisionMode = false) {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      btn.addEventListener('click', async () => {
        // Show prompt overlay briefly to capture the next key combination
        const overlay = document.createElement('div')
        overlay.style.position = 'fixed'
        overlay.style.left = '0'
        overlay.style.top = '0'
        overlay.style.right = '0'
        overlay.style.bottom = '0'
        overlay.style.background = 'rgba(0,0,0,0.6)'
        overlay.style.display = 'flex'
        overlay.style.alignItems = 'center'
        overlay.style.justifyContent = 'center'
        overlay.style.zIndex = '9999'
        
        const prompt = document.createElement('div')
        prompt.style.background = '#fff'
        prompt.style.padding = '20px'
        prompt.style.borderRadius = '8px'
        prompt.style.width = '400px'
        prompt.style.textAlign = 'center'
        prompt.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)'
        
        const title = document.createElement('div')
        title.textContent = 'Press Hotkey Combination'
        title.style.fontWeight = 'bold'
        title.style.marginBottom = '10px'
        title.style.fontSize = '16px'
        
        const currentKeys = document.createElement('div')
        currentKeys.textContent = 'Waiting for input...'
        currentKeys.style.fontSize = '20px'
        currentKeys.style.color = '#0b79ff'
        currentKeys.style.margin = '20px 0'
        currentKeys.style.minHeight = '30px'
        
        const subtext = document.createElement('div')
        subtext.textContent = 'Press Esc to cancel'
        subtext.style.color = '#999'
        subtext.style.fontSize = '12px'
        
        prompt.appendChild(title)
        prompt.appendChild(currentKeys)
        prompt.appendChild(subtext)
        overlay.appendChild(prompt)
        document.body.appendChild(overlay)

        // keydown listener
        const handler = async (ev) => {
          ev.preventDefault()
          ev.stopPropagation()
          
          const parts = []
          const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
          
          // Handle modifiers
          if (isMac) {
             if (ev.metaKey) parts.push('CommandOrControl')
             if (ev.ctrlKey) parts.push('Control')
          } else {
             if (ev.ctrlKey) parts.push('CommandOrControl')
             if (ev.metaKey) parts.push('Super')
          }
          if (ev.altKey) parts.push('Option')
          if (ev.shiftKey) parts.push('Shift')
          
          let keyPart = ''
          // Use code for digits and letters to avoid Shift+5=% issue
          if (ev.code.startsWith('Key')) {
            keyPart = ev.code.slice(3).toUpperCase()
          } else if (ev.code.startsWith('Digit')) {
            keyPart = ev.code.slice(5)
          } else {
            // Fallback for other keys
            const k = ev.key
            if (k === ' ') keyPart = 'Space'
            else if (k === 'ArrowUp') keyPart = 'Up'
            else if (k === 'ArrowDown') keyPart = 'Down'
            else if (k === 'ArrowLeft') keyPart = 'Left'
            else if (k === 'ArrowRight') keyPart = 'Right'
            else if (k && k.length === 1) keyPart = k.toUpperCase()
            else keyPart = k
          }
          
          // Ignore if it's just a modifier
          const isModifier = ['Shift', 'Control', 'Alt', 'Meta', 'Command', 'Option', 'CommandOrControl', 'Super'].some(m => 
            keyPart === m || ev.key === m
          )
          
          if (isModifier) {
            currentKeys.textContent = parts.join(' + ') + ' + ...'
            return
          }
          
          parts.push(keyPart)
          const hk = parts.join('+')
          currentKeys.textContent = hk
          
          // Remove listeners immediately
          document.removeEventListener('keydown', handler, true)
          document.removeEventListener('keydown', cancelHandler, true)
          
          // Visual feedback before closing
          currentKeys.style.color = '#28a745'
          setTimeout(async () => {
            overlay && overlay.parentNode && overlay.parentNode.removeChild(overlay)
            
            // set it in the input and trigger a save
            const input = document.getElementById(inputId)
            if (input) {
                input.value = hk
                await saveSettings()
            }
          }, 200)
        }
        const cancelHandler = (ev) => {
          if (ev.key === 'Escape') {
            document.removeEventListener('keydown', handler, true)
            document.removeEventListener('keydown', cancelHandler, true)
            overlay && overlay.parentNode && overlay.parentNode.removeChild(overlay)
          }
        }
        document.addEventListener('keydown', cancelHandler, true)
        document.addEventListener('keydown', handler, true)
      })
    }

    attachHotkeyListener('setHotkeyBtn', 'hotkeyInput', false)
    attachHotkeyListener('setVisionHotkeyBtn', 'visionHotkeyInput', true)
    
    // clear hotkey
    const clearHotkeyBtn = document.getElementById('clearHotkeyBtn')
    if (clearHotkeyBtn) {
      clearHotkeyBtn.addEventListener('click', async () => {
        const r = await window.electronAPI.setHotkey('')
        if (r && r.ok) {
          const hotkeyInput = document.getElementById('hotkeyInput')
          if (hotkeyInput) hotkeyInput.value = ''
          alert('Hotkey cleared.')
        } else {
          alert('Failed to clear hotkey: ' + (r && r.error ? r.error : 'unknown'))
        }
      })
    }
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
