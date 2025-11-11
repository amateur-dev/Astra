const assert = require('node:assert').strict
const { test } = require('node:test')
const cp = require('node:child_process')

// We'll require the module under test
const { checkWhisperAvailability } = require('../src/lib/whisper-utils')

// Helper to temporarily stub child_process.exec
function withExecStub (stubImpl, fn) {
  const orig = cp.exec
  cp.exec = stubImpl
  try {
    return fn()
  } finally {
    cp.exec = orig
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
  const res = await withExecStub(stub, () => checkWhisperAvailability())
  assert.equal(res.ok, false)
})
