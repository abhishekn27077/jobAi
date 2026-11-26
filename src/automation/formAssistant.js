import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import dns from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { loadCandidateProfile } from '../profile/profileManager.js';
import { exportTailoredDocumentsForJob } from '../resumes/resumeGenerator.js';
import { getPortalAdapter } from './portalAdapters/portalRegistry.js';
import { generateScreeningAnswers } from './screeningEngine.js';
import { updateApplicationStatus } from '../tracker/applicationTracker.js';
import { getDatabase } from '../db/schema.js';
import { getChromeProfileConfig, openUrlInChromeProfile } from './chromeProfileConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Checks whether an IP address (IPv4 or IPv6) is private, loopback, link-local, or reserved.
 */
export function isPrivateOrLoopbackIp(ipStr) {
  if (!ipStr || typeof ipStr !== 'string') return false;
  let cleanIp = ipStr.trim().replace(/^\[|\]$/g, '').toLowerCase();

  // Handle IPv4-mapped IPv6 (::ffff:x.x.x.x or ::ffff:hhhh:hhhh)
  if (cleanIp.startsWith('::ffff:')) {
    const mapped = cleanIp.slice(7);
    if (mapped.includes('.')) {
      cleanIp = mapped;
    } else {
      const hexParts = mapped.split(':');
      if (hexParts.length === 2) {
        const h1 = parseInt(hexParts[0], 16) || 0;
        const h2 = parseInt(hexParts[1], 16) || 0;
        cleanIp = `${(h1 >> 8) & 0xff}.${h1 & 0xff}.${(h2 >> 8) & 0xff}.${h2 & 0xff}`;
      }
    }
  }

  // IPv4 Evaluation
  const ipv4Match = cleanIp.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [_, o1, o2, o3, o4] = ipv4Match.map(Number);
    if (o1 > 255 || o2 > 255 || o3 > 255 || o4 > 255) return true; // Malformed / out of range

    if (
      o1 === 10 || // 10.0.0.0/8
      (o1 === 172 && o2 >= 16 && o2 <= 31) || // 172.16.0.0/12
      (o1 === 192 && o2 === 168) || // 192.168.0.0/16
      o1 === 127 || // 127.0.0.0/8 (Loopback)
      o1 === 0 || // 0.0.0.0/8
      (o1 === 169 && o2 === 254) || // 169.254.0.0/16 (Link-local / Cloud metadata)
      (o1 === 100 && o2 >= 64 && o2 <= 127) || // 100.64.0.0/10 (Carrier-grade NAT)
      (o1 === 192 && o2 === 0 && o3 === 2) || // 192.0.2.0/24 (TEST-NET-1)
      (o1 === 198 && (o2 === 51 && o3 === 100)) || // 198.51.100.0/24 (TEST-NET-2)
      (o1 === 203 && o2 === 0 && o3 === 113) || // 203.0.113.0/24 (TEST-NET-3)
      (o1 >= 224) // Multicast and Class E reserved
    ) {
      return true;
    }
    return false;
  }

  // IPv6 Evaluation
  const lowerIp = cleanIp.toLowerCase();
  if (
    lowerIp === '::1' || // Loopback
    lowerIp === '::' || // Unspecified
    lowerIp.startsWith('fc') || // Unique Local Address (fc00::/7)
    lowerIp.startsWith('fd') || // Unique Local Address (fd00::/8)
    lowerIp.startsWith('fe8') || // Link-Local (fe80::/10)
    lowerIp.startsWith('fe9') ||
    lowerIp.startsWith('fea') ||
    lowerIp.startsWith('feb') ||
    lowerIp.startsWith('ff') || // Multicast (ff00::/8)
    lowerIp.startsWith('2001:db8:') // Documentation prefix
  ) {
    return true;
  }

  return false;
}

