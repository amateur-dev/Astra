const assert = require('node:assert').strict
const { test } = require('node:test')
const cp = require('node:child_process')
const fs = require('node:fs')

// We'll require the module under test
const { checkWhisperAvailability } = require('../src/lib/whisper-utils')

// Helper to temporarily stub child_process.exec
async function withExecStub(stubImpl, fn) {
  const origExec = cp.exec;
  const origExists = fs.existsSync;
  cp.exec = stubImpl;
  fs.existsSync = () => false; // Prevent fallback to absolute paths breaking tests
  try {
    return await fn();
  } finally {
    cp.exec = origExec;
    fs.existsSync = origExists;
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
