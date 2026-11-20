import { BasePortalAdapter } from './baseAdapter.js';
import fs from 'node:fs';
import path from 'node:path';

export class AshbyAdapter extends BasePortalAdapter {
  constructor() {
    super('Ashby', 'supported');
  }

  canHandle(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    return u.includes('ashbyhq.com') || u.includes('jobs.ashbyhq.com');
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

    // 1. Ashby Form Selectors
    await tryFill(['input[name*="name" i]', 'input[autocomplete="name"]', 'input[placeholder*="Name" i]'], mappedData.fullName, 'Full Name');
    await tryFill(['input[type="email"]', 'input[name*="email" i]'], mappedData.email, 'Email');
    await tryFill(['input[type="tel"]', 'input[name*="phone" i]'], mappedData.phone, 'Phone');

    // 2. Links
    await tryFill(['input[name*="linkedin" i]', 'input[placeholder*="linkedin" i]'], mappedData.linkedIn, 'LinkedIn URL');
    await tryFill(['input[name*="github" i]', 'input[placeholder*="github" i]'], mappedData.gitHub, 'GitHub URL');
    await tryFill(['input[name*="portfolio" i]', 'input[placeholder*="portfolio" i]', 'input[placeholder*="website" i]'], mappedData.portfolio, 'Portfolio URL');

    // 3. Location
    await tryFill(['input[name*="location" i]', 'input[placeholder*="Location" i]', 'input[name*="city" i]'], mappedData.location, 'Location');

    // 4. Resume Attachment
    if (resumePdfPath && fs.existsSync(resumePdfPath)) {
      try {
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.setInputFiles(resumePdfPath);
          filled.push({ field: 'Resume File', selector: 'input[type="file"]', value: path.basename(resumePdfPath) });
        }
      } catch (err) {
        unverified.push({ field: 'Resume Attachment', error: err.message });
      }
    }

    // 5. Verification read-back
    const verification = await this.verifyFilledFields(page, filled);

    return {
      portal: 'Ashby',
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
