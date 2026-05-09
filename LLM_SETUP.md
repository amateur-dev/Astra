# LLM Setup & Models

Local Hotkey Voice App uses [Ollama](https://ollama.ai/) to run powerful language and vision models locally on your Mac.

## Recommended Text Models (For Transcripts, Copilot, & Memory)

1. **Llama 3.2 (3B)** - `llama3.2`
   - *Best overall balance of speed and intelligence.*
   - Install: `ollama run llama3.2`

2. **Qwen 2.5 (1.5B)** - `qwen2.5:1.5b`
   - *Extremely fast, great for older Macs or minimal RAM.*
   - Install: `ollama run qwen2.5:1.5b`

## Recommended Vision Models (For Screen Context)

Vision models are required if you enable "Screen Context" for Copilot mode. Because taking a screenshot and analyzing it requires significant processing power, **we strongly recommend using smaller vision models** to prevent the app from feeling slow.

1. **Llama 3.2 Vision (11B)** - `llama3.2-vision`
   - *Most accurate, but requires significant RAM (16GB+) and can take 20-40 seconds to process a screenshot.*
   - Install: `ollama run llama3.2-vision`

2. **Moondream 2 (1.8B)** - `moondream`
   - *Incredibly fast and lightweight. Excellent for quickly identifying text, jargon, and UI elements on the screen.*
   - Install: `ollama run moondream`

## How to Configure in the App

1. Ensure Ollama is running in your menu bar.
2. Open the Local Hotkey Voice App settings (Right-click the tray icon > Settings).
3. Under the "Ollama (AI Polish)" section:
   - Ensure the URL is `http://localhost:11434` (or `http://127.0.0.1:11434` if you have connection issues).
   - Enter your preferred model name (e.g., `llama3.2` or `llama3.2-vision`).
4. Click **Save Settings**.