/**
 * Validates target job URL against SSRF and private network access.
 * Prohibits loopback, RFC 1918 private IP ranges, link-local, cloud metadata,
 * IPv6 ULA/link-local/mapped addresses, and dynamic-DNS/internal domains.
 */
export function validateSafeJobUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Invalid Job URL: URL must be a non-empty string.');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid Job URL: Malformed URL "${rawUrl}".`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Security Violation: Protocol "${parsed.protocol}" is not permitted. Only HTTP and HTTPS are allowed.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const cleanHostname = hostname.replace(/^\[|\]$/g, '');

  // 1. Direct host string checks
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname === '::' ||
    hostname === '[::]'
  ) {
    throw new Error(`Security Violation: Access to local network host "${hostname}" is prohibited.`);
  }

  // 2. Reserved & Private domain suffixes and dynamic DNS loopback providers
  const reservedDomains = [
    'localtest.me',
    'nip.io',
    'sslip.io',
    'vcap.me'
  ];

  const reservedSuffixes = [
    '.localhost',
    '.local',
    '.internal',
    '.lan',
    '.corp',
    '.home',
    '.intranet',
    '.test',
    '.example',
    '.invalid',
    '.nip.io',
    '.sslip.io',
    '.localtest.me',
    '.vcap.me'
  ];

  if (
    reservedDomains.includes(hostname) ||
    reservedSuffixes.some(suffix => hostname.endsWith(suffix) || hostname.includes(suffix))
  ) {
    throw new Error(`Security Violation: Hostname "${hostname}" uses a private, internal, or dynamic-DNS resolution domain.`);
  }

  // 3. Cloud metadata and direct IP evaluation
  if (isPrivateOrLoopbackIp(cleanHostname)) {
    throw new Error(`Security Violation: Access to private or loopback network address "${hostname}" is prohibited.`);
  }

  return parsed.toString();
}

/**
 * Asynchronously validates job URL against DNS resolution and private network rebinding.
 */
export async function validateSafeJobUrlAsync(rawUrl) {
  const validUrl = validateSafeJobUrl(rawUrl);
  const parsed = new URL(validUrl);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  // If already verified static IP, skip DNS lookup
  if (hostname.match(/^(\d{1,3}\.){3}\d{1,3}$/) || hostname.includes(':')) {
    return validUrl;
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true });
    for (const record of addresses) {
      if (isPrivateOrLoopbackIp(record.address)) {
        throw new Error(`Security Violation: Hostname "${hostname}" resolves to private/loopback IP "${record.address}". Access is prohibited.`);
      }
    }
  } catch (err) {
    if (err.message.startsWith('Security Violation:')) {
      throw err;
    }
    // Network/DNS lookup errors in offline test mode: warn but do not bypass static security validation
    console.warn(`[SSRF Guard Notice] DNS resolution notice for ${hostname}: ${err.message}`);
  }

  return validUrl;
}

