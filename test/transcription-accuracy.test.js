const assert = require('node:assert').strict
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { exec } = require('node:child_process')
const { cleanTranscript } = require('../src/lib/transcript-utils')

// Simple word-level Levenshtein edit distance
function editDistance(a, b) {
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 0; i <= n; i++) dp[i][0] = i
  for (let j = 0; j <= m; j++) dp[0][j] = j
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      )
    }
  }
  return dp[n][m]
}

function normalizeToWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9']+/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function computeWER(refText, hypText) {
  const ref = normalizeToWords(refText)
  const hyp = normalizeToWords(hypText)
  if (ref.length === 0) return { wer: hyp.length === 0 ? 0 : 1, refWords: 0, hypWords: hyp.length }
  const dist = editDistance(ref, hyp)
  const wer = dist / ref.length
  return { wer, refWords: ref.length, hypWords: hyp.length, edits: dist }
}

// The command template should print the transcript to STDOUT and may use {wav} placeholder.
function getTranscribeCmdTemplate() {
  return process.env.TRANSCRIBE_CMD || process.env.WHISPER_CMD || ''
}

function runTranscription(template, wavPath) {
  return new Promise((resolve, reject) => {
    const cmd = template.replace(/{wav}/g, JSON.stringify(wavPath))
    exec(cmd, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).toString()))
      resolve(stdout.toString())
    })
  })
}

const wavPath = path.resolve(__dirname, 'Dipesh Test Audio.wav')
const expectedPath = path.resolve(__dirname, 'Dipesh Test Audio.txt')

const haveAssets = fs.existsSync(wavPath) && fs.existsSync(expectedPath)
const tpl = getTranscribeCmdTemplate()

// Allow adjusting accuracy threshold via env; default 0.80
const threshold = Math.max(0, Math.min(1, Number(process.env.ACCURACY_THRESHOLD || 0.80)))

const skipReason = !haveAssets
  ? 'sample WAV/text not found'
  : (!tpl ? 'TRANSCRIBE_CMD/WHISPER_CMD not configured' : '')

// Long timeout because real transcription may be slow
const options = { timeout: Number(process.env.ACCURACY_TEST_TIMEOUT_MS || 180000), skip: Boolean(skipReason) }

if (skipReason) {
  test('transcription accuracy (skipped)', options, () => {
    console.warn('Skipping transcription accuracy test:', skipReason)
  })
} else {
  test('transcription accuracy against reference text', options, async () => {
    const expectedRaw = fs.readFileSync(expectedPath, 'utf8')
    const expected = cleanTranscript(expectedRaw)

    const rawOutput = await runTranscription(tpl, wavPath)
    const actual = cleanTranscript(rawOutput)

    const { wer, refWords, hypWords, edits } = computeWER(expected, actual)
    const accuracy = 1 - wer

    // Provide detailed diff metrics if it fails
    assert.ok(
      accuracy >= threshold,
      `Accuracy ${accuracy.toFixed(3)} below threshold ${threshold} (WER=${wer.toFixed(3)}, edits=${edits}, refWords=${refWords}, hypWords=${hypWords})`)
  })
}
