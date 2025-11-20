const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const { BIN_DIR, MODELS_DIR, FFMPEG_PATH, WHISPER_PATH, getModelPath } = require('./paths');
const logger = require('./logger');

// Ensure directories exist
if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });
if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });

const MODELS = {
  'tiny.en': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    filename: 'ggml-tiny.en.bin',
    size: '75 MB',
    ram: '~390 MB',
    desc: 'Fastest, lower accuracy'
  },
  'base.en': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    filename: 'ggml-base.en.bin',
    size: '142 MB',
    ram: '~500 MB',
    desc: 'Balanced speed/accuracy'
  },
  'small.en': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
    filename: 'ggml-small.en.bin',
    size: '466 MB',
    ram: '~1.0 GB',
    desc: 'Good accuracy, slower (Recommended)'
  },
  'medium.en': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin',
    filename: 'ggml-medium.en.bin',
    size: '1.5 GB',
    ram: '~2.6 GB',
    desc: 'High accuracy, slow'
  }
};

// FFmpeg URL (macOS static build)
const FFMPEG_URL = 'https://evermeet.cx/ffmpeg/getrelease/zip';

// Whisper URL - Placeholder! 
// Since there is no official stable permalink for a macOS binary, 
// we might need to ask the user to provide it or use a custom hosted one.
// For this implementation, we'll use a placeholder that will fail if tried, 
// but the UI will allow the user to retry or we can update it later.
// Ideally, we would host a specific version on GitHub Releases of THIS repo.
const WHISPER_URL = 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.5.4/whisper-bin-x64.zip'; // Example

async function checkDependencies() {
  const status = {
    ffmpeg: false,
    whisper: false,
    models: {}
  };

  // Check FFmpeg
  if (fs.existsSync(FFMPEG_PATH)) {
    status.ffmpeg = true;
  } else {
    // Check PATH
    try {
      await new Promise((resolve, reject) => {
        exec('which ffmpeg', (err, stdout) => {
          if (!err && stdout.trim()) status.ffmpeg = true;
          resolve();
        });
      });
    } catch (e) {}
  }

  // Check Whisper
  if (fs.existsSync(WHISPER_PATH)) {
    status.whisper = true;
  } else {
    // Check PATH
    try {
      await new Promise((resolve, reject) => {
        exec('which whisper-cli', (err, stdout) => {
          if (!err && stdout.trim()) status.whisper = true;
          resolve();
        });
      });
    } catch (e) {}
  }

  // Check Models
  for (const [key, info] of Object.entries(MODELS)) {
    if (fs.existsSync(path.join(MODELS_DIR, info.filename))) {
      status.models[info.filename] = true; // Use filename as key to match getAvailableModels
    } else {
      status.models[info.filename] = false;
    }
  }

  return status;
}

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle relative redirects
        const newUrl = new URL(response.headers.location, url).toString();
        downloadFile(newUrl, destPath, onProgress).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloaded = 0;

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        file.write(chunk);
        if (onProgress && totalSize) {
          onProgress(downloaded / totalSize);
        }
      });

      response.on('end', () => {
        file.end();
        resolve();
      });
    });

    request.on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function installFFmpeg(onProgress) {
  const zipPath = path.join(BIN_DIR, 'ffmpeg.zip');
  logger.info('Downloading FFmpeg...');
  await downloadFile(FFMPEG_URL, zipPath, onProgress);
  
  logger.info('Unzipping FFmpeg...');
  await new Promise((resolve, reject) => {
    exec(`unzip -o "${zipPath}" -d "${BIN_DIR}"`, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  
  fs.unlinkSync(zipPath);
  fs.chmodSync(FFMPEG_PATH, 0o755);
  logger.info('FFmpeg installed.');
}

async function installWhisper(onProgress) {
  // NOTE: This is a placeholder implementation assuming a zip with a binary named 'main' or 'whisper-cli'
  // Since we don't have a real URL, this might fail in practice without a real URL.
  // For the purpose of the "First Run" feature, we implement the logic.
  
  const zipPath = path.join(BIN_DIR, 'whisper.zip');
  logger.info('Downloading Whisper...');
  await downloadFile(WHISPER_URL, zipPath, onProgress);
  
  logger.info('Unzipping Whisper...');
  await new Promise((resolve, reject) => {
    exec(`unzip -o "${zipPath}" -d "${BIN_DIR}"`, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  
  fs.unlinkSync(zipPath);
  
  // Rename 'main' to 'whisper-cli' if needed
  const mainPath = path.join(BIN_DIR, 'main');
  if (fs.existsSync(mainPath)) {
    fs.renameSync(mainPath, WHISPER_PATH);
  }
  
  if (fs.existsSync(WHISPER_PATH)) {
    fs.chmodSync(WHISPER_PATH, 0o755);
    logger.info('Whisper installed.');
  } else {
    throw new Error('Whisper binary not found in downloaded archive');
  }
}

async function downloadModel(modelKey, onProgress) {
  const info = MODELS[modelKey];
  if (!info) throw new Error('Unknown model');
  
  const dest = path.join(MODELS_DIR, info.filename);
  logger.info(`Downloading model ${modelKey}...`);
  await downloadFile(info.url, dest, onProgress);
  logger.info(`Model ${modelKey} installed.`);
}

module.exports = {
  checkDependencies,
  installFFmpeg,
  installWhisper,
  downloadModel,
  MODELS
};
