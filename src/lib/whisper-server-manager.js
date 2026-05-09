const { spawn } = require('child_process');
const path = require('path');
const { WHISPER_SERVER_PATH } = require('./paths');
const fs = require('fs');

class WhisperServerManager {
  constructor() {
    this.process = null;
    this.port = 8080;
  }

  async start(modelPath) {
    if (this.process) {
      console.log('Whisper server already running');
      return;
    }

    const bin = WHISPER_SERVER_PATH;
    if (!fs.existsSync(bin)) {
      console.error(`whisper-server binary not found at ${bin}. Real-time streaming will be unavailable.`);
      return;
    }

    console.log(`Starting whisper-server with binary: ${bin} and model: ${modelPath}`);
    
    // Using --port and -m for model. 
    // whisper.cpp server documentation says it listens for POST /inference
    this.process = spawn(bin, [
      '-m', modelPath,
      '--port', this.port.toString()
    ]);

    this.process.stdout.on('data', (data) => {
      // whisper-server can be noisy, maybe log to debug only
      // console.log(`whisper-server: ${data}`);
    });

    this.process.stderr.on('data', (data) => {
      // whisper-server often logs info to stderr
      console.log(`whisper-server info: ${data}`);
    });

    this.process.on('close', (code) => {
      console.log(`whisper-server process exited with code ${code}`);
      this.process = null;
    });

    // Wait a bit for server to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  stop() {
    if (this.process) {
      console.log('Stopping whisper-server...');
      this.process.kill();
      this.process = null;
    }
  }

  isRunning() {
    return this.process !== null;
  }
}

module.exports = new WhisperServerManager();
