# Voice Hotkey macOS App

A macOS menu bar application that provides voice-to-text functionality via global hotkeys.

## Features

- **Menu Bar App**: Runs as a status bar item (NSStatusItem) for easy access
- **Global Hotkey**: Register a rebindable global hotkey (default: Cmd+Shift+V)
- **On-Device Speech Recognition**: Uses SFSpeechRecognizer with `requiresOnDeviceRecognition` for privacy
- **Audio Capture**: Captures microphone input using AVAudioEngine.installTap
- **Text Insertion**: Inserts recognized text at cursor position via NSPasteboard + synthetic Cmd+V (CGEvent)
- **Permission Management**: Checks and requests accessibility, microphone, and speech recognition permissions
- **Dual Modes**:
  - **Push-to-Talk**: Press hotkey to start recording, automatically stops after speech
  - **Toggle**: Press hotkey once to start, press again to stop recording
- **Optional LLM Integration**: Use local Llama 3 via Ollama for advanced text processing:
  - **Format Text**: Improve readability, fix capitalization, add punctuation
  - **Correct Grammar**: Fix grammar and spelling errors
  - **Smart Edit**: Improve writing style and clarity

## Requirements

- macOS 13.0 or later
- Xcode 15.0 or later
- Microphone access
- Speech recognition permission
- Accessibility permissions (for global hotkeys)

### Optional (for LLM features)
- Ollama (https://ollama.ai)
- Llama 3 model (~4.7GB)
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

1. Launch the app - it will appear in the menu bar with a microphone icon
2. Press Cmd+Shift+V (or your configured hotkey) to activate voice recognition
3. Speak your text
4. The recognized text will be inserted at your cursor position

### Switching Modes

Click the menu bar icon and select "Mode: Push-to-Talk" or "Mode: Toggle" to switch between recording modes.

### Using LLM Processing (Optional)

After transcribing text, you can optionally enhance it using the local LLM:

1. Click the menu bar icon
2. Select **LLM Processing** → choose an option:
   - **Format Text** (Cmd+Shift+F): Improve readability and punctuation
   - **Correct Grammar** (Cmd+Shift+G): Fix grammar and spelling
   - **Smart Edit** (Cmd+Shift+E): Enhance writing style

**Note**: LLM features require Ollama and Llama 3. See [LLM_SETUP.md](LLM_SETUP.md) for setup instructions.

## Architecture

- **AppDelegate.swift**: Main application entry point
- **StatusBarController.swift**: Manages the menu bar interface
- **HotkeyManager.swift**: Handles global hotkey registration and events
- **VoiceRecognitionManager.swift**: Manages audio capture and speech recognition
- **PermissionManager.swift**: Handles permission checks and requests
- **PreferencesWindow.swift**: Preferences UI
- **LLMManager.swift**: Optional LLM integration via Ollama/Llama 3

## License

MIT