import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeCanonicalUrl, generateJobDedupSignature } from '../src/discovery/urlNormalizer.js';
import { validateJobRecord } from '../src/discovery/jobValidator.js';
import { verifyJobUrl } from '../src/matcher/jobVerifier.js';
import { calculateAtsScore, evaluateJobEligibility } from '../src/resumes/atsScorer.js';
import { auditDocumentTruthfulness } from '../src/resumes/resumeGenerator.js';
import { loadCandidateProfile } from '../src/profile/profileManager.js';
import { saveOrUpdateJob } from '../src/tracker/jobTracker.js';
import { getDatabase } from '../src/db/schema.js';

test('Quality Hardening: Canonical URL Normalizer strips tracking and normalizes structure', () => {
  const dirtyUrl1 = 'https://Example.COM:443/careers/job/123/?utm_source=linkedin&utm_medium=cpc&ref=job_board#apply-now';
  const cleanUrl1 = normalizeCanonicalUrl(dirtyUrl1);
  assert.strictEqual(cleanUrl1, 'https://example.com/careers/job/123');

  const dirtyUrl2 = 'http://jobs.company.org/apply?session_id=xyz789&source=freehire&gh_src=custom_12';
  const cleanUrl2 = normalizeCanonicalUrl(dirtyUrl2);
  assert.strictEqual(cleanUrl2, 'http://jobs.company.org/apply');

  const invalidUrl = 'not-a-valid-url';
  assert.strictEqual(normalizeCanonicalUrl(invalidUrl), 'not-a-valid-url');
});

test('Quality Hardening: Job Deduplication detects duplicate listings across sources', () => {
  const jobA = {
    company: 'Wipro Technologies Pvt. Ltd.',
    title: 'Fresher Java Developer',
    location: 'Bengaluru, Karnataka'
  };
  const jobB = {
    company: 'Wipro Technologies',
    title: 'Fresher Java Developer',
    location: 'Bangalore, India'
  };

  const sigA = generateJobDedupSignature(jobA);
  const sigB = generateJobDedupSignature(jobB);
  assert.strictEqual(sigA, sigB, 'Should generate matching deduplication signatures');
});

test('Quality Hardening: Job Validator rejects invalid records and auto-repairs experience bounds', () => {
  // Invalid title & missing company
  const invalid = validateJobRecord({
    title: 'AB',
    company: 'N/A',
    url: 'invalid'
  });
  assert.strictEqual(invalid.isValid, false);
  assert.ok(invalid.errors.length >= 2);

  // Inverted experience auto-repair
  const inverted = validateJobRecord({
    title: 'Java Developer',
    company: 'Infosys',
    url: 'https://careers.infosys.com/job/456',
    experienceMin: 5,
    experienceMax: 2
  });
  assert.strictEqual(inverted.normalizedJob.experienceMin, 2);
  assert.strictEqual(inverted.normalizedJob.experienceMax, 5);
});

import http from 'node:http';

test('Quality Hardening: Job Verifier accurately categorizes statuses and NEVER marks jobs expired when blocked by bot challenges', async () => {
  // Spin up an in-memory test server
  const server = http.createServer((req, res) => {
    if (req.url === '/blocked-403') {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden by Cloudflare WAF');
    } else if (req.url === '/blocked-429') {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('Too Many Requests');
    } else if (req.url === '/bot-challenge') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>Attention Required! | Cloudflare</title></head><body>Please verify you are a human</body></html>');
    } else if (req.url === '/expired-404') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } else if (req.url === '/expired-closed-text') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Careers</h1><p>This position has been filled. Thank you.</p></body></html>');
    } else if (req.url === '/active-job') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Junior Java Developer</h1><p>Apply below.</p></body></html>');
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server Error');
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Test 403 Forbidden -> 'blocked', NOT 'expired'
    const res403 = await verifyJobUrl(`${baseUrl}/blocked-403`);
    assert.strictEqual(res403.verificationStatus, 'blocked');
    assert.strictEqual(res403.isAlive, true);
    assert.strictEqual(res403.isBlocked, true);
    assert.ok(res403.reason.includes('blocked automated request'));

    // 2. Test 429 Too Many Requests -> 'blocked', NOT 'expired'
    const res429 = await verifyJobUrl(`${baseUrl}/blocked-429`);
    assert.strictEqual(res429.verificationStatus, 'blocked');
    assert.strictEqual(res429.isAlive, true);

    // 3. Test Bot Challenge Screen -> 'blocked', NOT 'expired'
    const resBot = await verifyJobUrl(`${baseUrl}/bot-challenge`);
    assert.strictEqual(resBot.verificationStatus, 'blocked');
    assert.strictEqual(resBot.isAlive, true);
    assert.ok(resBot.reason.includes('Bot challenge'));

    // 4. Test 404 Not Found -> 'expired'
    const res404 = await verifyJobUrl(`${baseUrl}/expired-404`);
    assert.strictEqual(res404.verificationStatus, 'expired');
    assert.strictEqual(res404.isAlive, false);

    // 5. Test Closed vacancy marker in 200 OK -> 'expired'
    const resClosed = await verifyJobUrl(`${baseUrl}/expired-closed-text`);
    assert.strictEqual(resClosed.verificationStatus, 'expired');
    assert.strictEqual(resClosed.isAlive, false);
    assert.ok(resClosed.reason.includes('Closed vacancy banner'));

    // 6. Test Active job -> 'verified_active'
    const resActive = await verifyJobUrl(`${baseUrl}/active-job`);
    assert.strictEqual(resActive.verificationStatus, 'verified_active');
    assert.strictEqual(resActive.isAlive, true);
  } finally {
    server.close();
  }
});

