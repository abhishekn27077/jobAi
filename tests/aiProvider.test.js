import { test } from 'node:test';
import assert from 'node:assert';
import { getAvailableAiProvider, generateWithAiProvider } from '../src/resumes/aiProvider.js';
import { generateStudioResume } from '../src/resumes/resumeStudioService.js';
import { loadCandidateProfile } from '../src/profile/profileManager.js';

test('AI Provider: Returns null and deterministic mode when no API keys are present', async () => {
  const origGemini = process.env.GEMINI_API_KEY;
  const origOpenAi = process.env.OPENAI_API_KEY;
  const origAnthropic = process.env.ANTHROPIC_API_KEY;

  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const provider = getAvailableAiProvider();
    assert.strictEqual(provider, null);

    const profile = loadCandidateProfile();
    const job = { id: 1, title: 'Java Developer', company: 'TestCorp', description: 'Java role' };
    const jdAnalysis = { requiredSkills: ['Java'], preferredSkills: [] };

    const aiResult = await generateWithAiProvider({ job, jdAnalysis, profile });
    assert.strictEqual(aiResult.success, false);
    assert.strictEqual(aiResult.isAiGenerated, false);
    assert.ok(aiResult.generationMode.includes('Local Deterministic Engine'));

    // Test studio generation does not pretend AI was used
    const studio = await generateStudioResume(job, { forceAi: true });
    assert.strictEqual(studio.isAiGenerated, false);
    assert.ok(studio.generationMode.includes('Local Deterministic Engine'));
  } finally {
    if (origGemini) process.env.GEMINI_API_KEY = origGemini;
    if (origOpenAi) process.env.OPENAI_API_KEY = origOpenAi;
    if (origAnthropic) process.env.ANTHROPIC_API_KEY = origAnthropic;
  }
});

test('AI Provider: Gracefully handles provider errors and falls back to deterministic without claiming AI', async () => {
  // Set an invalid key to test error handling and fallback
  const origGemini = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'invalid_mock_key_for_testing';

  try {
    const profile = loadCandidateProfile();
    const job = { id: 2, title: 'Java Engineer', company: 'TestCorp', description: 'Java Spring role' };
    const jdAnalysis = { requiredSkills: ['Java', 'Spring Boot'], preferredSkills: [] };

    const aiResult = await generateWithAiProvider({ job, jdAnalysis, profile });

    // The call must fail gracefully
    assert.strictEqual(aiResult.success, false);
    assert.strictEqual(aiResult.isAiGenerated, false);
    assert.ok(aiResult.generationMode.includes('Fallback'));
    // Ensure the key itself is not exposed in the reason
    assert.ok(!aiResult.reason.includes('invalid_mock_key_for_testing'));

    // Studio must use deterministic fallback and NOT pretend AI was used
    const studio = await generateStudioResume(job, { forceAi: true });
    assert.strictEqual(studio.isAiGenerated, false);
    assert.ok(studio.generationMode.includes('Fallback') || studio.generationMode.includes('Deterministic'));
    assert.ok(studio.content.summary.length > 0);
  } finally {
    if (origGemini) {
      process.env.GEMINI_API_KEY = origGemini;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
  }
});
