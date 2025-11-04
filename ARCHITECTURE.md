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
- Handle hotkey press events
- Support hotkey rebinding
- Convert between key codes and readable format

**Key APIs:**
- `RegisterEventHotKey()` (Carbon)
- `InstallEventHandler()` (Carbon)
- `UnregisterEventHotKey()` (Carbon)

**Implementation Details:**
- Uses Carbon's Event Manager for system-wide hotkey capture
- Default: Cmd+Shift+V (keyCode: kVK_ANSI_V, modifiers: cmdKey | shiftKey)
- Thread-safe callback mechanism

**Limitations:**
- Cannot detect key release for true push-to-talk
- Hotkey must be unique system-wide

### VoiceRecognitionManager
**Purpose:** Audio capture, speech recognition, and text processing

**Responsibilities:**
- Manage audio engine lifecycle
- Capture microphone input to WAV file
- Coordinate Whisper transcription
- Process text with LLM for enhancement
- Insert polished text at cursor
- Support two recognition modes

**Key APIs:**
- `AVAudioEngine` - Audio capture
- `AVAudioEngine.inputNode.installTap()` - Buffer-level access
- `AVAudioFile` - WAV file writing
- `Process` - Subprocess execution for Whisper.cpp
- `LLMManager` - Text enhancement via Ollama
- `NSPasteboard` - Clipboard operations
- `CGEvent` - Synthetic keyboard events

**Audio Pipeline:**
```
Microphone → AVAudioEngine → installTap(buffer) → AVAudioFile (WAV) → WhisperManager → Whisper.cpp → Raw Text → LLMManager → Llama 3 → Polished Text
```

**Recognition Modes:**
1. **Push-to-Talk**: 
   - Starts on hotkey press
   - Auto-stops after 5 seconds or when speech ends
   - Best for short commands

2. **Toggle**: 
   - Starts on first hotkey press
   - Stops on second press
   - Best for longer dictation

**Text Insertion Flow:**
```
1. Save current pasteboard content
2. Clear pasteboard
3. Set recognized text to pasteboard
4. Create Cmd+V key down event (CGEvent)
5. Post key down event
6. Create Cmd+V key up event
7. Post key up event
8. Wait 200ms
9. Restore original pasteboard content
```

**On-Device Recognition:**
- Set via `requiresOnDeviceRecognition = true`
- Ensures privacy (no network transmission)
- Requires macOS 13.0+
- Limited to supported languages

### PermissionManager
**Purpose:** Permission verification and request handling

**Responsibilities:**
- Check accessibility permissions
- Request microphone access
- Request speech recognition access
- Show permission alerts
- Validate permissions before operations

**Key APIs:**
- `AXIsProcessTrustedWithOptions()` - Accessibility
- `AVCaptureDevice.requestAccess(for: .audio)` - Microphone
- `SFSpeechRecognizer.requestAuthorization()` - Speech

**Permission Flow:**
```
App Launch → Check all permissions → Missing? → Request → Show alert if denied
```

### PreferencesWindow
**Purpose:** User preferences and settings UI

**Responsibilities:**
- Display current configuration
- Show hotkey information
- Explain modes and permissions
- Future: Support hotkey rebinding

**Key APIs:**
- `NSWindow`
- `NSTextField`
- `NSView`

## Data Flow

### Recording Activation (Push-to-Talk)
```
1. User presses Cmd+Shift+V
2. HotkeyManager receives event
3. HotkeyManager calls callback → StatusBarController.handleHotkey()
4. StatusBarController → VoiceRecognitionManager.startRecording()
5. VoiceRecognitionManager checks permissions
6. Audio engine starts, tap installed, recording to WAV file
7. UI updates to "Recording..."
8. After 10s → stopRecording() automatically
9. Audio file passed to WhisperManager.transcribeAudio()
10. Whisper.cpp transcribes audio to text
11. Raw transcription passed to LLMManager.processText() with smartEdit
12. Llama 3 enhances the text
13. Polished text → insertText()
14. Text appears at cursor
```

