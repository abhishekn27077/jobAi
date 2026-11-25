import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { getDatabase } from '../src/db/schema.js';
import { getPortalAdapter, getPortalSupportMatrix } from '../src/automation/portalAdapters/portalRegistry.js';
import { GreenhouseAdapter } from '../src/automation/portalAdapters/greenhouseAdapter.js';
import { LeverAdapter } from '../src/automation/portalAdapters/leverAdapter.js';
import { AshbyAdapter } from '../src/automation/portalAdapters/ashbyAdapter.js';
import { WorkdayAdapter } from '../src/automation/portalAdapters/workdayAdapter.js';
import { GenericAdapter } from '../src/automation/portalAdapters/genericAdapter.js';
import { generateScreeningAnswers, validateAnswerTruthfulness } from '../src/automation/screeningEngine.js';
import { prepareApplication } from '../src/automation/applicationWorkflow.js';
import { updateApplicationStatus, getApplications, getApplicationByJobId } from '../src/tracker/applicationTracker.js';
import { launchFormAssistant, autoFillApplicationForm } from '../src/automation/formAssistant.js';
import { loadCandidateProfile } from '../src/profile/profileManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function launchTestBrowser() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    try {
      return await chromium.launch({ channel: 'msedge', headless: true });
    } catch {
      return await chromium.launch({ headless: true });
    }
  }
}

test('Portal Registry accurately identifies ATS portals and provides support matrix', () => {
  const greenhouse = getPortalAdapter('https://boards.greenhouse.io/stripe/jobs/12345');
  assert.strictEqual(greenhouse.name, 'Greenhouse');
  assert.strictEqual(greenhouse.getSupportLevel(), 'supported');

  const lever = getPortalAdapter('https://jobs.lever.co/netflix/67890');
  assert.strictEqual(lever.name, 'Lever');
  assert.strictEqual(lever.getSupportLevel(), 'supported');

  const ashby = getPortalAdapter('https://jobs.ashbyhq.com/openai/11223');
  assert.strictEqual(ashby.name, 'Ashby');
  assert.strictEqual(ashby.getSupportLevel(), 'supported');

  const smartRecruiters = getPortalAdapter('https://jobs.smartrecruiters.com/Square/33445');
  assert.strictEqual(smartRecruiters.name, 'SmartRecruiters');
  assert.strictEqual(smartRecruiters.getSupportLevel(), 'supported');

  const workday = getPortalAdapter('https://target.myworkdayjobs.com/targetcareers/job/123');
  assert.strictEqual(workday.name, 'Workday');
  assert.strictEqual(workday.getSupportLevel(), 'partially_supported');

  const generic = getPortalAdapter('https://company.com/careers/software-engineer');
  assert.strictEqual(generic.name, 'Generic ATS / Career Page');
  assert.strictEqual(generic.getSupportLevel(), 'partially_supported');

  const matrix = getPortalSupportMatrix();
  assert.ok(matrix.length >= 6);
  const ghRow = matrix.find(m => m.portal === 'Greenhouse');
  assert.ok(ghRow);
  assert.strictEqual(ghRow.supportLevel, 'supported');
  assert.ok(ghRow.automatedActions.length > 0);
  assert.ok(ghRow.manualActionsRequired.length > 0);
});

