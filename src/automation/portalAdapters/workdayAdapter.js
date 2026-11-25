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
        } catch { }
      }
      return false;
    };

    // Standard Workday data-automation-id or input fields if accessible
    await tryFill(['input[data-automation-id*="legalNameSection_firstName"]', 'input[id*="input-1"]'], mappedData.firstName, 'First Name');
    await tryFill(['input[data-automation-id*="legalNameSection_lastName"]', 'input[id*="input-2"]'], mappedData.lastName, 'Last Name');
    await tryFill(['input[data-automation-id*="email"]', 'input[type="email"]'], mappedData.email, 'Email');
    await tryFill(['input[data-automation-id*="phone"]', 'input[type="tel"]'], mappedData.phone, 'Phone');
    await tryFill(['input[data-automation-id*="linkedin" i]', 'input[id*="linkedin" i]'], mappedData.linkedIn, 'LinkedIn');
    await tryFill(['input[data-automation-id*="website" i]', 'input[data-automation-id*="portfolio" i]'], mappedData.portfolio, 'Portfolio');
    await tryFill(['input[data-automation-id*="addressSection_city" i]', 'input[id*="city" i]'], mappedData.city, 'City');

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

    // Custom Screening Questions (Matched by Label or Name)
    if (screeningAnswers && typeof screeningAnswers === 'object') {
      for (const [qKey, answerData] of Object.entries(screeningAnswers)) {
        const val = typeof answerData === 'string' ? answerData : answerData.answer;
        if (!val) continue;

        try {
          const matchedEl = await page.evaluateHandle((query) => {
            const labels = Array.from(document.querySelectorAll('label, [data-automation-id*="label"]'));
            for (const lbl of labels) {
              if (lbl.innerText.toLowerCase().includes(query.toLowerCase())) {
                const targetId = lbl.getAttribute('for');
                if (targetId) return document.getElementById(targetId);
                return lbl.querySelector('input, textarea, select') || lbl.nextElementSibling?.querySelector('input, textarea, select');
              }
            }
            return null;
          }, qKey);

          if (matchedEl && await matchedEl.asElement()) {
            const el = matchedEl.asElement();
            const tag = await el.evaluate(e => e.tagName.toLowerCase());
            if (tag === 'textarea' || tag === 'input') {
              await el.fill(val);
              const elSelector = await el.evaluate(e => {
                if (e.id) return `#${e.id}`;
                if (e.name) return `[name="${e.name}"]`;
                return null;
              }).catch(() => null);
              filled.push({ field: `Screening: ${qKey}`, selector: elSelector, value: val });
            }
          }
        } catch {}
      }
    }

    // Verification read-back
    const verification = await this.verifyFilledFields(page, filled);

    return {
      portal: 'Workday',
      supportLevel: 'partially_supported',
      fieldsFilledCount: filled.length,
      filledFields: filled,
      verification,
      unverified,
      instructions: 'Workday multi-stage applications require manual step verification for each page.'
    };
  }
}

