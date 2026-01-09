# Contributing to Voice Hotkey

Thank you for your interest in contributing to Voice Hotkey! This document provides guidelines and instructions for setting up your development environment.

## Development Setup

### Prerequisites

- **Node.js**: v16 or higher
- **npm**: v8 or higher
- **macOS**: This app is currently designed for macOS (uses native features like AppleScript and specific window levels).

### External Dependencies

The app relies on the following external binaries for its core functionality:

1.  **Whisper.cpp**: For local speech-to-text transcription.
    -   You need the `whisper-cli` binary.
    -   You need a model file (e.g., `ggml-small.en.bin`).
2.  **FFmpeg**: For audio processing (trimming, format conversion).
    -   You need the `ffmpeg` binary.

**Setup Steps:**

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/amateur-dev/local-hotkey-voice-mac-app.git
    cd local-hotkey-voice-mac-app
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Setup Binaries:**
    -   **FFmpeg**: Install via Homebrew (`brew install ffmpeg`) or place the binary in `build/ffmpeg/ffmpeg`.
    -   **Whisper**:
        -   Build from [whisper.cpp](https://github.com/ggerganov/whisper.cpp) using the following commands:
            ```bash
            # Clone whisper.cpp
            git clone https://github.com/ggerganov/whisper.cpp.git
            cd whisper.cpp
            
            # Build with CMake (static build to avoid rpath issues)
            cmake -B build -DWHISPER_METAL=ON -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_EXAMPLES=ON
            cmake --build build --config Release
            
            # The binary will be at: build/bin/whisper-cli
            ```
        -   Copy the `whisper-cli` binary to `build/whisper/whisper-cli` in this project, or place it in your PATH.
        -   **Important**: Always build with `-DBUILD_SHARED_LIBS=OFF` to avoid hardcoded library paths that won't work on other machines.
    -   **Models**:
        -   Download a model (e.g., `ggml-small.en.bin`) from Hugging Face or the whisper.cpp repo.
        -   Place it in the `models/` directory.

4.  **Run the app:**
    ```bash
    npm start
    ```

## Project Structure

-   `src/main.js`: Main process entry point. Handles window management, global shortcuts, and IPC.
-   `src/renderer/`: Frontend UI code (HTML/CSS/JS).
    -   `index.html`: Main hidden window / settings.
    -   `recording-window.html`: Floating overlay.
    -   `renderer.js`: Main renderer logic.
-   `src/lib/`: Shared utilities (Whisper wrapper, logger).

## Code Style

-   We use standard JavaScript style.
-   Please ensure your code is clean and commented where necessary.

## Pull Requests

1.  Fork the repository.
2.  Create a feature branch (`git checkout -b feature/amazing-feature`).
3.  Commit your changes.
4.  Push to the branch.
5.  Open a Pull Request.

## Reporting Issues

Please use the GitHub Issues tab to report bugs or request features. Include as much detail as possible, including logs (Settings -> View Logs).
