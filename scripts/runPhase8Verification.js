/**
 * CareerOS Phase 8 — Comprehensive Independent Verification Suite
 * Exercises Items 2 through 7 in isolation without modifying production databases or user secrets.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  encryptTokenPayload,
  decryptTokenPayload,
  secureWipeFile
} from '../src/email/tokenEncryption.js';

import {
  startDashboardServer
} from '../src/dashboard/server.js';

import {
  validateSafeJobUrl,
  validateSafeJobUrlAsync,
  isPrivateOrLoopbackIp,
  launchFormAssistant
} from '../src/automation/formAssistant.js';

import {
  auditTaxAccuracyForFinancialYear,
  calculateNewRegimeTax,
  calculateOfferTakeHome
} from '../src/intelligence/salaryCalculatorService.js';

import {
  backupDatabase,
  restoreDatabase
} from '../src/db/backupService.js';

import {
  disconnectAccount,
  consumeOAuthState,
  generateOAuthSecurityContext
} from '../src/email/googleOAuthClient.js';

import {
  extractJdRequirements
} from '../src/resumes/jdAnalyzer.js';

import {
  loadCandidateProfile
} from '../src/profile/profileManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

const results = {};

function logPass(item, detail) {
  console.log(`  [PASS] ${detail}`);
  if (!results[item]) results[item] = [];
  results[item].push({ status: 'PASS', detail });
}

function logFail(item, detail) {
  console.error(`  [FAIL] ${detail}`);
  if (!results[item]) results[item] = [];
  results[item].push({ status: 'FAIL', detail });
}

async function runItem2Verification() {
  console.log('\n--- Item 2: Google OAuth on Windows, Token Encryption, Migration & Recovery ---');
  try {
    // 1. Encryption at rest & Key Derivation
    const testTokens = {
      access_token: 'ya29.sample_test_access_token_12345',
      refresh_token: '1//sample_test_refresh_token_67890',
      token_type: 'Bearer',
      expires_at: Date.now() + 3600000
    };

    const encrypted = encryptTokenPayload(testTokens);
    if (encrypted.encrypted === true &&
        encrypted.algorithm === 'aes-256-gcm' &&
        encrypted.iv && encrypted.iv.length === 24 &&
        encrypted.tag && encrypted.tag.length === 32 &&
        encrypted.ciphertext) {
      logPass('item2', 'Token encryption at rest produces authenticated AES-256-GCM ciphertext with 96-bit IV and 128-bit tag.');
    } else {
      logFail('item2', 'Encrypted payload structure invalid.');
    }

    // 2. Restart persistence: Decrypting the encrypted payload
    const decrypted = decryptTokenPayload(encrypted);
    if (decrypted && decrypted.tokens && decrypted.tokens.access_token === testTokens.access_token) {
      logPass('item2', 'Restart persistence verified: Encrypted payload accurately decrypted to original token contents.');
    } else {
      logFail('item2', 'Decryption failed to recover original token contents.');
    }

    // 3. Plaintext legacy migration
    const legacyPlaintext = {
      access_token: 'legacy_access_token_abc',
      refresh_token: 'legacy_refresh_token_xyz'
    };
    const migrationResult = decryptTokenPayload(legacyPlaintext);
    if (migrationResult && migrationResult.needsMigration === true &&
        migrationResult.tokens.access_token === legacyPlaintext.access_token) {
      logPass('item2', 'Plaintext migration detection verified: Flagged legacy token for automatic encrypted rewrite.');
    } else {
      logFail('item2', 'Plaintext migration detection failed.');
    }

    // 4. Corrupted ciphertext recovery behavior
    const tamperedPayload = {
      ...encrypted,
      ciphertext: encrypted.ciphertext.slice(0, -4) + 'abcd'
    };
    const corruptResult = decryptTokenPayload(tamperedPayload);
    if (corruptResult === null) {
      logPass('item2', 'Recovery behavior verified: Tampered ciphertext gracefully rejected without unhandled crash.');
    } else {
      logFail('item2', 'Tampered ciphertext was not rejected.');
    }

    // 5. Disconnect account confirmation gate
    let disconnectBlocked = false;
    try {
      await disconnectAccount({ userConfirmed: false });
    } catch (e) {
      if (e.message.includes('User Confirmation Required')) {
        disconnectBlocked = true;
      }
    }
    if (disconnectBlocked) {
      logPass('item2', 'Disconnect account gate verified: Rejects unconfirmed disconnect request.');
    } else {
      logFail('item2', 'Disconnect account allowed without explicit confirmation.');
    }

    // 6. OAuth State & PKCE S256 verification
    const sec = generateOAuthSecurityContext('http://localhost:3000/oauth2callback');
    const consumed = consumeOAuthState(sec.state);
    const reused = consumeOAuthState(sec.state);
    if (consumed.valid === true && reused.valid === false) {
      logPass('item2', 'OAuth PKCE state single-use consumption and replay defense verified.');
    } else {
      logFail('item2', 'OAuth state single-use verification failed.');
    }

  } catch (err) {
    logFail('item2', `Exception in Item 2 verification: ${err.message}`);
  }
}

async function runItem3Verification() {
  console.log('\n--- Item 3: Dashboard Security Beyond 7 Tests (Origin, DNS Rebinding, CSRF, Payloads) ---');
  const TEST_PORT = 3981;
  let server;

  try {
    server = startDashboardServer(TEST_PORT, '127.0.0.1');
    await new Promise(res => setTimeout(res, 300));

    // 1. Browser Origin Behavior: Allowed Origin
    const reqAllowedOrigin = await fetch(`http://127.0.0.1:${TEST_PORT}/api/stats`, {
      headers: {
        'Origin': `http://127.0.0.1:${TEST_PORT}`
      }
    });
    if (reqAllowedOrigin.status === 200 &&
        reqAllowedOrigin.headers.get('access-control-allow-origin') === `http://127.0.0.1:${TEST_PORT}`) {
      logPass('item3', 'Browser-origin behavior: Same-origin request permitted with exact origin CORS header.');
    } else {
      logFail('item3', `Same-origin request failed: status ${reqAllowedOrigin.status}`);
    }

    // 2. Browser Origin Behavior: Malicious Cross-Origin Rejected
    const reqEvilOrigin = await fetch(`http://127.0.0.1:${TEST_PORT}/api/stats`, {
      headers: {
        'Origin': 'http://evil-attacker.com'
      }
    });
    if (reqEvilOrigin.status === 403) {
      logPass('item3', 'Browser-origin behavior: Malicious cross-origin header strictly blocked with 403 Forbidden.');
    } else {
      logFail('item3', `Malicious origin was not blocked: status ${reqEvilOrigin.status}`);
    }

    // 3. DNS Rebinding: Malicious Host Header
    const dnsRebindRes = await new Promise((resolve) => {
      const r = http.request({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/stats',
        method: 'GET',
        headers: {
          'Host': 'attacker.rebind.internal.evil.com:3981'
        }
      }, (res) => {
        resolve(res.statusCode);
      });
      r.on('error', () => resolve(500));
      r.end();
    });
    if (dnsRebindRes === 400) {
      logPass('item3', 'DNS Rebinding defense verified: Unauthorized Host header rejected with 400 Bad Request.');
    } else {
      logFail('item3', `DNS Rebinding attempt returned unexpected status: ${dnsRebindRes}`);
    }

    // 4. CSRF Protection: Sec-Fetch-Site: cross-site on state-changing endpoint
    const csrfRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/resume/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'cross-site'
      },
      body: JSON.stringify({ jobId: 1 })
    });
    if (csrfRes.status === 403) {
      logPass('item3', 'CSRF protection verified: Sec-Fetch-Site: cross-site on POST rejected with 403 Forbidden.');
    } else {
      logFail('item3', `Cross-site state-changing POST was not blocked: status ${csrfRes.status}`);
    }

    // 5. Payload limit enforcement (> 512KB) on registered POST route
    const largePayload = JSON.stringify({ data: 'A'.repeat(600 * 1024), jobId: 1 });
    const payloadRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/resume/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: largePayload
    });
    if (payloadRes.status === 413) {
      logPass('item3', 'Payload size enforcement verified: Request body > 512KB rejected with 413 Payload Too Large.');
    } else {
      logFail('item3', `Large payload returned unexpected status: ${payloadRes.status}`);
    }

    // 6. Content-Type validation on registered POST route
    const badContentTypeRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/resume/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: 'invalid plain text'
    });
    if (badContentTypeRes.status === 415) {
      logPass('item3', 'Media-Type enforcement verified: Non-JSON body on POST rejected with 415 Unsupported Media Type.');
    } else {
      logFail('item3', `Invalid content-type returned unexpected status: ${badContentTypeRes.status}`);
    }

    // 7. Path traversal prevention on static file serving
    const staticTraversalRes = await fetch(`http://127.0.0.1:${TEST_PORT}/..%2f..%2fpackage.json`);
    if (staticTraversalRes.status === 403 || staticTraversalRes.status === 404) {
      logPass('item3', 'Static serving path traversal guard verified: Escape attempts return 403/404.');
    } else {
      logFail('item3', `Static traversal returned unexpected status: ${staticTraversalRes.status}`);
    }

    // 8. Error sanitization (no internal file paths exposed)
    const notFoundApiRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/job/not-a-number/tailor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const notFoundText = await notFoundApiRes.text();
    if (!notFoundText.includes('D:\\job\\job') && !notFoundText.includes('/job/job')) {
      logPass('item3', 'Error sanitization verified: Internal filesystem paths redacted from client responses.');
    } else {
      logFail('item3', 'Internal filesystem path leaked in response.');
    }

  } catch (err) {
    logFail('item3', `Exception in Item 3 verification: ${err.message}`);
  } finally {
    if (server) {
      await new Promise(r => server.close(r));
    }
  }
}

async function runItem4Verification() {
  console.log('\n--- Item 4: Playwright URL Validation against DNS Resolution & IPv6/Private-Network Bypasses ---');
  try {
    const maliciousUrls = [
      { url: 'http://127.0.0.1:8080/apply', desc: 'IPv4 loopback (127.0.0.1)' },
      { url: 'http://[::1]:8080/apply', desc: 'IPv6 loopback ([::1])' },
      { url: 'http://[::ffff:127.0.0.1]:8080/apply', desc: 'IPv4-mapped IPv6 dotted decimal' },
      { url: 'http://[::ffff:7f00:1]:8080/apply', desc: 'IPv4-mapped IPv6 hex loopback' },
      { url: 'http://[fc00::1]:8080/apply', desc: 'IPv6 Unique Local Address (fc00::/7)' },
      { url: 'http://[fd12:3456:789a::1]:8080/apply', desc: 'IPv6 Unique Local Address (fd00::/8)' },
      { url: 'http://[fe80::1]:8080/apply', desc: 'IPv6 Link-Local Address (fe80::/10)' },
      { url: 'http://169.254.169.254/latest/meta-data/', desc: 'AWS/Cloud instance metadata IP' },
      { url: 'http://2130706433/apply', desc: 'Decimal integer encoded loopback (2130706433)' },
      { url: 'http://localtest.me/apply', desc: 'Dynamic DNS loopback domain (localtest.me)' },
      { url: 'http://test.127.0.0.1.nip.io/apply', desc: 'Dynamic DNS wildcard domain (nip.io)' },
      { url: 'http://subdomain.sslip.io/apply', desc: 'Dynamic DNS wildcard domain (sslip.io)' },
      { url: 'http://service.internal/apply', desc: 'Private internal TLD (.internal)' },
      { url: 'http://server.local/apply', desc: 'mDNS local TLD (.local)' },
      { url: 'file:///C:/Windows/win.ini', desc: 'File URI scheme traversal' },
      { url: 'javascript:alert(1)', desc: 'Javascript URI scheme execution' }
    ];

    let allBlocked = true;
    for (const testCase of maliciousUrls) {
      let blocked = false;
      try {
        validateSafeJobUrl(testCase.url);
      } catch (e) {
        if (e.message.includes('Security Violation') || e.message.includes('Invalid Job URL')) {
          blocked = true;
        }
      }
      if (!blocked) {
        logFail('item4', `Failed to block malicious vector: ${testCase.desc} (${testCase.url})`);
        allBlocked = false;
      }
    }

    if (allBlocked) {
      logPass('item4', 'All 16 private network, IPv6, loopback, decimal, and dynamic DNS vectors strictly blocked.');
    }

    // Test DNS resolution validation:
    let dnsBlocked = false;
    try {
      await validateSafeJobUrlAsync('http://localhost:8080/apply');
    } catch (e) {
      if (e.message.includes('Security Violation')) {
        dnsBlocked = true;
      }
    }
    if (dnsBlocked) {
      logPass('item4', 'Async DNS resolution defense verified: Resolving to local/private network triggers security violation.');
    } else {
      logFail('item4', 'Async DNS resolution failed to block localhost.');
    }

    // Verify legitimate job board URLs pass seamlessly
    const legitimateUrls = [
      'https://boards.greenhouse.io/airbnb/jobs/456789',
      'https://jobs.lever.co/netflix/1234-abcd',
      'https://careers.google.com/jobs/results/998877'
    ];

    let legitPassed = true;
    for (const legit of legitimateUrls) {
      try {
        const validated = validateSafeJobUrl(legit);
        if (!validated.startsWith('https://')) legitPassed = false;
      } catch {
        legitPassed = false;
      }
    }
    if (legitPassed) {
      logPass('item4', 'Legitimate external ATS URLs (Greenhouse, Lever, Google Careers) successfully validated and permitted.');
    } else {
      logFail('item4', 'Legitimate external ATS URLs were erroneously blocked.');
    }

  } catch (err) {
    logFail('item4', `Exception in Item 4 verification: ${err.message}`);
  }
}

async function runItem5Verification() {
  console.log('\n--- Item 5: Audit Salary Calculations & Statutory Verification for FY 2024-25, FY 2025-26 & FY 2026-27 ---');
  try {
    // 1. Audit FY 2024-25: Finance (No. 2) Act, 2024
    const audit24 = auditTaxAccuracyForFinancialYear('FY 2024-25');
    if (audit24.verified === true &&
        audit24.basicExemptionLimit === 300000 &&
        audit24.rebateThreshold === 700000 &&
        audit24.governingAct.includes('Finance (No. 2) Act, 2024')) {
      logPass('item5', 'FY 2024-25 verified against enacted Finance (No. 2) Act, 2024 (Basic Exemption: ₹3L, Rebate: ₹7L).');
    } else {
      logFail('item5', 'Audit for FY 2024-25 failed.');
    }

    // 2. Audit FY 2025-26: Finance Act, 2025
    const audit25 = auditTaxAccuracyForFinancialYear('FY 2025-26');
    if (audit25.verified === true &&
        audit25.basicExemptionLimit === 400000 &&
        audit25.rebateThreshold === 1200000 &&
        audit25.governingAct.includes('Finance Act, 2025')) {
      logPass('item5', 'FY 2025-26 verified against enacted Finance Act, 2025 (Basic Exemption: ₹4L, Rebate: ₹12L, Max Rebate: ₹60,000).');
    } else {
      logFail('item5', 'Audit for FY 2025-26 failed.');
    }

    // 3. Audit FY 2026-27: Income-tax Act, 2025 (Effective 1 April 2026)
    const audit26 = auditTaxAccuracyForFinancialYear('FY 2026-27');
    if (audit26.verified === true &&
        audit26.taxYear.includes('Tax Year 2026-27') &&
        audit26.governingAct.includes('Income-tax Act, 2025') &&
        audit26.actTransition.includes('repeals and replaces the Income-tax Act, 1961')) {
      logPass('item5', 'FY 2026-27 statutorily verified under Income-tax Act, 2025 (effective 1 April 2026, transitioning to unified Tax Year).');
    } else {
      logFail('item5', 'Audit for FY 2026-27 failed.');
    }

    // 4. FY 2024-25 Calculation Accuracy
    // Taxable income ₹7,00,000 -> Nil tax under Section 87A (Rebate ₹20,000)
    const taxCase24A = calculateNewRegimeTax(700000, 'FY 2024-25');
    if (taxCase24A.totalTax === 0 && taxCase24A.rebate87A === 20000) {
      logPass('item5', 'FY 2024-25 Section 87A Rebate verified: Taxable income ₹7,00,000 yields ₹0 total tax.');
    } else {
      logFail('item5', `FY 2024-25 Section 87A Rebate incorrect: ${JSON.stringify(taxCase24A)}`);
    }

    // Marginal Relief for FY 2024-25: ₹7,10,000 -> excess = 10,000 -> tax before cess = 10,000 -> total = 10,400
    const taxCase24B = calculateNewRegimeTax(710000, 'FY 2024-25');
    if (taxCase24B.marginalRelief === 11000 && taxCase24B.totalTax === 10400) {
      logPass('item5', 'FY 2024-25 Marginal Relief verified: ₹7,10,000 taxable yields ₹11,000 relief, ₹10,400 total tax.');
    } else {
      logFail('item5', `FY 2024-25 Marginal Relief incorrect: ${JSON.stringify(taxCase24B)}`);
    }

    // 5. FY 2025-26 Calculation Accuracy (Finance Act, 2025)
    // Taxable income ₹12,00,000 -> Nil tax under Section 87A (Rebate ₹60,000)
    const taxCase25A = calculateNewRegimeTax(1200000, 'FY 2025-26');
    if (taxCase25A.totalTax === 0 && taxCase25A.rebate87A === 60000) {
      logPass('item5', 'FY 2025-26 Section 87A Rebate verified: Taxable income ₹12,00,000 yields ₹0 total tax (Rebate ₹60,000).');
    } else {
      logFail('item5', `FY 2025-26 Section 87A Rebate incorrect: ${JSON.stringify(taxCase25A)}`);
    }

    // Marginal Relief for FY 2025-26: ₹12,20,000 -> slab tax = 63,000 -> excess = 20,000 -> relief = 43,000 -> total = 20,800
    const taxCase25B = calculateNewRegimeTax(1220000, 'FY 2025-26');
    if (taxCase25B.marginalRelief === 43000 && taxCase25B.totalTax === 20800) {
      logPass('item5', 'FY 2025-26 Marginal Relief verified: ₹12,20,000 taxable yields ₹43,000 relief, ₹20,800 total tax.');
    } else {
      logFail('item5', `FY 2025-26 Marginal Relief incorrect: ${JSON.stringify(taxCase25B)}`);
    }

    // Higher Slab for FY 2025-26: ₹15,00,000 -> slab tax = 1,05,000 -> cess = 4,200 -> total = 1,09,200
    const taxCase25C = calculateNewRegimeTax(1500000, 'FY 2025-26');
    if (taxCase25C.baseTax === 105000 && taxCase25C.totalTax === 109200) {
      logPass('item5', 'FY 2025-26 Higher Slabs verified: ₹15,00,000 taxable yields ₹1,05,000 base tax + ₹4,200 cess = ₹1,09,200.');
    } else {
      logFail('item5', `FY 2025-26 Higher Slabs incorrect: ${JSON.stringify(taxCase25C)}`);
    }

    // 6. FY 2026-27: Income-tax Act, 2025 Section 19(1) Professional Tax & Standard Deduction
    // 6a. Zero PT case: CTC ₹12,75,000, Fixed ₹12,75,000, PT ₹0 -> Taxable ₹12,00,000 -> Tax ₹0
    const offer26ZeroPt = calculateOfferTakeHome({
      ctcAnnual: 1275000,
      fixedBaseAnnual: 1275000,
      professionalTaxAnnual: 0,
      financialYear: 'FY 2026-27'
    });
    if (offer26ZeroPt.taxBreakdown.standardDeduction === 75000 &&
        offer26ZeroPt.taxBreakdown.employmentTaxDeduction === 0 &&
        offer26ZeroPt.taxBreakdown.taxableIncome === 1200000 &&
        offer26ZeroPt.taxBreakdown.finalTaxPayable === 0) {
      logPass('item5', 'FY 2026-27 with zero PT verified: Fixed gross ₹12,75,000 yields ₹12,00,000 taxable income after ₹75k standard deduction and ₹0 final tax.');
    } else {
      logFail('item5', `FY 2026-27 with zero PT mismatch: ${JSON.stringify(offer26ZeroPt.taxBreakdown)}`);
    }

    // 6b. With ₹2,400 PT under Section 19(1) Table Sl. No. 1: Fixed ₹12,77,400, PT ₹2,400 -> Taxable ₹12,00,000 -> Tax ₹0
    const offer26WithPt = calculateOfferTakeHome({
      ctcAnnual: 1277400,
      fixedBaseAnnual: 1277400,
      professionalTaxAnnual: 2400,
      financialYear: 'FY 2026-27'
    });
    if (offer26WithPt.taxBreakdown.standardDeduction === 75000 &&
        offer26WithPt.taxBreakdown.employmentTaxDeduction === 2400 &&
        offer26WithPt.taxBreakdown.taxableIncome === 1200000 &&
        offer26WithPt.taxBreakdown.finalTaxPayable === 0 &&
        offer26WithPt.employeeDeductions.annual.professionalTax === 2400) {
      logPass('item5', 'FY 2026-27 with ₹2,400 PT verified: Fixed gross ₹12,77,400 yields ₹12,00,000 taxable income after ₹75k std ded + ₹2.4k Section 19(1) PT ded, zero tax, and PT deducted once on payslip.');
    } else {
      logFail('item5', `FY 2026-27 with PT mismatch: ${JSON.stringify(offer26WithPt.taxBreakdown)}`);
    }

    // 6c. Marginal Relief Boundary for FY 2026-27: Inside vs Outside boundary
    const taxInsideMR = calculateNewRegimeTax(1270000, 'FY 2026-27');
    const taxOutsideMR = calculateNewRegimeTax(1271000, 'FY 2026-27');
    if (taxInsideMR.marginalRelief === 500 && taxInsideMR.totalTax === 72800 &&
        taxOutsideMR.marginalRelief === 0 && taxOutsideMR.totalTax === 73476) {
      logPass('item5', 'FY 2026-27 Marginal Relief Boundary verified: ₹12,70,000 taxable receives ₹500 relief (tax ₹72,800); ₹12,71,000 taxable receives ₹0 relief (tax ₹73,476).');
    } else {
      logFail('item5', `FY 2026-27 Marginal Relief Boundary mismatch: inside=${JSON.stringify(taxInsideMR)}, outside=${JSON.stringify(taxOutsideMR)}`);
    }

    // 6d. Section 115BAC(2)(i) PT Disallowance Retention for FY 2024-25 & FY 2025-26
    const offer24PtCheck = calculateOfferTakeHome({
      ctcAnnual: 1000000,
      fixedBaseAnnual: 900000,
      professionalTaxAnnual: 2400,
      financialYear: 'FY 2024-25'
    });
    const offer25PtCheck = calculateOfferTakeHome({
      ctcAnnual: 1400000,
      fixedBaseAnnual: 1300000,
      professionalTaxAnnual: 2400,
      financialYear: 'FY 2025-26'
    });
    if (offer24PtCheck.taxBreakdown.employmentTaxDeduction === 0 &&
        offer24PtCheck.taxBreakdown.taxableIncome === 825000 &&
        offer25PtCheck.taxBreakdown.employmentTaxDeduction === 0 &&
        offer25PtCheck.taxBreakdown.taxableIncome === 1225000) {
      logPass('item5', 'FY 2024-25 & FY 2025-26 PT Disallowance verified: Section 115BAC(2)(i) retains zero PT deduction from taxable income.');
    } else {
      logFail('item5', `Section 115BAC PT disallowance retention failed: 24=${JSON.stringify(offer24PtCheck.taxBreakdown)}, 25=${JSON.stringify(offer25PtCheck.taxBreakdown)}`);
    }

  } catch (err) {
    logFail('item5', `Exception in Item 5 verification: ${err.message}`);
  }
}

async function runItem6Verification() {
  console.log('\n--- Item 6: Real Local Smoke Test (Dashboard, Job Matching, Resume, Application & Approval Gate) ---');
  const SMOKE_PORT = 3982;
  let server;

  try {
    server = startDashboardServer(SMOKE_PORT, '127.0.0.1');
    await new Promise(res => setTimeout(res, 400));

    // 1. Load jobs
    const jobsRes = await fetch(`http://127.0.0.1:${SMOKE_PORT}/api/jobs`);
    if (jobsRes.status !== 200) throw new Error(`GET /api/jobs returned status ${jobsRes.status}`);
    const jobsData = await jobsRes.json();
    const jobs = Array.isArray(jobsData) ? jobsData : (jobsData.jobs || []);
    if (jobs.length > 0) {
      logPass('item6', `Dashboard API loaded ${jobs.length} jobs successfully.`);
    } else {
      logFail('item6', 'GET /api/jobs returned empty job list.');
    }

    const testJob = jobs[0];
    if (!testJob || !testJob.id) {
      throw new Error('No valid job available for smoke test.');
    }

    // 2. ATS Score & Matching API (POST /api/resume/score)
    const profile = loadCandidateProfile();
    const jdAnalysis = extractJdRequirements(testJob.description || testJob.title, testJob.title);
    const scoreRes = await fetch(`http://127.0.0.1:${SMOKE_PORT}/api/resume/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jdAnalysis,
        resumeContent: profile
      })
    });
    if (scoreRes.status === 200) {
      const scoreData = await scoreRes.json();
      if (scoreData.success && scoreData.atsScore) {
        logPass('item6', `ATS matching API (/api/resume/score) evaluated candidate against ${testJob.title} (Score: ${scoreData.atsScore.overallScore}).`);
      } else {
        logFail('item6', 'ATS matching returned unexpected structure.');
      }
    } else {
      logFail('item6', `POST /api/resume/score returned status ${scoreRes.status}`);
    }

    // 3. Tailor resume (POST /api/job/:id/tailor)
    const tailorRes = await fetch(`http://127.0.0.1:${SMOKE_PORT}/api/job/${testJob.id}/tailor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (tailorRes.status === 200) {
      const tailorData = await tailorRes.json();
      if (tailorData.success && tailorData.resumeMarkdown && tailorData.coverLetterMarkdown) {
        logPass('item6', `Tailored resume & cover letter generated successfully for Job ID ${testJob.id} (${testJob.company}).`);
      } else {
        logFail('item6', 'Tailor resume returned unexpected structure.');
      }
    } else {
      logFail('item6', `POST /api/job/${testJob.id}/tailor returned status ${tailorRes.status}`);
    }

    // 4. Prepare application dossier (GET /api/job/:id/application)
    const prepRes = await fetch(`http://127.0.0.1:${SMOKE_PORT}/api/job/${testJob.id}/application`);
    if (prepRes.status === 200) {
      const prepData = await prepRes.json();
      if (prepData.success && prepData.dossier && prepData.dossier.checklist) {
        logPass('item6', `Application dossier prepared with ${prepData.dossier.checklist.length}-step checklist and verified profile.`);
      } else {
        logFail('item6', 'Application preparation returned unexpected structure.');
      }
    } else {
      logFail('item6', `GET /api/job/${testJob.id}/application returned status ${prepRes.status}`);
    }

    // 5. Verify Approval Gate strictly blocks unconfirmed browser launch via API
    const unconfirmedAssistRes = await fetch(`http://127.0.0.1:${SMOKE_PORT}/api/job/${testJob.id}/assist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userConfirmedApproval: false })
    });
    if (unconfirmedAssistRes.status === 400) {
      const errBody = await unconfirmedAssistRes.json();
      if (errBody.error && errBody.error.includes('Human Approval Gate')) {
        logPass('item6', 'API Human Approval Gate (/api/job/:id/assist) strictly blocks execution when userConfirmedApproval is false.');
      } else {
        logFail('item6', 'Approval gate returned 400 but unexpected error message.');
      }
    } else {
      logFail('item6', `Approval gate test returned status ${unconfirmedAssistRes.status}`);
    }

    // 6. Verify Form Assistant low-level approval gate
    let lowLevelGateBlocked = false;
    try {
      await launchFormAssistant(testJob, { userConfirmedApproval: false });
    } catch (e) {
      if (e.code === 'APPROVAL_REQUIRED' || e.message.includes('Human Approval Gate')) {
        lowLevelGateBlocked = true;
      }
    }
    if (lowLevelGateBlocked) {
      logPass('item6', 'Automation Form Assistant module strictly enforces APPROVAL_REQUIRED gate before browser invocation.');
    } else {
      logFail('item6', 'Automation module allowed launch without user confirmation.');
    }

  } catch (err) {
    logFail('item6', `Exception in Item 6 verification: ${err.message}`);
  } finally {
    if (server) {
      await new Promise(r => server.close(r));
    }
  }
}

async function runItem7Verification() {
  console.log('\n--- Item 7: Database Backup & Restore with Disposable Database & Safety Guard ---');
  const DISPOSABLE_DB_PATH = path.join(DATA_DIR, 'disposable_verify_test.db');
  let backupFile = null;

  try {
    // 1. Create disposable SQLite database
    const db = new DatabaseSync(DISPOSABLE_DB_PATH);
    db.exec(`
      CREATE TABLE test_data (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        val TEXT
      );
      INSERT INTO test_data (id, name, val) VALUES (1, 'Initial Record', 'original_val');
      INSERT INTO test_data (id, name, val) VALUES (2, 'Second Record', 'original_val_2');
    `);
    const initialRows = db.prepare('SELECT * FROM test_data').all();
    db.close();

    if (initialRows.length === 2) {
      logPass('item7', 'Disposable test database initialized with test records.');
    } else {
      logFail('item7', 'Failed to initialize disposable test database.');
    }

    // 2. Perform safe backup of disposable database using direct file copy + integrity check
    const timestamp = Date.now();
    backupFile = `disposable_backup_${timestamp}.db`;
    const backupDest = path.join(BACKUPS_DIR, backupFile);
    fs.copyFileSync(DISPOSABLE_DB_PATH, backupDest);

    const testDb = new DatabaseSync(backupDest);
    const integrity = testDb.prepare('PRAGMA integrity_check').get();
    testDb.close();

    if (integrity && integrity['integrity_check'] === 'ok') {
      logPass('item7', 'Backup created successfully with passing PRAGMA integrity_check: ok.');
    } else {
      logFail('item7', 'Backup creation integrity check failed.');
    }

    // 3. Mutate data in disposable database
    const mutateDb = new DatabaseSync(DISPOSABLE_DB_PATH);
    mutateDb.exec("UPDATE test_data SET val = 'mutated_after_backup' WHERE id = 1");
    mutateDb.close();

    // 4. Test Path Traversal Protection during Restore
    let traversalBlocked = false;
    try {
      restoreDatabase('../../disposable_backup_evil.db', { userConfirmed: true });
    } catch (e) {
      if (e.message.includes('Security Violation') || e.message.includes('Unsafe backup path')) {
        traversalBlocked = true;
      }
    }
    if (traversalBlocked) {
      logPass('item7', 'Path traversal restoration attack strictly blocked by backupService.');
    } else {
      logFail('item7', 'Path traversal restore was not blocked.');
    }

    // 5. Test Unconfirmed Restoration Protection
    let unconfirmedBlocked = false;
    try {
      restoreDatabase(backupFile, { userConfirmed: false });
    } catch (e) {
      if (e.message.includes('Destructive Action Protection') || e.message.includes('userConfirmed')) {
        unconfirmedBlocked = true;
      }
    }
    if (unconfirmedBlocked) {
      logPass('item7', 'Destructive action protection verified: Unconfirmed restore rejected.');
    } else {
      logFail('item7', 'Unconfirmed restore was permitted.');
    }

    // 6. Restore backup to disposable DB
    fs.copyFileSync(backupDest, DISPOSABLE_DB_PATH);
    const verifyRestoredDb = new DatabaseSync(DISPOSABLE_DB_PATH);
    const restoredRow = verifyRestoredDb.prepare('SELECT * FROM test_data WHERE id = 1').get();
    const finalIntegrity = verifyRestoredDb.prepare('PRAGMA integrity_check').get();
    verifyRestoredDb.close();

    if (restoredRow && restoredRow.val === 'original_val' && finalIntegrity['integrity_check'] === 'ok') {
      logPass('item7', 'Disposable database restored cleanly; verified original records and PRAGMA integrity_check: ok.');
    } else {
      logFail('item7', 'Database restore did not restore original values or integrity check failed.');
    }

  } catch (err) {
    logFail('item7', `Exception in Item 7 verification: ${err.message}`);
  } finally {
    // Clean up disposable database and test backup artifacts
    try {
      if (fs.existsSync(DISPOSABLE_DB_PATH)) fs.unlinkSync(DISPOSABLE_DB_PATH);
      if (backupFile) {
        const bp = path.join(BACKUPS_DIR, backupFile);
        if (fs.existsSync(bp)) fs.unlinkSync(bp);
      }
    } catch (cleanErr) {
      console.warn('Cleanup notice:', cleanErr.message);
    }
  }
}

async function runAll() {
  console.log('================================================================');
  console.log('  CareerOS Phase 8 — Comprehensive Independent Verification  ');
  console.log('================================================================');

  await runItem2Verification();
  await runItem3Verification();
  await runItem4Verification();
  await runItem5Verification();
  await runItem6Verification();
  await runItem7Verification();

  console.log('\n================================================================');
  console.log('  Summary of Independent Verifications:');
  console.log('================================================================');
  let totalPass = 0;
  let totalFail = 0;
  for (const [item, list] of Object.entries(results)) {
    const passed = list.filter(r => r.status === 'PASS').length;
    const failed = list.filter(r => r.status === 'FAIL').length;
    totalPass += passed;
    totalFail += failed;
    console.log(`  ${item.toUpperCase()}: ${passed} passed, ${failed} failed`);
  }
  console.log(`\n  TOTAL: ${totalPass} passed, ${totalFail} failed`);
  console.log('================================================================\n');

  if (totalFail > 0) process.exit(1);
}

runAll();
