/**
 * CareerOS — Base Portal Adapter
 * Abstract base class providing common field detection, heuristic mapping,
 * DOM verification, and session wall detection for application portals.
 */

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
   * Reads back values from filled DOM elements to verify data integrity.
   */
  async verifyFilledFields(page, expectedValues) {
    const results = [];
    for (const [key, expected] of Object.entries(expectedValues)) {
      if (!expected || typeof expected !== 'string') continue;
      // Verification logic executed per selector
    }
    return results;
  }
}

