import test from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { autoFillApplicationForm } from '../src/automation/formAssistant.js';
import { loadCandidateProfile } from '../src/profile/profileManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Form Assistant accurately pre-fills HTML application form fields', async () => {
  const profile = loadCandidateProfile();
  const testHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Job Application Form</title></head>
      <body>
        <form id="apply-form">
          <input type="text" name="full_name" placeholder="Full Name" />
          <input type="email" name="email" placeholder="Email Address" />
          <input type="tel" name="phone" placeholder="Phone Number" />
          <input type="text" name="linkedin" placeholder="LinkedIn URL" />
          <input type="text" name="github" placeholder="GitHub Profile" />
          <input type="text" name="city" placeholder="Current City" />
          <input type="file" name="resume_file" />
          <button type="submit">Submit Application</button>
        </form>
      </body>
    </html>
  `;

  // Create temporary dummy PDF for file upload testing
  const dummyPdf = path.join(__dirname, 'dummy_resume.pdf');
  fs.writeFileSync(dummyPdf, 'dummy pdf content', 'utf-8');

  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  }

  try {
    const page = await browser.newPage();
    await page.setContent(testHtml);

    const result = await autoFillApplicationForm(page, profile, dummyPdf);
    assert.ok(result.fieldsFilled >= 6, `Should fill at least 6 fields, filled: ${result.fieldsFilled}`);

    // Verify filled values
    const nameVal = await page.inputValue('input[name="full_name"]');
    assert.strictEqual(nameVal, 'Abhishek N');

    const emailVal = await page.inputValue('input[name="email"]');
    assert.strictEqual(emailVal, profile.personal.email);

    const phoneVal = await page.inputValue('input[name="phone"]');
    assert.strictEqual(phoneVal, profile.personal.phone);

    const linkedInVal = await page.inputValue('input[name="linkedin"]');
    assert.match(linkedInVal, /linkedin\.com/i);

    // Verify safety banner exists
    const banner = await page.$('#careeros-assistant-banner');
    assert.ok(banner, 'Safety banner must be injected');
  } finally {
    if (browser) await browser.close();
    if (fs.existsSync(dummyPdf)) fs.unlinkSync(dummyPdf);
  }
});
