# Testing: Download and run CI-built DMG

This project includes a GitHub Actions workflow that builds the app and uploads a DMG artifact you can download and open without using Xcode.

How to get the DMG

1. After I push the workflow changes a GitHub Actions run will start (or you can run it manually on the PR).
2. Open the GitHub repository page → Actions → choose the most recent "Build macOS DMG" run.
3. In the run details open the "Artifacts" section and download the `VoiceHotkeyApp-dmg` artifact. It contains `VoiceHotkeyApp-Release.dmg`.

How to open the DMG

1. Double-click the downloaded `VoiceHotkeyApp-Release.dmg` to mount it.
2. Drag the `VoiceHotkeyApp.app` to your Applications folder (optional) or right-click → Open from the mounted volume.
3. On first launch macOS may block the app (unsigned). Open System Settings → Privacy & Security and click "Open Anyway" for VoiceHotkeyApp. You may need to right-click the app and choose Open.

Notes

- The DMG produced by the CI workflow is unsigned. You must manually allow it in Security & Privacy on first run.
- The DMG does not include Whisper model data (very large); use the app menu (Setup Models) to download Whisper and configure Ollama as needed.
