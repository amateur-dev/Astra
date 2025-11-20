# Voice Hotkey (macOS)

A powerful, local-first voice dictation tool for macOS. Press a hotkey, speak, and have your text typed directly into any application. Powered by [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) for privacy and speed, with optional LLM polishing via [Ollama](https://ollama.ai).

![Status](https://img.shields.io/badge/status-beta-blue)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)

## Features

-   **Global Hotkey**: Toggle recording from anywhere (Default: `Cmd+Shift+V`).
-   **Floating Overlay**: Minimal, non-intrusive recording UI with waveform visualization.
-   **Local Transcription**: Uses Whisper.cpp for offline, private, and fast speech-to-text.
-   **Smart Polishing (Optional)**: Use Ollama (Llama 3, etc.) to fix grammar, punctuation, and formatting automatically.
-   **Auto-Paste**: Automatically types the transcribed text into your active application.
-   **System Integration**:
    -   Does not steal focus from your active window.
    -   Dynamic menu bar icons (Idle / Recording / Processing).
    -   "Screen Saver" window level ensures visibility over fullscreen apps.

## Prerequisites

The app includes a **First Run Wizard** that will attempt to download and configure the necessary dependencies automatically.

However, if you prefer to set them up manually or if the automatic setup fails:

1.  **Node.js** (v18+)
2.  **FFmpeg**: For audio processing.
    ```bash
    brew install ffmpeg
    ```
3.  **Whisper.cpp**: For transcription.
    -   Clone and build [whisper.cpp](https://github.com/ggerganov/whisper.cpp).
    -   Ensure you have the `whisper-cli` (or `main`) binary.
    -   Download a model file (e.g., `ggml-small.en.bin`).
    -   *See [LLM_SETUP.md](LLM_SETUP.md) for detailed build instructions.*

4.  **(Optional) Ollama**: For text polishing.
    -   Install [Ollama](https://ollama.ai).
    -   Pull a model: `ollama pull llama3`

## Installation & Setup

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/amateur-dev/local-hotkey-voice-mac-app.git
    cd local-hotkey-voice-mac-app
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Configure Binaries**:
    -   The app looks for `whisper-cli` in your PATH or common locations (`~/whisper.cpp/build/bin/whisper-cli`, etc.).
    -   It looks for models in the `models/` directory of the project.
    -   *Tip: You can symlink your model to the project folder:*
        ```bash
        mkdir -p models
        ln -s /path/to/your/ggml-small.en.bin models/ggml-small.en.bin
        ```

4.  **Run the app**:
    ```bash
    npm start
    ```

## Usage

1.  **Start Recording**: Press `Cmd+Shift+V` (or your configured hotkey).
    -   A floating window will appear near your cursor.
    -   Speak your text.
2.  **Stop Recording**: Press the hotkey again.
    -   The app will process the audio.
    -   Once complete, it will paste the text into your active window.
3.  **Cancel**: Press `Escape` during recording to cancel.

## Configuration

Click the "Settings" button in the main window (accessible via the Tray icon -> Open) to configure:
-   **Global Hotkey**: Change the shortcut.
-   **Auto-Paste**: Toggle automatic pasting.
-   **Polish with Ollama**: Enable/disable LLM post-processing.

## Troubleshooting

-   **"Orange Dot" stays on**: This means the microphone handle wasn't released. The app has safeguards for this, but if it happens, quit the app from the tray.
-   **Paste fails**: Ensure the app (or Terminal/VS Code if running in dev) has **Accessibility** permissions in macOS System Settings -> Privacy & Security.
-   **Logs**: Go to Settings -> View Logs to see detailed application logs for debugging.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for development instructions.

## Author

**Dipesh Sukhani**
-   Website: [dipeshsukhani.dev](https://dipeshsukhani.dev)
-   Email: [me@dipeshsukhani.dev](mailto:me@dipeshsukhani.dev)
-   LinkedIn: [linkedin.com/in/dipeshsukhani](https://linkedin.com/in/dipeshsukhani)
-   Twitter: [@dipesh_sukhani](https://x.com/dipesh_sukhani)
-   GitHub: [@amateur-dev](https://github.com/amateur-dev)

## License

MIT
