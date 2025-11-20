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

module.exports = {
  userDataPath,
  BIN_DIR,
  MODELS_DIR,
  FFMPEG_PATH: path.join(BIN_DIR, 'ffmpeg'),
  WHISPER_PATH: path.join(BIN_DIR, 'whisper-cli'), // We'll rename it to this after download
  getModelPath: (modelName) => path.join(MODELS_DIR, modelName)
};
