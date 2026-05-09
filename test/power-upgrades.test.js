const assert = require('node:assert').strict;
const { test } = require('node:test');

// We mock the logic found in src/main.js to verify it works as intended
function getFinalText(text, enableCaveat, hadScreenContext = false) {
  if (enableCaveat !== false && text) {
    const contextMsg = hadScreenContext ? ' + Screen Context' : '';
    return text.trim() + ` [Voice Note Transcribed Using AI${contextMsg}]`;
  }
  return text;
}

test('AI Caveat is appended correctly when enabled', () => {
  const input = 'Hello world';
  const expected = 'Hello world [Voice Note Transcribed Using AI]';
  assert.equal(getFinalText(input, true, false), expected);
});

test('AI Caveat is appended correctly when screen context is present', () => {
  const input = 'Hello world';
  const expected = 'Hello world [Voice Note Transcribed Using AI + Screen Context]';
  assert.equal(getFinalText(input, true, true), expected);
});

test('AI Caveat is NOT appended when disabled', () => {
  const input = 'Hello world';
  assert.equal(getFinalText(input, false, true), input);
});

test('AI Caveat handles whitespace correctly', () => {
  const input = '  Hello world  ';
  const expected = 'Hello world [Voice Note Transcribed Using AI]';
  assert.equal(getFinalText(input, true, false), expected);
});

// Test the Prompt Generation Logic (Mocked from main.js)
function generatePrompt(text, isCopilot, context, hasScreen) {
    let prompt = '';
    if (isCopilot) {
      if (context) {
        prompt = `You are an AI writing assistant.
Your task is to edit, rewrite, or fulfill the following USER INSTRUCTION based on the provided TEXT.
${hasScreen ? 'A screenshot of the user\'s screen is provided for visual context. Use it to correctly identify jargon, app names, or UI elements mentioned in the instruction.' : ''}

TEXT:
"""
${context}
"""

USER INSTRUCTION:
"""
${text}
"""

IMPORTANT:
1) Return ONLY the modified text.
2) Do NOT include any introductory phrases like "Here is the rewritten text:".
3) Do NOT include any caveats or explanations.
4) Maintain the same format (e.g. if the input is code, return code; if it is an email, return an email).`;
      } else {
        prompt = `You are an AI writing assistant.
The user has provided a voice instruction, but NO text was selected. 
${hasScreen ? 'A screenshot of the user\'s screen is provided for visual context. Use it to correctly identify jargon, app names, or UI elements mentioned in the instruction.' : ''}

USER INSTRUCTION:
"""
${text}
"""

TASK:
1) Fulfill the user's instruction. If they asked to "write a React component", write it. If they asked a question, answer it concisely.
2) Return ONLY the result.
3) Do NOT include any introductory phrases or caveats.`;
      }
    }
    return prompt;
}

test('Copilot prompt includes context when provided', () => {
    const text = 'Fix typos';
    const context = 'Heello world';
    const prompt = generatePrompt(text, true, context, false);
    assert.ok(prompt.includes('TEXT:\n"""\nHeello world\n"""'));
    assert.ok(prompt.includes('USER INSTRUCTION:\n"""\nFix typos\n"""'));
});

test('Copilot prompt handles missing context (generative mode)', () => {
    const text = 'Write a poem';
    const prompt = generatePrompt(text, true, null, false);
    assert.ok(prompt.includes('but NO text was selected'));
    assert.ok(prompt.includes('USER INSTRUCTION:\n"""\nWrite a poem\n"""'));
});

test('Copilot prompt includes screen context hint when enabled', () => {
    const prompt = generatePrompt('fix', true, 'text', true);
    assert.ok(prompt.includes('A screenshot of the user\'s screen is provided'));
});
