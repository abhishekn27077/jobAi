import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCandidateProfile } from '../profile/profileManager.js';
import { exportTailoredDocumentsForJob } from '../resumes/resumeGenerator.js';
import { getDatabase } from '../db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function launchFormAssistant(job, options = {}) {
  const profile = loadCandidateProfile();
  const db = getDatabase();

  console.log(`\n[Form Assistant] Preparing application for: "${job.title}" @ "${job.company}"`);
  console.log(`[Form Assistant] Target URL: ${job.url}`);

  // 1. Ensure Tailored Resume PDF is ready
  console.log('[Form Assistant] Generating tailored ATS resume PDF...');
  const docs = await exportTailoredDocumentsForJob(job);
  const pdfPath = docs.resumePdfPath;

  // 2. Launch Visible Google Chrome
  console.log('[Form Assistant] Launching visible Chrome browser (Human-in-the-Loop)...');
  let browser;
  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: ['--start-maximized']
    });
  } catch {
    browser = await chromium.launch({
      channel: 'msedge',
      headless: false,
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

  // 3. Inject Assistant Banner & Auto-Fill Known Fields
  try {
    // Wait for form elements or body
    await page.waitForTimeout(2000);

    const fillResult = await autoFillApplicationForm(page, profile, pdfPath);
    console.log(`[Form Assistant] Auto-filled ${fillResult.fieldsFilled} standard fields.`);

    // 4. Record action in Career Vault
    db.prepare(`
      INSERT INTO applications (job_id, portal_type, resume_version, applied_date, user_approved, notes)
      VALUES (?, ?, ?, datetime('now'), 0, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        resume_version = excluded.resume_version,
        notes = excluded.notes,
        created_at = datetime('now')
    `).run(
      job.id,
      detectPortalType(job.url),
      path.basename(pdfPath),
      `Form Assistant launched. Resume: ${path.basename(pdfPath)}`
    );

    db.prepare(`
      INSERT INTO activity_audit_log (action, details)
      VALUES (?, ?)
    `).run(
      'FORM_ASSISTANT_LAUNCHED',
      `Launched Playwright form assistant for Job #${job.id} (${job.title} @ ${job.company}). Pre-filled ${fillResult.fieldsFilled} fields.`
    );

    // Update job status to 'ready_to_apply'
    db.prepare(`UPDATE jobs SET status = 'ready_to_apply', updated_at = datetime('now') WHERE id = ?`).run(job.id);

    console.log('\n================================================================');
    console.log('✅ Form Assistant is standing by in your open Chrome browser!');
    console.log('👉 Please review the pre-filled fields, answer custom questions,');
    console.log('   and click "Submit Application" when you are satisfied.');
    console.log('================================================================\n');

    return {
      success: true,
      jobId: job.id,
      fieldsFilled: fillResult.fieldsFilled,
      resumePdfPath: pdfPath,
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

export async function autoFillApplicationForm(page, profile, pdfPath) {
  const p = profile.personal;
  let fieldsFilled = 0;

  // Inject helper notification banner at top of page
  await page.evaluate(() => {
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
      <span>🎯 <strong>CareerOS Assistant:</strong> Verified profile details pre-filled. Review inputs & submit manually.</span>
      <button style="background: rgba(255,255,255,0.2); border: 1px solid #fff; color: #fff; padding: 2px 8px; border-radius: 4px; cursor: pointer;" onclick="this.parentElement.remove()">Dismiss Banner</button>
    `;
    document.body.prepend(banner);
  }).catch(() => {});

  // Field selector heuristics mapping to verified profile data
  const fieldMappings = [
    {
      selectors: ['input[name*="first_name" i]', 'input[id*="first_name" i]', 'input[autocomplete="given-name"]'],
      value: p.fullName.split(' ')[0]
    },
    {
      selectors: ['input[name*="last_name" i]', 'input[id*="last_name" i]', 'input[autocomplete="family-name"]'],
      value: p.fullName.split(' ').slice(1).join(' ') || p.fullName
    },
    {
      selectors: ['input[name="name" i]', 'input[id="name" i]', 'input[name*="full_name" i]', 'input[id*="full_name" i]', 'input[autocomplete="name"]'],
      value: p.fullName
    },
    {
      selectors: ['input[type="email"]', 'input[name*="email" i]', 'input[id*="email" i]', 'input[autocomplete="email"]'],
      value: p.email
    },
    {
      selectors: ['input[type="tel"]', 'input[name*="phone" i]', 'input[id*="phone" i]', 'input[name*="mobile" i]', 'input[autocomplete="tel"]'],
      value: p.phone
    },
    {
      selectors: ['input[name*="linkedin" i]', 'input[id*="linkedin" i]', 'input[placeholder*="linkedin" i]'],
      value: p.linkedIn
    },
    {
      selectors: ['input[name*="github" i]', 'input[id*="github" i]', 'input[placeholder*="github" i]'],
      value: p.gitHub
    },
    {
      selectors: ['input[name*="portfolio" i]', 'input[name*="website" i]', 'input[id*="website" i]', 'input[placeholder*="website" i]'],
      value: p.portfolio
    },
    {
      selectors: ['input[name*="city" i]', 'input[id*="city" i]', 'input[name*="location" i]', 'input[id*="location" i]'],
      value: 'Bangalore, India'
    }
  ];

  for (const mapping of fieldMappings) {
    for (const selector of mapping.selectors) {
      try {
        const el = await page.$(selector);
        if (el && await el.isVisible()) {
          const currentVal = await el.inputValue().catch(() => '');
          if (!currentVal) {
            await el.fill(mapping.value);
            fieldsFilled++;
            break; // Stop after filling first matching selector for this field
          }
        }
      } catch {}
    }
  }

  // Handle Resume File Input
  try {
    const fileInputs = await page.$$('input[type="file"]');
    if (fileInputs.length > 0 && fs.existsSync(pdfPath)) {
      // Find file input that mentions resume or CV
      let resumeInput = fileInputs[0];
      for (const fi of fileInputs) {
        const nameAttr = await fi.getAttribute('name') || '';
        const idAttr = await fi.getAttribute('id') || '';
        if (/resume|cv/i.test(nameAttr + idAttr)) {
          resumeInput = fi;
          break;
        }
      }
      await resumeInput.setInputFiles(pdfPath);
      fieldsFilled++;
      console.log(`[Form Assistant] Attached tailored resume: ${path.basename(pdfPath)}`);
    }
  } catch (err) {
    console.warn(`[Form Assistant Notice]: Could not auto-attach file input (${err.message})`);
  }

  return { fieldsFilled };
}

function detectPortalType(url) {
  if (!url) return 'direct';
  const u = url.toLowerCase();
  if (u.includes('greenhouse.io')) return 'greenhouse';
  if (u.includes('lever.co')) return 'lever';
  if (u.includes('myworkdayjobs.com') || u.includes('workday')) return 'workday';
  if (u.includes('smartrecruiters.com')) return 'smartrecruiters';
  if (u.includes('ashbyhq.com')) return 'ashby';
  if (u.includes('freshteam.com')) return 'freshteam';
  if (u.includes('zohorecruit.com') || u.includes('zohorecruit.in')) return 'zoho';
  if (u.includes('cutshort.io')) return 'cutshort';
  if (u.includes('hirist.tech')) return 'hirist';
  if (u.includes('instahyre.com')) return 'instahyre';
  return 'direct';
}
