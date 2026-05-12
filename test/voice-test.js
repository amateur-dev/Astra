const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const WHISPER_BIN = '/Users/dk_sukhani/whisper.cpp/build/bin/whisper-cli';
const MODEL_PATH = '/Users/dk_sukhani/Library/Application Support/voice-hotkey-electron/models/ggml-small.en.bin';
const VOICE_DIR = path.join(__dirname, '..', 'dipesh_voice');

async function runTest() {
  const files = fs.readdirSync(VOICE_DIR).filter(f => f.endsWith('.m4a'));
  console.log(`Found ${files.length} voice notes to test.`);

  for (const file of files) {
    const inputPath = path.join(VOICE_DIR, file);
    const wavPath = path.join(VOICE_DIR, file.replace('.m4a', '.wav'));
    
    console.log(`\n--- Testing: ${file} ---`);
    
    // 1. Convert to WAV
    console.log(`Step 1: Converting to WAV...`);
    await new Promise((resolve, reject) => {
      exec(`ffmpeg -y -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}"`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // 2. Transcribe
    console.log(`Step 2: Transcribing...`);
    await new Promise((resolve) => {
      exec(`"${WHISPER_BIN}" -m "${MODEL_PATH}" -f "${wavPath}" --no-timestamps`, (err, stdout, stderr) => {
        if (err) {
          console.error(`Transcription failed for ${file}:`, stderr || err.message);
        } else {
          console.log(`RESULT:\n${stdout.trim()}`);
        }
        resolve();
      });
    });
    
    // Cleanup WAV
    fs.unlinkSync(wavPath);
  }
}

runTest().catch(console.error);