export async function launchFormAssistant(job, options = {}) {
  const {
    userConfirmedApproval = false,
    resumePdfPath = null,
    screeningAnswers = null,
    headless = false
  } = options;

  // STRICT HUMAN APPROVAL GATE:
  // Cannot launch browser form filling without explicit user confirmation
  if (!userConfirmedApproval) {
    const error = new Error('Human Approval Gate: You must explicitly approve the application preparation and proposed answers before launching the browser assistant.');
    error.code = 'APPROVAL_REQUIRED';
    throw error;
  }

  // FRESHNESS & ELIGIBILITY SAFEGUARDS:
  // 1. Expired jobs must not proceed to autofill
  const jobStatus = (job.status || '').toLowerCase();
  const verifStatus = (job.verification_status || job.verificationStatus || '').toLowerCase();
  if (jobStatus === 'expired' || verifStatus === 'expired') {
    const error = new Error(`Job Freshness Safeguard: Job #${job.id || ''} ("${job.title}" @ "${job.company}") is marked as expired or closed. Autofill is blocked.`);
    error.code = 'JOB_EXPIRED';
    throw error;
  }

  // 2. Ineligible roles must not proceed to autofill
  if (job.fresher_eligible === 0 || job.fresherEligible === 0) {
    const error = new Error(`Eligibility Safeguard: Candidate fresher profile is ineligible for this role ("${job.title}" @ "${job.company}"). Autofill is blocked.`);
    error.code = 'INELIGIBLE_ROLE';
    throw error;
  }

  // 3. Clear warnings for blocked, inaccessible and unverified jobs
  if (verifStatus === 'blocked') {
    console.warn(`[Form Assistant Safety Warning] Job #${job.id || ''} URL is protected by anti-bot verification (${job.verification_reason || 'Bot challenge'}). Manual human review and navigation required.`);
  } else if (verifStatus === 'inaccessible') {
    console.warn(`[Form Assistant Safety Warning] Job #${job.id || ''} URL was reported inaccessible (${job.verification_reason || '404/connection error'}). Manual review required.`);
  } else if (verifStatus === 'unverified') {
    console.warn(`[Form Assistant Safety Warning] Job #${job.id || ''} URL has not been verified for active status. Human review recommended.`);
  }

  // SSRF Protection: Validate target URL including DNS resolution before browser navigation
  await validateSafeJobUrlAsync(job.url);

  const profile = loadCandidateProfile();
  const db = getDatabase();

  console.log(`\n[Form Assistant] Preparing application for: "${job.title}" @ "${job.company}"`);
  console.log(`[Form Assistant] Target URL: ${job.url}`);

  // 1. Ensure Tailored Resume PDF is ready
  let pdfPath = resumePdfPath;
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    console.log('[Form Assistant] Generating tailored ATS resume PDF...');
    const docs = await exportTailoredDocumentsForJob(job);
    pdfPath = docs.resumePdfPath;
  }

  // 2. Launch Google Chrome (Human-in-the-Loop, using configured Chrome Profile when interactive)
  console.log(`[Form Assistant] Launching browser (Headless: ${headless})...`);
  let browser = null;
  let context = null;
  const chromeCfg = getChromeProfileConfig();
  const shouldUseProfile = !headless && options.useChromeProfile !== false && chromeCfg.enabled && fs.existsSync(chromeCfg.userDataDir);

  if (shouldUseProfile) {
    // 2a. If user launched Chrome with --remote-debugging-port=9222, attach directly to their open window
    try {
      browser = await chromium.connectOverCDP(chromeCfg.cdpUrl, { timeout: 1500 });
      context = browser.contexts()[0] || await browser.newContext({ viewport: null });
      console.log(`[Form Assistant] Attached to running Chrome profile "${chromeCfg.profileLabel}" via CDP.`);
    } catch {
      // 2b. Try launching persistent context with the exact Chrome profile ("Profile 21" = Abhishek • Work)
      try {
        context = await chromium.launchPersistentContext(chromeCfg.userDataDir, {
          channel: 'chrome',
          headless: false,
          viewport: null,
          args: [`--profile-directory=${chromeCfg.profileDirectory}`, '--start-maximized']
        });
        console.log(`[Form Assistant] Launched Chrome profile "${chromeCfg.profileLabel}" (${chromeCfg.profileDirectory}).`);
      } catch (profileErr) {
        // 2c. Chrome is already open and holds the User Data lock — open job directly in that Chrome profile window
        try {
          const opened = openUrlInChromeProfile(job.url, chromeCfg);
          console.log(`[Form Assistant] Chrome profile "${opened.profileLabel}" is already open; opened job tab directly in your logged-in profile.`);
          try {
            updateApplicationStatus(job.id, 'ready_for_review', {
              notes: `Opened directly in your logged-in Chrome profile (${opened.profileLabel}). Review, attach ${path.basename(pdfPath)}, and submit manually.`
            });
          } catch {}
          return {
            success: true,
            usedExistingChromeWindow: true,
            chromeProfile: opened.profileDirectory,
            chromeProfileLabel: opened.profileLabel,
            jobId: job.id,
            portal: getPortalAdapter(job.url).name,
            fieldsFilled: 0,
            verification: [],
            resumePdfPath: pdfPath,
            message: `Opened ${job.url} directly in your logged-in Chrome profile (${opened.profileLabel}).`
          };
        } catch {
          console.warn(`[Form Assistant] Could not attach to Chrome profile (${profileErr.message}); falling back to standard browser.`);
        }
      }
    }
  }

  if (!context) {
    try {
      browser = await chromium.launch({
        channel: 'chrome',
        headless,
        args: ['--start-maximized']
      });
    } catch {
      try {
        browser = await chromium.launch({
          channel: 'msedge',
          headless,
          args: ['--start-maximized']
        });
      } catch {
        browser = await chromium.launch({
          headless,
          args: ['--start-maximized']
        });
      }
    }
    context = await browser.newContext({ viewport: null });
  }

  const page = await context.newPage();

  console.log(`[Form Assistant] Navigating to: ${job.url}`);
  try {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    console.warn(`[Form Assistant] Initial navigation notice: ${err.message}`);
  }

  // 3. Detect Portal & Check Barriers
  const adapter = getPortalAdapter(job.url);
  const barrierCheck = await adapter.detectSessionOrAuthBarrier(page);
  if (barrierCheck.hasBarrier) {
    console.warn(`[Form Assistant Notice] ${barrierCheck.message}`);
  }

  // 4. Inject Assistant Banner & Auto-Fill Approved Fields
  try {
    await page.waitForTimeout(1500);

    const answers = screeningAnswers || generateScreeningAnswers(job);
    const fillResult = await autoFillApplicationForm(page, profile, pdfPath, { screeningAnswers: answers, adapter });
    console.log(`[Form Assistant] Auto-filled ${fillResult.fieldsFilled} standard fields using ${adapter.name} adapter.`);

    // Read-back verification checks (Phase 9.2 Common Contract)
    const mismatches = (fillResult.verification || []).filter(
      v => v.status === 'MISMATCH' || v.legacyStatus === 'mismatch'
    );
    const verifiedCount = (fillResult.verification || []).filter(
      v => (v.status === 'VERIFIED' || v.legacyStatus === 'verified_match') && v.status !== 'UNSUPPORTED'
    ).length;
    const unsupportedCount = (fillResult.verification || []).filter(
      v => v.status === 'UNSUPPORTED' || v.legacyStatus === 'unverifiable'
    ).length;

    // Strict Gate: Mismatches must block progression to human review until corrected
    if (mismatches.length > 0) {
      console.warn(`[Form Assistant Safety Warning] Read-back mismatch detected on ${mismatches.length} field(s): ${mismatches.map(m => m.field).join(', ')}. Progression to 'ready_for_review' is BLOCKED.`);
      try {
        updateApplicationStatus(job.id, 'needs_correction', {
          notes: `Form Assistant detected ${mismatches.length} verification mismatch(es): ${mismatches.map(m => `${m.field} (expected: "${m.expected}", actual: "${m.actual}")`).join('; ')}. Manual correction required before review.`
        });
      } catch {}

      db.prepare(`
        INSERT INTO activity_audit_log (action, details)
        VALUES (?, ?)
      `).run(
        'FORM_ASSISTANT_MISMATCH_BLOCKED',
        `Form Assistant blocked promotion to ready_for_review for Job #${job.id} due to ${mismatches.length} DOM mismatch(es): ${mismatches.map(m => m.field).join(', ')}.`
      );

      return {
        success: false,
        mismatchBlocked: true,
        jobId: job.id,
        portal: adapter.name,
        supportLevel: adapter.getSupportLevel(),
        fieldsFilled: fillResult.fieldsFilled,
        verification: fillResult.verification,
        mismatches,
        resumePdfPath: pdfPath,
        barrier: barrierCheck.hasBarrier ? barrierCheck : null,
        browser,
        page,
        error: `Field read-back mismatch on ${mismatches.length} field(s): ${mismatches.map(m => m.field).join(', ')}. Manual correction required before review.`
      };
    }

    // 5. Update Application Tracker to 'ready_for_review' only when no mismatches exist
    try {
      updateApplicationStatus(job.id, 'ready_for_review', {
        notes: `Form Assistant filled ${fillResult.fieldsFilled} fields via ${adapter.name}. Verification: ${verifiedCount} verified, ${unsupportedCount} unsupported.`
      });
    } catch {}

    db.prepare(`
      INSERT INTO activity_audit_log (action, details)
      VALUES (?, ?)
    `).run(
      'FORM_ASSISTANT_LAUNCHED',
      `Launched Playwright form assistant for Job #${job.id} (${job.title} @ ${job.company}). Pre-filled ${fillResult.fieldsFilled} fields. Portal: ${adapter.name}. Verification: ${verifiedCount} verified, ${unsupportedCount} unsupported.`
    );

    console.log('\n================================================================');
    console.log('✅ Form Assistant is standing by in your open Chrome browser!');
    console.log('👉 Please review the pre-filled fields, verify all data,');
    console.log('   and click "Submit Application" manually when satisfied.');
    console.log('================================================================\n');

    return {
      success: true,
      jobId: job.id,
      portal: adapter.name,
      supportLevel: adapter.getSupportLevel(),
      fieldsFilled: fillResult.fieldsFilled,
      verification: fillResult.verification,
      resumePdfPath: pdfPath,
      barrier: barrierCheck.hasBarrier ? barrierCheck : null,
      browser,
      page
    };
  } catch (err) {
    console.error('[Form Assistant Error]:', err.message);
    return {
      success: false,
      error: err.message,
      browser,
      page
    };
  }
}