test('Quality Hardening: Eligibility messages derive dynamically from JD and profile without hardcoding', () => {
  const profile = loadCandidateProfile();

  const jdStretch = {
    title: 'Backend Associate',
    company: 'Acme Systems',
    experience: { min: 2, max: 3, isFresherEligible: false, rawText: '2-3 years' },
    education: { isEligibleForMCA: true }
  };

  const stretchRes = evaluateJobEligibility(jdStretch, profile);
  assert.strictEqual(stretchRes.status, 'POTENTIAL_STRETCH');
  assert.ok(stretchRes.unmetMandatoryRequirements[0].includes('Backend Associate'));
  assert.ok(stretchRes.unmetMandatoryRequirements[0].includes('MCA'));

  const atsScore = calculateAtsScore(jdStretch, { personal: profile.personal, technicalSkills: { languages: ['Java'] }, projects: [], education: profile.education }, profile);
  assert.strictEqual(atsScore.eligibilityAssessment.status, 'POTENTIAL_STRETCH');
  assert.ok(atsScore.overallMatch.alert.message.includes('Acme Systems') || atsScore.overallMatch.alert.message.includes('Backend Associate'));
  assert.ok(atsScore.requirementBreakdown !== undefined);
});

test('Quality Hardening: Resume Auditor provides claim-level evidence verification', () => {
  const profile = loadCandidateProfile();

  const truthfulResume = {
    summary: 'Java Full Stack Developer with experience in Spring Boot and React.',
    technicalSkills: {
      languages: ['Java', 'SQL'],
      backend: ['Core Java', 'Spring Boot'],
      frontend: ['React.js'],
      databases: ['MySQL']
    },
    education: [
      { degree: 'Master of Computer Applications (MCA)', institution: 'AIMS Institutes, Bangalore', period: '2024 – 2026' }
    ],
    experience: [
      { role: 'Advanced Java Full Stack Development Intern', company: 'Anudip Foundation, Bangalore', period: 'Oct 2026' }
    ],
    projects: [
      { name: 'Employee Leave Management System', techStack: ['Java', 'Spring Boot', 'MySQL'] },
      { name: 'NearVia – Hyperlocal Marketplace for Daily-Wage Work', techStack: ['React', 'TypeScript', 'Node.js'] }
    ]
  };

  const auditTruthful = auditDocumentTruthfulness(truthfulResume, profile);
  assert.strictEqual(auditTruthful.passed, true);
  assert.ok(auditTruthful.claimAudits.length >= 3);
  assert.ok(auditTruthful.claimAudits.every(c => c.isSupported === true));

  // Fabricated resume with unknown company and unknown degree
  const fakeResume = {
    ...truthfulResume,
    education: [
      { degree: 'B.Tech in Artificial Intelligence', institution: 'MIT' }
    ],
    experience: [
      { role: 'Senior Architect', company: 'Google Inc.' }
    ],
    projects: [
      { name: 'Autonomous Quantum Satellite', techStack: ['Q#'] }
    ]
  };

  const auditFake = auditDocumentTruthfulness(fakeResume, profile);
  assert.strictEqual(auditFake.passed, false);
  assert.ok(auditFake.flags.some(f => f.category === 'UNVERIFIED_DEGREE'));
  assert.ok(auditFake.flags.some(f => f.category === 'UNVERIFIED_EXPERIENCE'));
  assert.ok(auditFake.flags.some(f => f.category === 'UNVERIFIED_PROJECT'));
  assert.ok(auditFake.claimAudits.some(c => c.isSupported === false));
});
