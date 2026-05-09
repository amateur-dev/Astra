const assert = require('assert');
const child_process = require('child_process');

// Mock spawn
const originalSpawn = child_process.spawn;
let spawnCallCount = 0;
let killCalled = false;

child_process.spawn = (command, args) => {
  spawnCallCount++;
  // Determine if this is piper or ffplay based on args
  const isPiper = args.includes('--output_raw'); // Note: arg is --output-raw but code uses --output-raw, let's check exact string
  // In code: '--output-raw'
  
  return {
    stdin: { write: () => {}, end: () => {} },
    stdout: { 
        pipe: (dest) => {},
        unpipe: () => {} 
    },
    on: (evt, cb) => { if (evt === 'close') setTimeout(() => cb(0), 10); },
    kill: () => { killCalled = true; }
  };
};

const ttsUtils = require('../src/lib/tts-utils');

async function runTests() {
  console.log('Running TTS Tests...');

  // 1. Test Speak
  try {
      await ttsUtils.speak("Test");
      assert.strictEqual(spawnCallCount, 2, "Should spawn 2 processes (piper + ffplay)");
      console.log('✔ Speak spawns processes');
  } catch (e) { console.error('✖ Speak failed', e); }

  // 2. Test Stop
  spawnCallCount = 0;
  killCalled = false;
  try {
      ttsUtils.speak("Test 2"); // Start it
      ttsUtils.stop();
      assert.strictEqual(killCalled, true, "Stop should call kill()");
      console.log('✔ Stop kills processes');
  } catch (e) { console.error('✖ Stop failed', e); }

  // Restore
  child_process.spawn = originalSpawn;
}

runTests();
