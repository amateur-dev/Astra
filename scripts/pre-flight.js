/**
 * Pre-Flight Validation Engine
 * This script performs a triple-check of the application's readiness:
 * 1. Structural/Syntax Check: Ensures no redeclarations or broken braces.
 * 2. Environment Integrity: Verifies AI binaries, native modules, and folders.
 * 3. Logic Regression: Runs all unit and E2E simulation tests.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  bold: "\x1b[1m"
};

function log(msg, color = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}

async function run() {
  log("\n🚀 Starting Pre-Flight Validation...", colors.bold + colors.blue);

  // --- 1. Syntax Validation ---
  log("\n[1/3] Validating Syntax & Structure...");
  const filesToSubCheck = [
    'src/main.js',
    'src/preload.js',
    'src/lib/db-manager.js',
    'src/lib/memory-manager.js',
    'src/lib/whisper-server-manager.js'
  ];

  for (const file of filesToSubCheck) {
    try {
      execSync(`node -c ${file}`);
      log(`  ✅ ${file}: Syntax OK`, colors.green);
    } catch (e) {
      log(`  ❌ ${file}: Syntax Error Detected!`, colors.red);
      process.exit(1);
    }
  }

  // --- 2. Environment & Binary Check ---
  log("\n[2/3] Verifying Environment Integrity...");
  
  // Check for Electron Binary
  const electronPath = './node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
  if (fs.existsSync(electronPath)) {
     log("  ✅ Electron Binary: Found", colors.green);
  } else {
     log("  ❌ Electron Binary: MISSING! (Run npm install)", colors.red);
  }

  // Check for Native Modules (better-sqlite3)
  try {
    require('better-sqlite3');
    log("  ✅ Native Modules (SQLite): Ready", colors.green);
  } catch (e) {
    log("  ❌ Native Modules: Needs Rebuild! (" + e.message.split('\n')[0] + ")", colors.yellow);
  }

  // Check for AI Binaries
  const whisperServer = '/Users/dk_sukhani/whisper.cpp/build/bin/whisper-server';
  if (fs.existsSync(whisperServer)) {
    log("  ✅ Whisper Server: Found", colors.green);
  } else {
    log("  ⚠️  Whisper Server: NOT FOUND (Real-time streaming will be disabled)", colors.yellow);
  }

  // --- 3. Logic & Regression Testing ---
  log("\n[3/3] Running Logic & Regression Tests...");
  try {
    const testOutput = execSync('npm test', { stdio: 'pipe' }).toString();
    log(testOutput);
    log("\n✨ ALL TESTS PASSED SUCCESSFULLY!", colors.bold + colors.green);
  } catch (e) {
    log("\n❌ LOGIC REGRESSION FAILED!", colors.red);
    log(e.stdout.toString());
    process.exit(1);
  }

  log("\n✅ Application is ready for launch.\n", colors.bold + colors.green);
}

run().catch(err => {
  log("\nCRITICAL FAILURE: " + err.message, colors.red);
  process.exit(1);
});
