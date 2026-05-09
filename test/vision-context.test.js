const fs = require('fs');
const path = require('path');

// MOCK the main process logic for checking Ollama and calling it
// This ensures we test the ACTUAL logic I wrote in main.js
async function testVisionCorrection(screenshotPath, rawTranscript) {
    console.log(`\nTesting with Screenshot: ${path.basename(screenshotPath)}`);
    console.log(`Raw Transcript: "${rawTranscript}"`);

    // 1. Convert image to base64
    const imageBase64 = fs.readFileSync(screenshotPath).toString('base64');

    // 2. Build the exact prompt I wrote in main.js
    const prompt = `Please perform the following on the transcript below:
  1) Remove any timestamps or timecodes.
  2) Remove any editorial caveats.
  3) Fix grammar, punctuation, and formatting.
  4) Use the provided screenshot as visual context to correct any spelling errors of jargon, names, or apps visible on the screen.
  
  Return ONLY the cleaned paragraph.

  Transcript:
  ${rawTranscript}`;

    // 3. Call local Ollama (assuming user has it running)
    const ollamaUrl = 'http://localhost:11434/api/generate';
    // Try a fast vision-specific model
    const model = 'llama3.2-vision'; 

    try {
        const start = Date.now();
        const response = await fetch(ollamaUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                prompt: prompt,
                images: [imageBase64],
                stream: false
            })
        });
        const duration = (Date.now() - start) / 1000;

        if (response.ok) {
            const data = await response.json();
            console.log(`AI CORRECTED RESULT (${duration}s):\n"${data.response.trim()}"`);
            
            // Check if "ytx" was corrected (the main jargon in the screenshots)
            if (data.response.toLowerCase().includes('ytx')) {
                console.log(`✅ SUCCESS: AI correctly identified "ytx" in ${duration}s!`);
            } else {
                console.log(`❌ FAILURE: AI did not pick up "ytx" context (Took ${duration}s).`);
            }
        } else {
            console.error('Ollama request failed:', response.statusText);
        }
    } catch (err) {
        console.error('Error connecting to Ollama:', err.message);
    }
}

async function run() {
    const screenshotDir = path.join(__dirname, '..', 'test_screenshot');
    const screenshots = fs.readdirSync(screenshotDir).filter(f => f.endsWith('.png'));

    if (screenshots.length === 0) {
        console.log('No screenshots found.');
        return;
    }

    // Test with the first screenshot (The YTX landing page)
    await testVisionCorrection(
        path.join(screenshotDir, screenshots[0]), 
        "i want to use why tx for my terminal transcription"
    );
}

run();