### Recording Activation (Toggle)
```
1. User presses Cmd+Shift+V (first time)
2-7. Same as push-to-talk
8. Recording continues until user presses hotkey again
9. Audio file passed to WhisperManager.transcribeAudio()
10. Whisper.cpp transcribes audio to text
11. Raw transcription passed to LLMManager.processText() with smartEdit
12. Llama 3 enhances the text
13. Polished text → insertText()
14. Text appears at cursor
```

### Text Insertion
```
1. VoiceRecognitionManager receives final transcription
2. onFinalResult callback fired with text
3. StatusBarController.insertText(text) called
4. VoiceRecognitionManager.insertText(text):
   a. Store current pasteboard
   b. Set text to pasteboard
   c. Generate Cmd+V CGEvent
   d. Post to system
   e. Restore pasteboard after delay
```

## Threading Model

- **Main Thread:**
  - All UI updates
  - Status bar modifications
  - Window management
  - Callback invocations (explicitly dispatched)

- **Background Threads:**
  - Audio capture (AVAudioEngine's internal thread)
  - Speech recognition (SFSpeechRecognizer's internal thread)

- **Thread Safety:**
  - All callbacks dispatch to main queue
  - Audio engine accessed serially
  - Singleton pattern for managers

## Error Handling

### Permission Errors
- Checked before each operation
- User-friendly alerts shown
- Graceful degradation (operations skip if no permission)

### Audio Errors
- Wrapped in do-catch blocks
- Cleanup on failure
- User notification via status updates

### Recognition Errors
- Handled in recognitionTask completion
- Automatic cleanup
- Silent failure with logging

## Security Considerations

### On-Device Processing
- No network transmission of audio
- `requiresOnDeviceRecognition = true` enforces local processing
- Privacy-first design

### Sandboxing
- App runs without sandbox (`com.apple.security.app-sandbox = false`)
- Required for global hotkeys and synthetic events
- Necessary for accessibility features

### Entitlements
- `com.apple.security.device.audio-input` - Microphone
- `com.apple.security.automation.apple-events` - Synthetic events
- Hardened runtime enabled

## Performance Characteristics

### Memory Usage
- Baseline: ~30-50 MB
- Recording: +10-20 MB (audio buffers)
- Peak: ~70 MB

### CPU Usage
- Idle: < 1%
- Recording: 10-20% (audio capture)
- Transcription: 50-100% (Whisper.cpp processing)
- Text processing: 50-100% (LLM processing)
- Brief spike during text insertion

### Latency
- Hotkey detection: < 50ms
- Recording start: < 200ms
- Transcription: 2-5 seconds (Whisper.cpp)
- Text enhancement: 2-10 seconds (LLM)
- Total end-to-end: 4-15 seconds
- Text insertion: < 100ms

## Dependencies

### System Frameworks
- **AppKit** (Cocoa): UI, menu bar
- **AVFoundation**: Audio capture
- **Carbon**: Global hotkeys
- **CoreGraphics**: Synthetic events

### External Dependencies
- **Whisper.cpp**: Local speech recognition (downloaded automatically)
- **Ollama**: Local LLM processing (optional, but recommended)

### Minimum Requirements
- macOS 13.0 (Ventura)
- Swift 5.0
- Xcode 15.0

## Known Limitations

1. **True Push-to-Talk**: Cannot detect key release events with current Carbon API. Uses timeout workaround.

2. **Language Support**: Whisper.cpp supports multiple languages, but currently configured for English only.

3. **Processing Time**: End-to-end latency is 4-15 seconds due to local processing of both Whisper and LLM.

4. **Hotkey Conflicts**: If another app uses Cmd+Shift+V, registration may fail silently.

5. **Text Insertion**: Relies on target app accepting Cmd+V. May not work in all applications.

6. **Clipboard Side Effects**: Brief modification of system clipboard during insertion.

## Future Enhancements

1. **True Push-to-Talk**: Implement using different API or run loop monitoring
2. **Hotkey Rebinding UI**: Allow users to customize hotkey
3. **Multiple Language Support**: Add language selector
4. **Custom Vocabulary**: Support user-defined words/phrases
5. **Command Mode**: Execute system commands via voice
6. **History**: Track and replay previous transcriptions
7. **Keyboard Maestro Integration**: Direct text insertion without clipboard