test('Screening Engine strictly grounds answers in verified candidate profile with zero fabrication', () => {
  const sampleJob = {
    title: 'Junior Java Developer',
    company: 'FinTech Solutions',
    description: 'Looking for a junior Java engineer with Spring Boot knowledge.'
  };

  const catalog = generateScreeningAnswers(sampleJob);
  assert.ok(catalog.work_authorization);
  assert.match(catalog.work_authorization.answer, /citizen of India/i);
  assert.strictEqual(catalog.work_authorization.confidence, 'high');
  assert.ok(catalog.work_authorization.evidence.includes('candidate_profile.json'));

  assert.ok(catalog.experience_java);
  assert.match(catalog.experience_java.answer, /Anudip Foundation/i);
  assert.ok(catalog.experience_java.evidence.includes('Anudip Foundation'));

  assert.ok(catalog.education_degree);
  assert.match(catalog.education_degree.answer, /Master of Computer Applications/i);
  assert.match(catalog.education_degree.answer, /AIMS Institutes/i);

  assert.ok(catalog.notice_period);
  assert.match(catalog.notice_period.answer, /Available immediately/i);

  // Test custom screening questions with unsupported/unverified question
  const customQuestions = [
    'Are you legally authorized to work in India?',
    'How many years of experience do you have with Spring Boot?',
    'Do you have 7+ years of Kubernetes production administration experience?'
  ];

  const customAnswers = generateScreeningAnswers(sampleJob, customQuestions);
  assert.strictEqual(customAnswers['Are you legally authorized to work in India?'].confidence, 'high');
  assert.strictEqual(customAnswers['How many years of experience do you have with Spring Boot?'].confidence, 'high');

  // Unsupported question must NOT fabricate answers
  const unsupported = customAnswers['Do you have 7+ years of Kubernetes production administration experience?'];
  assert.ok(unsupported);
  assert.strictEqual(unsupported.confidence, 'unsupported');
  assert.strictEqual(unsupported.requiresUserInput, true);
  assert.strictEqual(unsupported.answer, '');

  // Truthfulness validator
  const profile = loadCandidateProfile();
  const validCheck = validateAnswerTruthfulness('Hands-on Java experience building full stack web applications with Spring Boot during MCA.', profile);
  assert.strictEqual(validCheck.valid, true);
  assert.strictEqual(validCheck.issues.length, 0);

  // Claiming 1+ years of professional/full-time experience when candidate is a fresher must be rejected
  const invalidExpCheck = validateAnswerTruthfulness('I have 1 year of professional experience as a Java developer.', profile);
  assert.strictEqual(invalidExpCheck.valid, false);
  assert.ok(invalidExpCheck.issues.some(i => i.includes('exceeding candidate\'s verified fresher status')));

  // Falsely claiming Anudip was full-time employment must be rejected
  const anudipFullTimeCheck = validateAnswerTruthfulness('I was a full-time software engineer at Anudip Foundation.', profile);
  assert.strictEqual(anudipFullTimeCheck.valid, false);
  assert.ok(anudipFullTimeCheck.issues.some(i => i.includes('represented as an internship')));

  const fabricatedDegree = validateAnswerTruthfulness('I hold a Ph.D. in Computer Science from Stanford University.', profile);
  assert.strictEqual(fabricatedDegree.valid, false);
  assert.ok(fabricatedDegree.issues.some(i => i.includes('claims a degree')));

  const fabricatedYears = validateAnswerTruthfulness('I have 6 years of industry experience building cloud architectures.', profile);
  assert.strictEqual(fabricatedYears.valid, false);
  assert.ok(fabricatedYears.issues.some(i => i.includes('exceeding candidate\'s verified fresher status')));
});

test('Human Approval Gate prevents automatic launch and prevents unconfirmed submissions', async () => {
  const dummyJob = {
    id: 9999,
    title: 'Test Engineer',
    company: 'Test Co',
    url: 'https://example.com/jobs/1'
  };

  // 1. launchFormAssistant must throw APPROVAL_REQUIRED without userConfirmedApproval
  await assert.rejects(
    async () => {
      await launchFormAssistant(dummyJob, { userConfirmedApproval: false });
    },
    (err) => {
      return err.code === 'APPROVAL_REQUIRED';
    },
    'Should throw APPROVAL_REQUIRED when confirmation is missing'
  );

  // 2. updateApplicationStatus must throw error when setting submitted without userConfirmed
  assert.throws(
    () => {
      updateApplicationStatus(1, 'submitted', { userConfirmed: false });
    },
    /Approval Gate Violation/i
  );
});

