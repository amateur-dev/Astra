# Testing Guide for Voice Hotkey App

## Pre-Testing Setup

Before testing, ensure you have:
1. macOS 13.0 or later
2. Built the app successfully in Xcode
3. A working microphone
4. Granted all necessary permissions

## Permission Tests

### Test 1: Accessibility Permission
**Steps:**
1. Launch the app for the first time
2. Should see an alert about accessibility permissions
3. Click "Open System Preferences"
4. Enable accessibility for VoiceHotkeyApp
5. Restart the app

**Expected:** App should have accessibility access, hotkey should work

### Test 2: Microphone Permission
**Steps:**
# Testing the Electron MVP

This file lists quick manual tests to validate the recording → transcribe → paste flow for the Electron rewrite.

Prerequisites

- `npm install` completed
- `ffmpeg` installed and available on PATH
- A working transcription command (whisper.cpp) configured in Settings or via `TRANSCRIBE_CMD`
- (Optional) `ollama serve` running if you plan to test polishing

Manual test cases

1) Start/stop recording (hotkey)

Steps:
- Launch the app (npm run start)
- Press Cmd+Shift+V to start recording (the UI shows recording active)
- Speak for a few seconds
- Press Cmd+Shift+V again to stop

Expected:
- Recording stops, a webm is saved to /tmp, `ffmpeg` converts it and the transcription command runs. The transcript appears in the UI.

2) Settings save / test transcribe

Steps:
- Open Settings, set `TRANSCRIBE_CMD` or the Whisper binary + model
- Click Test (if available)

Expected:
- The test should run a short conversion and return transcript output or an error with details.

3) Ollama polishing (optional)

Steps:
- Enable Ollama in Settings and set the URL (default http://localhost:11434)
- Ensure `ollama serve` is running and the model is pulled
- Use the hotkey flow to generate a transcript

Expected:
- If polishing is enabled, the polished text replaces or augments the transcript in the UI. If Ollama is unreachable, the app displays diagnostics (it will try 127.0.0.1 if localhost fails).

4) Paste into front app (Accessibility)

Steps:
- Open a simple text editor (TextEdit or Slack message box)
- Perform the hotkey record → transcribe flow with Auto-paste enabled, or click "Paste into front app"

Expected:
- The transcribed (and optionally polished) text appears at the cursor. If paste fails, check Accessibility permissions in System Settings → Privacy & Security → Accessibility.

Edge cases to try

- Very short audio (1s) — ensure the transcription command handles short inputs
- No `ffmpeg` installed — expect clear error message in app
- Incorrect `TRANSCRIBE_CMD` — app should display stderr from the command

Automated tests

- This MVP currently focuses on manual verification. If you want, I can add a small set of unit tests for the main process helpers (transcribeWebm, polishWithOllama) using Jest or similar; note that tests will need environment mocking for child_process and network calls.
