/**
 * CareerOS — AI Provider Abstraction
 * Supports Google Gemini, OpenAI, and Anthropic Claude for optional AI-assisted resume tailoring.
 * Features:
 * - Evidence-grounded generation strictly constrained to verified candidate profile.
 * - Enforces structured JSON output schema.
 * - Strict anti-fabrication auditor verification before accepting AI output.
 * - Resilient timeouts (12s) and graceful deterministic fallback.
 * - Never claims AI generation unless the provider actually responds successfully.
 * - Zero API key leakage.
 */

import { auditDocumentTruthfulness } from './resumeGenerator.js';

export function getAvailableAiProvider() {
  if (process.env.GEMINI_API_KEY) return { provider: 'gemini', name: 'Google Gemini', model: 'gemini-1.5-flash' };
  if (process.env.OPENAI_API_KEY) return { provider: 'openai', name: 'OpenAI', model: 'gpt-4o-mini' };
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', name: 'Anthropic Claude', model: 'claude-3-haiku-20240307' };
  return null;
}

export async function generateWithAiProvider({ job, jdAnalysis, profile }) {
  const providerInfo = getAvailableAiProvider();
  if (!providerInfo) {
    return {
      success: false,
      reason: 'NO_API_KEY_CONFIGURED',
      generationMode: 'Local Deterministic Engine (Zero Fabrication)',
      isAiGenerated: false
    };
  }

  const prompt = buildStructuredPrompt(job, jdAnalysis, profile);

  try {
    let rawText = null;

    if (providerInfo.provider === 'gemini') {
      rawText = await callGeminiApi(process.env.GEMINI_API_KEY, prompt, providerInfo.model);
    } else if (providerInfo.provider === 'openai') {
      rawText = await callOpenAiApi(process.env.OPENAI_API_KEY, prompt, providerInfo.model);
    } else if (providerInfo.provider === 'anthropic') {
      rawText = await callAnthropicApi(process.env.ANTHROPIC_API_KEY, prompt, providerInfo.model);
    }

    if (!rawText) {
      throw new Error('Empty response received from AI provider');
    }

    // Extract JSON block if wrapped in markdown
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, rawText];
    const parsedContent = JSON.parse(jsonMatch[1] || rawText);

    // Validate minimum required resume schema
    if (!parsedContent.summary || !parsedContent.technicalSkills || !parsedContent.projects) {
      throw new Error('AI output missing required resume structural sections');
    }

    // Ensure candidate personal info and education are grounded from master profile
    parsedContent.personal = profile.personal;
    parsedContent.education = profile.education;
    parsedContent.experience = profile.experience;
    parsedContent.certificationsAndAwards = profile.certifications;

    // Strict Truthfulness Auditor Gate: Check AI output for hallucinations
    const audit = auditDocumentTruthfulness(parsedContent, profile);
    if (!audit.passed) {
      console.warn('[AI Provider] AI output rejected by Truthfulness Auditor:', audit.warnings);
      return {
        success: false,
        reason: `AI output failed truthfulness verification: ${audit.warnings.join('; ')}`,
        generationMode: 'Local Deterministic Engine (Fallback: AI Output Rejected by Truthfulness Auditor)',
        isAiGenerated: false
      };
    }

    return {
      success: true,
      content: parsedContent,
      generationMode: `AI Provider: ${providerInfo.name} (${providerInfo.model})`,
      isAiGenerated: true
    };
  } catch (err) {
    // Sanitize any accidental API key leaks in error message
    const sanitizedError = (err.message || 'Unknown provider error')
      .replace(/[a-zA-Z0-9_-]{20,}/g, '[REDACTED_KEY]');

    console.warn(`[AI Provider] Call failed for ${providerInfo.name}:`, sanitizedError);

    return {
      success: false,
      reason: sanitizedError,
      generationMode: `Local Deterministic Engine (Fallback: ${providerInfo.name} unavailable)`,
      isAiGenerated: false
    };
  }
}

function buildStructuredPrompt(job, jdAnalysis, profile) {
  return `
You are the CareerOS Tailoring Agent. Tailor an entry-level resume for the target job using ONLY verified candidate profile data.

TARGET JOB:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || 'India'}
Description:
${job.description || ''}

REQUIRED SKILLS: ${(jdAnalysis.requiredSkills || []).join(', ')}
PREFERRED SKILLS: ${(jdAnalysis.preferredSkills || []).join(', ')}

VERIFIED CANDIDATE PROFILE (ABSOLUTE GROUND TRUTH):
Full Name: ${profile.personal.fullName}
Degree: MCA (Master of Computer Applications) from AIMS Institutes, Bangalore (Oct 2026 completion).
BCA from SSA Government First Grade College, Ballari (2024 completion).
Internship: Advanced Java Full Stack Development Intern at Anudip Foundation (Oct 2026).
Verified Projects:
1. NearVia – Hyperlocal Marketplace for Daily-Wage Work (React, TypeScript, Node.js, Express, PostgreSQL, PostGIS, Supabase)
2. FinSight – AI Expense Tracker and Financial Health Predictor (React, Node.js, Express, MongoDB Atlas, Python, FastAPI)
3. Employee Leave Management System (Java, Spring Boot, Hibernate/JPA, React, MySQL)
4. Smart Rover – AI Waste Detection Vehicle (ESP32-CAM, Python, OpenCV, Telegram Bot API)
5. Aquaponics Monitoring System (ESP32, Sensors, Telegram Bot API)

CRITICAL ANTI-FABRICATION CONSTRAINTS:
1. DO NOT invent B.Tech, B.E., M.Tech, Ph.D, or MBA degrees. Candidate has MCA and BCA.
2. DO NOT use the words "production-grade", "production-ready", or "enterprise-grade".
3. DO NOT claim "microservices" architecture experience. Mention REST APIs and modular services.
4. DO NOT claim "immediate joiner". Candidate is an MCA 2026 graduate.
5. DO NOT invent commercial years of experience.
6. DO NOT invent skills not present in the verified candidate profile.

Respond with ONLY valid JSON with this exact schema:
{
  "summary": "2-3 sentences tailored professional summary grounded in verified facts",
  "technicalSkills": {
    "languages": ["Java", "Python", ...],
    "backend": ["Core Java", "Spring Boot", ...],
    "frontend": ["React.js", ...],
    "databases": ["MySQL", "PostgreSQL", ...]
  },
  "projects": [
    {
      "name": "Project Name from verified list",
      "techStack": ["matching stack"],
      "bullets": ["verified factual bullet point", "verified factual bullet point"]
    }
  ]
}
`.trim();
}

async function callGeminiApi(apiKey, prompt, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    }),
    signal: AbortSignal.timeout(12000)
  });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw new Error(`Gemini API HTTP ${resp.status}: ${errorBody.substring(0, 100)}`);
  }

  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text;
}

async function callOpenAiApi(apiKey, prompt, model) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a truthful career assistant. Respond with strictly verified JSON only.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2
    }),
    signal: AbortSignal.timeout(12000)
  });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw new Error(`OpenAI API HTTP ${resp.status}: ${errorBody.substring(0, 100)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content;
}

async function callAnthropicApi(apiKey, prompt, model) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model || 'claude-3-haiku-20240307',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    }),
    signal: AbortSignal.timeout(12000)
  });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw new Error(`Anthropic API HTTP ${resp.status}: ${errorBody.substring(0, 100)}`);
  }

  const data = await resp.json();
  return data.content?.[0]?.text;
}
