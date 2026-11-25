import { BasePortalAdapter } from './baseAdapter.js';
import fs from 'node:fs';
import path from 'node:path';

export class GenericAdapter extends BasePortalAdapter {
  constructor() {
    super('Generic ATS / Career Page', 'partially_supported');
  }

  canHandle(url) {
    return true; // Fallback catch-all adapter
  }

  async fill(page, mappedData, { resumePdfPath = null, screeningAnswers = {} } = {}) {
    const filled = [];
    const unverified = [];

    const fieldMappings = [
      {
        name: 'First Name',
        selectors: ['input[name*="first_name" i]', 'input[id*="first_name" i]', 'input[name*="firstName" i]', 'input[autocomplete="given-name"]'],
        value: mappedData.firstName
      },
      {
        name: 'Last Name',
        selectors: ['input[name*="last_name" i]', 'input[id*="last_name" i]', 'input[name*="lastName" i]', 'input[autocomplete="family-name"]'],
        value: mappedData.lastName
      },
      {
        name: 'Full Name',
        selectors: ['input[name="name" i]', 'input[id="name" i]', 'input[name*="full_name" i]', 'input[id*="full_name" i]', 'input[autocomplete="name"]'],
        value: mappedData.fullName
      },
      {
        name: 'Email',
        selectors: ['input[type="email"]', 'input[name*="email" i]', 'input[id*="email" i]', 'input[autocomplete="email"]'],
        value: mappedData.email
      },
      {
        name: 'Phone',
        selectors: ['input[type="tel"]', 'input[name*="phone" i]', 'input[id*="phone" i]', 'input[name*="mobile" i]', 'input[autocomplete="tel"]'],
        value: mappedData.phone
      },
      {
        name: 'LinkedIn URL',
        selectors: ['input[name*="linkedin" i]', 'input[id*="linkedin" i]', 'input[placeholder*="linkedin" i]'],
        value: mappedData.linkedIn
      },
      {
        name: 'GitHub URL',
        selectors: ['input[name*="github" i]', 'input[id*="github" i]', 'input[placeholder*="github" i]'],
        value: mappedData.gitHub
      },
      {
        name: 'Portfolio / Website',
        selectors: ['input[name*="portfolio" i]', 'input[name*="website" i]', 'input[id*="website" i]'],
        value: mappedData.portfolio
      },
      {
        name: 'Location / City',
        selectors: ['input[name*="city" i]', 'input[id*="city" i]', 'input[name*="location" i]'],
        value: mappedData.city
      }
    ];

    for (const mapping of fieldMappings) {
      if (!mapping.value) continue;
      for (const selector of mapping.selectors) {
        try {
          const el = await page.$(selector);
          if (el && await el.isVisible()) {
            const currentVal = await el.inputValue().catch(() => '');
            if (!currentVal) {
              await el.fill(mapping.value);
              filled.push({ field: mapping.name, selector, value: mapping.value });
              break;
            }
          }
        } catch {}
      }
    }

    // Resume Attachment
    if (resumePdfPath && fs.existsSync(resumePdfPath)) {
      try {
        const fileInputs = await page.$$('input[type="file"]');
        if (fileInputs.length > 0) {
          let resumeInput = fileInputs[0];
          for (const fi of fileInputs) {
            const nameAttr = await fi.getAttribute('name') || '';
            const idAttr = await fi.getAttribute('id') || '';
            if (/resume|cv/i.test(nameAttr + idAttr)) {
              resumeInput = fi;
              break;
            }
          }
          await resumeInput.setInputFiles(resumePdfPath);
          filled.push({ field: 'Resume File', selector: 'input[type="file"]', value: path.basename(resumePdfPath) });
        }
      } catch (err) {
        unverified.push({ field: 'Resume Attachment', error: err.message });
      }
    }

    const verification = await this.verifyFilledFields(page, filled);

    return {
      portal: 'Generic ATS',
      supportLevel: 'partially_supported',
      fieldsFilledCount: filled.length,
      filledFields: filled,
      verification,
      unverified
    };
  }
}
