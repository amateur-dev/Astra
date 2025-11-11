const fs = require('fs')
const path = require('path')
// We require child_process at call-time so tests can stub `child_process.exec`

// Check whether a 'whisper' binary is available on PATH or referenced in a
// configured transcription template. Accepts an optional template override for
// testing convenience.
async function checkWhisperAvailability (tplOverride) {
  try {
    const tpl = (typeof tplOverride === 'string' ? tplOverride : (process.env.TRANSCRIBE_CMD || process.env.WHISPER_CMD || ''))
    if (tpl && /whisper/i.test(tpl)) {
      const binMatch = tpl.match(/^\s*(?:"|')?(.*?)(?:"|')?(?:\s|$)/)
      if (binMatch && binMatch[1]) {
        const explicit = binMatch[1]
        try {
          if (fs.existsSync(explicit)) return { ok: true, path: explicit, source: 'configured' }
        } catch (e) { /* ignore */ }
      }
    }

    // Try common binary names in order. Many builds name the binary `whisper-cli`.
    const candidates = ['whisper', 'whisper-cli']
    let found = null
    for (const name of candidates) {
      // require exec at call-time so tests can stub it
      const { exec } = require('child_process')
      // eslint-disable-next-line no-await-in-loop
      const p = await new Promise((resolve) => {
        exec(`which ${name}`, (err, stdout) => {
          if (err) return resolve(null)
          const out = stdout && stdout.toString().trim()
          resolve(out || null)
        })
      })
      if (p) { found = p; break }
    }
    // If not found on PATH, try common absolute locations where users build whisper.cpp
    if (!found) {
      const home = process.env.HOME || ''
      const absoluteCandidates = []
      // common build locations
      if (home) {
        absoluteCandidates.push(path.join(home, 'whisper.cpp', 'build', 'bin', 'whisper-cli'))
        absoluteCandidates.push(path.join(home, 'whisper.cpp', 'build', 'bin', 'main'))
        absoluteCandidates.push(path.join(home, 'whisper.cpp', 'build', 'whisper-cli'))
        absoluteCandidates.push(path.join(home, 'whisper.cpp', 'main'))
      }
      absoluteCandidates.push('/opt/homebrew/bin/whisper-cli')
      absoluteCandidates.push('/usr/local/bin/whisper-cli')
      absoluteCandidates.push('/usr/bin/whisper-cli')
      absoluteCandidates.push('/bin/whisper-cli')
      for (const pth of absoluteCandidates) {
        try {
          if (pth && fs.existsSync(pth)) { found = pth; break }
        } catch (e) { /* ignore */ }
      }
    }
    if (found) return { ok: true, path: found, source: 'which' }
    return { ok: false, error: 'whisper binary not found on PATH' }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

module.exports = { checkWhisperAvailability }
