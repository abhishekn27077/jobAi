import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { getDatabase, getDbPath } from '../src/db/schema.js';
import { saveOrUpdateJob, getStats, getJobs } from '../src/tracker/jobTracker.js';
import { evaluateJobFit } from '../src/matcher/scoringEngine.js';
import { prepareApplication } from '../src/automation/applicationWorkflow.js';
import { exportVaultToCsv, exportVaultToJson } from '../src/tracker/vaultExporter.js';
import { extractAtsJobId, normalizeCanonicalUrl } from '../src/discovery/urlNormalizer.js';
import { cleanTestFixtures } from '../src/db/backupService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REAL_VAULT_PATH = path.resolve(__dirname, '../data/career_vault.db');

describe('Phase 9.3 — Data Integrity & Reliability Safeguards', () => {
  let realVaultHashBefore = null;

  before(() => {
    if (fs.existsSync(REAL_VAULT_PATH)) {
      realVaultHashBefore = crypto.createHash('sha256').update(fs.readFileSync(REAL_VAULT_PATH)).digest('hex');
    }
  });

  after(() => {
    // A. Protect the Real Database Verification
    if (fs.existsSync(REAL_VAULT_PATH) && realVaultHashBefore) {
      const realVaultHashAfter = crypto.createHash('sha256').update(fs.readFileSync(REAL_VAULT_PATH)).digest('hex');
      assert.equal(
        realVaultHashAfter,
        realVaultHashBefore,
        'CRITICAL VIOLATION: Test execution mutated data/career_vault.db!'
      );
    }
  });

  test('A. Test runner must route to isolated test database, preserving real database path', () => {
    const activePath = getDbPath();
    assert.match(activePath, /test_vault_/, 'Active DB path under test must be an isolated test database');
    assert.notEqual(path.resolve(activePath), REAL_VAULT_PATH, 'Test DB must never be real career_vault.db');
  });

  test('B. Expired jobs synchronization & dashboard statistics exclusion', () => {
    const db = getDatabase();

    // Ingest an active job
    const activeJob = {
      title: 'Backend Engineer - Node.js',
      company: 'Reliable Test Co',
      location: 'Bengaluru, Karnataka',
      url: 'https://boards.greenhouse.io/reliable/jobs/111001',
      description: 'Looking for Node.js, JavaScript, SQLite developer. Fresher welcome.',
      requiredSkills: ['Node.js', 'JavaScript', 'SQLite'],
      experienceMin: 0,
      experienceMax: 1
    };
    const activeRes = saveOrUpdateJob(activeJob);
    assert.equal(activeRes.success, true);

    // Ingest an expired job
    const expiredJob = {
      title: 'Frontend Engineer - React',
      company: 'Expired Test Co',
      location: 'Bengaluru, Karnataka',
      url: 'https://boards.greenhouse.io/expired/jobs/222002',
      description: 'React developer position. Closed.',
      requiredSkills: ['React', 'JavaScript'],
      status: 'expired',
      verificationStatus: 'expired',
      experienceMin: 0,
      experienceMax: 1
    };
    const expiredRes = saveOrUpdateJob(expiredJob);
    assert.equal(expiredRes.success, true);

    // Ensure evaluation synchronized for expired job
    const evalExpired = db.prepare('SELECT * FROM job_evaluations WHERE job_id = ?').get(expiredRes.jobId);
    assert.equal(evalExpired.recommendation, 'EXPIRED');
    assert.equal(evalExpired.score, 0);

    // Ensure getStats() excludes expired jobs from recommended
    const stats = getStats();
    const recommendedJobs = getJobs({ recommendation: 'RECOMMENDED' });
    const recommendedIds = recommendedJobs.map(j => j.id);
    assert.equal(recommendedIds.includes(expiredRes.jobId), false, 'Expired job must not appear in RECOMMENDED listings');

    // Ensure exports reflect expired state
    const csvExport = exportVaultToCsv();
    assert.equal(fs.existsSync(csvExport.csvPath), true);
    const csvContent = fs.readFileSync(csvExport.csvPath, 'utf8');
    assert.match(csvContent, /"EXPIRED"/);
  });

  test('C. Deduplication: canonical URL trailing slash normalization', () => {
    const jobA = {
      title: 'Software Engineer',
      company: 'Slash Test Corp',
      location: 'Bengaluru',
      url: 'https://jobs.lever.co/slashcorp/987654321',
      description: 'Node.js developer needed.',
      requiredSkills: ['Node.js']
    };
    const resA = saveOrUpdateJob(jobA);
    assert.equal(resA.isNew, true);

    // Same URL with trailing slash
    const jobB = {
      title: 'Software Engineer',
      company: 'Slash Test Corp',
      location: 'Bengaluru',
      url: 'https://jobs.lever.co/slashcorp/987654321/',
      description: 'Node.js developer needed. Updated description.',
      requiredSkills: ['Node.js']
    };
    const resB = saveOrUpdateJob(jobB);
    assert.equal(resB.isNew, false, 'Trailing slash variant must update existing record, not create duplicate');
    assert.equal(resB.jobId, resA.jobId, 'Must share identical job ID');
  });

  test('C. Requisition awareness: genuinely distinct ATS openings are NOT merged', () => {
    // Bulk hiring at same company in same city with different requisition IDs
    const opening1 = {
      title: 'Associate Software Engineer',
      company: 'Enterprise MegaCorp',
      location: 'Bengaluru, Karnataka',
      url: 'https://jobs.smartrecruiters.com/EnterpriseMegaCorp/743999652637348',
      description: 'Opening A: Team Alpha.',
      requiredSkills: ['Java', 'SQL']
    };
    const opening2 = {
      title: 'Associate Software Engineer',
      company: 'Enterprise MegaCorp',
      location: 'Bengaluru, Karnataka',
      url: 'https://jobs.smartrecruiters.com/EnterpriseMegaCorp/743999651515373',
      description: 'Opening B: Team Beta.',
      requiredSkills: ['Java', 'SQL']
    };

    const res1 = saveOrUpdateJob(opening1);
    const res2 = saveOrUpdateJob(opening2);

    assert.equal(res1.isNew, true);
    assert.equal(res2.isNew, true, 'Distinct ATS requisition IDs must be preserved as separate openings');
    assert.notEqual(res1.jobId, res2.jobId, 'Requisitions must have separate IDs');
  });

  test('C. Duplicate application prevention: repeated clicks are idempotent', async () => {
    const testJob = {
      title: 'Full Stack Engineer',
      company: 'Idempotent Apps Inc',
      location: 'Bengaluru, Karnataka',
      url: 'https://jobs.ashbyhq.com/idempotent/333444',
      description: 'Full stack development with Node.js and React.',
      requiredSkills: ['Node.js', 'React'],
      experienceMin: 0,
      experienceMax: 2
    };
    const saveRes = saveOrUpdateJob(testJob);

    // Prepare application first time
    const dossier1 = await prepareApplication(saveRes.jobId);
    assert.ok(dossier1.applicationId);

    // Prepare application second time (simulating user clicking Prepare Application again)
    const dossier2 = await prepareApplication(saveRes.jobId);
    assert.equal(dossier2.applicationId, dossier1.applicationId, 'Repeated preparation must reuse existing application record');

    const db = getDatabase();
    const appCount = db.prepare('SELECT count(*) as count FROM applications WHERE job_id = ?').get(saveRes.jobId).count;
    assert.equal(appCount, 1, 'Exactly one application record must exist for this opening');
  });

  test('D. DegreeClassifier integration in discovery scoringEngine', () => {
    // 1. Strict B.Tech-only restriction
    const strictJob = {
      title: 'Junior Developer',
      company: 'Exclusive Tech Ltd',
      location: 'Bengaluru',
      url: 'https://example.com/strict-btech',
      description: 'Eligibility Criteria: Only candidates with B.Tech or B.E. in Computer Science can apply. MCA is strictly not eligible.',
      requiredSkills: ['Python', 'SQL'],
      experienceMin: 0,
      experienceMax: 1
    };
    const evalStrict = evaluateJobFit(strictJob);
    assert.equal(Boolean(evalStrict.fresherEligible), false, 'Strict B.Tech restriction must make candidate ineligible');
    assert.equal(evalStrict.recommendation, 'REJECTED', 'Strictly ineligible role must be capped to REJECTED');
    assert.equal(evalStrict.score, 0, 'Score must be 0 for strictly ineligible degree restriction');
    assert.match(evalStrict.summaryReason, /Degree Restriction:/);

    // 2. Explicit MCA acceptance
    const mcaJob = {
      title: 'Software Trainee',
      company: 'Inclusive Tech Ltd',
      location: 'Bengaluru',
      url: 'https://example.com/mca-welcome',
      description: 'Education: MCA or B.Tech/B.E. in IT/CS. Fresher welcome to apply.',
      requiredSkills: ['JavaScript', 'HTML'],
      experienceMin: 0,
      experienceMax: 1
    };
    const evalMca = evaluateJobFit(mcaJob);
    assert.equal(Boolean(evalMca.fresherEligible), true, 'Explicit MCA acceptance must confirm fresher eligibility');
    assert.match(evalMca.summaryReason, /MCA degree|Education/i);
  });

  test('E. Non-empty analysis explanation guarantee across all dimensions', () => {
    const minimalJob = {
      title: 'General Assistant',
      company: 'Minimal Co',
      location: 'India',
      url: 'https://example.com/minimal',
      description: 'Do daily tasks.',
      requiredSkills: []
    };
    const evalRes = evaluateJobFit(minimalJob);
    assert.ok(evalRes.summaryReason, 'Summary reason must never be null or undefined');
    assert.ok(evalRes.summaryReason.trim().length > 10, 'Summary reason must be an informative explanation');
  });

  test('ATS Job ID extraction across major ATS platforms', () => {
    assert.equal(extractAtsJobId('https://boards.greenhouse.io/figma/jobs/7141324002'), 'gh-7141324002');
    assert.equal(extractAtsJobId('https://jobs.lever.co/palantir/51d69d4e-b5f7-410e-8d82-843818e6ecaa'), 'lever-51d69d4e-b5f7-410e-8d82-843818e6ecaa');
    assert.equal(extractAtsJobId('https://jobs.ashbyhq.com/openai/19f187a5-c335-430c-b26a-65fc0605d3b6'), 'ashby-19f187a5-c335-430c-b26a-65fc0605d3b6');
    assert.equal(extractAtsJobId('https://jobs.smartrecruiters.com/Company/743999652637348'), 'sr-743999652637348');
  });

  test('F. Safe test fixture cleanup with backup and integrity guarantee', () => {
    const db = getDatabase();

    const fakeAcme = saveOrUpdateJob({
      title: 'Junior Java Software Engineer',
      company: 'Acme',
      location: 'Bengaluru',
      url: `https://jobs.lever.co/acme-corp/role-${Date.now()}`
    });

    const fakeExample = saveOrUpdateJob({
      title: 'Test Job',
      company: 'Apex',
      location: 'Bengaluru',
      url: 'https://apexfintech.example.com/careers/java-dev-01'
    });

    assert.ok(fakeAcme.jobId);
    assert.ok(fakeExample.jobId);

    const cleanResult = cleanTestFixtures();
    assert.equal(cleanResult.success, true);
    assert.ok(cleanResult.safetyBackupPath);
    assert.ok(cleanResult.cleanedJobs >= 2);
    assert.equal(cleanResult.integrityStatus, 'ok');

    const checkAcme = db.prepare('SELECT id FROM jobs WHERE id = ?').get(fakeAcme.jobId);
    const checkExample = db.prepare('SELECT id FROM jobs WHERE id = ?').get(fakeExample.jobId);
    assert.equal(checkAcme, undefined);
    assert.equal(checkExample, undefined);
  });
});
