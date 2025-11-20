const ffmpegStatus = document.getElementById('ffmpegStatus');
const whisperStatus = document.getElementById('whisperStatus');
const modelTableBody = document.getElementById('modelTableBody');
const startBtn = document.getElementById('startBtn');
const errorMsg = document.getElementById('errorMsg');

let selectedModel = 'small.en'; // Default
let dependencies = null;

const MODELS = {
  'tiny.en': { size: '75 MB', ram: '~390 MB', desc: 'Fastest, lower accuracy' },
  'base.en': { size: '142 MB', ram: '~500 MB', desc: 'Balanced speed/accuracy' },
  'small.en': { size: '466 MB', ram: '~1.0 GB', desc: 'Good accuracy (Recommended)' },
  'medium.en': { size: '1.5 GB', ram: '~2.6 GB', desc: 'High accuracy, slow' }
};

function updateStatus(el, isOk) {
  if (isOk) {
    el.textContent = 'Installed';
    el.className = 'status-badge status-ok';
  } else {
    el.textContent = 'Missing';
    el.className = 'status-badge status-missing';
  }
}

function renderModels() {
  modelTableBody.innerHTML = '';
  for (const [key, info] of Object.entries(MODELS)) {
    const tr = document.createElement('tr');
    tr.className = `model-row ${key === selectedModel ? 'selected' : ''}`;
    tr.onclick = () => {
      selectedModel = key;
      renderModels();
    };
    
    const isInstalled = dependencies && dependencies.models && dependencies.models[info.filename];
    const radio = `<input type="radio" name="model" ${key === selectedModel ? 'checked' : ''}>`;
    
    tr.innerHTML = `
      <td>${radio}</td>
      <td>${key} ${isInstalled ? '✅' : ''}</td>
      <td>${info.size}</td>
      <td>${info.ram}</td>
      <td>${info.desc}</td>
    `;
    modelTableBody.appendChild(tr);
  }
}

async function check() {
  try {
    dependencies = await window.electronAPI.checkDependencies();
    updateStatus(ffmpegStatus, dependencies.ffmpeg);
    updateStatus(whisperStatus, dependencies.whisper);
    renderModels();
    
    // If everything installed (including selected model), change button text
    if (dependencies.ffmpeg && dependencies.whisper && dependencies.models[MODELS[selectedModel].filename]) {
      startBtn.textContent = 'Start Application';
    } else {
      startBtn.textContent = 'Download & Install';
    }
  } catch (e) {
    console.error(e);
    errorMsg.textContent = 'Failed to check dependencies: ' + e.message;
    errorMsg.style.display = 'block';
  }
}

window.electronAPI.onDownloadProgress(({ type, progress }) => {
  let container, bar, text;
  if (type === 'ffmpeg') {
    container = document.getElementById('ffmpegProgress');
  } else if (type === 'whisper') {
    container = document.getElementById('whisperProgress');
  } else if (type.startsWith('model')) {
    container = document.getElementById('modelProgress');
  }
  
  if (container) {
    container.style.display = 'block';
    bar = container.querySelector('.progress-fill');
    text = container.querySelector('.progress-text');
    
    const pct = Math.round(progress * 100);
    bar.style.width = `${pct}%`;
    text.textContent = `Downloading... ${pct}%`;
  }
});

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  errorMsg.style.display = 'none';
  
  try {
    // 1. Install FFmpeg if missing
    if (!dependencies.ffmpeg) {
      await window.electronAPI.downloadDependency('ffmpeg');
      dependencies.ffmpeg = true;
      updateStatus(ffmpegStatus, true);
      document.getElementById('ffmpegProgress').style.display = 'none';
    }
    
    // 2. Install Whisper if missing
    if (!dependencies.whisper) {
      await window.electronAPI.downloadDependency('whisper');
      dependencies.whisper = true;
      updateStatus(whisperStatus, true);
      document.getElementById('whisperProgress').style.display = 'none';
    }
    
    // 3. Install Model if missing
    if (!dependencies.models[MODELS[selectedModel].filename]) {
      await window.electronAPI.downloadDependency('model', selectedModel);
      dependencies.models[MODELS[selectedModel].filename] = true;
      renderModels();
      document.getElementById('modelProgress').style.display = 'none';
    }
    
    // Set the selected model as active
    await window.electronAPI.setModel(MODELS[selectedModel].filename);

    // Done
    await window.electronAPI.finishSetup();
  } catch (e) {
    console.error(e);
    errorMsg.textContent = 'Installation failed: ' + e.message;
    errorMsg.style.display = 'block';
    startBtn.disabled = false;
  }
});

// Initial check
check();
