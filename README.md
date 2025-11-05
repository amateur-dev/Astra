# Voice Hotkey — Electron rewrite (MVP)

This repo was replaced with a minimal Electron-based MVP per user request. It provides a tray app that appears in the Dock and supports a global hotkey (Cmd/Ctrl+Shift+R) to toggle a recording state.

Quick start

1. Install dependencies:

```bash
npm install
```

2. Run in development:

# Voice Hotkey — Electron (MVP)

This repository contains an Electron-based MVP that records microphone audio with a global hotkey, transcribes locally using a Whisper binary (whisper.cpp), optionally polishes the transcript using a locally running Ollama server, and can paste the resulting text into the frontmost app.

This README covers prerequisites, how to run the app during development, and the typical recording → transcribe → paste workflow.

Quick start (development)

1. Install dependencies:

```bash
npm install
```

2. Run the app:

```bash
npm run start
```

3. Open the Settings in the app and configure:
  - Whisper binary path (or set `TRANSCRIBE_CMD` env var)
  - Model path (-m)
  - Optional: enable Ollama polishing and set Ollama URL/model
  - Optional: enable Auto-transcribe and Auto-paste

Core flow

- Press the global hotkey (default: Cmd+Shift+V) to start recording.
- Press the hotkey again to stop recording. The app saves the recording, converts it to WAV, runs your transcription command, optionally polishes with Ollama, and then:
  - shows the transcript in the UI
  - optionally auto-pastes into the frontmost app (requires macOS Accessibility permission)

Prerequisites (local)

- Node 18+ (used by Electron)
- ffmpeg (for webm → wav conversion). Install on macOS with Homebrew:

```bash
brew install ffmpeg
```

- whisper.cpp (or your preferred local CLI) built and a working CLI like `whisper-cli` or `main`. See `LLM_SETUP.md` for build steps and model download.

- (Optional) Ollama for LLM polishing:

```bash
# install ollama - https://ollama.ai
ollama pull llama3.2
ollama serve
```

Settings / TRANSCRIBE_CMD

You can either set the transcription command in the app Settings or export an env var in the shell used to start the app:

```bash
export TRANSCRIBE_CMD="/path/to/whisper-cli -m /path/to/ggml-tiny.en.bin -f {wav}"
```

The command must include `{wav}` which will be replaced by the temporary WAV path the app generates.

Accessibility note (macOS)

The paste-to-front feature uses `osascript` (System Events) to synthesize Cmd+V in the frontmost app. macOS requires Accessibility permission for whatever process sends those events (Terminal during development or the packaged Electron app once distributed). If pastes fail, grant Accessibility permission in System Settings → Privacy & Security → Accessibility.

Troubleshooting

- Mic indicator stays on after stopping: if you see the macOS mic indicator persist, ensure you started/stopped using the hotkey (the app now releases tracks immediately). If it still persists, check for other apps holding the mic.
- Ollama connectivity: if the app reports `Ollama unreachable`, try changing the Ollama URL to `http://127.0.0.1:11434` and ensure `ollama serve` is running and the model is pulled.
- `ffmpeg` missing: install via Homebrew.

Files of interest

- `src/main.js` — Electron main process (tray, global shortcut, IPC, transcription + Ollama calls)
- `src/preload.js` — IPC bridge for renderer
- `src/renderer/renderer.js` — UI, MediaRecorder, and paste wiring

Packaging

Use `npm run dist` (configured to call `electron-builder --mac`) to produce a DMG. Packaging requires macOS and Xcode toolchain.

If you need help with any step, tell me which OS step you're on and I will provide the exact commands (e.g., building whisper.cpp, pulling models, or granting macOS permissions).

---
Updated to reflect the Electron rewrite and the recording → transcribe → paste flow.
