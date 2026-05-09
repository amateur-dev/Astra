const fs = require('fs');
const path = require('path');

async function runStreamingTest() {
    const screenshotPath = path.join(__dirname, '..', 'test_screenshot', 'test-scaled-800.jpg');
    console.log(`[System] Loading image: ${screenshotPath}`);
    
    // Convert to base64
    const imageBase64 = fs.readFileSync(screenshotPath).toString('base64');
    const rawTranscript = "i want to use why tx for my terminal transcription";

    const prompt = `Rewrite the following transcript to fix spelling mistakes. The user was talking about a tool called "YTX".
Transcript: ${rawTranscript}`;

    console.log('[System] Connecting to local Ollama (qwen2.5:1.5b) with STREAM: TRUE...\n');
    console.log('--- STREAM START ---');

    const start = Date.now();
    let firstTokenTime = null;

    try {
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'qwen2.5:1.5b',
                prompt: prompt,
                stream: true // THIS IS THE KEY CHANGE
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Web Streams API handling (for native fetch)
        if (response.body && response.body.getReader) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                if (!firstTokenTime) {
                    firstTokenTime = Date.now();
                    console.log(`\n\n[System] ⏱️ TIME TO FIRST TOKEN: ${((firstTokenTime - start) / 1000).toFixed(2)} seconds! (This is when the UI starts updating)`);
                    console.log('\n--- AI TYPING ---');
                }

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.response) {
                            process.stdout.write(parsed.response);
                        }
                    } catch (e) {
                        // ignore parse errors
                    }
                }
            }
        }

        const totalTime = ((Date.now() - start) / 1000).toFixed(2);
        console.log(`\n\n--- STREAM END ---`);
        console.log(`[System] 🏁 Total generation time: ${totalTime} seconds.`);

    } catch (err) {
        console.error('Error connecting to Ollama:', err.message);
    }
}

runStreamingTest();