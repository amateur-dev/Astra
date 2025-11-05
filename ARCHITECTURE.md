# Architecture Documentation

## Overview

Voice Hotkey App is a macOS menu bar application that provides system-wide voice-to-text functionality through global hotkeys. The app uses local Whisper.cpp for speech recognition and optional LLM processing for text enhancement, all running offline for privacy.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        macOS System                          │
│                                                              │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Microphone │  │  Pasteboard  │  │  Active Apps     │   │
│  └──────┬─────┘  └──────┬───────┘  └────────┬─────────┘   │
│         │                │                    │              │
└─────────┼────────────────┼────────────────────┼──────────────┘
          │                │                    │
          │                │                    │
┌─────────┼────────────────┼────────────────────┼──────────────┐
│         │    Voice Hotkey App                 │              │
│         │                │                    │              │
│  ┌──────▼────────┐  ┌───▼────────────┐  ┌───▼─────────┐   │
│  │ AVAudioEngine │  │  NSPasteboard  │  │   CGEvent   │   │
│  │   (Capture)   │  │  (Copy/Paste)  │  │  (Cmd+V)    │   │
│  └──────┬────────┘  └───▲────────────┘  └─────────────┘   │
│         │                │                                   │
│  ┌──────▼────────────────┴────────────┐                    │
│  │    VoiceRecognitionManager         │                    │
│  │  - Audio capture via installTap    │                    │
│  │  - WhisperManager (Whisper.cpp)    │                    │
│  │  - LLMManager (Ollama/Llama 3)     │                    │
│  │  - Text insertion pipeline         │                    │
│  └──────┬─────────────────────────────┘                    │
│         │                                                    │
│  ┌──────▼──────────────┐  ┌───────────────────────┐       │
│  │  StatusBarController│  │   HotkeyManager       │       │
│  │  - NSStatusItem     │◄─┤   - Carbon HotKey API │       │
│  │  - Menu management  │  │   - Event handling    │       │
│  └─────────────────────┘  └───────────────────────┘       │
│                                                              │
│  ┌────────────────────────────────────────────────┐        │
│  │           PermissionManager                     │        │
│  │  - Accessibility (AXIsProcessTrusted)          │        │
│  │  - Microphone (AVCaptureDevice)                │        │
│  │  - No speech recognition permissions needed    │        │
│  └────────────────────────────────────────────────┘        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Component Details

### AppDelegate
**Purpose:** Application lifecycle management

**Responsibilities:**
- Initialize StatusBarController on launch
- Trigger permission checks
- Handle application termination and cleanup

**Key APIs:**
- `NSApplicationDelegate`

### StatusBarController
**Purpose:** Menu bar UI and user interaction

**Responsibilities:**
- Create and manage NSStatusItem
- Build and update menu
- Handle menu actions (mode switch, preferences, quit)
- Update UI state (recording indicator)
- Coordinate between HotkeyManager and VoiceRecognitionManager

**Key APIs:**
- `NSStatusBar.system.statusItem(withLength:)`
- `NSMenu`, `NSMenuItem`
- `NSImage(systemSymbolName:)`

**State:**
- Current recording status
- Selected mode (push-to-talk vs toggle)

### HotkeyManager
**Purpose:** Global hotkey registration and event handling

**Responsibilities:**
- Register global hotkey with Carbon Event Manager
# Architecture — Electron MVP

This document describes the high-level architecture of the Electron-based MVP that replaced the previous native macOS implementation. The app's responsibilities are:

- Global hotkey to toggle recording
- Capture audio in the renderer using MediaRecorder
- Save audio to /tmp, convert to WAV with ffmpeg
- Run a local STT CLI (whisper.cpp) via a configurable command template
- Optionally call a local Ollama server to polish transcripts
- Paste prepared text into the frontmost app (clipboard + synthetic paste via osascript)

Components

1) Main process (`src/main.js`)
- Responsibilities:
  - App lifecycle, tray/menu, and globalShortcut registration
  - IPC handlers for: save-recording, transcribe, get-settings, save-settings, test-transcribe, paste-into-front
  - Helpers: transcribeWebm(webmPath), polishWithOllama(text)
  - Runs ffmpeg and the transcription CLI as child processes and returns stdout/stderr to the renderer
  - Writes clipboard content and runs `osascript` for synthetic paste events when requested

2) Preload (`src/preload.js`)
- Responsibilities:
  - Exposes a safe IPC surface to the renderer (contextBridge) with methods for saving recordings, transcribing, reading/saving settings and triggering paste

3) Renderer (`src/renderer/renderer.js`, `src/renderer/index.html`)
- Responsibilities:
  - UI: record/pause button, transcript display, settings panel
  - Acquire microphone stream via getUserMedia and use MediaRecorder to capture WebM
  - Send the saved WebM via IPC to main to persist and optionally auto-transcribe/polish/paste
  - Load/save settings using the exposed preload API
  - Ensure MediaStream tracks are stopped immediately when stopping recording to release the microphone

4) Persistence
- `electron-store` stores settings such as `transcribe_cmd`, `auto_transcribe`, `ollama_enabled`, `ollama_url`, `ollama_model`, `auto_paste`.

5) External tools
- `ffmpeg` — required for webm → wav conversion (must be on PATH)
- `whisper.cpp` (or equivalent CLI) — invoked using the configured template (must include `{wav}`)
- `ollama` (optional) — local server the app calls via HTTP to polish text

IPC contract (high level)

- save-recording (renderer → main): payload { webmBase64, filename? } → main writes to /tmp and returns path
- transcribe (renderer → main): path → returns { success, text, diagnostics }
- paste-into-front (renderer → main): text → writes clipboard and runs osascript to synthesize Cmd+V
- get-settings / save-settings (renderer ↔ main): exchange settings object

Error handling and diagnostics

- The main process captures stdout/stderr of child processes and returns both to the renderer so UI can show helpful error messages.
- Ollama helper will try configured host (often `http://localhost:11434`) and, on connection errors, retry with `http://127.0.0.1:11434` and return details of attempted hosts and errors to help troubleshoot IPv6 vs IPv4 binding issues.

Security & Permissions

- Paste via `osascript` requires macOS Accessibility permission to allow the process to control the computer. The app shows helpful messages guiding the user to grant this permission.
- The app does not upload audio or transcripts by default; Ollama calls are to a user-managed local server.

Quality gates

- The main process should validate that `ffmpeg` is on PATH and that `transcribe_cmd` expands to a valid executable before attempting transcription.
- The renderer ensures MediaStream tracks are stopped on stop to avoid the persistent mic indicator issue.

Next steps (low-risk improvements)

- Add a small Jest-based test for `transcribeWebm` and `polishWithOllama` using mocks for child_process and fetch.
- Add an option to configure the global hotkey via the Settings UI and persist it via `electron-store`.
