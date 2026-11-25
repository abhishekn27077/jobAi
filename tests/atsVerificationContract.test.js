import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { BasePortalAdapter } from '../src/automation/portalAdapters/baseAdapter.js';
import { GreenhouseAdapter } from '../src/automation/portalAdapters/greenhouseAdapter.js';
import { LeverAdapter } from '../src/automation/portalAdapters/leverAdapter.js';
import { AshbyAdapter } from '../src/automation/portalAdapters/ashbyAdapter.js';
import { SmartRecruitersAdapter } from '../src/automation/portalAdapters/smartRecruitersAdapter.js';
import { WorkdayAdapter } from '../src/automation/portalAdapters/workdayAdapter.js';
import { GenericAdapter } from '../src/automation/portalAdapters/genericAdapter.js';
import { launchFormAssistant } from '../src/automation/formAssistant.js';
import { getDatabase } from '../src/db/schema.js';
import { getApplicationByJobId } from '../src/tracker/applicationTracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function launchTestBrowser() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    try {
      return await chromium.launch({ channel: 'msedge', headless: true });
    } catch {
      return await chromium.launch({ headless: true });
    }
  }
}

test('BasePortalAdapter implements standard VERIFIED, MISMATCH, UNSUPPORTED verification contract across all inputs', async () => {
  const dummyFile = path.join(__dirname, 'dummy_contract_test.pdf');
  fs.writeFileSync(dummyFile, 'dummy content', 'utf-8');

  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage();
    const testHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <input id="name_input" value="Abhishek N" />
          <input id="email_input" value="wrong_email@example.com" />
          <textarea id="cover_notes">Experienced in Java Spring Boot development.</textarea>
          <select id="country_select">
            <option value="IN" selected>India</option>
            <option value="US">United States</option>
          </select>
          <input type="checkbox" id="auth_checkbox" checked />
          <input type="checkbox" id="unauthorized_checkbox" />
          <input type="file" id="resume_upload" />
        </body>
      </html>
    `;
    await page.setContent(testHtml);

    // Attach file to resume_upload
    const fileEl = await page.$('#resume_upload');
    await fileEl.setInputFiles(dummyFile);

    const adapter = new BasePortalAdapter('TestAdapter');

    const filledItems = [
      { field: 'Full Name', selector: '#name_input', value: 'Abhishek N' },
      { field: 'Email Address', selector: '#email_input', value: 'abhishek@example.com' },
      { field: 'Notes', selector: '#cover_notes', value: 'Experienced in Java Spring Boot development.' },
      { field: 'Country', selector: '#country_select', value: 'India' },
      { field: 'Work Authorization', selector: '#auth_checkbox', value: 'true' },
      { field: 'Failed Authorization', selector: '#unauthorized_checkbox', value: 'true' },
      { field: 'Resume File', selector: '#resume_upload', value: 'dummy_contract_test.pdf' },
      { field: 'Mismatched Resume File', selector: '#resume_upload', value: 'different_resume.pdf' },
      { field: 'Missing Field', selector: '#does_not_exist', value: 'Some Value' },
      { field: 'No Selector Field', selector: null, value: 'Custom Answer' }
    ];

    const results = await adapter.verifyFilledFields(page, filledItems);

    assert.strictEqual(results.length, 10);

    // 1. Text exact match -> VERIFIED
    const nameResult = results.find(r => r.field === 'Full Name');
    assert.strictEqual(nameResult.status, 'VERIFIED');
    assert.strictEqual(nameResult.actual, 'Abhishek N');

    // 2. Text conflict -> MISMATCH
    const emailResult = results.find(r => r.field === 'Email Address');
    assert.strictEqual(emailResult.status, 'MISMATCH');
    assert.strictEqual(emailResult.actual, 'wrong_email@example.com');

    // 3. Textarea match -> VERIFIED
    const notesResult = results.find(r => r.field === 'Notes');
    assert.strictEqual(notesResult.status, 'VERIFIED');

    // 4. Select match -> VERIFIED
    const countryResult = results.find(r => r.field === 'Country');
    assert.strictEqual(countryResult.status, 'VERIFIED');

    // 5. Checkbox true match -> VERIFIED
    const authResult = results.find(r => r.field === 'Work Authorization');
    assert.strictEqual(authResult.status, 'VERIFIED');

    // 6. Checkbox mismatch -> MISMATCH
    const unauthResult = results.find(r => r.field === 'Failed Authorization');
    assert.strictEqual(unauthResult.status, 'MISMATCH');

    // 7. Attached file match -> VERIFIED
    const fileResult = results.find(r => r.field === 'Resume File');
    assert.strictEqual(fileResult.status, 'VERIFIED');

    // 8. Attached file name conflict -> MISMATCH
    const fileMismatchResult = results.find(r => r.field === 'Mismatched Resume File');
    assert.strictEqual(fileMismatchResult.status, 'MISMATCH');

    // 9. Missing DOM element -> UNSUPPORTED (Never reported as VERIFIED)
    const missingResult = results.find(r => r.field === 'Missing Field');
    assert.strictEqual(missingResult.status, 'UNSUPPORTED');
    assert.notStrictEqual(missingResult.status, 'VERIFIED');

    // 10. No selector -> UNSUPPORTED (Never reported as VERIFIED)
    const noSelectorResult = results.find(r => r.field === 'No Selector Field');
    assert.strictEqual(noSelectorResult.status, 'UNSUPPORTED');
    assert.notStrictEqual(noSelectorResult.status, 'VERIFIED');
  } finally {
    if (browser) await browser.close();
    if (fs.existsSync(dummyFile)) fs.unlinkSync(dummyFile);
  }
});

test('Portal adapters inherit unified verifyFilledFields verification contract', () => {
  const greenhouse = new GreenhouseAdapter();
  const lever = new LeverAdapter();
  const ashby = new AshbyAdapter();
  const smart = new SmartRecruitersAdapter();
  const workday = new WorkdayAdapter();
  const generic = new GenericAdapter();

  assert.strictEqual(typeof greenhouse.verifyFilledFields, 'function');
  assert.strictEqual(typeof lever.verifyFilledFields, 'function');
  assert.strictEqual(typeof ashby.verifyFilledFields, 'function');
  assert.strictEqual(typeof smart.verifyFilledFields, 'function');
  assert.strictEqual(typeof workday.verifyFilledFields, 'function');
  assert.strictEqual(typeof generic.verifyFilledFields, 'function');
});
