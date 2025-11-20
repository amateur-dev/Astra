# Voice Hotkey (macOS)

A powerful, local-first voice dictation tool for macOS. Press a hotkey, speak, and have your text typed directly into any application. Powered by [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) for privacy and speed, with optional LLM polishing via [Ollama](https://ollama.ai).

![Status](https://img.shields.io/badge/status-beta-blue)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)
![Downloads](https://img.shields.io/github/downloads/amateur-dev/local-hotkey-voice-mac-app/total?color=brightgreen)

> **[Download the latest version for macOS](https://github.com/amateur-dev/local-hotkey-voice-mac-app/releases/latest)**

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

**For Users (DMG App):**
-   **macOS** (Apple Silicon or Intel).
-   That's it! The app comes bundled with everything it needs (Node.js, FFmpeg, Whisper).
-   *Note: On the first run, the app will ask to download a speech model (approx. 400MB) optimized for your needs.*

**For Developers (Source Code):**
If you want to build the app from source, you will need:
1.  **Node.js** (v18+)
2.  **FFmpeg**: `brew install ffmpeg`
3.  **Whisper.cpp**: `whisper-cli` binary in your PATH.

## Installation & Setup

### Option A: Download App (Recommended)

1.  **Download**: Go to the [Releases Page](https://github.com/amateur-dev/local-hotkey-voice-mac-app/releases) and download the `.dmg` file for your Mac:
    -   **Apple Silicon (M1/M2/M3)**: Download `voice-hotkey-electron-x.x.x-arm64.dmg`
    -   **Intel Mac**: Download `voice-hotkey-electron-x.x.x.dmg` (or `x64`)

2.  **Install**: Open the downloaded `.dmg` file and drag the app icon into the **Applications** folder.

    > **Note on Security Warning**:
    > Since this app is not signed with a paid Apple Developer ID ($99/year), macOS will show a warning saying it "cannot be opened because the developer cannot be verified" or "it is from an unidentified developer". **This is normal for open-source apps.**

3.  **First Launch (Bypassing Security)**:
    1.  Double-click the app to open it. You will see the warning. Click **Done** or **Cancel**.
    2.  Open **System Settings** -> **Privacy & Security**.
    3.  Scroll down to the "Security" section. You will see a message: *"voice-hotkey-electron was blocked from use because it is not from an identified developer."*
    4.  Click **Open Anyway**.
    5.  A final popup will appear. Click **Open**.
    6.  *(You only need to do this once).*

4.  **Setup Wizard**:
    -   The app will launch and show the "Welcome" screen.
    -   **System Components**: You should see green "Installed" badges for FFmpeg and Whisper (they are bundled with the app!).
    -   **Select Model**: Choose a speech model (e.g., "Small") and click **Download & Install**.
    -   Once finished, the app is ready to use!

### Option B: Build from Source
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

## Feedback & Support

If you encounter any bugs, have feature requests, or need assistance, please open an issue on our GitHub repository:

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
