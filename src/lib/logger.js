const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let logFilePath = null;

function init() {
  // On macOS: ~/Library/Logs/Astra/app.log
  // We use app.getPath('logs') which usually points to ~/Library/Logs/<AppName>
  // We'll add a subdirectory just to be safe and organized
  const logsDir = path.join(app.getPath('logs'), 'Astra');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  logFilePath = path.join(logsDir, 'app.log');
  
  rotateLogs();
}

function rotateLogs() {
  if (!fs.existsSync(logFilePath)) return;
  
  try {
    const stats = fs.statSync(logFilePath);
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    // We can also check age, but size is usually more critical for disk space
    
    if (stats.size > MAX_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${logFilePath}.${timestamp}`;
      fs.renameSync(logFilePath, backupPath);
      
      // Clean up old backups (keep last 5)
      const dir = path.dirname(logFilePath);
      const files = fs.readdirSync(dir)
        .filter(f => f.startsWith('app.log.') && f !== 'app.log')
        .sort(); // Lexicographical sort works for ISO timestamps
        
      while (files.length > 5) {
        const toDelete = files.shift();
        fs.unlinkSync(path.join(dir, toDelete));
      }
    }
  } catch (e) {
    console.error('Failed to rotate logs:', e);
  }
}

function formatMessage(level, message, ...args) {
  const timestamp = new Date().toISOString();
  const formattedArgs = args.map(arg => {
    if (arg instanceof Error) return arg.stack;
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg);
      } catch (e) {
        return '[Circular/Object]';
      }
    }
    return String(arg);
  }).join(' ');
  return `[${timestamp}] [${level}] ${message} ${formattedArgs}\n`;
}

function write(level, message, ...args) {
  if (!logFilePath) {
    try {
      init();
    } catch (e) {
      // Use process.stderr directly to avoid infinite recursion if console.error is hooked
      process.stderr.write(`Logger init failed: ${e.message}\n`);
      return;
    }
  }
  
  const line = formatMessage(level, message, ...args);
  
  // Also print to console for dev debugging
  if (level === 'ERROR') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
  
  try {
    fs.appendFileSync(logFilePath, line);
  } catch (e) {
    process.stderr.write(`Failed to write to log file: ${e.message}\n`);
  }
}

module.exports = {
  info: (msg, ...args) => write('INFO', msg, ...args),
  warn: (msg, ...args) => write('WARN', msg, ...args),
  error: (msg, ...args) => write('ERROR', msg, ...args),
  getLogPath: () => {
    if (!logFilePath) init();
    return logFilePath;
  },
  getLogs: () => {
    if (!logFilePath) init();
    if (fs.existsSync(logFilePath)) {
      return fs.readFileSync(logFilePath, 'utf8');
    }
    return '';
  },
  clearLogs: () => {
    if (!logFilePath) init();
    try {
      fs.writeFileSync(logFilePath, '');
    } catch (e) {
      console.error('Failed to clear logs:', e);
    }
  }
};
