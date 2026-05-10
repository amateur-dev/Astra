# Voice Hotkey (macOS)

A powerful, local-first voice dictation tool for macOS. Press a hotkey, speak, and have your text typed directly into any application. Powered by [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) for privacy and speed, with optional LLM polishing via [Ollama](https://ollama.ai).

![Status](https://img.shields.io/badge/status-beta-blue)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)
![Downloads](https://img.shields.io/github/downloads/amateur-dev/local-hotkey-voice-mac-app/total?color=brightgreen)

> **[Download the latest version for macOS](https://github.com/amateur-dev/local-hotkey-voice-mac-app/releases/latest)**

## Features

-   **Dual Hotkeys**: Two modes for different use cases:
    -   **Standard Voice** (`Cmd+Shift+V`): Fast voice-to-text without screenshots
    -   **Vision Voice** (`Cmd+Shift+O`): Voice + screenshot OCR for context-aware transcription
-   **Native macOS OCR**: Uses Apple Vision Framework for instant text extraction from screenshots (0 RAM, no cloud)
-   **Smart Polishing**: Automatic grammar, punctuation, and formatting via Ollama with background warmup
-   **Floating Overlay**: Minimal, non-intrusive recording UI with waveform visualization
-   **Local Transcription**: Uses Whisper.cpp for offline, private, and fast speech-to-text
-   **Auto-Paste**: Automatically types the transcribed text into your active application
-   **System Integration**:
    -   Does not steal focus from your active window
    -   Dynamic menu bar icons (Idle / Recording / Processing)
    -   "Screen Saver" window level ensures visibility over fullscreen apps
-   **Apple Silicon Optimized**: Ollama uses MLX framework on M1/M2/M3/M4 chips for 2-4x faster inference

## Prerequisites

**For Users (DMG App):**
-   **macOS** (Apple Silicon or Intel)
-   **Ollama** (optional, for LLM polishing): [Download](https://ollama.ai)
-   *Note: On first run, the app will ask to download a speech model (~400MB) and Whisper.cpp*

**For Developers (Source Code):**
If you want to build the app from source:
1.  **Node.js** (v18+)
2.  **FFmpeg**: `brew install ffmpeg`
3.  **Whisper.cpp**: `whisper-cli` binary in your PATH

## Installation & Setup

### Option A: Download App (Recommended)

1.  **Download**: Go to the [Releases Page](https://github.com/amateur-dev/local-hotkey-voice-mac-app/releases) and download the `.dmg` file:
    -   **Apple Silicon (M1/M2/M3/M4)**: Download `voice-hotkey-electron-x.x.x-arm64.dmg`
    -   **Intel Mac**: Download `voice-hotkey-electron-x.x.x.dmg`

2.  **Install**: Open the `.dmg` and drag the app to **Applications**.

    > **Note on Security Warning**:
    > Since this app is not signed with a paid Apple Developer ID, macOS will show "cannot be opened because the developer cannot be verified". **This is normal for open-source apps.**

3.  **First Launch (Bypassing Security)**:
    1.  Double-click the app -> Click **Done** or **Cancel** on warning.
    2.  Open **System Settings** -> **Privacy & Security**.
    3.  Scroll to "Security" -> Click **Open Anyway**.
    4.  *(You only need to do this once)*.

4.  **Setup Wizard**:
    -   App shows welcome screen with system component status
    -   Select a speech model (e.g., "Small") and download
    -   Optionally install Ollama for LLM polishing

### Option B: Build from Source

```bash
git clone https://github.com/amateur-dev/local-hotkey-voice-mac-app.git
cd local-hotkey-voice-mac-app
npm install
npm start
```

## Usage

### Standard Voice Mode
1.  Press `Cmd+Shift+V` to start recording
2.  Speak your text
3.  Press `Cmd+Shift+V` again to stop
4.  Text is automatically typed into your active window

### Vision Voice Mode (with Screen Context)
1.  Press `Cmd+Shift+O` to start recording
2.  Speak your text
3.  App takes a screenshot and extracts text via native OCR
4.  The extracted text is used to correct jargon, app names, etc.
5.  Text is automatically typed into your active window

### Cancel Recording
Press `Escape` during recording to cancel.

## Configuration

Click "Settings" in the main window (via Tray icon) to configure:

| Setting | Description |
|---------|-------------|
| **Global Hotkeys** | Customize Standard (`Cmd+Shift+V`) and Vision (`Cmd+Shift+O`) shortcuts |
| **Auto-Paste** | Toggle automatic typing into active application |
| **Ollama URL** | Set custom Ollama endpoint (default: `http://localhost:11434`) |
| **Ollama Model** | Choose LLM for polishing (default: `qwen2.5:0.5b`) |
| **Polish Mode** | Enable/disable automatic grammar/spelling correction |

## Ollama Setup (Optional)

For LLM-powered text polishing:

1.  **Install Ollama**: [Download](https://ollama.ai) or `brew install ollama`
2.  **Start Ollama**: `ollama serve` (runs in background)
3.  **Verify**: `ollama list` should show `qwen2.5:0.5b` model

### Recommended Model: qwen2.5:0.5b

We recommend `qwen2.5:0.5b` (397MB) for the best balance of speed and quality:

-   **Speed**: ~0.7 seconds per polish (vs 8-15s for larger models)
-   **Quality**: Good grammar/punctuation correction
-   **Memory**: Only 397MB RAM (vs 6-8GB for larger models)
-   **Apple Silicon**: Ollama uses MLX framework for 2-4x faster inference on M1/M2/M3/M4 chips

To change the model:
```bash
# Pull a different model
ollama pull qwen2.5:1.5b

# Then select it in app Settings
```

### Troubleshooting Ollama

-   **Ollama not running**: Start with `ollama serve`
-   **Model not found**: Run `ollama pull qwen2.5:0.5b`
-   **Connection refused**: Check Ollama URL in Settings (default: `http://localhost:11434`)

## How It Works

### Voice Transcription
1.  Audio is captured via macOS microphone
2.  Whisper.cpp transcribes locally (no cloud, complete privacy)
3.  Text is automatically typed into the active application

### LLM Polishing (Optional)
1.  Text is sent to Ollama (localhost)
2.  Prompt instructs model to clean grammar/punctuation
3.  Response timeout: 60 seconds (prevents infinite hangs)
4.  Polished text replaces original

### Vision Mode with OCR
1.  Screenshot captured using macOS screencapture
2.  Apple Vision Framework extracts text (native, 0 RAM)
3.  Extracted text used as context for LLM polishing
4.  Corrects jargon, app names, UI text automatically

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for development instructions.

### Running Tests
```bash
npm test
```

### Environment Diagnostics
```bash
npm run doctor
```

## Tech Stack

-   **Electron**: Desktop app framework
-   **Whisper.cpp**: Local speech-to-text (C++ port of OpenAI Whisper)
-   **Ollama**: Local LLM inference with MLX optimization for Apple Silicon
-   **Apple Vision Framework**: Native OCR for screen context
-   **Node.js**: Backend logic

## Feedback & Support

-   **Report a Bug**: [Open a new issue](https://github.com/amateur-dev/local-hotkey-voice-mac-app/issues/new?labels=bug)
-   **Request a Feature**: [Open a new issue](https://github.com/amateur-dev/local-hotkey-voice-mac-app/issues/new?labels=enhancement)

## Author

**Dipesh Sukhani**
-   Website: [dipeshsukhani.dev](https://dipeshsukhani.dev)
-   Email: [me@dipeshsukhani.dev](mailto:me@dipeshsukhani.dev)
-   LinkedIn: [linkedin.com/in/dipeshsukhani](https://linkedin.com/in/dipeshsukhani)
-   Twitter: [@dipesh_sukhani](https://x.com/dipesh_sukhani)
-   GitHub: [@amateur-dev](https://github.com/amateur-dev)

## License

MIT