test('Session Expiry and Auth Barrier Detection flags authentication walls', async () => {
  const browser = await launchTestBrowser();

  try {
    const page = await browser.newPage();

    // Mock Workday Login Wall HTML
    const workdayLoginHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <div data-automation-id="signInPage">
            <h2>Sign In to Your Account</h2>
            <form>
              <input type="text" id="username" placeholder="Email" />
              <input type="password" id="password" placeholder="Password" />
              <button type="submit">Sign In</button>
              <a href="#">Create Account</a>
            </form>
          </div>
        </body>
      </html>
    `;

    await page.setContent(workdayLoginHtml);
    const workdayAdapter = new WorkdayAdapter();
    const barrier = await workdayAdapter.detectSessionOrAuthBarrier(page);

    assert.strictEqual(barrier.hasBarrier, true);
    assert.strictEqual(barrier.barrierType, 'workday_account_barrier');
    assert.ok(barrier.message.includes('Workday requires candidate account'));

    // Mock Generic Page with Session Expired
    const sessionExpiredHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <div class="alert alert-danger">Your session has timed out or expired. Please log in again.</div>
        </body>
      </html>
    `;
    await page.setContent(sessionExpiredHtml);
    const genericAdapter = new GenericAdapter();
    const sessionBarrier = await genericAdapter.detectSessionOrAuthBarrier(page);
    assert.strictEqual(sessionBarrier.hasBarrier, true);
    assert.strictEqual(sessionBarrier.barrierType, 'session_expired');
  } finally {
    if (browser) await browser.close();
  }
});

test('Greenhouse Adapter pre-fills form and verifies DOM values', async () => {
  const profile = loadCandidateProfile();
  const dummyPdf = path.join(__dirname, 'dummy_greenhouse_resume.pdf');
  fs.writeFileSync(dummyPdf, 'dummy pdf content for greenhouse', 'utf-8');

  const browser = await launchTestBrowser();

  try {
    const page = await browser.newPage();
    const greenhouseHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Greenhouse Application</title></head>
        <body>
          <form id="application_form">
            <input type="text" id="first_name" name="job_application[first_name]" />
            <input type="text" id="last_name" name="job_application[last_name]" />
            <input type="email" id="email" name="job_application[email]" />
            <input type="tel" id="phone" name="job_application[phone]" />
            <input type="file" id="resume_file" name="resume" />
            <div class="field">
              <label>LinkedIn Profile</label>
              <input type="text" name="job_application[answers_attributes][0][text_value]" placeholder="LinkedIn" />
            </div>
            <div class="field">
              <label>GitHub Profile</label>
              <input type="text" name="job_application[answers_attributes][1][text_value]" placeholder="GitHub" />
            </div>
          </form>
        </body>
      </html>
    `;

    await page.setContent(greenhouseHtml);
    const adapter = new GreenhouseAdapter();
    const mapped = adapter.mapProfileToFields(profile);

    const fillResult = await adapter.fill(page, mapped, { resumePdfPath: dummyPdf });
    assert.ok(fillResult.fieldsFilledCount >= 5, `Expected >= 5 fields filled, got ${fillResult.fieldsFilledCount}`);

    // Verify DOM values
    const firstName = await page.inputValue('#first_name');
    assert.strictEqual(firstName, 'Abhishek');

    const email = await page.inputValue('#email');
    assert.strictEqual(email, profile.personal.email);

    // Verify verification array
    const verifications = fillResult.verification;
    const firstVer = verifications.find(v => v.field === 'First Name');
    assert.ok(firstVer);
    assert.ok(firstVer.status === 'VERIFIED' || firstVer.status === 'verified_match');
  } finally {
    if (browser) await browser.close();
    if (fs.existsSync(dummyPdf)) fs.unlinkSync(dummyPdf);
  }
});

test('Lever Adapter pre-fills single-page form and verifies DOM values', async () => {
  const profile = loadCandidateProfile();
  const dummyPdf = path.join(__dirname, 'dummy_lever_resume.pdf');
  fs.writeFileSync(dummyPdf, 'dummy pdf content for lever', 'utf-8');

  const browser = await launchTestBrowser();

  try {
    const page = await browser.newPage();
    const leverHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Lever Application</title></head>
        <body>
          <form class="application-form">
            <input type="text" name="name" />
            <input type="email" name="email" />
            <input type="tel" name="phone" />
            <input type="text" name="org" />
            <input type="text" name="urls[LinkedIn]" />
            <input type="text" name="urls[GitHub]" />
            <input type="file" name="resume" />
            <textarea name="comments" placeholder="Additional info"></textarea>
          </form>
        </body>
      </html>
    `;

    await page.setContent(leverHtml);
    const adapter = new LeverAdapter();
    const mapped = adapter.mapProfileToFields(profile);

    const fillResult = await adapter.fill(page, mapped, {
      resumePdfPath: dummyPdf,
      screeningAnswers: {
        comments: { answer: 'Eager to contribute verified Java skills.' }
      }
    });

    assert.ok(fillResult.fieldsFilledCount >= 5, `Expected >= 5 fields filled, got ${fillResult.fieldsFilledCount}`);

    const nameVal = await page.inputValue('input[name="name"]');
    assert.strictEqual(nameVal, 'Abhishek N');

    const emailVal = await page.inputValue('input[name="email"]');
    assert.strictEqual(emailVal, profile.personal.email);

    const verifications = fillResult.verification;
    const nameVer = verifications.find(v => v.field === 'Full Name');
    assert.ok(nameVer);
    assert.ok(nameVer.status === 'VERIFIED' || nameVer.status === 'verified_match');
  } finally {
    if (browser) await browser.close();
    if (fs.existsSync(dummyPdf)) fs.unlinkSync(dummyPdf);
  }
});

