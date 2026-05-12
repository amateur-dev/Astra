const assert = require('node:assert').strict;
const { test } = require('node:test');
const dbManager = require('../src/lib/db-manager');
const memoryManager = require('../src/lib/memory-manager');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const WHISPER_BIN = '/Users/dk_sukhani/whisper.cpp/build/bin/whisper-cli';
const MODEL_PATH = '/Users/dk_sukhani/Library/Application Support/voice-hotkey-electron/models/ggml-small.en.bin';
const VOICE_DIR = path.join(__dirname, '..', 'dipesh_voice');

test('Verification: Real Voice Data Learning & Recall', async (t) => {
  
  // 1. Clear previous test data to be sure
  dbManager.db.exec("DELETE FROM transcripts");
  
  const files = fs.readdirSync(VOICE_DIR).filter(f => f.endsWith('.m4a'));
  console.log(`  - Processing ${files.length} real voice notes for memory verification...`);

  for (const file of files) {
    const inputPath = path.join(VOICE_DIR, file);
    const wavPath = path.join(VOICE_DIR, file.replace('.m4a', '.test.wav'));
    
    // Convert
    execSync(`ffmpeg -y -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}"`, { stdio: 'ignore' });
    
    // Transcribe
    const transcript = execSync(`"${WHISPER_BIN}" -m "${MODEL_PATH}" -f "${wavPath}" --no-timestamps`, { encoding: 'utf8' }).trim();
    
    // --- THE COOL PART: Saving to Vector Memory ---
    // We'll mock the embedding since Ollama might not be running in this shell, 
    // but we'll use a real transcript snippet.
    const mockEmbedding = Buffer.from(new Float32Array(Array(768).fill(0.1)).buffer);
    memoryManager.logTranscript(transcript, transcript, mockEmbedding);
    
    fs.unlinkSync(wavPath);
  }

  await t.test('App should now "remember" Dipesh\'s specific voice content', () => {
    // Search for a unique concept from Voice Note 1: "productivity"
    const results = dbManager.searchTranscripts('productivity');
    assert.ok(results.length > 0, 'Memory should find the transcript about productivity');
    assert.ok(results[0].raw_text.includes('noise tools and fake productivity'));
    console.log('  ✅ Verified: App successfully remembered the "Productivity" philosophy.');
  });

  await t.test('App should now "remember" Dipesh\'s voice content about "chaos"', () => {
    // Search for a unique concept from Voice Note 2: "chaos"
    const results = dbManager.searchTranscripts('chaos');
    assert.ok(results.length > 0, 'Memory should find the transcript about chaos');
    assert.ok(results[0].raw_text.includes('life is a mix of chaos and obsession'));
    console.log('  ✅ Verified: App successfully remembered the "Chaos and Obsession" context.');
  });

  await t.test('Vocabulary learning from real voice correction', () => {
    // Simulate user correcting a common mistake in the voice note
    // For example, if the user highlights "PRJ X" and says "Project Xero"
    memoryManager.addCorrection('prj x', 'Project Xero');
    
    const context = memoryManager.getMemoryContext();
    assert.ok(context.includes('prj x') && context.includes('Project Xero'));
    console.log('  ✅ Verified: Adaptive Vocabulary learning is active.');
  });

});