export async function autoFillApplicationForm(page, profile, pdfPath, options = {}) {
  const currentUrl = page.url() || '';
  const adapter = options.adapter || getPortalAdapter(currentUrl);

  // Inject helper notification banner at top of page
  await page.evaluate(() => {
    if (document.getElementById('careeros-assistant-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'careeros-assistant-banner';
    banner.style.position = 'fixed';
    banner.style.top = '0';
    banner.style.left = '0';
    banner.style.right = '0';
    banner.style.backgroundColor = '#1e3a8a';
    banner.style.color = '#ffffff';
    banner.style.padding = '10px 16px';
    banner.style.fontSize = '13px';
    banner.style.fontWeight = '600';
    banner.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    banner.style.zIndex = '999999';
    banner.style.display = 'flex';
    banner.style.justifyContent = 'space-between';
    banner.style.alignItems = 'center';
    banner.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    banner.innerHTML = `
      <span>🎯 <strong>CareerOS Assistant:</strong> Verified profile details pre-filled. Human review required — click Submit manually when ready.</span>
      <button style="background: rgba(255,255,255,0.2); border: 1px solid #fff; color: #fff; padding: 2px 8px; border-radius: 4px; cursor: pointer;" onclick="this.parentElement.remove()">Dismiss Banner</button>
    `;
    document.body.prepend(banner);
  }).catch(() => {});

  const mappedData = adapter.mapProfileToFields(profile);

  // Execute adapter filling
  const fillResult = await adapter.fill(page, mappedData, {
    resumePdfPath: pdfPath,
    screeningAnswers: options.screeningAnswers || {}
  });

  return {
    fieldsFilled: fillResult.fieldsFilledCount || (fillResult.filledFields ? fillResult.filledFields.length : 0),
    filledFields: fillResult.filledFields || [],
    verification: fillResult.verification || [],
    portal: adapter.name
  };
}

export function detectPortalType(url) {
  const adapter = getPortalAdapter(url);
  return adapter.name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
