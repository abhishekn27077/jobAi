import { BasePortalAdapter } from './baseAdapter.js';
import fs from 'node:fs';
import path from 'node:path';

export class LeverAdapter extends BasePortalAdapter {
  constructor() {
    super('Lever', 'supported');
  }

  canHandle(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    return u.includes('jobs.lever.co') || u.includes('lever.co');
  }

  async fill(page, mappedData, { resumePdfPath = null, screeningAnswers = {} } = {}) {
    const filled = [];
    const unverified = [];

    const tryFill = async (selectors, value, fieldName) => {
      if (!value) return false;
      for (const sel of selectors) {
        try {
          const el = await page.$(sel);
          if (el && await el.isVisible()) {
            await el.fill(value);
            filled.push({ field: fieldName, selector: sel, value });
            return true;
          }
        } catch {}
      }
      return false;
    };

    // 1. Lever Standard Field Selectors
    await tryFill(['input[name="name"]', '#name', 'input[autocomplete="name"]'], mappedData.fullName, 'Full Name');
    await tryFill(['input[name="email"]', '#email', 'input[type="email"]'], mappedData.email, 'Email');
    await tryFill(['input[name="phone"]', '#phone', 'input[type="tel"]'], mappedData.phone, 'Phone');
    await tryFill(['input[name="org"]', 'input[name*="company" i]'], mappedData.currentCompany, 'Current Company');

    // 2. URLs (LinkedIn, GitHub, Portfolio)
    await tryFill(['input[name="urls[LinkedIn]"]', 'input[name*="linkedin" i]'], mappedData.linkedIn, 'LinkedIn URL');
    await tryFill(['input[name="urls[GitHub]"]', 'input[name*="github" i]'], mappedData.gitHub, 'GitHub URL');
    await tryFill(['input[name="urls[Portfolio]"]', 'input[name*="portfolio" i]', 'input[name*="website" i]'], mappedData.portfolio, 'Portfolio URL');

    // 3. Location / City
    await tryFill(['input[name*="location" i]', 'input[id*="location" i]'], mappedData.location, 'Location');

    // 4. Resume Attachment
    if (resumePdfPath && fs.existsSync(resumePdfPath)) {
      try {
        const fileInput = await page.$('input[name="resume"], input[type="file"]');
        if (fileInput) {
          await fileInput.setInputFiles(resumePdfPath);
          filled.push({ field: 'Resume File', selector: 'input[name="resume"]', value: path.basename(resumePdfPath) });
        }
      } catch (err) {
        unverified.push({ field: 'Resume Attachment', error: err.message });
      }
    }

    // 5. Custom Questions in Lever (.application-question)
    if (screeningAnswers && typeof screeningAnswers === 'object') {
      for (const [qKey, answerData] of Object.entries(screeningAnswers)) {
        const val = typeof answerData === 'string' ? answerData : answerData.answer;
        if (!val) continue;

        try {
          const targetInput = await page.evaluateHandle((query) => {
            const questions = Array.from(document.querySelectorAll('.application-question, .custom-question, .field'));
            for (const q of questions) {
              if (q.innerText.toLowerCase().includes(query.toLowerCase())) {
                return q.querySelector('textarea, input[type="text"]');
              }
            }
            return null;
          }, qKey);

          if (targetInput && await targetInput.asElement()) {
            await targetInput.asElement().fill(val);
            filled.push({ field: `Screening: ${qKey}`, value: val });
          }
        } catch {}
      }
    }

    // 6. Read back and verify filled fields
    const verification = await this.verifyFilledFields(page, filled);

    return {
      portal: 'Lever',
      fieldsFilledCount: filled.length,
      filledFields: filled,
      verification,
      unverified
    };
  }

  async verifyFilledFields(page, filledItems) {
    const verified = [];
    for (const item of filledItems) {
      if (!item.selector || item.field === 'Resume File') {
        verified.push({ field: item.field, status: 'verified_present', value: item.value });
        continue;
      }
      try {
        const actualValue = await page.$eval(item.selector, el => el.value || '').catch(() => null);
        const matches = actualValue !== null && (actualValue.trim() === item.value.trim() || item.value.includes(actualValue));
        verified.push({
          field: item.field,
          status: matches ? 'verified_match' : 'mismatch',
          expected: item.value,
          actual: actualValue
        });
      } catch (e) {
        verified.push({ field: item.field, status: 'unverifiable', error: e.message });
      }
    }
    return verified;
  }
}
