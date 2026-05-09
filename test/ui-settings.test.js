const assert = require('node:assert').strict;
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

// Read the renderer.js file as text
const rendererPath = path.join(__dirname, '../src/renderer/renderer.js');
const rendererCode = fs.readFileSync(rendererPath, 'utf-8');

test('Renderer UI elements should correctly extract state for saving', async (t) => {
  // 1. Setup a mocked DOM environment for our specific bug
  const mockDOM = {
    'autoPaste': { checked: true, type: 'checkbox' },
    'ollamaEnabled': { checked: true, type: 'checkbox' },
    'screenContextEnabled': { checked: true, type: 'checkbox' },
    'enableAiCaveat': { checked: false, type: 'checkbox' },
    'ollamaUrl': { value: 'http://custom-url', type: 'text' },
    'ollamaModel': { value: 'custom-model', type: 'text' },
    'whisperBin': { value: '/path/to/whisper', type: 'text' },
    'modelPath': { value: '/path/to/model', type: 'text' },
    'ffmpegPath': { value: '/path/to/ffmpeg', type: 'text' },
    'hotkeyInput': { value: 'Cmd+P', type: 'text' }
  };

  global.document = {
    getElementById: (id) => {
      if (mockDOM[id]) {
        return {
          ...mockDOM[id],
          value: mockDOM[id].value || '',
          checked: mockDOM[id].checked || false,
          trim: function() { return this.value.trim(); }
        };
      }
      return null;
    }
  };

  // 2. We extract the exact save logic from renderer.js using a regex
  // This ensures we test the ACTUAL logic running in the app.
  const saveSettingsMatch = rendererCode.match(/async function saveSettings \(\) \{([\s\S]*?)(?=const r = await window\.electronAPI\.saveSettings)/);
  assert.ok(saveSettingsMatch, 'Should find saveSettings function body in renderer.js');
  
  let functionBody = saveSettingsMatch[1];
  
  // We need to capture the 'payloadWithPolish' that it attempts to send
  functionBody += `\nreturn payloadWithPolish;`;

  // 3. Execute the function body in our mocked environment
  const saveSettingsFn = new Function(functionBody);
  const resultPayload = saveSettingsFn();

  // 4. Verify it captured all UI states correctly (The core bug)
  await t.test('Should capture legacy transcribe_cmd correctly', () => {
    assert.equal(resultPayload.transcribe_cmd, '/path/to/whisper -m /path/to/model -f {wav}');
  });

  await t.test('Should capture screenContextEnabled', () => {
    assert.equal(resultPayload.screen_context_enabled, true);
  });

  await t.test('Should capture enableAiCaveat', () => {
    assert.equal(resultPayload.enable_ai_caveat, false);
  });

  await t.test('Should capture autoPaste', () => {
    assert.equal(resultPayload.auto_paste, true);
  });

  await t.test('Should capture ollama config', () => {
    assert.equal(resultPayload.ollama_url, 'http://custom-url');
    assert.equal(resultPayload.ollama_model, 'custom-model');
  });
  
  // Clean up global mock
  delete global.document;
});
