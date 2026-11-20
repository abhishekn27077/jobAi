import { BasePortalAdapter } from './baseAdapter.js';
import fs from 'node:fs';
import path from 'node:path';

export class WorkdayAdapter extends BasePortalAdapter {
  constructor() {
    super('Workday', 'partially_supported');
  }

  canHandle(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    return u.includes('myworkdayjobs.com') || u.includes('workday.com') || u.includes('wd3.myworkday.com');
  }

  async detectSessionOrAuthBarrier(page) {
    // Check for Workday specific account creation / login screens first
    const isWdAuth = await page.evaluate(() => {
      const text = document.body ? document.body.innerText.toLowerCase() : '';
      return text.includes('create account') ||
             text.includes('sign in') ||
             text.includes('autofill with resume') ||
             text.includes('use my last application');
    }).catch(() => false);

    if (isWdAuth) {
      return {
        hasBarrier: true,
        type: 'workday_account_barrier',
        barrierType: 'workday_account_barrier',
        message: 'Workday requires candidate account authentication or account creation before accessing application form fields. Please sign in or create an account in the open browser window.'
      };
    }

    const base = await super.detectSessionOrAuthBarrier(page);
    if (base.hasBarrier) return base;

    return { hasBarrier: false };
  }

  async fill(page, mappedData, { resumePdfPath = null, screeningAnswers = {} } = {}) {
    const filled = [];
    const unverified = [];

    // Check barrier first
    const barrier = await this.detectSessionOrAuthBarrier(page);
    if (barrier.hasBarrier) {
      return {
        portal: 'Workday',
        supportLevel: 'partially_supported',
        fieldsFilledCount: 0,
        filledFields: [],
        barrier,
        instructions: 'Workday requires candidate account sign-in. Use the provided profile values to paste into fields once signed in.'
      };
    }

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

    // Standard Workday data-automation-id or input fields if accessible
    await tryFill(['input[data-automation-id*="legalNameSection_firstName"]', 'input[id*="input-1"]'], mappedData.firstName, 'First Name');
    await tryFill(['input[data-automation-id*="legalNameSection_lastName"]', 'input[id*="input-2"]'], mappedData.lastName, 'Last Name');
    await tryFill(['input[data-automation-id*="email"]', 'input[type="email"]'], mappedData.email, 'Email');
    await tryFill(['input[data-automation-id*="phone"]', 'input[type="tel"]'], mappedData.phone, 'Phone');

    // Resume Attachment if available
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

    return {
      portal: 'Workday',
      supportLevel: 'partially_supported',
      fieldsFilledCount: filled.length,
      filledFields: filled,
      unverified,
      instructions: 'Workday multi-stage applications require manual step verification for each page.'
    };
  }
}

