import { BasePortalAdapter } from './baseAdapter.js';
import fs from 'node:fs';
import path from 'node:path';

export class SmartRecruitersAdapter extends BasePortalAdapter {
  constructor() {
    super('SmartRecruiters', 'supported');
  }

  canHandle(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    return u.includes('smartrecruiters.com') || u.includes('jobs.smartrecruiters.com');
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

    // 1. SmartRecruiters Inputs
    await tryFill(['input[name*="firstName" i]', '#first-name-input', 'input[autocomplete="given-name"]'], mappedData.firstName, 'First Name');
    await tryFill(['input[name*="lastName" i]', '#last-name-input', 'input[autocomplete="family-name"]'], mappedData.lastName, 'Last Name');
    await tryFill(['input[name*="email" i]', '#email-input', 'input[type="email"]'], mappedData.email, 'Email');
    await tryFill(['input[name*="phone" i]', '#phone-number-input', 'input[type="tel"]'], mappedData.phone, 'Phone');
    await tryFill(['input[name*="city" i]', '#city-input', 'input[placeholder*="City" i]'], mappedData.city, 'City');
    await tryFill(['input[name*="linkedin" i]'], mappedData.linkedIn, 'LinkedIn URL');

    // 2. Resume File
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

    const verification = await this.verifyFilledFields(page, filled);

    return {
      portal: 'SmartRecruiters',
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
