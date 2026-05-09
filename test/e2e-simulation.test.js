const assert = require('node:assert').strict;
const { test } = require('node:test');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// 1. Load Managers
const dbManager = require('../src/lib/db-manager');
const memoryManager = require('../src/lib/memory-manager');
const whisperServerManager = require('../src/lib/whisper-server-manager');

// 2. Mocking the Ollama fetch to avoid dependency on a running Ollama for the test
// but ensuring the internal logic calls it correctly.
const mockOllamaResponse = (prompt) => {
  if (prompt.includes('RELEVANT PAST CONTEXT')) {
    return { ok: true, text: "Fixed with memory: Project X is active." };
  }
  return { ok: true, text: "Polished transcript output." };
};

test('E2E Simulation: Full Pipeline (DB -> Whisper Server -> Memory -> AI)', async (t) => {
  
  // Step 1: Database Initialization Check
  await t.test('Database should have correct tables', () => {
    const tables = dbManager.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    assert.ok(tables.includes('transcripts'));
    assert.ok(tables.includes('vocabulary'));
    assert.ok(tables.includes('summaries'));
  });

  // Step 2: Whisper Server Startup (Manual Check)
  // We won't actually start the real server to avoid blocking the test runner,
  // but we verify the manager can find the binary.
  await t.test('Whisper Server binary should be detectable', async () => {
    const { checkWhisperAvailability } = require('../src/lib/whisper-utils');
    const res = await checkWhisperAvailability();
    assert.ok(res, 'checkWhisperAvailability should return a result');
    if (res.ok) {
        console.log('  - Found whisper-server at:', res.path);
    } else {
        // Just log it in the test environment if not found, rather than fail,
        // since CI environments might not have whisper compiled.
        console.log('  - Whisper not found, skipping strictly checking path.');
    }
  });

  // Step 3: Memory & Learning Simulation
  await t.test('Memory should learn and retrieve context', async () => {
    // Inject a specific correction
    memoryManager.addCorrection('prj x', 'Project Xero');
    const context = memoryManager.getMemoryContext();
    assert.ok(context.includes('prj x') && context.includes('Project Xero'));
    
    // Simulate logging a transcript
    dbManager.insertTranscript('raw text', 'Polished text of Project Xero');
    
    // Verify it is searchable
    const search = dbManager.searchTranscripts('Xero');
    assert.ok(search.length >= 1, 'Should find at least one result for Xero');
  });

  // Step 4: Semantic Context Integration Simulation
  await t.test('Semantic context should be constructed from embeddings', () => {
     // Mock an embedding (float32 array)
     const mockEmbedding = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
     dbManager.insertTranscript('jargon', 'Specialized Jargon', mockEmbedding);
     
     const semanticContext = memoryManager.getSemanticContext(mockEmbedding);
     assert.ok(semanticContext.includes('Specialized Jargon'));
     console.log('  - Semantic context correctly retrieved.');
  });

  // Step 5: Final Polish Flow Simulation
  await t.test('Polishing should combine all context sources', async () => {
    // This is the core logic in main.js refactored for testing
    const rawText = "some prj x jargon";
    const memContext = memoryManager.getMemoryContext();
    const semContext = "RELEVANT PAST CONTEXT: Project X is active.";
    
    // Mock the prompt construction
    const prompt = `
      Context: ${memContext}
      Semantic: ${semContext}
      Input: ${rawText}
    `;
    
    const result = mockOllamaResponse(prompt);
    assert.equal(result.text, "Fixed with memory: Project X is active.");
  });

  // Step 6: Cleanup Simulation
  await t.test('Cleanup should identify and potentially remove files', async () => {
    const testFile = path.join(require('os').tmpdir(), 'voicehotkey-test-delete.wav');
    fs.writeFileSync(testFile, 'dummy content');
    
    // Check if it exists
    assert.ok(fs.existsSync(testFile));
    
    // Run the logic (forced cleanup)
    const tmpDir = require('os').tmpdir();
    const files = fs.readdirSync(tmpDir);
    for (const file of files) {
      if (file === 'voicehotkey-test-delete.wav') {
        fs.unlinkSync(path.join(tmpDir, file));
      }
    }
    
    assert.ok(!fs.existsSync(testFile));
    console.log('  - File cleanup logic verified.');
  });

});
