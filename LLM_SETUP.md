# LLM Integration Setup Guide

This guide explains how to set up and use the optional LLM (Large Language Model) integration with Voice Hotkey App.

## Overview

The app uses **Whisper.cpp** for local speech-to-text transcription and includes optional LLM-based text processing powered by Ollama and Llama 3. The LLM feature is **completely optional** and enhances the transcribed text for better readability.

## Why LLM Integration?

The LLM integration provides advanced text processing capabilities:

- **Format Text**: Improve readability, fix capitalization, add punctuation
- **Correct Grammar**: Fix grammar and spelling errors
- **Smart Edit**: Improve writing style and clarity while preserving meaning

## Default Behavior

By default, the app uses **Whisper.cpp** for local speech-to-text conversion:
- ✅ Completely offline
- ✅ Private and secure
- ✅ High accuracy with OpenAI's Whisper model
- ✅ One-time setup to download the model

The LLM is **invoked automatically** after transcription to polish the text (smart editing), but can also be used on-demand for other processing tasks.

## Setup Instructions

### Step 1: Setup Whisper (Speech-to-Text)

The app will automatically download Whisper.cpp when you first use it:

1. Launch Voice Hotkey App
2. Click the menu bar icon
3. Select **LLM Processing** → **Setup Whisper**
4. The app will download the Whisper binary (~50MB) and base model (~140MB)
5. Wait for download to complete

### Step 2: Install Ollama (Text Processing)

1. Visit https://ollama.ai
2. Download Ollama for macOS
3. Install the application
4. Start Ollama (it runs in the background)

### Step 3: Download Llama 3 Model

You can download the model in two ways:

#### Option A: Through the App (Recommended)
1. Click the menu bar icon
2. Select **LLM Processing** → **Setup LLM (Ollama)**
3. Follow the prompts
4. The app will automatically download Llama 3 (~4.7GB)

#### Option B: Via Terminal
```bash
ollama pull llama3
```

### Step 4: Verify Installation

1. Click the menu bar icon
2. Check the **LLM Processing** submenu
3. Status should show:
   - **"Whisper: Ready"**
   - **"LLM: Ready (Llama 3)"**

## Usage

### Basic Workflow

1. **Transcribe and process speech** (automatic):
- Press Cmd+Shift+V
- Speak your text
- Whisper transcribes the audio
    - LLM automatically applies smart editing
    - Polished text is inserted at cursor

2. **Additional processing** (optional):
- Click menu bar icon → **LLM Processing**
- Choose additional processing:
- **Format Text** (Cmd+Shift+F) - For additional formatting
  - **Correct Grammar** (Cmd+Shift+G) - For grammar correction
      - **Smart Edit** (Cmd+Shift+E) - For re-processing with different style
    - The processed text replaces the original

### Keyboard Shortcuts

- **Cmd+Shift+F**: Format the last transcribed text
- **Cmd+Shift+G**: Correct grammar in last transcribed text
- **Cmd+Shift+E**: Smart edit the last transcribed text

## How It Works

### Architecture

```
Speech Input → Audio Recording → Whisper.cpp (local) → Raw Transcription
      ↓
LLM Processing (Ollama/Llama 3)
      ↓
         Smart Edited Text Inserted
```

### Privacy & Offline Operation

- **Speech Recognition**: Always offline (Whisper.cpp runs locally)
- **LLM Processing**: Runs locally via Ollama (localhost:11434)
- **No Cloud**: No data sent to external servers
- **Automatic**: LLM processes all transcriptions by default for better quality

## Example Use Cases

### Use Case 1: Quick Notes
```
Speak: "meeting with john tomorrow discuss project timeline"
Result: "meeting with john tomorrow discuss project timeline"

Apply Format Text:
Result: "Meeting with John tomorrow. Discuss project timeline."
```

### Use Case 2: Email Draft
```
Speak: "hey team wanted to update everyone on the progress were making good headway on the new feature should be done by friday"

Apply Smart Edit:
Result: "Hi team, I wanted to update everyone on our progress. We're making good headway on the new feature and should have it completed by Friday."
```

### Use Case 3: Grammar Correction
```
Speak: "their going to the store and there buying some groceries for they're party"

Apply Correct Grammar:
Result: "They're going to the store and they're buying some groceries for their party."
```

## System Requirements

