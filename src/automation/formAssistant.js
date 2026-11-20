import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCandidateProfile } from '../profile/profileManager.js';
import { exportTailoredDocumentsForJob } from '../resumes/resumeGenerator.js';
import { getPortalAdapter } from './portalAdapters/portalRegistry.js';
import { generateScreeningAnswers } from './screeningEngine.js';
import { updateApplicationStatus } from '../tracker/applicationTracker.js';
import { getDatabase } from '../db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function launchFormAssistant(job, options = {}) {
  const {
    userConfirmedApproval = false,
    resumePdfPath = null,
    screeningAnswers = null,
    headless = false
  } = options;

  // STRICT HUMAN APPROVAL GATE:
  // Cannot launch browser form filling without explicit user confirmation
  if (!userConfirmedApproval) {
    const error = new Error('Human Approval Gate: You must explicitly approve the application preparation and proposed answers before launching the browser assistant.');
    error.code = 'APPROVAL_REQUIRED';
    throw error;
  }

  const profile = loadCandidateProfile();
  const db = getDatabase();

  console.log(`\n[Form Assistant] Preparing application for: "${job.title}" @ "${job.company}"`);
  console.log(`[Form Assistant] Target URL: ${job.url}`);

  // 1. Ensure Tailored Resume PDF is ready
  let pdfPath = resumePdfPath;
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    console.log('[Form Assistant] Generating tailored ATS resume PDF...');
    const docs = await exportTailoredDocumentsForJob(job);
    pdfPath = docs.resumePdfPath;
  }

  // 2. Launch Google Chrome (Human-in-the-Loop)
  console.log(`[Form Assistant] Launching browser (Headless: ${headless})...`);
  let browser;
  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless,
      args: ['--start-maximized']
    });
  } catch {
    browser = await chromium.launch({
      channel: 'msedge',
      headless,
      args: ['--start-maximized']
    });
  }

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  console.log(`[Form Assistant] Navigating to: ${job.url}`);
  try {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    console.warn(`[Form Assistant] Initial navigation notice: ${err.message}`);
  }

  // 3. Detect Portal & Check Barriers
  const adapter = getPortalAdapter(job.url);
  const barrierCheck = await adapter.detectSessionOrAuthBarrier(page);
  if (barrierCheck.hasBarrier) {
    console.warn(`[Form Assistant Notice] ${barrierCheck.message}`);
  }

  // 4. Inject Assistant Banner & Auto-Fill Approved Fields
  try {
    await page.waitForTimeout(1500);

    const answers = screeningAnswers || generateScreeningAnswers(job);
    const fillResult = await autoFillApplicationForm(page, profile, pdfPath, { screeningAnswers: answers, adapter });
    console.log(`[Form Assistant] Auto-filled ${fillResult.fieldsFilled} standard fields using ${adapter.name} adapter.`);

    // 5. Update Application Tracker to 'ready_for_review'
    try {
      updateApplicationStatus(job.id, 'ready_for_review', {
        notes: `Form Assistant filled ${fillResult.fieldsFilled} fields via ${adapter.name}. Verification: ${JSON.stringify(fillResult.verification || [])}`
      });
    } catch {}

    db.prepare(`
      INSERT INTO activity_audit_log (action, details)
      VALUES (?, ?)
    `).run(
      'FORM_ASSISTANT_LAUNCHED',
      `Launched Playwright form assistant for Job #${job.id} (${job.title} @ ${job.company}). Pre-filled ${fillResult.fieldsFilled} fields. Portal: ${adapter.name}. Verification matches: ${(fillResult.verification || []).filter(v => v.status === 'verified_match').length}`
    );

    console.log('\n================================================================');
    console.log('✅ Form Assistant is standing by in your open Chrome browser!');
    console.log('👉 Please review the pre-filled fields, verify all data,');
    console.log('   and click "Submit Application" manually when satisfied.');
    console.log('================================================================\n');

    return {
      success: true,
      jobId: job.id,
      portal: adapter.name,
      supportLevel: adapter.getSupportLevel(),
      fieldsFilled: fillResult.fieldsFilled,
      verification: fillResult.verification,
      resumePdfPath: pdfPath,
      barrier: barrierCheck.hasBarrier ? barrierCheck : null,
      browser,
      page
    };
  } catch (err) {
    console.error('[Form Assistant Error]:', err.message);
    return {
      success: false,
      error: err.message,
      browser,
      page
    };
  }
}

export async function autoFillApplicationForm(page, profile, pdfPath, options = {}) {
  const currentUrl = page.url() || '';
  const adapter = options.adapter || getPortalAdapter(currentUrl);

  // Inject helper notification banner at top of page
  await page.evaluate(() => {
    if (document.getElementById('careeros-assistant-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'careeros-assistant-banner';
    banner.style.position = 'fixed';
    banner.style.top = '0';
    banner.style.left = '0';
    banner.style.right = '0';
    banner.style.backgroundColor = '#1e3a8a';
    banner.style.color = '#ffffff';
    banner.style.padding = '10px 16px';
    banner.style.fontSize = '13px';
    banner.style.fontWeight = '600';
    banner.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    banner.style.zIndex = '999999';
    banner.style.display = 'flex';
    banner.style.justifyContent = 'space-between';
    banner.style.alignItems = 'center';
    banner.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    banner.innerHTML = `
      <span>🎯 <strong>CareerOS Assistant:</strong> Verified profile details pre-filled. Human review required — click Submit manually when ready.</span>
      <button style="background: rgba(255,255,255,0.2); border: 1px solid #fff; color: #fff; padding: 2px 8px; border-radius: 4px; cursor: pointer;" onclick="this.parentElement.remove()">Dismiss Banner</button>
    `;
    document.body.prepend(banner);
  }).catch(() => {});

  const mappedData = adapter.mapProfileToFields(profile);

  // Execute adapter filling
  const fillResult = await adapter.fill(page, mappedData, {
    resumePdfPath: pdfPath,
    screeningAnswers: options.screeningAnswers || {}
  });

  return {
    fieldsFilled: fillResult.fieldsFilledCount || (fillResult.filledFields ? fillResult.filledFields.length : 0),
    filledFields: fillResult.filledFields || [],
    verification: fillResult.verification || [],
    portal: adapter.name
  };
}

export function detectPortalType(url) {
  const adapter = getPortalAdapter(url);
  return adapter.name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
