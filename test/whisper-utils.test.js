const assert = require('node:assert').strict
const { test } = require('node:test')
const cp = require('node:child_process')

// We'll require the module under test
const { checkWhisperAvailability } = require('../src/lib/whisper-utils')
const { formatTranscriptionError } = require('../src/lib/whisper-utils')

// Helper to temporarily stub child_process.exec
function withExecStub (stubImpl, fn) {
  const orig = cp.exec
  cp.exec = stubImpl
  try {
    const res = fn()
    // If fn returns a Promise, await it so the stub remains in place during async work
    if (res && typeof res.then === 'function') {
      return res.finally(() => { cp.exec = orig })
    }
    return res
  } finally {
    // If fn returned a Promise, the restore happens in the finally above. Otherwise, restore here.
    try { if (! (fn() && typeof fn().then === 'function')) cp.exec = orig } catch (e) { cp.exec = orig }
  }
}

test('checkWhisperAvailability returns ok when which returns path', async () => {
  const stub = (cmd, cb) => { cb(null, '/usr/local/bin/whisper\n') }
  const res = await withExecStub(stub, () => checkWhisperAvailability())
  assert.equal(res.ok, true)
  assert.ok(res.path && res.path.includes('whisper'))
})

test('checkWhisperAvailability returns not-ok when which fails', async () => {
  const stub = (cmd, cb) => { cb(new Error('not found'), '') }
  // Also ensure fs.existsSync doesn't find common absolute paths on this machine
  const fs = require('fs')
  const origExists = fs.existsSync
  fs.existsSync = () => false
  try {
    const res = await withExecStub(stub, () => checkWhisperAvailability())
    assert.equal(res.ok, false)
  } finally {
    fs.existsSync = origExists
  }
})

test('formatTranscriptionError recognizes macOS dyld missing library and returns helpful message', () => {
  const stderr = `dyld[84605]: Library not loaded: @rpath/libwhisper.1.dylib\n  Referenced from: /Applications/voice-hotkey-electron.app/Contents/Resources/whisper/whisper-cli\n  Reason: tried: '/Users/dk_sukhani/whisper.cpp/build/src/libwhisper.1.dylib' (no such file)`
  const out = formatTranscriptionError(stderr)
  assert.ok(out.includes('could not be loaded'))
  assert.ok(out.includes('libwhisper'))
  assert.ok(out.includes('Suggested actions'))
})

test('formatTranscriptionError returns string for other errors', () => {
  const err = new Error('some other runtime error')
  const out = formatTranscriptionError(err)
  assert.ok(out.includes('some other runtime error'))
})