### Minimum Requirements
- macOS 13.0 (Ventura) or later
- 8GB RAM (for basic LLM usage)
- 10GB free disk space (for Llama 3 model)

### Recommended
- macOS 14.0 (Sonoma) or later
- 16GB RAM (for better LLM performance)
- Apple Silicon (M1/M2/M3) for best performance

## Performance

### Speech Recognition (Whisper.cpp)
- Latency: 2-5 seconds (depending on audio length)
- CPU: 50-100% (during transcription)
- Memory: ~200-500MB (model loaded)

### LLM Processing (Ollama/Llama 3)
- Latency: 2-10 seconds (depending on text length)
- CPU: 50-100% (during processing)
- Memory: ~2-4GB (when model loaded)

## Troubleshooting

### "Ollama Not Available"

**Problem**: Ollama is not installed or not running

**Solution**:
1. Install Ollama from https://ollama.ai
2. Make sure Ollama is running (check menu bar for Ollama icon)
3. Try restarting Ollama
4. Verify Ollama is running: `curl http://localhost:11434`

### "Model Not Downloaded"

**Problem**: Llama 3 model is not present

**Solution**:
1. Use the app's "Setup LLM" option, or
2. Run in terminal: `ollama pull llama3`
3. Wait for download to complete (~4.7GB)

### Slow LLM Processing

**Problem**: LLM takes too long to process text

**Solutions**:
- Close other applications to free up memory
- On Intel Macs, expect slower performance (30-60 seconds)
- Consider using a smaller model: `ollama pull llama3:8b`
- Ensure you have adequate RAM (16GB recommended)

### Connection Errors

**Problem**: Cannot connect to Ollama

**Solution**:
1. Verify Ollama is running: `ps aux | grep ollama`
2. Check Ollama port: `lsof -i :11434`
3. Restart Ollama
4. Check firewall settings

## Uninstalling

### Remove LLM Only (Keep App)
The LLM integration is optional. Simply:
1. Don't use the LLM Processing menu
2. Optionally uninstall Ollama

### Remove Llama 3 Model
```bash
ollama rm llama3
```
This frees up ~4.7GB of disk space.

### Uninstall Ollama
1. Quit Ollama
2. Delete Ollama.app from Applications
3. Remove models: `rm -rf ~/.ollama`

## Advanced Configuration

### Using Different Models

You can use different Ollama models by modifying `LLMManager.swift`:

```swift
// Line 10: Change model name
private let modelName = "llama3"  // Change to "mistral", "phi", etc.
```

Available models:
- `llama3` (default, 4.7GB)
- `llama3:70b` (larger, better quality, 40GB)
- `mistral` (smaller, faster, 4.1GB)
- `phi` (very small, 1.6GB)

### Custom Prompts

To customize LLM behavior, edit the prompts in `LLMManager.swift`:

```swift
private func buildPrompt(for type: LLMProcessingType, text: String) -> String {
    // Modify prompts here
}
```

## FAQ

**Q: Do I need LLM for the app to work?**
A: No! The app works perfectly without LLM using Apple's speech recognition.

**Q: Does LLM require internet?**
A: No, Ollama and Llama 3 run completely offline on your Mac.

**Q: How much does it cost?**
A: Free! Both Ollama and Llama 3 are open source and free to use.

**Q: Is my data private?**
A: Yes! Everything runs locally. No data is sent to external servers.

**Q: Can I use it while offline?**
A: Yes! Once Ollama and the model are installed, everything works offline.

**Q: Which Mac do I need?**
A: Any Mac with macOS 13+, but Apple Silicon (M1/M2/M3) gives best performance.

**Q: Can I use a different LLM?**
A: Yes! Ollama supports many models. See "Advanced Configuration" above.

## Support

For issues or questions:
- Check the troubleshooting section above
- Review Ollama documentation: https://github.com/ollama/ollama
- Check app logs in Console.app

## Updates

The LLM integration is designed to be:
- ✅ **Non-intrusive**: Works alongside default speech recognition
- ✅ **Optional**: Never required for basic functionality
- ✅ **Privacy-focused**: Everything runs locally
- ✅ **Easy to disable**: Just don't use it
- ✅ **Easy to remove**: Uninstall Ollama anytime

---

**Version**: 1.0
**Last Updated**: November 2025
**Compatibility**: macOS 13.0+