test('Job-to-Application Workflow prepares application dossier and prevents duplicates', async () => {
  const db = getDatabase();

  // Clean up any previous test artifacts
  db.prepare(`
    DELETE FROM applications 
    WHERE job_id IN (SELECT id FROM jobs WHERE company = 'Test Intelligence Co')
  `).run();
  db.prepare(`DELETE FROM jobs WHERE company = 'Test Intelligence Co'`).run();

  // Insert a test job
  const ins = db.prepare(`
    INSERT INTO jobs (
      title, company, location, work_mode, experience_min, experience_max,
      description, required_skills, preferred_skills, source, url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'Junior Java Software Engineer',
    'Test Intelligence Co',
    'Bengaluru',
    'hybrid',
    0,
    1,
    'Looking for MCA/BCA fresher with Java, Spring Boot, and PostgreSQL knowledge.',
    JSON.stringify(['Java', 'Spring Boot', 'PostgreSQL']),
    JSON.stringify(['React', 'Docker']),
    'test',
    'https://boards.greenhouse.io/testintelligence/jobs/991188'
  );
  const testJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(ins.lastInsertRowid);

  // 1. Prepare application dossier
  const dossier = await prepareApplication(testJob.id);
  assert.ok(dossier);
  assert.strictEqual(dossier.jobId, testJob.id);
  assert.strictEqual(dossier.portal.name, 'Greenhouse');
  assert.strictEqual(dossier.portal.supportLevel, 'supported');
  assert.ok(dossier.resumeVersion);
  assert.ok(dossier.coverLetter.markdown);
  assert.match(dossier.coverLetter.markdown, /Test Intelligence Co/i);
  assert.ok(dossier.checklist.length >= 7);
  assert.ok(dossier.screeningAnswers);

  // 2. Verify record in database
  const appRecord1 = getApplicationByJobId(testJob.id);
  assert.ok(appRecord1);
  assert.strictEqual(appRecord1.portal_type, 'Greenhouse');
  assert.strictEqual(appRecord1.status, 'preparing');

  // Count applications for this job
  const count1 = db.prepare('SELECT count(*) as count FROM applications WHERE job_id = ?').get(testJob.id).count;
  assert.strictEqual(count1, 1);

  // 3. Prevent Duplicates: Call prepareApplication again for the same job
  const dossier2 = await prepareApplication(testJob.id);
  assert.strictEqual(dossier2.applicationId, appRecord1.id);

  const count2 = db.prepare('SELECT count(*) as count FROM applications WHERE job_id = ?').get(testJob.id).count;
  assert.strictEqual(count2, 1, 'Calling prepareApplication twice must not duplicate application records');

  // 4. Update status with confirmation
  const updateRes = updateApplicationStatus(testJob.id, 'submitted', {
    confirmationNumber: 'GH-APP-991188',
    notes: 'Submitted via Greenhouse form manually by candidate',
    userConfirmed: true
  });
  assert.strictEqual(updateRes.newStatus, 'submitted');

  // Verify status history
  const appRecordUpdated = getApplicationByJobId(testJob.id);
  assert.strictEqual(appRecordUpdated.status, 'submitted');
  assert.strictEqual(appRecordUpdated.confirmation_number, 'GH-APP-991188');
  assert.ok(appRecordUpdated.status_history.length >= 2);
  const lastHistory = appRecordUpdated.status_history[appRecordUpdated.status_history.length - 1];
  assert.strictEqual(lastHistory.to, 'submitted');
  assert.strictEqual(lastHistory.userConfirmed, true);
});
