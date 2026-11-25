/**
 * CareerOS — Base Portal Adapter
 * Abstract base class providing common field detection, heuristic mapping,
 * DOM verification, and session wall detection for application portals.
 */

import path from 'node:path';

export class BasePortalAdapter {
  constructor(name, supportLevel = 'supported') {
    this.name = name;
    this.supportLevel = supportLevel; // 'supported' | 'partially_supported' | 'unsupported'
  }

  canHandle(url) {
    return false;
  }

  getSupportLevel() {
    return this.supportLevel;
  }

  /**
   * Detects login walls, session expirations, or SSO requirements.
   */
  async detectSessionOrAuthBarrier(page) {
    try {
      const pageText = await page.evaluate(() => document.body ? document.body.innerText.toLowerCase() : '').catch(() => '');
      const url = page.url().toLowerCase();

      const isSessionExpiry = /session.*(expired|timed?\s*out)|(expired|timed?\s*out).*session/i.test(pageText);
      const isLoginWall = url.includes('/login') ||
        url.includes('/signin') ||
        url.includes('/auth') ||
        pageText.includes('sign in to your account') ||
        pageText.includes('please log in to apply') ||
        isSessionExpiry;

      if (isLoginWall) {
        const bType = isSessionExpiry ? 'session_expired' : 'authentication_required';
        return {
          hasBarrier: true,
          type: bType,
          barrierType: bType,
          message: isSessionExpiry
            ? 'Application session has expired or timed out. Please refresh or re-authenticate in the browser.'
            : 'The employer portal requires candidate login or session authentication. Please log in to your account in the browser, then continue.'
        };
      }

      // Check for bot challenges or CAPTCHA
      const hasCaptcha = pageText.includes('cf-browser-verification') ||
        pageText.includes('verify you are human') ||
        pageText.includes('turnstile') ||
        pageText.includes('recaptcha') ||
        pageText.includes('hcaptcha');

      if (hasCaptcha) {
        return {
          hasBarrier: true,
          type: 'captcha_challenge',
          message: 'A security verification or CAPTCHA challenge is active. Complete the challenge manually in the open browser.'
        };
      }

      return { hasBarrier: false };
    } catch (e) {
      return { hasBarrier: false, error: e.message };
    }
  }

