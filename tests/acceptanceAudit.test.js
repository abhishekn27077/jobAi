import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { getDatabase } from '../src/db/schema.js';
import { loadCandidateProfile } from '../src/profile/profileManager.js';
import { evaluateJobFit } from '../src/matcher/scoringEngine.js';
import { normalizeCanonicalUrl, normalizeLocation } from '../src/discovery/urlNormalizer.js';
import { validateJobRecord } from '../src/discovery/jobValidator.js';
import { fetchSmartRecruitersJobs, fetchGreenhouseJobs, extractBasicSkills } from '../src/discovery/directAtsClient.js';
import { generateStudioResume } from '../src/resumes/resumeStudioService.js';
import { auditDocumentTruthfulness } from '../src/resumes/resumeGenerator.js';
import { prepareApplication, confirmApplicationSubmission } from '../src/automation/applicationWorkflow.js';
import { launchFormAssistant, validateSafeJobUrl } from '../src/automation/formAssistant.js';
import { parseRawGmailMessage } from '../src/email/emailSyncService.js';
import { getCompanyResearch } from '../src/intelligence/companyResearchService.js';
import { encryptTokenPayload, decryptTokenPayload } from '../src/email/tokenEncryption.js';
import { backupDatabase, restoreDatabase } from '../src/db/backupService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Phase 9 Audit 1: Live Indian Tech Location Normalization', () => {
  // Candidate prioritizes Bengaluru and Remote India, followed by Indian tech hubs
  assert.strictEqual(normalizeLocation('Bengaluru'), 'Bengaluru, Karnataka, India');
  assert.strictEqual(normalizeLocation('Bangalore, India'), 'Bengaluru, Karnataka, India');
  assert.strictEqual(normalizeLocation('Remote, India'), 'Remote (India)');
  assert.strictEqual(normalizeLocation('Hyderabad'), 'Hyderabad, Telangana, India');
  assert.strictEqual(normalizeLocation('Pune, Maharashtra'), 'Pune, Maharashtra, India');
  assert.strictEqual(normalizeLocation('Noida, Uttar Pradesh'), 'Delhi NCR, India');
  assert.strictEqual(normalizeLocation('Gurugram, Haryana'), 'Delhi NCR, India');
  assert.strictEqual(normalizeLocation('Chennai'), 'Chennai, Tamil Nadu, India');
  assert.strictEqual(normalizeLocation('Mumbai'), 'Mumbai, Maharashtra, India');
});

test('Phase 9 Audit 2: SmartRecruiters & Greenhouse Non-Fabrication Audit', async () => {
  // Mock SmartRecruiters response with a non-Java posting
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (url.includes('smartrecruiters.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: [
              {
                id: 'sr-design-01',
                name: 'Product Designer (UI/UX)',
                company: { identifier: 'DesignStudio', name: 'Design Studio' },
                location: { city: 'Bengaluru', remote: false },
                typeOfEmployment: { label: 'Full-time' },
                department: { label: 'Design' },
                releasedDate: null
              }
            ]
          })
        };
      } else if (url.includes('greenhouse.io')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            jobs: [
              {
                id: 8881,
                title: 'Backend Engineer (Java & Spring Boot)',
                absolute_url: 'https://boards.greenhouse.io/groww/jobs/8881',
                location: { name: 'Bengaluru, India' },
                updated_at: '2026-02-15T10:00:00Z',
                content: '&lt;p&gt;We are seeking a backend engineer proficient in Java, Spring Boot, and PostgreSQL to design microservices.&lt;/p&gt;'
              }
            ]
          })
        };
      }
      return originalFetch(url);
    };

    // 1. SmartRecruiters: Must NOT invent Java/Spring Boot/SQL when role is UI/UX Design!
    const srJobs = await fetchSmartRecruitersJobs('DesignStudio', 'Design');
    assert.strictEqual(srJobs.length, 1);
    const srJob = srJobs[0];
    assert.strictEqual(srJob.title, 'Product Designer (UI/UX)');
    assert.strictEqual(srJob.postedAt, null, 'Unlisted posting date must remain null');
    assert.ok(!srJob.skills.includes('Java'), 'Must NOT invent Java skills for a Designer role');
    assert.ok(!srJob.skills.includes('Spring Boot'), 'Must NOT invent Spring Boot skills for a Designer role');

    // 2. Greenhouse: Must extract genuine skills from actual HTML description
    const ghJobs = await fetchGreenhouseJobs('groww');
    assert.strictEqual(ghJobs.length, 1);
    const ghJob = ghJobs[0];
    assert.strictEqual(ghJob.title, 'Backend Engineer (Java & Spring Boot)');
    assert.ok(ghJob.skills.includes('Java'), 'Must extract Java from genuine description');
    assert.ok(ghJob.skills.includes('Spring Boot'), 'Must extract Spring Boot from genuine description');
    assert.ok(ghJob.skills.includes('PostgreSQL'), 'Must extract PostgreSQL from genuine description');
    assert.strictEqual(ghJob.postedAt, '2026-02-15T10:00:00Z');

  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Phase 9 Audit 3: Job Eligibility & Match Scoring Against Verified Profile', () => {
  const profile = loadCandidateProfile();
  assert.strictEqual(profile.status.graduationYear, 2026);
  assert.match(profile.status.targetLevel, /0 years full-time/i);

  // 1. Matching Fresher Role in Bengaluru
  const matchingJob = {
    id: 991,
    title: 'Junior Java Developer',
    company: 'Fintech Bengaluru',
    location: 'Bengaluru, Karnataka, India',
    description: 'Looking for a fresher/junior software engineer with Java, Spring Boot, REST APIs and SQL fundamentals.',
    skills: ['Java', 'Spring Boot', 'SQL', 'REST APIs'],
    experience_min: 0,
    experience_max: 1
  };
  const matchEval = evaluateJobFit(matchingJob);
  assert.strictEqual(matchEval.fresherEligible, 1);
  assert.strictEqual(matchEval.recommendation, 'RECOMMENDED');
  assert.ok(matchEval.score >= 70, `Score should be >= 70, got ${matchEval.score}`);
  assert.ok(matchEval.matchedSkills.includes('Java'));
  assert.ok(matchEval.matchedSkills.includes('Spring Boot'));

  // 2. Senior / Lead Role Mismatch
  const seniorJob = {
    id: 992,
    title: 'Lead Architect / Principal Java Engineer',
    company: 'Enterprise Corp',
    location: 'Bengaluru, Karnataka, India',
    description: 'Minimum 8+ years of production microservices experience required.',
    skills: ['Java', 'Microservices', 'Kubernetes'],
    experience_min: 8,
    experience_max: 12
  };
  const seniorEval = evaluateJobFit(seniorJob);
  assert.strictEqual(seniorEval.fresherEligible, 0);
  assert.strictEqual(seniorEval.recommendation, 'REJECTED');
  assert.strictEqual(seniorEval.breakdown.seniorityScore, 0);
  assert.match(seniorEval.summaryReason, /Senior\/Experienced role/i);
});

