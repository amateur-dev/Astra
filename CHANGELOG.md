# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2025-11-20

### Added
-   **First Run Wizard**: Automatic detection and downloading of required dependencies (FFmpeg, Whisper binaries, and Models).
-   **Model Management**: New Settings UI to view, download, and switch between different Whisper models (Tiny, Base, Small, Medium).
-   **Author Credits**: Added author information to README and Settings.

### Fixed
-   **Hotkey Recording**: Fixed issues with setting custom hotkeys; added real-time visual feedback and better key mapping.
-   **GitHub Link**: Corrected the repository link in the Settings menu.

### Changed
-   **Version Bump**: First official release (v1.0.0).

## [0.1.0] - Beta

### Added
-   **Floating Recording UI**: New transparent, always-on-top recording window with waveform visualization.
-   **Dynamic Tray Icons**: Status indicators for Idle, Recording, and Processing states.
-   **Transcription Progress**: Visual feedback during the transcription process.
-   **Transcript Result Window**: Fallback window for when auto-paste fails, with Copy/Select All options.
-   **Settings UI**: Simplified settings with "Polish with Ollama" option (hidden if Ollama is not detected).
-   **Logging System**: Background logging to `~/Library/Logs/VoiceHotkey/app.log` and a built-in Log Viewer.
-   **Global Hotkey**: Configurable global shortcut (default: Cmd+Shift+V) to toggle recording.
-   **Escape to Cancel**: Pressing Escape during recording now cancels the session.

### Changed
-   **Window Management**: Improved focus handling to prevent the app from stealing focus from the active application.
-   **Microphone Handling**: Fixed issues with microphone indicators persisting after recording stops.
-   **Architecture**: Refactored main process and renderer communication for better stability.

### Fixed
-   Fixed issue where the recording window would switch desktops or steal focus.
-   Fixed "orange dot" microphone indicator leak.
-   Fixed race conditions in recording start/stop sequences.

## [0.1.0] - Initial Release
-   Basic voice recording and transcription using local Whisper.
-   Auto-paste functionality.
