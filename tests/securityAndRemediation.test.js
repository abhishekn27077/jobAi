import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startDashboardServer } from '../src/dashboard/server.js';
import {
  generateOAuthSecurityContext,
  consumeOAuthState,
  validateRedirectUri,
  getGoogleAuthUrl,
  disconnectAccount,
  GOOGLE_OAUTH_SCOPES
} from '../src/email/googleOAuthClient.js';
import {
  encryptTokenPayload,
  decryptTokenPayload,
  secureWipeFile
} from '../src/email/tokenEncryption.js';
import {
  calculateNewRegimeTax,
  calculateOldRegimeTax,
  calculateOfferTakeHome,
  auditTaxAccuracyForFinancialYear,
  SALARY_DISCLAIMER
} from '../src/intelligence/salaryCalculatorService.js';
import {
  generateScreeningAnswers,
  validateAnswerTruthfulness
} from '../src/automation/screeningEngine.js';
import { validateSafeJobUrl } from '../src/automation/formAssistant.js';
import { restoreDatabase } from '../src/db/backupService.js';
import { loadCandidateProfile } from '../src/profile/profileManager.js';
import { prepareApplication, confirmApplicationSubmission } from '../src/automation/applicationWorkflow.js';
import { launchFormAssistant } from '../src/automation/formAssistant.js';
import { saveOrUpdateJob, getJobById } from '../src/tracker/jobTracker.js';
import { validateJobRecord } from '../src/discovery/jobValidator.js';
import { getCompanyResearch } from '../src/intelligence/companyResearchService.js';
import { parseRawGmailMessage } from '../src/email/emailSyncService.js';
import { getDatabase } from '../src/db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper for making HTTP requests to dashboard test server
function makeRequest({ host = '127.0.0.1', port, method = 'GET', path: reqPath = '/', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host,
      port,
      method,
      path: reqPath,
      headers
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch { }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data,
          json
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

test('Security Remediation 1: Dashboard Origin, Host & CSRF Protection', async () => {
  const testPort = 3199;
  const server = startDashboardServer(testPort, '127.0.0.1');

  try {
    // 1. Host Header Validation: Spoofed Host header must be rejected with 400
    const spoofedHostRes = await makeRequest({
      port: testPort,
      method: 'GET',
      path: '/api/stats',
      headers: { host: 'attacker-controlled.site.com' }
    });
    assert.strictEqual(spoofedHostRes.statusCode, 400);
    assert.match(spoofedHostRes.json.error, /Host header validation failed/i);

    // 2. Cross-Origin Validation: Untrusted Origin must be rejected with 403 Forbidden
    const crossOriginRes = await makeRequest({
      port: testPort,
      method: 'GET',
      path: '/api/stats',
      headers: {
        host: `127.0.0.1:${testPort}`,
        origin: 'https://evil-malicious-site.com'
      }
    });
    assert.strictEqual(crossOriginRes.statusCode, 403);
    assert.match(crossOriginRes.json.error, /Untrusted cross-origin request rejected/i);

    // 3. Legitimate Local Origin must be allowed with explicit header (NO wildcard *)
    const validOriginRes = await makeRequest({
      port: testPort,
      method: 'GET',
      path: '/api/stats',
      headers: {
        host: `127.0.0.1:${testPort}`,
        origin: `http://127.0.0.1:${testPort}`
      }
    });
    assert.strictEqual(validOriginRes.statusCode, 200);
    assert.strictEqual(validOriginRes.headers['access-control-allow-origin'], `http://127.0.0.1:${testPort}`);
    assert.notStrictEqual(validOriginRes.headers['access-control-allow-origin'], '*');

    // 4. CSRF Protection: Sec-Fetch-Site cross-site on state-changing POST must be blocked with 403
    const crossSitePostRes = await makeRequest({
      port: testPort,
      method: 'POST',
      path: '/api/scan',
      headers: {
        host: `127.0.0.1:${testPort}`,
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json'
      },
      body: {}
    });
    assert.strictEqual(crossSitePostRes.statusCode, 403);
    assert.match(crossSitePostRes.json.error, /Cross-site state-changing request blocked/i);

    // 5. Payload Too Large: Bodies exceeding 512KB must be rejected with 413
    const hugePayload = 'A'.repeat(600 * 1024);
    const oversizedRes = await makeRequest({
      port: testPort,
      method: 'POST',
      path: '/api/scan',
      headers: {
        host: `127.0.0.1:${testPort}`,
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(hugePayload))
      },
      body: hugePayload
    });
    assert.strictEqual(oversizedRes.statusCode, 413);

    // 6. Malformed JSON must be rejected with 400 Bad Request
    const malformedRes = await makeRequest({
      port: testPort,
      method: 'POST',
      path: '/api/scan',
      headers: {
        host: `127.0.0.1:${testPort}`,
        'content-type': 'application/json'
      },
      body: '{ broken json: nil, '
    });
    assert.strictEqual(malformedRes.statusCode, 400);
    assert.match(malformedRes.json.error, /Malformed JSON payload/i);

    // 7. Path Traversal Guard: Directory traversal in static file serving must be blocked
    const traversalRes = await makeRequest({
      port: testPort,
      method: 'GET',
      path: '/../../package.json',
      headers: { host: `127.0.0.1:${testPort}` }
    });
    assert.ok(traversalRes.statusCode === 403 || traversalRes.statusCode === 404);
    assert.ok(!traversalRes.data.includes('"dependencies"'));

    // 8. Parameter Validation: Invalid non-numeric Job ID must return 400
    const invalidIdRes = await makeRequest({
      port: testPort,
      method: 'POST',
      path: '/api/job/not-a-number/tailor',
      headers: { host: `127.0.0.1:${testPort}` }
    });
    assert.strictEqual(invalidIdRes.statusCode, 400);
    assert.match(invalidIdRes.json.error, /Invalid Job ID parameter/i);

    // 9. Sensitive Confirmation Gates:
    // Restore without userConfirmed: true must be rejected
    const unconfirmedRestore = await makeRequest({
      port: testPort,
      method: 'POST',
      path: '/api/backup/restore',
      headers: {
        host: `127.0.0.1:${testPort}`,
        'content-type': 'application/json'
      },
      body: { backupPath: 'dummy.db', userConfirmed: false }
    });
    assert.strictEqual(unconfirmedRestore.statusCode, 400);

    // Disconnect without userConfirmed: true must be rejected
    const unconfirmedDisconnect = await makeRequest({
      port: testPort,
      method: 'POST',
      path: '/api/oauth/disconnect',
      headers: {
        host: `127.0.0.1:${testPort}`,
        'content-type': 'application/json'
      },
      body: { userConfirmed: false }
    });
    assert.strictEqual(unconfirmedDisconnect.statusCode, 400);

  } finally {
    server.close();
  }
});

test('Security Remediation 2: OAuth 2.0 PKCE, Cryptographic State & Token Encryption', async () => {
  // 1. Cryptographic state and PKCE S256 generation
  const context = generateOAuthSecurityContext('http://localhost:3000/oauth2callback');
  assert.ok(context.state.length >= 64, 'State must be cryptographically random hex (>= 256 bits)');
  assert.ok(context.codeVerifier.length >= 43, 'PKCE verifier must be at least 43 characters');
  assert.ok(context.codeChallenge, 'PKCE code challenge must exist');

  // Verify challenge is Base64URL(SHA-256(verifier))
  const expectedChallenge = crypto.createHash('sha256').update(context.codeVerifier).digest('base64url');
  assert.strictEqual(context.codeChallenge, expectedChallenge);

  // 2. State Validation & One-Time Use Consumption
  const consumeValid = consumeOAuthState(context.state);
  assert.strictEqual(consumeValid.valid, true);
  assert.strictEqual(consumeValid.data.codeVerifier, context.codeVerifier);

  // Replay attempt must fail (single-use constraint)
  const consumeReplay = consumeOAuthState(context.state);
  assert.strictEqual(consumeReplay.valid, false);

  // Unknown or forged state must fail
  const forgedState = consumeOAuthState('forged-state-parameter-12345');
  assert.strictEqual(forgedState.valid, false);

  // 3. Strict Redirect URI Validation
  assert.strictEqual(validateRedirectUri('http://localhost:3000/oauth2callback'), 'http://localhost:3000/oauth2callback');
  assert.throws(
    () => validateRedirectUri('https://attacker-steals-tokens.com/oauth/callback'),
    /Unauthorized OAuth redirect URI/
  );

  // 4. Minimum Necessary Scopes
  assert.strictEqual(GOOGLE_OAUTH_SCOPES.length, 3);
  assert.ok(!GOOGLE_OAUTH_SCOPES.includes('https://www.googleapis.com/auth/calendar.readonly'), 'Redundant readonly calendar scope removed');

  // 5. AES-256-GCM Token Encryption and Decryption
  const testTokens = {
    access_token: 'secret_oauth_access_token_xyz',
    refresh_token: 'secret_oauth_refresh_token_abc',
    token_type: 'Bearer',
    expires_in: 3600
  };

  const encrypted = encryptTokenPayload(testTokens);
  assert.strictEqual(encrypted.encrypted, true);
  assert.strictEqual(encrypted.algorithm, 'aes-256-gcm');
  assert.ok(encrypted.iv && encrypted.tag && encrypted.ciphertext);
  assert.ok(!JSON.stringify(encrypted).includes('secret_oauth_access_token_xyz'), 'Plaintext must not be visible in encrypted payload');

  const decrypted = decryptTokenPayload(encrypted);
  assert.strictEqual(decrypted.needsMigration, false);
  assert.strictEqual(decrypted.tokens.access_token, testTokens.access_token);
  assert.strictEqual(decrypted.tokens.refresh_token, testTokens.refresh_token);

  // 6. Seamless Legacy Plaintext Migration
  const legacyPlaintext = {
    access_token: 'legacy_plain_access_token',
    refresh_token: 'legacy_plain_refresh_token'
  };
  const migrationResult = decryptTokenPayload(legacyPlaintext);
  assert.strictEqual(migrationResult.needsMigration, true);
  assert.strictEqual(migrationResult.tokens.access_token, 'legacy_plain_access_token');
});

test('Security Remediation 3: Candidate Truthfulness and Experience Grounding', () => {
  const profile = loadCandidateProfile();

  // 1. Profile Status: Fresher with 0 years full-time experience
  assert.match(profile.status.targetLevel, /0 years full-time/i);
  assert.strictEqual(profile.status.graduationYear, 2026);

  // 2. Anudip Foundation must be strictly an Internship / Training
  const anudip = profile.experience.find(e => /Anudip/i.test(e.company));
  assert.ok(anudip);
  assert.match(anudip.type, /Internship/i);
  assert.notStrictEqual(anudip.type, 'Full-time Employment');

  // 3. Screening Engine truthful answers (0 years commercial experience)
  const answers = generateScreeningAnswers({ company: 'TestCorp', title: 'Java Developer' });
  assert.match(answers.experience_java.answer, /0 years full-time/i);
  assert.match(answers.experience_java.answer, /internship at Anudip Foundation/i);
  assert.ok(!answers.experience_java.answer.startsWith('1 year of hands-on Java'), 'Must not claim 1 year of experience');

  // 4. Truthfulness Validator: Reject claiming >= 1 year of professional/work experience
  const check1Year = validateAnswerTruthfulness('I possess 1 year of professional experience in Java and Spring Boot.', profile);
  assert.strictEqual(check1Year.valid, false);
  assert.ok(check1Year.issues.some(i => i.includes('exceeding candidate\'s verified fresher status')));

  // 5. Truthfulness Validator: Reject falsely claiming full-time employment at Anudip
  const checkAnudipFullTime = validateAnswerTruthfulness('I was a full-time software engineer at Anudip Foundation.', profile);
  assert.strictEqual(checkAnudipFullTime.valid, false);
  assert.ok(checkAnudipFullTime.issues.some(i => i.includes('represented as an internship')));

  // 6. Legitimate truthful answer must pass
  const legitimate = validateAnswerTruthfulness('I completed my MCA in 2026 and gained hands-on Java and Spring Boot experience during my Anudip internship and NearVia project.', profile);
  assert.strictEqual(legitimate.valid, true);
});

test('Security Remediation 4: Indian Income Tax — Statutory Verification for FY 2024-25, FY 2025-26 & FY 2026-27', () => {
  // =========================================================================
  // 1. FY 2024-25 (Finance (No. 2) Act, 2024 — Section 115BAC(1A))
  // =========================================================================
  const audit24 = auditTaxAccuracyForFinancialYear('FY 2024-25');
  assert.strictEqual(audit24.verified, true);
  assert.strictEqual(audit24.basicExemptionLimit, 300000);
  assert.strictEqual(audit24.rebateThreshold, 700000);
  assert.strictEqual(audit24.maxRebate, 25000);

  // 1a. Section 87A Rebate: Zero tax for taxable income <= 7,00,000
  const taxUnder7L = calculateNewRegimeTax(650000, 'FY 2024-25');
  assert.strictEqual(taxUnder7L.totalTax, 0);
  assert.strictEqual(taxUnder7L.rebate87A, 17500); // (650000 - 300000) * 5%

  const taxAt7L = calculateNewRegimeTax(700000, 'FY 2024-25');
  assert.strictEqual(taxAt7L.totalTax, 0);
  assert.strictEqual(taxAt7L.rebate87A, 20000); // 400000 * 5%

  // 1b. Section 87A Marginal Relief for income slightly above 7,00,000
  // Taxable: 7,10,000. Normal tax before cess = 20,000 + 10,000*10% = 21,000.
  // Excess income over 7,00,000 = 10,00,000 - 7,00,000 = 10,000.
  // Tax before cess is capped at 10,000. Relief = 11,000. Cess (4%) = 400. Total = 10,400.
  const marginalTax24 = calculateNewRegimeTax(710000, 'FY 2024-25');
  assert.strictEqual(marginalTax24.marginalRelief, 11000);
  assert.strictEqual(marginalTax24.totalTax, 10400);

  // 1c. CTC vs Gross vs Taxable Income Distinction (FY 2024-25)
  // CTC = ₹10,00,000. Fixed Gross = ₹9,00,000.
  // Standard Deduction = ₹75,000.
  // Professional Tax is NOT deductible under Section 115BAC.
  // Taxable Income = 9,00,000 - 75,000 = 8,25,000.
  // Slabs: 0-3L: 0; 3L-7L: 20,000; 7L-8.25L: 12,500. Base = 32,500. Cess (4%) = 1,300. Total = 33,800.
  const offer10L_24 = calculateOfferTakeHome({
    ctcAnnual: 1000000,
    fixedBaseAnnual: 900000,
    variableAnnual: 100000,
    location: 'Bengaluru',
    taxRegime: 'new_regime',
    financialYear: 'FY 2024-25'
  });
  assert.strictEqual(offer10L_24.taxBreakdown.standardDeduction, 75000);
  assert.strictEqual(offer10L_24.taxBreakdown.taxableIncome, 825000);
  assert.strictEqual(offer10L_24.taxBreakdown.finalTaxPayable, 33800);
  assert.strictEqual(offer10L_24.fixedGrossAnnual, 900000);
  assert.strictEqual(offer10L_24.variablePayAnnual, 100000);
  assert.ok(offer10L_24.employerContributions.employerEpf > 0);
  assert.ok(offer10L_24.employerContributions.gratuity > 0);
  assert.strictEqual(offer10L_24.employeeDeductions.annual.professionalTax, 2400);

  // =========================================================================
  // 2. FY 2025-26 (Finance Act, 2025 — Section 115BAC(1A) Revised Slabs)
  // =========================================================================
  const audit25 = auditTaxAccuracyForFinancialYear('FY 2025-26');
  assert.strictEqual(audit25.verified, true);
  assert.strictEqual(audit25.basicExemptionLimit, 400000);
  assert.strictEqual(audit25.rebateThreshold, 1200000);
  assert.strictEqual(audit25.maxRebate, 60000);

  // 2a. Section 87A Rebate: Zero tax for taxable income <= 12,00,000
  const taxUnder12L = calculateNewRegimeTax(1000000, 'FY 2025-26');
  assert.strictEqual(taxUnder12L.totalTax, 0);
  assert.strictEqual(taxUnder12L.rebate87A, 40000); // 4L@5% (20k) + 2L@10% (20k) = 40k

  const taxAt12L = calculateNewRegimeTax(1200000, 'FY 2025-26');
  assert.strictEqual(taxAt12L.totalTax, 0);
  assert.strictEqual(taxAt12L.rebate87A, 60000); // 4L@5% (20k) + 4L@10% (40k) = 60k

  // 2b. Section 87A Marginal Relief for income slightly above 12,00,000
  // Taxable: 12,20,000. Normal slab tax = 20k + 40k + 20,000*15% = 63,000.
  // Excess income over 12,00,000 = 20,000.
  // Tax capped at 20,000. Relief = 43,000. Cess (4%) = 800. Total = 20,800.
  const marginalTax25 = calculateNewRegimeTax(1220000, 'FY 2025-26');
  assert.strictEqual(marginalTax25.marginalRelief, 43000);
  assert.strictEqual(marginalTax25.totalTax, 20800);

  // 2c. Higher Slab: 15,00,000 taxable income
  // 0-4L: 0; 4-8L: 20k; 8-12L: 40k; 12-15L (3L@15%): 45k. Base = 1,05,000. Cess = 4,200. Total = 1,09,200.
  const tax15L = calculateNewRegimeTax(1500000, 'FY 2025-26');
  assert.strictEqual(tax15L.baseTax, 105000);
  assert.strictEqual(tax15L.totalTax, 109200);

  // =========================================================================
  // 3. FY 2026-27 (Income-tax Act, 2025 — Unified Tax Year Framework)
  // =========================================================================
  const audit26 = auditTaxAccuracyForFinancialYear('FY 2026-27');
  assert.strictEqual(audit26.verified, true);
  assert.strictEqual(audit26.status, 'verified_statutory');
  assert.ok(audit26.governingAct.includes('Income-tax Act, 2025'));
  assert.ok(audit26.actTransition.includes('repeals and replaces the Income-tax Act, 1961'));
  assert.strictEqual(audit26.rebateThreshold, 1200000);

  // 3a. FY 2026-27 with zero Professional Tax
  // Fixed Gross = ₹12,75,000, PT = ₹0.
  // Standard Deduction (Section 19(1) Sl. No. 2) = ₹75,000; Employment Tax Deduction = ₹0.
  // Taxable Income = 12,75,000 - 75,000 - 0 = 12,00,000 -> Tax is ₹0 under Section 87A / 2025 Act rebate.
  const offer26_zeroPt = calculateOfferTakeHome({
    ctcAnnual: 1275000,
    fixedBaseAnnual: 1275000,
    professionalTaxAnnual: 0,
    financialYear: 'FY 2026-27'
  });
  assert.strictEqual(offer26_zeroPt.taxBreakdown.standardDeduction, 75000);
  assert.strictEqual(offer26_zeroPt.taxBreakdown.employmentTaxDeduction, 0);
  assert.strictEqual(offer26_zeroPt.taxBreakdown.taxableIncome, 1200000);
  assert.strictEqual(offer26_zeroPt.taxBreakdown.baseTax, 60000);
  assert.strictEqual(offer26_zeroPt.taxBreakdown.rebate87A, 60000);
  assert.strictEqual(offer26_zeroPt.taxBreakdown.marginalRelief, 0);
  assert.strictEqual(offer26_zeroPt.taxBreakdown.finalTaxPayable, 0);
  assert.ok(offer26_zeroPt.statutoryDisclaimer.includes('Income-tax Act, 2025'));

  // 3b. FY 2026-27 with ₹2,400 annual Professional Tax (Section 19(1) Table Sl. No. 1 deduction)
  // Fixed Gross = ₹12,77,400, PT = ₹2,400.
  // Standard Deduction = ₹75,000; Eligible Section 19(1) Employment Tax Deduction = ₹2,400.
  // Taxable Income = 12,77,400 - 75,000 - 2,400 = 12,00,000 -> Tax is ₹0.
  const offer26_withPt = calculateOfferTakeHome({
    ctcAnnual: 1277400,
    fixedBaseAnnual: 1277400,
    professionalTaxAnnual: 2400,
    financialYear: 'FY 2026-27'
  });
  assert.strictEqual(offer26_withPt.taxBreakdown.standardDeduction, 75000);
  assert.strictEqual(offer26_withPt.taxBreakdown.employmentTaxDeduction, 2400);
  assert.strictEqual(offer26_withPt.taxBreakdown.taxableIncome, 1200000);
  assert.strictEqual(offer26_withPt.taxBreakdown.baseTax, 60000);
  assert.strictEqual(offer26_withPt.taxBreakdown.rebate87A, 60000);
  assert.strictEqual(offer26_withPt.taxBreakdown.finalTaxPayable, 0);
  // Non-duplication verification: PT is deducted once on payroll payslip (₹2,400 annual / ₹200 monthly)
  assert.strictEqual(offer26_withPt.employeeDeductions.annual.professionalTax, 2400);
  assert.strictEqual(offer26_withPt.monthlyBreakdown.professionalTax, 200);

  // 3c. Taxable income immediately below, at, and above ₹12 Lakh boundary (FY 2026-27)
  // - Immediately below: Taxable ₹11,99,000 -> Base Tax: 20k + 3.99L@10% (39,900) = 59,900; Rebate = 59,900; Tax = 0.
  const taxBelow12L = calculateNewRegimeTax(1199000, 'FY 2026-27');
  assert.strictEqual(taxBelow12L.baseTax, 59900);
  assert.strictEqual(taxBelow12L.rebate87A, 59900);
  assert.strictEqual(taxBelow12L.marginalRelief, 0);
  assert.strictEqual(taxBelow12L.totalTax, 0);

  // - At ₹12 Lakh: Taxable ₹12,00,000 -> Base Tax = 60,000; Rebate = 60,000; Tax = 0.
  const taxAt12L_26 = calculateNewRegimeTax(1200000, 'FY 2026-27');
  assert.strictEqual(taxAt12L_26.baseTax, 60000);
  assert.strictEqual(taxAt12L_26.rebate87A, 60000);
  assert.strictEqual(taxAt12L_26.marginalRelief, 0);
  assert.strictEqual(taxAt12L_26.totalTax, 0);

  // - Immediately above: Taxable ₹12,01,000 (excess = 1,000)
  //   Normal base tax: 60,000 + 1,000*15% = 60,150. Capped at excess (1,000).
  //   Marginal relief = 60,150 - 1,000 = 59,150. Tax before cess = 1,000. 4% Cess = 40. Total = 1,040.
  const taxAbove12L = calculateNewRegimeTax(1201000, 'FY 2026-27');
  assert.strictEqual(taxAbove12L.baseTax, 60150);
  assert.strictEqual(taxAbove12L.rebate87A, 0);
  assert.strictEqual(taxAbove12L.marginalRelief, 59150);
  assert.strictEqual(taxAbove12L.cess, 40);
  assert.strictEqual(taxAbove12L.totalTax, 1040);

  // 3d. Taxable income around the Marginal-Relief Boundary (FY 2026-27)
  // Marginal relief cutoff occurs where 60,000 + 0.15X <= X <=> 0.85X >= 60,000 <=> X >= ~70,588.24.
  // - Inside boundary: ₹12,70,000 (excess = 70,000)
  //   Base tax = 60,000 + 70,000*15% = 70,500. Relief = 70,500 - 70,000 = 500. Cess = 4% of 70,000 = 2,800. Total = 72,800.
  const taxInsideBoundary = calculateNewRegimeTax(1270000, 'FY 2026-27');
  assert.strictEqual(taxInsideBoundary.baseTax, 70500);
  assert.strictEqual(taxInsideBoundary.marginalRelief, 500);
  assert.strictEqual(taxInsideBoundary.cess, 2800);
  assert.strictEqual(taxInsideBoundary.totalTax, 72800);

  // - At boundary limit: ₹12,70,588 (excess = 70,588; base tax = 70,588; relief = 0).
  const taxAtBoundary = calculateNewRegimeTax(1270588, 'FY 2026-27');
  assert.strictEqual(taxAtBoundary.marginalRelief, 0);

  // - Outside boundary: ₹12,71,000 (excess = 71,000)
  //   Base tax = 60,000 + 71,000*15% = 70,650 <= 71,000 -> Relief = 0. Cess = 4% of 70,650 = 2,826. Total = 73,476.
  const taxOutsideBoundary = calculateNewRegimeTax(1271000, 'FY 2026-27');
  assert.strictEqual(taxOutsideBoundary.baseTax, 70650);
  assert.strictEqual(taxOutsideBoundary.marginalRelief, 0);
  assert.strictEqual(taxOutsideBoundary.cess, 2826);
  assert.strictEqual(taxOutsideBoundary.totalTax, 73476);

  // 3e. Verification that FY 2024-25 and FY 2025-26 retain previous PT disallowance under Section 115BAC(2)(i)
  // FY 2024-25: Gross ₹9,00,000, PT ₹2,400. PT is NOT deducted from taxable income!
  const offer24_ptRetention = calculateOfferTakeHome({
    ctcAnnual: 1000000,
    fixedBaseAnnual: 900000,
    professionalTaxAnnual: 2400,
    financialYear: 'FY 2024-25'
  });
  assert.strictEqual(offer24_ptRetention.taxBreakdown.standardDeduction, 75000);
  assert.strictEqual(offer24_ptRetention.taxBreakdown.employmentTaxDeduction, 0, 'FY 2024-25 New Regime must not deduct PT from taxable income');
  assert.strictEqual(offer24_ptRetention.taxBreakdown.taxableIncome, 825000); // 9,00,000 - 75,000
  assert.strictEqual(offer24_ptRetention.taxBreakdown.finalTaxPayable, 33800);

  // FY 2025-26: Gross ₹13,00,000, PT ₹2,400. PT is NOT deducted from taxable income!
  const offer25_ptRetention = calculateOfferTakeHome({
    ctcAnnual: 1400000,
    fixedBaseAnnual: 1300000,
    professionalTaxAnnual: 2400,
    financialYear: 'FY 2025-26'
  });
  assert.strictEqual(offer25_ptRetention.taxBreakdown.standardDeduction, 75000);
  assert.strictEqual(offer25_ptRetention.taxBreakdown.employmentTaxDeduction, 0, 'FY 2025-26 New Regime must not deduct PT from taxable income');
  assert.strictEqual(offer25_ptRetention.taxBreakdown.taxableIncome, 1225000); // 13,00,000 - 75,000
  assert.strictEqual(offer25_ptRetention.taxBreakdown.marginalRelief, 38750);
  assert.strictEqual(offer25_ptRetention.taxBreakdown.finalTaxPayable, 26000);

  // 3f. Direct demonstration: Gross ₹13,00,000 with PT ₹2,400 under FY 2026-27 vs FY 2025-26
  // In FY 2026-27, Section 19(1) Sl. No. 1 allows PT deduction -> Taxable = 13,00,000 - 75,000 - 2,400 = 12,22,600
  // Excess = 22,600 -> Relief = 40,790 -> Tax = 22,600 + 904 = 23,504 (Saving ₹2,496 vs FY 2025-26)
  const offer26_demonstration = calculateOfferTakeHome({
    ctcAnnual: 1400000,
    fixedBaseAnnual: 1300000,
    professionalTaxAnnual: 2400,
    financialYear: 'FY 2026-27'
  });
  assert.strictEqual(offer26_demonstration.taxBreakdown.standardDeduction, 75000);
  assert.strictEqual(offer26_demonstration.taxBreakdown.employmentTaxDeduction, 2400);
  assert.strictEqual(offer26_demonstration.taxBreakdown.taxableIncome, 1222600);
  assert.strictEqual(offer26_demonstration.taxBreakdown.baseTax, 63390);
  assert.strictEqual(offer26_demonstration.taxBreakdown.marginalRelief, 40790);
  assert.strictEqual(offer26_demonstration.taxBreakdown.cess, 904);
  assert.strictEqual(offer26_demonstration.taxBreakdown.finalTaxPayable, 23504);
});

test('Security Remediation 5: Browser Automation SSRF & Private Network Block', () => {
  // Prohibit loopback addresses (IPv4 & IPv6)
  assert.throws(() => validateSafeJobUrl('http://localhost:8080/apply'), /Access to local network host/);
  assert.throws(() => validateSafeJobUrl('http://127.0.0.1:3000/apply'), /Access to local network host/);
  assert.throws(() => validateSafeJobUrl('http://0.0.0.0:8000/apply'), /Access to local network host/);
  assert.throws(() => validateSafeJobUrl('http://[::1]:8080/apply'), /Access to local network host/);
  assert.throws(() => validateSafeJobUrl('http://[::ffff:127.0.0.1]:8080/apply'), /private or loopback network address/);

  // Prohibit IPv6 Unique Local (ULA fc00::/7) and Link-Local (fe80::/10)
  assert.throws(() => validateSafeJobUrl('http://[fc00::1]:8080/apply'), /private or loopback network address/);
  assert.throws(() => validateSafeJobUrl('http://[fe80::1]:8080/apply'), /private or loopback network address/);

  // Prohibit Cloud metadata service (169.254.169.254) and decimal/octal encodings
  assert.throws(() => validateSafeJobUrl('http://169.254.169.254/latest/meta-data/'), /private or loopback network address/);
  assert.throws(() => validateSafeJobUrl('http://2130706433/apply'), /Access to local network host/);

  // Prohibit private RFC 1918 networks
  assert.throws(() => validateSafeJobUrl('http://10.0.0.1/admin'), /private or loopback network address/);
  assert.throws(() => validateSafeJobUrl('http://192.168.1.1/setup'), /private or loopback network address/);
  assert.throws(() => validateSafeJobUrl('http://172.20.0.1/dashboard'), /private or loopback network address/);

  // Prohibit dynamic-DNS loopback and internal reserved domains
  assert.throws(() => validateSafeJobUrl('http://127.0.0.1.nip.io/apply'), /private, internal, or dynamic-DNS/);
  assert.throws(() => validateSafeJobUrl('http://localtest.me/apply'), /private, internal, or dynamic-DNS/);
  assert.throws(() => validateSafeJobUrl('http://internal-portal.corp/apply'), /private, internal, or dynamic-DNS/);
  assert.throws(() => validateSafeJobUrl('http://hr.company.internal/job'), /private, internal, or dynamic-DNS/);

  // Prohibit unsafe schemes
  assert.throws(() => validateSafeJobUrl('file:///C:/Windows/System32/cmd.exe'), /Protocol "file:" is not permitted/);
  assert.throws(() => validateSafeJobUrl('gopher://127.0.0.1:70/'), /Protocol "gopher:" is not permitted/);

  // Legitimate public HTTPS job portal URL must pass
  const validUrl = validateSafeJobUrl('https://boards.greenhouse.io/swiggy/jobs/12345');
  assert.strictEqual(validUrl, 'https://boards.greenhouse.io/swiggy/jobs/12345');
});

test('Security Remediation 6: Database Restore Path Traversal & Safety Protection', () => {
  // 1. Restore without explicit user confirmation must fail
  assert.throws(
    () => restoreDatabase('some_backup.db', { userConfirmed: false }),
    /Destructive Action Protection/
  );

  // 2. Restore with path traversal outside data/backups must be blocked
  assert.throws(
    () => restoreDatabase('../../../windows/system32/config/sam.db', { userConfirmed: true }),
    /Security Violation: Unsafe backup path/
  );

  // 3. Restore non-.db file must be blocked
  assert.throws(
    () => restoreDatabase('package.json', { userConfirmed: true }),
    /Restoration is restricted to files in data\/backups/
  );
});

test('Security Remediation 7: Repository Privacy & Secrets Guard', () => {
  // Verify that the publicly tracked candidate profile strictly contains sanitized placeholders
  const trackedProfileRaw = fs.readFileSync(path.resolve(__dirname, '../data/candidate_profile.json'), 'utf-8');
  const trackedProfile = JSON.parse(trackedProfileRaw);

  assert.strictEqual(trackedProfile.personal.phone, '+91-XXXXXXXXXX');
  assert.strictEqual(trackedProfile.personal.email, 'candidate@example.com');

  // Verify that active OAuth token directory and local profile are properly git-ignored
  const gitignoreContent = fs.readFileSync(path.resolve(__dirname, '../.gitignore'), 'utf-8');
  assert.ok(gitignoreContent.includes('data/.oauth_tokens/'));
  assert.ok(gitignoreContent.includes('data/backups/'));
  assert.ok(gitignoreContent.includes('data/*.local.json') || gitignoreContent.includes('candidate_profile.local.json'));
  assert.ok(gitignoreContent.includes('.env'));
});

test('Correctness Audit 1 & 4: Application Workflow applied_date, Freshness and Eligibility Safeguards', async () => {
  const db = getDatabase();

  // Create a clean test job for workflow testing
  const insertStmt = db.prepare(`
    INSERT INTO jobs (title, company, location, url, source, description, status, verification_status, experience_min, experience_max)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const res = insertStmt.run(
    'Junior Backend Engineer',
    'WorkflowAuditCorp',
    'Bengaluru, Karnataka, India',
    'https://workflowauditcorp.example.com/jobs/101',
    'direct',
    'Hands-on Java and Spring Boot experience required for entry-level backend position.',
    'active',
    'verified',
    0,
    1
  );
  const testJobId = Number(res.lastInsertRowid);

  try {
    // 1. Defect 1: Preparing application must NOT set applied_date
    const prep = await prepareApplication(testJobId);
    assert.ok(prep.applicationId);
    assert.strictEqual(prep.isAutofillAllowed, true);

    const appRow = db.prepare('SELECT status, applied_date FROM applications WHERE job_id = ?').get(testJobId);
    assert.strictEqual(appRow.status, 'preparing');
    assert.strictEqual(appRow.applied_date, null, 'applied_date MUST remain null when application is merely prepared');

    // 2. Strict Approval Gate on submission
    assert.throws(
      () => confirmApplicationSubmission(testJobId, { userConfirmed: false }),
      /Approval Gate Violation/i
    );

    // Unconfirmed submission attempt must leave applied_date as null
    const unconfirmedRow = db.prepare('SELECT status, applied_date FROM applications WHERE job_id = ?').get(testJobId);
    assert.strictEqual(unconfirmedRow.status, 'preparing');
    assert.strictEqual(unconfirmedRow.applied_date, null);

    // Explicit user confirmation must set status to submitted and record applied_date
    const submitResult = confirmApplicationSubmission(testJobId, {
      confirmationNumber: 'AUDIT-CONF-777',
      notes: 'User verified application on portal',
      userConfirmed: true
    });
    assert.strictEqual(submitResult.success, true);
    assert.strictEqual(submitResult.newStatus, 'submitted');

    const confirmedRow = db.prepare('SELECT status, applied_date FROM applications WHERE job_id = ?').get(testJobId);
    assert.strictEqual(confirmedRow.status, 'submitted');
    assert.ok(typeof confirmedRow.applied_date === 'string' && confirmedRow.applied_date.length > 0);

    // Audit log must record the confirmed submission
    const auditRow = db.prepare('SELECT * FROM activity_audit_log WHERE action = ? ORDER BY id DESC LIMIT 1').get('APPLICATION_SUBMISSION_CONFIRMED');
    assert.ok(auditRow);
    assert.match(auditRow.details, /AUDIT-CONF-777/);

    // 3. Defect 4: Freshness safeguards — Expired job must not proceed to autofill
    db.prepare("UPDATE jobs SET verification_status = 'expired' WHERE id = ?").run(testJobId);
    const expiredJob = getJobById(testJobId);

    const expiredPrep = await prepareApplication(testJobId);
    assert.strictEqual(expiredPrep.isAutofillAllowed, false);
    const freshnessCheck = expiredPrep.checklist.find(c => c.id === 'freshness');
    assert.ok(freshnessCheck);
    assert.strictEqual(freshnessCheck.completed, false);
    assert.ok(expiredPrep.warnings.some(w => /expired/i.test(w)));

    await assert.rejects(
      async () => {
        await launchFormAssistant(expiredJob, { userConfirmedApproval: true });
      },
      (err) => err.code === 'JOB_EXPIRED'
    );

    // 4. Defect 4: Eligibility safeguards — Ineligible role must be blocked
    db.prepare("UPDATE jobs SET verification_status = 'verified', experience_min = 6, experience_max = 10 WHERE id = ?").run(testJobId);
    const ineligibleJob = { ...getJobById(testJobId), fresher_eligible: 0 };

    const ineligiblePrep = await prepareApplication(testJobId);
    assert.strictEqual(ineligiblePrep.isAutofillAllowed, false);
    const eligibilityCheck = ineligiblePrep.checklist.find(c => c.id === 'eligibility');
    assert.ok(eligibilityCheck);
    assert.strictEqual(eligibilityCheck.completed, false);
    assert.ok(ineligiblePrep.warnings.some(w => /fresher.*not eligible/i.test(w)));

    await assert.rejects(
      async () => {
        await launchFormAssistant(ineligibleJob, { userConfirmedApproval: true });
      },
      (err) => err.code === 'INELIGIBLE_ROLE'
    );

  } finally {
    // Cleanup test artifacts
    db.prepare('DELETE FROM applications WHERE job_id = ?').run(testJobId);
    db.prepare('DELETE FROM jobs WHERE id = ?').run(testJobId);
  }
});

test('Correctness Audit 2 & 3: Job Ingestion Gate & Honest Date Preservation', () => {
  const db = getDatabase();

  // 1. Defect 2: Invalid job records must NOT silently enter the database
  const invalidJob1 = {
    title: '', // Missing title
    company: 'SilentCorruptCorp',
    url: 'https://silentcorrupt.example.com/job/1'
  };
  const saveRes1 = saveOrUpdateJob(invalidJob1);
  assert.strictEqual(saveRes1.success, false);
  assert.strictEqual(saveRes1.isValid, false);
  assert.strictEqual(saveRes1.jobId, null);
  assert.ok(Array.isArray(saveRes1.errors) && saveRes1.errors.length > 0);
  assert.ok(saveRes1.errors.some(e => e.includes('Missing job title')));

  // Verify database has no record for this company
  const dbCheck = db.prepare('SELECT id FROM jobs WHERE company = ?').get('SilentCorruptCorp');
  assert.strictEqual(dbCheck, undefined, 'Invalid record must not be present in jobs database');

  // Missing URL check
  const invalidJob2 = {
    title: 'Software Developer',
    company: 'MissingUrlCorp',
    url: 'not-a-valid-http-url'
  };
  const saveRes2 = saveOrUpdateJob(invalidJob2);
  assert.strictEqual(saveRes2.success, false);
  assert.strictEqual(saveRes2.isValid, false);
  assert.ok(saveRes2.errors.some(e => /application URL/i.test(e)));

  // 2. Defect 3: Never substitute current date when actual job posting date is unknown
  const validationNoDate = validateJobRecord({
    title: 'Junior Java Developer',
    company: 'HonestDateCo',
    url: 'https://honestdate.example.com/job/42',
    location: 'Bengaluru'
  });
  assert.strictEqual(validationNoDate.isValid, true);
  assert.strictEqual(
    validationNoDate.normalizedJob.postedAt,
    null,
    'Posting date must remain null when omitted, never substituted with current timestamp'
  );

  // Ingest valid job without posting date and verify SQLite stores NULL
  const saveDateRes = saveOrUpdateJob({
    title: 'Junior Python Engineer',
    company: 'HonestDateCo',
    url: 'https://honestdate.example.com/job/42',
    location: 'Bengaluru, Karnataka, India',
    description: 'Entry-level Python backend developer position with modern SQL databases.'
  });
  assert.strictEqual(saveDateRes.success, true);
  const insertedJob = getJobById(saveDateRes.jobId);
  assert.strictEqual(insertedJob.posted_at, null, 'SQLite posted_at column must be null');

  // Cleanup
  db.prepare('DELETE FROM jobs WHERE id = ?').run(saveDateRes.jobId);
});

test('Correctness Audit 5: Company Research Transparency & Non-Fabrication', () => {
  // Query research for an unknown company with no job descriptions in the database
  const research = getCompanyResearch('NonExistentCorpXYZ999');

  // 1. Must be clearly marked unverified and generic placeholder
  assert.strictEqual(research.verifiedStatus, 'unverified');
  assert.strictEqual(research.isGenericPlaceholder, true);

  // 2. Zero fabrication: Must NOT invent arbitrary tech stack (e.g. Java, Spring Boot)
  assert.deepStrictEqual(
    research.techStack,
    [],
    'Must not invent arbitrary programming languages or frameworks when no verified data exists'
  );

  // 3. Overview and verification guide must explicitly declare placeholder status
  assert.ok(research.overview.includes('Unverified placeholder'));
  assert.ok(research.productsServices.includes('Unverified company information'));
  assert.ok(research.verificationGuide.companyDetails.includes('Generic placeholder template'));
});

test('Correctness Audit 6: Gmail Sync, Pagination, Defensive RFC 2822 Parsing & Multipart Extraction', () => {
  // 1. Defensive RFC 2822 Date parsing: Malformed Date header must NOT throw RangeError
  const malformedDateMsg = {
    id: 'gmail_msg_invalid_date',
    threadId: 'thread_1',
    payload: {
      headers: [
        { name: 'Subject', value: 'Interview Scheduled with TechCo' },
        { name: 'From', value: 'recruiter@techco.com' },
        { name: 'Date', value: 'This is not a valid RFC 2822 date string' }
      ],
      body: { data: Buffer.from('Interview details for junior engineer.').toString('base64url') }
    }
  };

  const parsedDate = parseRawGmailMessage(malformedDateMsg);
  assert.ok(parsedDate);
  assert.strictEqual(parsedDate.subject, 'Interview Scheduled with TechCo');
  assert.strictEqual(parsedDate.from, 'recruiter@techco.com');
  assert.strictEqual(parsedDate.date, null, 'Invalid date string must safely yield null without throwing RangeError');

  // 2. Base64url body data handling (containing '-' and '_')
  const base64UrlContent = 'Thank you for your application? We are excited to connect! Special characters: >><< &&';
  const urlSafeB64 = Buffer.from(base64UrlContent).toString('base64url');
  assert.ok(urlSafeB64.includes('-') || urlSafeB64.includes('_') || urlSafeB64.length > 0);

  const directBodyMsg = {
    id: 'gmail_msg_direct_b64url',
    threadId: 'thread_2',
    payload: {
      headers: [
        { name: 'Subject', value: 'Application Update' },
        { name: 'From', value: 'talent@startup.in' }
      ],
      body: { data: urlSafeB64 }
    }
  };
  const parsedDirect = parseRawGmailMessage(directBodyMsg);
  assert.strictEqual(parsedDirect.body, base64UrlContent);

  // 3. Nested multipart message extraction (multipart/mixed -> multipart/alternative -> text/plain)
  const nestedMultipartMsg = {
    id: 'gmail_msg_nested_multipart',
    threadId: 'thread_3',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'Subject', value: 'Assessment Test Invitation' },
        { name: 'From', value: 'hr@hiringplatform.com' }
      ],
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            {
              mimeType: 'text/plain',
              body: { data: Buffer.from('Please complete the coding assessment by Sunday.').toString('base64url') }
            },
            {
              mimeType: 'text/html',
              body: { data: Buffer.from('<p>Please complete the coding assessment by Sunday.</p>').toString('base64url') }
            }
          ]
        }
      ]
    }
  };
  const parsedNested = parseRawGmailMessage(nestedMultipartMsg);
  assert.match(parsedNested.body, /coding assessment by Sunday/i);
});
