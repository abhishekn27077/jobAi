import { BasePortalAdapter } from './baseAdapter.js';
import fs from 'node:fs';
import path from 'node:path';

export class GreenhouseAdapter extends BasePortalAdapter {
  constructor() {
    super('Greenhouse', 'supported');
  }

  canHandle(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    return u.includes('greenhouse.io') || u.includes('boards.greenhouse.io') || u.includes('gh_jid=');
  }

  async fill(page, mappedData, { resumePdfPath = null, screeningAnswers = {} } = {}) {
    const filled = [];
    const unverified = [];

    // Helper to safely fill an input if it exists
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

    // 1. Standard Greenhouse Input Selectors
    await tryFill(['#first_name', 'input[name="first_name" i]', 'input[autocomplete="given-name"]'], mappedData.firstName, 'First Name');
    await tryFill(['#last_name', 'input[name="last_name" i]', 'input[autocomplete="family-name"]'], mappedData.lastName, 'Last Name');
    await tryFill(['#email', 'input[name="email" i]', 'input[type="email"]'], mappedData.email, 'Email');
    await tryFill(['#phone', 'input[name="phone" i]', 'input[type="tel"]'], mappedData.phone, 'Phone');

    // 2. Social & Web Profiles
    await tryFill(['#job_application_answers_attributes_0_text_value', 'input[name*="linkedin" i]', 'input[id*="linkedin" i]'], mappedData.linkedIn, 'LinkedIn URL');
    await tryFill(['input[name*="github" i]', 'input[id*="github" i]'], mappedData.gitHub, 'GitHub URL');
    await tryFill(['input[name*="website" i]', 'input[id*="website" i]', 'input[name*="portfolio" i]'], mappedData.portfolio, 'Portfolio URL');

    // 3. Location / City
    await tryFill(['#job_application_location', 'input[name*="location" i]', 'input[id*="location" i]'], mappedData.location, 'Location');

    // 4. Resume Attachment
    if (resumePdfPath && fs.existsSync(resumePdfPath)) {
      try {
        const resumeInput = await page.$('input[type="file"][id*="resume" i], input[type="file"][name*="resume" i], input[type="file"]');
        if (resumeInput) {
          await resumeInput.setInputFiles(resumePdfPath);
          filled.push({ field: 'Resume File', selector: 'input[type="file"]', value: path.basename(resumePdfPath) });
        }
      } catch (err) {
        unverified.push({ field: 'Resume Attachment', error: err.message });
      }
    }

    // 5. Custom Screening Questions (Matched by Label or Name)
    if (screeningAnswers && typeof screeningAnswers === 'object') {
      for (const [qKey, answerData] of Object.entries(screeningAnswers)) {
        const val = typeof answerData === 'string' ? answerData : answerData.answer;
        if (!val) continue;

        // Try to match custom question textareas or text inputs
        try {
          const matchedEl = await page.evaluateHandle((query) => {
            const labels = Array.from(document.querySelectorAll('label, .field-label'));
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

    // 6. Verification read-back
    const verification = await this.verifyFilledFields(page, filled);

    return {
      portal: 'Greenhouse',
      fieldsFilledCount: filled.length,
      filledFields: filled,
      verification,
      unverified
    };
  }
}
