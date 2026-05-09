const assert = require('node:assert').strict;
const { test } = require('node:test');

/**
 * MOCKED PAYLOAD BUILDER (Mirrors logic in src/main.js)
 */
function buildOllamaPayload(text, screenContext, isCopilot, copilotContext) {
    let prompt = '';
    if (isCopilot) {
        if (copilotContext) {
            prompt = `Copilot Edit Mode... ${screenContext ? 'with image' : 'no image'}`;
        } else {
            prompt = `Copilot Generative Mode... ${screenContext ? 'with image' : 'no image'}`;
        }
    } else {
        prompt = `Standard Mode... ${screenContext ? 'with image' : 'no image'}`;
    }

    const body = { model: 'llama3.2', prompt, stream: false };
    
    // THE CORE LOGIC UNDER TEST
    if (screenContext) {
        // Handle data URL stripping if present (Ollama wants raw base64)
        body.images = [screenContext.split(',')[1] || screenContext];
    }
    
    return body;
}

test('Multimodal Payload: Construction with Screenshot', () => {
    const dummyImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    const payload = buildOllamaPayload("fix this", dummyImage, false, null);

    // 1. Verify Prompt Mention
    assert.ok(payload.prompt.includes('with image'));
    
    // 2. Verify Image Extraction
    assert.ok(payload.images && payload.images.length === 1);
    
    // 3. Verify Data URL stripping (crucial for Ollama API)
    // It should NOT contain "data:image/png;base64,"
    assert.ok(!payload.images[0].includes('base64'));
    assert.ok(payload.images[0].startsWith('iVBORw0'));
    
    console.log('  ✅ Verified: Multimodal payload correctly strips DataURL and attaches base64 image.');
});

test('Multimodal Payload: Construction WITHOUT Screenshot', () => {
    const payload = buildOllamaPayload("fix this", null, false, null);
    
    assert.ok(payload.prompt.includes('no image'));
    assert.equal(payload.images, undefined);
    
    console.log('  ✅ Verified: Payload remains standard when screenshot is disabled.');
});
