const assert = require('node:assert').strict
const { test } = require('node:test')
const { cleanTranscript, extractTimestampFromText } = require('../src/lib/transcript-utils')

test('extractTimestampFromText finds times like 7:30 AM', () => {
  const s = 'This is the morning of the 11th of November, 7:30 AM and testing now'
  assert.equal(extractTimestampFromText(s), '7:30 AM')
})

test('extractTimestampFromText finds ordinals like 11th', () => {
  const s = 'Today is the 11th and we are testing timestamps'
  assert.equal(extractTimestampFromText(s), '11th')
})

test('cleanTranscript removes timestamp lines and caveat', () => {
  const raw = '00:00:01\nThis is a test transcript.\nI made the following changes:\n- removed timestamps'
  const cleaned = cleanTranscript(raw)
  assert.equal(cleaned, 'This is a test transcript.')
})

test('cleanTranscript returns raw text when input is empty', () => {
  assert.equal(cleanTranscript(''), '')
  assert.equal(cleanTranscript(null), null)
})
