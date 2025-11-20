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

function getBinaryPath(folderName, fileName) {
  // 1. Check bundled resources (Production)
  if (app.isPackaged) {
    const bundledPath = path.join(process.resourcesPath, folderName, fileName);
    if (fs.existsSync(bundledPath)) return bundledPath;
  }
  // 2. Check userData bin (Downloaded)
  return path.join(BIN_DIR, fileName);
}

module.exports = {
  userDataPath,
  BIN_DIR,
  MODELS_DIR,
  FFMPEG_PATH: getBinaryPath('ffmpeg', 'ffmpeg'),
  WHISPER_PATH: getBinaryPath('whisper', 'whisper-cli'),
  getModelPath: (modelName) => path.join(MODELS_DIR, modelName)
};