  /**
   * Scans DOM to identify form fields and classification categories.
   */
  async identifyFields(page) {
    return await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
      return inputs.map(el => {
        const type = el.getAttribute('type') || el.tagName.toLowerCase();
        const name = el.getAttribute('name') || '';
        const id = el.getAttribute('id') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const required = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';

        // Find associated label text if present
        let labelText = '';
        if (id) {
          const lbl = document.querySelector(`label[for="${id}"]`);
          if (lbl) labelText = lbl.innerText.trim();
        }
        if (!labelText && el.closest('label')) {
          labelText = el.closest('label').innerText.trim();
        }

        return {
          tagName: el.tagName.toLowerCase(),
          type,
          name,
          id,
          placeholder,
          ariaLabel,
          labelText,
          required
        };
      });
    });
  }

  /**
   * Maps profile evidence to standard fields.
   */
  mapProfileToFields(profile) {
    const p = profile.personal;
    const s = profile.status || {};

    const fullName = p.fullName || 'Candidate';
    const names = fullName.trim().split(/\s+/);
    const firstName = names[0];
    const lastName = names.slice(1).join(' ') || firstName;

    return {
      firstName,
      lastName,
      fullName,
      email: p.email,
      phone: p.phone,
      city: p.location ? p.location.split(',')[0].trim() : 'Bangalore',
      location: p.location || 'Bangalore, Karnataka, India',
      linkedIn: p.linkedIn || '',
      gitHub: p.gitHub || '',
      portfolio: p.portfolio || '',
      currentCompany: 'Anudip Foundation (Intern)',
      education: profile.education && profile.education[0] ? `${profile.education[0].degree}, ${profile.education[0].institution}` : 'MCA, AIMS Institutes',
      workAuthorization: s.workAuthorization || 'Citizen of India',
      requiresSponsorship: 'No'
    };
  }

  /**
   * Fills form fields safely. Never touches submit buttons or legal consent checkboxes.
   */
  async fill(page, mappedData, options = {}) {
    throw new Error('fill() must be implemented by subclass');
  }

  /**
   * Common ATS Field Read-Back Verification Contract (Phase 9.2):
   * Inspects active DOM elements and returns standardized verification outcomes:
   *  - 'VERIFIED': DOM element was inspected and its value matches expected profile value.
   *  - 'MISMATCH': DOM element has a value that conflicts with the expected profile value.
   *  - 'UNSUPPORTED': Field cannot be reliably read back or inspected in DOM.
   */
  async verifyFilledFields(page, filledItems = []) {
    const verified = [];
    for (const item of filledItems) {
      if (!item.selector) {
        verified.push({
          field: item.field,
          status: 'UNSUPPORTED',
          legacyStatus: 'unverifiable',
          expected: item.value,
          actual: null,
          reason: 'No DOM selector available for field read-back'
        });
        continue;
      }

      // 1. File input inspection
      if (item.field === 'Resume File' || item.selector.includes('type="file"')) {
        try {
          const fileInfo = await page.$eval(item.selector, el => {
            if (el.files && el.files.length > 0) {
              return { attached: true, name: el.files[0].name };
            }
            return { attached: false, name: '' };
          }).catch(() => null);

          if (fileInfo && fileInfo.attached) {
            const expFile = path.basename(String(item.value || ''));
            const isMatch = !expFile || fileInfo.name === expFile || fileInfo.name.includes(expFile) || expFile.includes(fileInfo.name);
            verified.push({
              field: item.field,
              status: isMatch ? 'VERIFIED' : 'MISMATCH',
              legacyStatus: isMatch ? 'verified_match' : 'mismatch',
              expected: expFile,
              actual: fileInfo.name,
              reason: isMatch ? 'File confirmed attached in DOM' : `Attached file "${fileInfo.name}" in DOM does not match expected file "${expFile}"`
            });
          } else {
            verified.push({
              field: item.field,
              status: 'UNSUPPORTED',
              legacyStatus: 'unverifiable',
              expected: item.value,
              actual: null,
              reason: 'File input DOM does not expose attached file details directly'
            });
          }
        } catch (e) {
          verified.push({
            field: item.field,
            status: 'UNSUPPORTED',
            legacyStatus: 'unverifiable',
            expected: item.value,
            actual: null,
            reason: `DOM file inspection unsupported: ${e.message}`
          });
        }
        continue;
      }

      // 2. Text, email, tel, select, textarea, checkbox inputs
      try {
        const actualValue = await page.$eval(item.selector, el => {
          if (el.tagName === 'SELECT') {
            const opt = el.options[el.selectedIndex];
            return opt ? (opt.text || opt.value || '') : '';
          }
          if (el.type === 'checkbox' || el.type === 'radio') {
            return el.checked ? 'true' : 'false';
          }
          return el.value !== undefined ? el.value : (el.innerText || '');
        }).catch(() => null);

        if (actualValue === null) {
          verified.push({
            field: item.field,
            status: 'UNSUPPORTED',
            legacyStatus: 'unverifiable',
            expected: item.value,
            actual: null,
            reason: 'Target element could not be queried in active DOM'
          });
          continue;
        }

        const expStr = String(item.value || '').trim();
        const actStr = String(actualValue).trim();

        let matches = false;
        if (actStr === 'true' || actStr === 'false') {
          const expBool = /^(true|yes|1|checked)$/i.test(expStr);
          const actBool = actStr === 'true';
          matches = expBool === actBool;
        } else {
          // Exact match or substring containment for URLs/composite strings
          matches = actStr === expStr ||
            (expStr.length > 0 && actStr.length > 0 && (expStr.includes(actStr) || actStr.includes(expStr)));
        }

        verified.push({
          field: item.field,
          status: matches ? 'VERIFIED' : 'MISMATCH',
          legacyStatus: matches ? 'verified_match' : 'mismatch',
          expected: expStr,
          actual: actStr,
          ...(matches ? {} : { reason: `Read-back value in DOM ("${actStr}") does not match expected profile value ("${expStr}")` })
        });
      } catch (e) {
        verified.push({
          field: item.field,
          status: 'UNSUPPORTED',
          legacyStatus: 'unverifiable',
          expected: item.value,
          actual: null,
          reason: e.message
        });
      }
    }
    return verified;
  }
}

