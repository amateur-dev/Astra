# Voice Hotkey macOS App

A macOS menu bar application that provides voice-to-text functionality via global hotkeys, using local Whisper for speech recognition and Llama 3 for intelligent text polishing.

## Features

- **Menu Bar App**: Runs as a status bar item (NSStatusItem) for easy access
- **Global Hotkey**: Register a rebindable global hotkey (default: Cmd+Shift+V)
- **Local Speech-to-Text**: Uses Whisper.cpp with OpenAI's Whisper model for offline speech recognition
- **Intelligent Text Polishing**: Automatically enhances transcripts with Llama 3 for proper formatting, grammar, and clarity
- **Audio Capture**: Captures microphone input using AVAudioEngine
- **Text Insertion**: Inserts recognized text at cursor position via NSPasteboard + synthetic Cmd+V (CGEvent)
- **Permission Management**: Checks and requests accessibility and microphone permissions
- **Dual Modes**:
  - **Push-to-Talk**: Press hotkey to start recording, automatically stops after timeout
  - **Toggle**: Press hotkey once to start, press again to stop recording
- **Fully Local Processing**: All AI processing (Whisper + LLM) runs locally via Ollama - no cloud, complete privacy

## Requirements

- macOS 13.0 or later
- Xcode 15.0 or later
- Microphone access
- Accessibility permissions (for global hotkeys)

### Required for Voice Recognition
- Ollama (https://ollama.ai)
- Whisper model (~1.5GB) - for speech-to-text
- Llama 3 model (~4.7GB) - for text polishing
- See [LLM_SETUP.md](LLM_SETUP.md) for detailed setup instructions

## Building

1. Clone the repository
2. Open `VoiceHotkeyApp/VoiceHotkeyApp.xcodeproj` in Xcode
3. Build and run (Cmd+R)

## Permissions

The app requires the following permissions:

- **Accessibility**: For global hotkey functionality
- **Microphone**: For voice input
- **Speech Recognition**: For converting speech to text

The app will prompt for these permissions on first launch.

## Usage

### First-Time Setup

1. Install Ollama from https://ollama.ai
2. Launch the Voice Hotkey App
3. Click the menu bar icon → **Setup Models (Whisper + LLM)**
4. Wait for models to download (~6GB total)
5. Once status shows "System: Ready", you're good to go!

### Daily Use

1. Press Cmd+Shift+V (or your configured hotkey) to start recording
2. Speak your text
3. The app will:
   - Transcribe with Whisper (speech-to-text)
   - Polish with Llama 3 (formatting, grammar, clarity)
   - Insert polished text at your cursor position

### Switching Modes

Click the menu bar icon and select "Mode: Push-to-Talk" or "Mode: Toggle" to switch between recording modes.

### How It Works

```
Your Voice → Whisper (Transcription) → Llama 3 (Polishing) → Polished Text Inserted
```

All processing happens locally on your Mac. No internet required after setup.

## Architecture

- **AppDelegate.swift**: Main application entry point
- **StatusBarController.swift**: Manages the menu bar interface
- **HotkeyManager.swift**: Handles global hotkey registration and events
- **VoiceRecognitionManager.swift**: Orchestrates recording → Whisper → LLM pipeline
- **WhisperManager.swift**: Manages Whisper speech-to-text via Ollama
- **LLMManager.swift**: Manages Llama 3 text polishing via Ollama
- **PermissionManager.swift**: Handles permission checks and requests
- **PreferencesWindow.swift**: Preferences UI

## License

MIT