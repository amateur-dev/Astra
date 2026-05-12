const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { PIPER_PATH, VOICE_MODEL_PATH, FFMPEG_PATH, BIN_DIR, PIPER_DIR } = require('./paths');
const logger = require('./logger');

let activeProcess = null;

function getFfplayPath() {
    // Try to find ffplay next to ffmpeg
    const ffmpegDir = path.dirname(FFMPEG_PATH);
    const bundledFfplay = path.join(ffmpegDir, 'ffplay');
    if (fs.existsSync(bundledFfplay)) return bundledFfplay;
    
    // Try BIN_DIR
    const binFfplay = path.join(BIN_DIR, 'ffplay');
    if (fs.existsSync(binFfplay)) return binFfplay;

    return 'ffplay'; // Fallback to system
}

async function speak(text) {
  stop(); // Stop any current speech

  if (!text || !text.trim()) return;

  const ffplayPath = getFfplayPath();
  
  return new Promise((resolve, reject) => {
    // Arguments as requested
    const piperArgs = [
      '--model', VOICE_MODEL_PATH,
      '--output-raw'
    ];
    
    // -f s16le -ar 22050 -ac 1 -i pipe:0 -nodisp -autoexit
    // Use -ch_layout mono instead of -ac 1 for newer ffmpeg/ffplay versions
    const ffplayArgs = [
      '-f', 's16le',
      '-ar', '22050',
      '-ch_layout', 'mono', 
      '-i', 'pipe:0',
      '-nodisp',
      '-autoexit'
    ];

    logger.info(`Speaking: ${text.substring(0, 50)}...`);

    try {
        const env = { ...process.env, DYLD_LIBRARY_PATH: PIPER_DIR };
        const piper = spawn(PIPER_PATH, piperArgs, { 
            stdio: ['pipe', 'pipe', 'pipe'],
            env: env
        });
        const ffplay = spawn(ffplayPath, ffplayArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
        
        activeProcess = { piper, ffplay };
        
        // Pipe piper output to ffplay input
        piper.stdout.pipe(ffplay.stdin);
        
        // Log Piper stderr
        if (piper.stderr) {
            piper.stderr.on('data', (data) => {
                logger.warn(`Piper stderr: ${data.toString()}`);
            });
        }

        // Log ffplay stderr (if piped)
        if (ffplay.stderr) {
            ffplay.stderr.on('data', (data) => {
                const msg = data.toString();
                // ffplay logs normal stats to stderr, so ignore those to avoid spam
                if (!msg.includes('  q=') && !msg.includes('aq=') && !msg.includes('sq=')) {
                logger.info(`ffplay: ${msg.trim()}`);
                }
            });
        }
        
        // Handle ffplay exit
        ffplay.on('close', (code) => {
            activeProcess = null;
            if (code === 0) resolve();
            else resolve(); // Resolve gracefully
        });
        
        // Errors
        piper.on('error', (err) => {
            logger.error('Piper error:', err);
            // Don't reject purely on error as pipes might close early
        });
        ffplay.on('error', (err) => {
            logger.error('ffplay error:', err);
            reject(err);
        });

        // Send text to piper
        piper.stdin.write(text);
        piper.stdin.end();

    } catch (e) {
        reject(e);
    }
  });
}

function stop() {
  if (activeProcess) {
    logger.info('Stopping speech...');
    if (activeProcess.piper) { 
        try { activeProcess.piper.stdout.unpipe(); } catch(e) {}
        activeProcess.piper.kill(); 
    }
    if (activeProcess.ffplay) activeProcess.ffplay.kill();
    activeProcess = null;
  }
}

module.exports = { speak, stop };