test('Phase 9 Audit 4: Resume Tailoring & Strict Truthfulness Auditor', async () => {
  const profile = loadCandidateProfile();
  const testJob = {
    id: 993,
    title: 'Junior Backend Developer',
    company: 'CloudNative Corp',
    location: 'Bengaluru, India',
    description: 'Backend developer with hands-on Java, Spring Boot and PostgreSQL knowledge.',
    skills: ['Java', 'Spring Boot', 'PostgreSQL']
  };

  // 1. Generate truthful resume
  const studioRes = await generateStudioResume(testJob);
  assert.ok(studioRes.content);
  assert.ok(studioRes.content.summary);

  // 2. Truthfulness Audit on legitimate generated resume
  const validAudit = auditDocumentTruthfulness(studioRes.content, profile);
  assert.strictEqual(validAudit.passed, true, 'Truthful generated resume must pass audit');
  assert.strictEqual(validAudit.hasCritical, false);

  // 3. Truthfulness Audit on corrupted/inflated claims (e.g. fabricated production-grade or buzzwords)
  const inflatedContent = `${JSON.stringify(studioRes.content)} Senior Engineer with production-grade microservices and 10+ years experience`;
  const failedAudit = auditDocumentTruthfulness(inflatedContent, profile);
  assert.strictEqual(failedAudit.passed, false, 'Inflated resume must fail audit');
  assert.strictEqual(failedAudit.hasCritical, true);
  assert.ok(failedAudit.flags.some(f => f.category === 'UNVERIFIED_PRODUCTION_CLAIM' || f.category === 'UNVERIFIED_MICROSERVICES_CLAIM'));
});

