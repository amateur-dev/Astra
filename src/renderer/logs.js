const logContainer = document.getElementById('logContainer');
const refreshBtn = document.getElementById('refreshBtn');
const copyBtn = document.getElementById('copyBtn');
const clearBtn = document.getElementById('clearBtn');

function formatLogLine(line) {
  const div = document.createElement('div');
  div.className = 'log-line';
  
  if (line.includes('[ERROR]')) div.classList.add('log-error');
  else if (line.includes('[WARN]')) div.classList.add('log-warn');
  else div.classList.add('log-info');
  
  div.textContent = line;
  return div;
}

async function loadLogs() {
  if (!window.electronAPI || !window.electronAPI.getLogs) return;
  
  try {
    const logs = await window.electronAPI.getLogs();
    logContainer.innerHTML = '';
    if (!logs) {
      logContainer.textContent = 'No logs found.';
      return;
    }
    
    const lines = logs.split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        logContainer.appendChild(formatLogLine(line));
      }
    });
    
    // Scroll to bottom
    logContainer.scrollTop = logContainer.scrollHeight;
  } catch (e) {
    console.error('Failed to load logs', e);
    logContainer.textContent = 'Error loading logs: ' + e.message;
  }
}

refreshBtn.addEventListener('click', loadLogs);

copyBtn.addEventListener('click', async () => {
  if (!window.electronAPI || !window.electronAPI.getLogs) return;
  const logs = await window.electronAPI.getLogs();
  navigator.clipboard.writeText(logs);
  const originalText = copyBtn.textContent;
  copyBtn.textContent = 'Copied!';
  setTimeout(() => copyBtn.textContent = originalText, 2000);
});

clearBtn.addEventListener('click', async () => {
  if (confirm('Are you sure you want to clear all logs?')) {
    if (window.electronAPI && window.electronAPI.clearLogs) {
      await window.electronAPI.clearLogs();
      loadLogs();
    }
  }
});

// Initial load
loadLogs();

// Auto-refresh every 5 seconds if window is visible
setInterval(() => {
  if (document.visibilityState === 'visible') {
    loadLogs();
  }
}, 5000);
