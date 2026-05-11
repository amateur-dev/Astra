const { app, systemPreferences } = require('electron');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function runDoctor() {
  console.log('\n🏥 Astra Doctor: Environment Diagnostics');
  console.log('==============================================\n');
  
  let allGood = true;

  // 1. Node & Electron Environment
  console.log('1. Environment Info');
  console.log(`   - Node.js Version: ${process.versions.node}`);
  console.log(`   - Electron Version: ${process.versions.electron}`);
  console.log(`   - Platform: ${process.platform} ${process.arch}\n`);

  // 2. macOS Permissions (Crucial for Hotkeys and Auto-paste)
  console.log('2. macOS Permissions');
  if (process.platform === 'darwin') {
    // Accessibility (Needed for Global Hotkeys and System Events/Auto-paste)
    const isAccessible = systemPreferences.isTrustedAccessibilityClient(false);
    if (isAccessible) {
      console.log('   ✅ Accessibility: Granted');
    } else {
      console.log('   ❌ Accessibility: DENIED or Not Requested');
      console.log('      ↳ FIX: Go to System Settings > Privacy & Security > Accessibility and enable your Terminal/IDE.');
      allGood = false;
    }

    // Microphone
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    if (micStatus === 'granted') {
      console.log(`   ✅ Microphone: ${micStatus}`);
    } else {
      console.log(`   ❌ Microphone: ${micStatus}`);
      console.log('      ↳ FIX: Go to System Settings > Privacy & Security > Microphone and enable the app.');
      allGood = false;
    }
  } else {
    console.log('   ℹ️  Skipping macOS specific permission checks.');
  }
  console.log('');

  // 3. Dependencies
  console.log('3. Core Dependencies');
  try {
    const ffmpeg = execSync('which ffmpeg', { encoding: 'utf-8' }).trim();
    console.log(`   ✅ FFmpeg: Installed at ${ffmpeg}`);
  } catch (e) {
    console.log('   ❌ FFmpeg: NOT FOUND');
    console.log('      ↳ FIX: Install using `brew install ffmpeg`.');
    allGood = false;
  }

  // 4. Ollama (Optional but recommended)
  try {
    const ollama = execSync('which ollama', { encoding: 'utf-8' }).trim();
    console.log(`   ✅ Ollama: Installed at ${ollama}`);
    
    // Check if Ollama is running
    try {
      execSync('curl -s http://localhost:11434/', { stdio: 'ignore' });
      console.log('   ✅ Ollama Server: Running');
    } catch (e) {
      console.log('   ⚠️  Ollama Server: Not Running (Run `ollama serve` to start)');
    }
  } catch (e) {
    console.log('   ⚠️  Ollama: NOT FOUND (Optional - needed for Copilot polishing)');
  }
  
  console.log('\n==============================================');
  if (allGood) {
    console.log('🎉 Your environment looks healthy and ready to go!\n');
    app.exit(0);
  } else {
    console.log('⚠️  Please address the issues marked with ❌ above before running the app.\n');
    app.exit(1);
  }
}

app.whenReady().then(runDoctor);