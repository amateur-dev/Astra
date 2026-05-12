const path = require('path');
const { app } = require('electron');

let userDataPath = '';
try {
  userDataPath = app.getPath('userData');
} catch (e) {
  // Fallback for testing or non-electron env
  userDataPath = path.join(process.env.HOME || '.', '.voice-hotkey');
}

const BIN_DIR = path.join(userDataPath, 'bin');
const MODELS_DIR = path.join(userDataPath, 'models');
const fs = require('fs');

const LEGACY_USER_DATA_PATH = path.join(process.env.HOME || '.', 'Library', 'Application Support', 'voice-hotkey-electron');
const LEGACY_BIN_DIR = path.join(LEGACY_USER_DATA_PATH, 'bin');
const LEGACY_MODELS_DIR = path.join(LEGACY_USER_DATA_PATH, 'models');

function getBinaryPath(folderName, fileName) {
  // 1. Check bundled resources (Production)
  if (app && app.isPackaged) {
    const bundledPath = path.join(process.resourcesPath, folderName, fileName);
    if (fs.existsSync(bundledPath)) return bundledPath;
  } else {
    // 2. Check local build directory (Development)
    // Use __dirname to reliably find project root from src/lib/
    const localBuildPath = path.join(__dirname, '..', '..', 'build', folderName, fileName);
    if (fs.existsSync(localBuildPath)) return localBuildPath;
  }
  // 3. Check userData bin (Downloaded)
  return path.join(BIN_DIR, fileName);
}

function getModelPath(modelName) {
  const commonPaths = [
    MODELS_DIR,
    LEGACY_MODELS_DIR,
    path.join(process.env.HOME || '.', '.voice-hotkey', 'models'),
    path.join(process.env.HOME || '.', '.cache', 'whisper'),
    path.join(process.env.HOME || '.', 'Library', 'Caches', 'whisper')
  ];

  for (const dir of commonPaths) {
    const fullPath = path.join(dir, modelName);
    if (fs.existsSync(fullPath)) return fullPath;
  }
  
  // If not found anywhere, default to the primary MODELS_DIR so it can be downloaded there
  return path.join(MODELS_DIR, modelName);
}

function getPiperDir() {
  const primary = path.join(BIN_DIR, 'piper');
  const legacy = path.join(LEGACY_BIN_DIR, 'piper');
  if (fs.existsSync(path.join(primary, 'piper'))) return primary;
  if (fs.existsSync(path.join(legacy, 'piper'))) return legacy;
  return primary;
}

function getVoiceModelPath() {
  const preferred = getModelPath('en_US-lessac-high.onnx');
  if (fs.existsSync(preferred)) return preferred;

  const fallbacks = [
    path.join(MODELS_DIR, 'en_US-amy-medium.onnx'),
    path.join(LEGACY_MODELS_DIR, 'en_US-amy-medium.onnx')
  ];

  for (const modelPath of fallbacks) {
    if (fs.existsSync(modelPath)) return modelPath;
  }

  return preferred;
}

const PIPER_DIR = getPiperDir();

module.exports = {
  userDataPath,
  BIN_DIR,
  MODELS_DIR,
  FFMPEG_PATH: getBinaryPath('ffmpeg', 'ffmpeg'),
  WHISPER_PATH: getBinaryPath('whisper', 'whisper-cli'),
  WHISPER_SERVER_PATH: getBinaryPath('whisper', 'whisper-server'),
  PIPER_DIR,
  PIPER_PATH: path.join(PIPER_DIR, 'piper'),
  VOICE_MODEL_PATH: getVoiceModelPath(),
  getModelPath,
  COMMON_MODEL_PATHS: [
    MODELS_DIR,
    LEGACY_MODELS_DIR,
    path.join(process.env.HOME || '.', '.voice-hotkey', 'models'),
    path.join(process.env.HOME || '.', '.cache', 'whisper'),
    path.join(process.env.HOME || '.', 'Library', 'Caches', 'whisper')
  ]
};
