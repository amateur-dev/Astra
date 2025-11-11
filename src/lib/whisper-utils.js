const fs = require('fs')
const { exec } = require('child_process')

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

    const found = await new Promise((resolve) => {
      exec('which whisper', (err, stdout) => {
        if (err) return resolve(null)
        const p = stdout && stdout.toString().trim()
        resolve(p || null)
      })
    })
    if (found) return { ok: true, path: found, source: 'which' }
    return { ok: false, error: 'whisper binary not found on PATH' }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

module.exports = { checkWhisperAvailability }