test('Phase 9 Audit 5: Application Workflow & Human Approval Gates', async () => {
  const db = getDatabase();

  const insert = db.prepare(`
    INSERT INTO jobs (title, company, location, url, source, description, status, verification_status, experience_min, experience_max)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const res = insert.run(
    'Junior Full Stack Trainee',
    'Phase9AppTestCorp',
    'Bengaluru, India',
    'https://phase9testcorp.example.com/apply/1',
    'direct',
    'Hands-on Java and React experience.',
    'active',
    'verified',
    0,
    1
  );
  const jobId = Number(res.lastInsertRowid);

  try {
    // 1. Prepare application
    const prep = await prepareApplication(jobId);
    assert.ok(prep.applicationId);
    assert.strictEqual(prep.isAutofillAllowed, true);

    // Verify applied_date is strictly null
    const app = db.prepare('SELECT status, applied_date FROM applications WHERE job_id = ?').get(jobId);
    assert.strictEqual(app.status, 'preparing');
    assert.strictEqual(app.applied_date, null, 'applied_date must remain null before submission');

    // 2. Unconfirmed submission rejected
    assert.throws(
      () => confirmApplicationSubmission(jobId, { userConfirmed: false }),
      /Approval Gate Violation/i
    );

    // 3. Browser Form Assistant rejects launch without explicit user confirmation
    await assert.rejects(
      async () => {
        await launchFormAssistant({ id: jobId, title: 'Trainee', company: 'Corp', url: 'https://example.com' }, { userConfirmedApproval: false });
      },
      (err) => err.code === 'APPROVAL_REQUIRED'
    );

    // 4. Confirm submission with user confirmation
    const confirmed = confirmApplicationSubmission(jobId, { confirmationNumber: 'P9-CONF-100', userConfirmed: true });
    assert.strictEqual(confirmed.success, true);
    assert.strictEqual(confirmed.newStatus, 'submitted');

    const submittedApp = db.prepare('SELECT status, applied_date FROM applications WHERE job_id = ?').get(jobId);
    assert.strictEqual(submittedApp.status, 'submitted');
    assert.ok(submittedApp.applied_date);

  } finally {
    db.prepare('DELETE FROM applications WHERE job_id = ?').run(jobId);
    db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
  }
});

test('Phase 9 Audit 6: Recruiter Evidence Tiers & Gmail Parsing Resilience', () => {
  // 1. Company research evidence tier separation
  const research = getCompanyResearch('NonExistentPhase9Corp');
  assert.strictEqual(research.verifiedStatus, 'unverified');
  assert.strictEqual(research.isGenericPlaceholder, true);
  assert.deepStrictEqual(research.techStack, []);

  // 2. Gmail MIME parsing resilience
  const complexGmailMsg = {
    id: 'p9_gmail_msg',
    threadId: 'p9_thread',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'Subject', value: 'Invitation to Technical Interview — Junior Java' },
        { name: 'From', value: 'recruiter@toptech.in' },
        { name: 'Date', value: 'Sun, 22 Nov 2026 10:00:00 +0530' }
      ],
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            {
              mimeType: 'text/plain',
              body: { data: Buffer.from('Congratulations Abhishek! We would like to schedule your Round 1 interview.').toString('base64url') }
            }
          ]
        }
      ]
    }
  };

  const parsed = parseRawGmailMessage(complexGmailMsg);
  assert.strictEqual(parsed.subject, 'Invitation to Technical Interview — Junior Java');
  assert.strictEqual(parsed.from, 'recruiter@toptech.in');
  assert.match(parsed.body, /schedule your Round 1 interview/i);
  assert.ok(parsed.date);
});

test('Phase 9 Audit 7: SQLite Database Integrity, Backup/Restore & Encryption', () => {
  const db = getDatabase();

  // 1. SQLite PRAGMA integrity_check
  const integrity = db.prepare('PRAGMA integrity_check').get();
  assert.strictEqual(integrity.integrity_check, 'ok');

  // 2. AES-256-GCM Token Encryption & Decryption
  const sampleToken = {
    access_token: 'p9_access_sample_xyz',
    refresh_token: 'p9_refresh_sample_abc',
    token_type: 'Bearer'
  };
  const enc = encryptTokenPayload(sampleToken);
  assert.strictEqual(enc.encrypted, true);
  assert.strictEqual(enc.algorithm, 'aes-256-gcm');
  assert.ok(!JSON.stringify(enc).includes('p9_access_sample_xyz'));

  const dec = decryptTokenPayload(enc);
  assert.strictEqual(dec.tokens.access_token, sampleToken.access_token);
  assert.strictEqual(dec.tokens.refresh_token, sampleToken.refresh_token);

  // 3. Backup creation with integrity verification
  const backup = backupDatabase();
  assert.strictEqual(backup.success, true);
  assert.strictEqual(backup.integrity, 'ok');
  assert.ok(fs.existsSync(backup.backupPath));

  // 4. Restore protection against path traversal
  assert.throws(
    () => restoreDatabase('../../etc/passwd', { userConfirmed: true }),
    /Security Violation/i
  );
  assert.throws(
    () => restoreDatabase(backup.backupFile, { userConfirmed: false }),
    /Destructive Action Protection/i
  );

  // Clean up backup file
  try {
    fs.unlinkSync(backup.backupPath);
  } catch {}
});

test('Phase 9.1 Audit 8: Negative Skill Extraction & Disambiguation Defense', () => {
  // 1. Negative phrases: Explicit exclusions must NOT be recognized as skills
  const negativeText = 'Executive Assistant: No Python or Java programming experience required.';
  const negSkills = extractBasicSkills(negativeText, { title: 'Executive Assistant' });
  assert.deepStrictEqual(negSkills, [], 'Should not extract skills negated with "No ... required"');

  // 2. Disambiguate English verb "react"
  const verbText = 'Community Manager: Ability to react quickly to urgent feedback and customer complaints.';
  const verbSkills = extractBasicSkills(verbText, { title: 'Community Manager' });
  assert.ok(!verbSkills.includes('React'), 'English verb "react" must NOT be extracted as React framework');

  // 3. Disambiguate Indonesian geography and coffee
  const geoText = 'Tour Operations Lead: Stationed in West Java, Indonesia.';
  const geoSkills = extractBasicSkills(geoText, { title: 'Tour Operations Lead' });
  assert.ok(!geoSkills.includes('Java'), 'Indonesian island/geography "Java" must NOT be extracted as Java language');

  const coffeeText = 'Head Barista: Serving specialty Java coffee and pastries.';
  const coffeeSkills = extractBasicSkills(coffeeText, { title: 'Head Barista' });
  assert.ok(!coffeeSkills.includes('Java'), 'Coffee/cafe "Java" must NOT be extracted as Java language');

  // 4. Explicitly non-technical role with casual mention
  const hrText = 'Talent Acquisition Partner: Supporting hiring for our engineering teams.';
  const hrSkills = extractBasicSkills(hrText, { title: 'Talent Acquisition Partner', department: 'Human Resources' });
  assert.deepStrictEqual(hrSkills, [], 'Non-technical role must not be assigned technical skills');

  // 5. Positive technical role: Genuine tech stack extraction
  const techText = 'Hands-on development with Core Java, Spring Boot, React.js frontend, and PostgreSQL database.';
  const techSkills = extractBasicSkills(techText, { title: 'Junior Software Engineer', department: 'Engineering' });
  assert.ok(techSkills.includes('Java'));
  assert.ok(techSkills.includes('Spring Boot'));
  assert.ok(techSkills.includes('React'));
  assert.ok(techSkills.includes('PostgreSQL'));
});

test('Phase 9.1 Audit 9: Zero-Reward Gate for Missing/Unverified Job Data', () => {
  // 1. Completely blank / missing job record
  const emptyJob = {
    title: '',
    company: 'Unverified Entity',
    location: '',
    description: ''
  };
  const emptyEval = evaluateJobFit(emptyJob);
  assert.strictEqual(emptyEval.breakdown.skillsScore, 0, 'Missing tech skills must yield 0 skill score');
  assert.strictEqual(emptyEval.breakdown.locationScore, 0, 'Missing location must yield 0 location score');
  assert.strictEqual(emptyEval.breakdown.roleScore, 0, 'Missing title must yield 0 role score');
  assert.ok(emptyEval.score <= 20, `Score for empty job must be <= 20, got ${emptyEval.score}`);
  assert.strictEqual(emptyEval.recommendation, 'REJECTED');
  assert.strictEqual(emptyEval.rating, 1);

  // 2. Non-technical role with target location but zero tech skills
  const nonTechJob = {
    title: 'Front Desk Receptionist',
    company: 'Hotel Corp',
    location: 'Bengaluru, Karnataka, India',
    description: 'Manage guest check-ins, answer phone calls, and greet visitors.'
  };
  const nonTechEval = evaluateJobFit(nonTechJob);
  assert.strictEqual(nonTechEval.breakdown.skillsScore, 0, 'Non-technical description must yield 0 skills score');
  assert.strictEqual(nonTechEval.breakdown.roleScore, 0, 'Non-technical title must yield 0 role score');
  assert.strictEqual(nonTechEval.breakdown.locationScore, 20); // Bengaluru location recognized
  assert.ok(nonTechEval.score <= 45, `Non-tech role score must be <= 45, got ${nonTechEval.score}`);
  assert.strictEqual(nonTechEval.recommendation, 'REJECTED');

  // 3. Technical role with genuine matching skills in Bengaluru
  const verifiedJob = {
    title: 'Junior Java Developer',
    company: 'Fintech Hub',
    location: 'Bengaluru, Karnataka, India',
    description: 'Looking for a fresher with Core Java, Spring Boot, and REST APIs.',
    skills: ['Java', 'Spring Boot', 'REST APIs'],
    experience_min: 0,
    experience_max: 1
  };
  const verifiedEval = evaluateJobFit(verifiedJob);
  assert.strictEqual(verifiedEval.breakdown.skillsScore, 30, 'Full skills match must yield full 30 points');
  assert.strictEqual(verifiedEval.breakdown.locationScore, 20, 'Bengaluru must yield full 20 points');
  assert.strictEqual(verifiedEval.breakdown.roleScore, 20, 'Java developer title must yield full 20 points');
  assert.strictEqual(verifiedEval.recommendation, 'RECOMMENDED');
  assert.strictEqual(verifiedEval.rating, 5);
});
