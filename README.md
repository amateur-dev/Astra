# Voice Hotkey 🎤✨

**Your personal voice assistant that types for you — no internet required.**

Press a hotkey, speak, and watch your words appear in any app. It's like magic, but it's just really good technology.

![macOS](https://img.shields.io/badge/macOS-hello%20beautiful-white)
![Status](https://img.shields.io/badge/status-live-brightgreen)
![Downloads](https://img.shields.io/github/downloads/amateur-dev/local-hotkey-voice-mac-app/total?color=brightgreen)

> **[⬇️ Download for macOS](https://github.com/amateur-dev/local-hotkey-voice-mac-app/releases/latest)**

---

## What's This Thing Do?

- **Two Hotkeys, Two Superpowers:**
  - `Cmd+Shift+V` → Quick voice-to-text (super fast ⚡)
  - `Cmd+Shift+O` → Voice + screenshot OCR (context-aware, catches UI text, app names, buttons, etc.)
- **Smart Text Fixer** → Auto-corrects grammar & punctuation using a tiny local AI model (0.5s, not 15s)
- **Native OCR** → Apple Vision Framework reads your screen (zero extra RAM, zero cloud)
- **Offline & Private** → Everything happens on your Mac. Your voice never leaves your computer.
- **Auto-Paste** → Types the transcribed text directly into whatever app you're using
- **Floating UI** → Minimal recording window that plays nice with fullscreen apps

---

## Quick Start

### 1️⃣ Download & Install

1. Go to **[Releases](https://github.com/amateur-dev/local-hotkey-voice-mac-app/releases)** and grab:
   - **Apple Silicon Mac** (M1/M2/M3/M4): `voice-hotkey-electron-x.x.x-arm64.dmg`
   - **Intel Mac**: `voice-hotkey-electron-x.x.x.dmg`
2. Drag to **Applications** folder
3. **First time? macOS might complain** (it's a non-signed app thing). Just:
   - Go to **System Settings → Privacy & Security → Security**
   - Click **Open Anyway**
   - Done! 🎉

### 2️⃣ First Launch

On first run, the app will:
- Ask permission for microphone 🎙️
- Download a speech model (~400MB, one-time)
- Optionally install Ollama for text polishing (we'll cover this below)

### 3️⃣ Start Using

| What You Want | Press | What Happens |
|---------------|-------|--------------|
| **Quick voice note** | `Cmd+Shift+V` | Speak → Stop → Text appears in your app |
| **Voice + screen context** | `Cmd+Shift+O` | Speak → Screenshot → OCR context → Text appears |

> **Tip:** Press `Escape` during recording to cancel.

---

## The "Smart Polish" Feature (Optional but 🔥)

Want your transcribed text to be grammar-perfect? Install **Ollama** — a tiny local AI that runs on your Mac.

### Setup Ollama

```bash
# Install (if you haven't)
brew install ollama

# Start it (runs in background)
ollama serve

# Pull our recommended model (397MB, ~0.5s per polish)
ollama pull qwen2.5:0.5b
```

That's it! The app automatically connects to Ollama and polishes your text.

### Why qwen2.5:0.5b?

| Model | Size | Speed | Verdict |
|-------|------|-------|---------|
| qwen2.5:0.5b | 397MB | ~0.5s | ⭐ **Perfect** |
| qwen2.5:1.5b | 1GB | ~1s | Good |
| phi4-mini | 2.5GB | ~9s | Too slow |
| gemma4 | 7GB | ~15s | Thinking mode = unusable |

If you want to try other models, just run `ollama pull <model-name>` and change it in Settings.

---

## Settings & Config

Click the **Tray Icon** (in menu bar) → **Settings** to customize:

| Option | What It Does |
|--------|--------------|
| **Hotkeys** | Change `Cmd+Shift+V` / `Cmd+Shift+O` to whatever you like |
| **Auto-Paste** | Toggle automatic typing into your active app |
| **Polish Mode** | Turn AI text fixing on/off |
| **Ollama URL** | Usually `http://localhost:11434` (don't change unless you know what you're doing) |

---

## Under the Hood

1. **Your Voice** → Recorded via macOS microphone
2. **Whisper.cpp** → Transcribes locally (no cloud, complete privacy)
3. **Ollama** (optional) → Fixes grammar/punctuation in ~0.5s
4. **Auto-Type** → Uses Mac's accessibility APIs to type into your active app

For Vision Mode (`Cmd+Shift+O`):
1. **Screenshot** → Captured via `screencapture`
2. **Apple Vision Framework** → Extracts text from screen (native, zero RAM)
3. **LLM Context** → Uses extracted text to correctly handle UI elements, button names, etc.

---

## Troubleshooting

### "Whisper not found" or "Library not loaded"
- Make sure you have `whisper-cli` in your PATH, or use the pre-built DMG which includes it.

### Ollama not responding
- Run `ollama serve` in Terminal
- Check Settings → Ollama URL is `http://localhost:11434`
- Run `ollama list` to see available models

### Hotkeys not working?
- Go to **System Settings → Privacy & Security → Accessibility** and enable Voice Hotkey

### Still stuck?
- **[Open an issue](https://github.com/amateur-dev/local-hotkey-voice-mac-app/issues)** — we'll help!

---

## Build from Source (For Developers)

```bash
git clone https://github.com/amateur-dev/local-hotkey-voice-mac-app.git
cd local-hotkey-voice-mac-app
npm install
npm start
```

**Requirements:**
- Node.js 18+
- FFmpeg (`brew install ffmpeg`)
- whisper-cli in PATH

---

## Tech Stack

- **Electron** — Desktop app framework
- **Whisper.cpp** — Local speech-to-text (OpenAI's Whisper, but faster)
- **Ollama** — Local LLM with MLX optimization for Apple Silicon (2-4x faster on M1/M2/M3/M4)
- **Apple Vision Framework** — Native OCR (zero RAM)
- **Node.js** — Backend magic

---

## Like This? ❤️

- ⭐ **Star the repo** if it made your life easier
- 🐛 **Report bugs** at [Issues](https://github.com/amateur-dev/local-hotkey-voice-mac-app/issues)
- 💡 **Suggest features** — we're all ears!

---

## Author

**Dipesh Sukhani**
- 🌐 [dipeshsukhani.dev](https://dipeshsukhani.dev)
- 📧 [me@dipeshsukhani.dev](mailto:me@dipeshsukhani.dev)
- 💼 [LinkedIn](https://linkedin.com/in/dipeshsukhani)
- 🐦 [@dipesh_sukhani](https://x.com/dipesh_sukhani)
- 🐙 [@amateur-dev](https://github.com/amateur-dev)

---

**MIT License** — Use it, break it, improve it. That's the spirit. 🚀