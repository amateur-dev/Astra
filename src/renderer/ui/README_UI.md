Voice Hotkey — UI Preview

This folder contains a lightweight preview and tokens to iterate the app UI from the Figma screenshots.

Files
- `tokens.css` — design tokens and base utility styles.
- `preview.html` — a static playground that demonstrates the Record + Transcript layout seen in the Figma attachments.

How to use
1. Open `src/renderer/ui/preview.html` in a browser (Chrome/Safari) or open it from an Electron dev server.

2. The preview is intentionally static and lightweight; it is intended as a design playground. When you're happy with the look, I can:
   - Convert components into actual renderer HTML/CSS/JS files.
   - Integrate tokens into the app's CSS and wire interactions to the real IPC APIs.

Next steps
- Implement `RecordCard`, `TranscriptCard`, and `SettingsModal` as reusable components.
- Add a storybook-like preview or small dev page that shows component states (idle, recording, finalizing, downloading).
- Iterate spacing/colours to match the Figma attachments and add dark mode tokens.
