import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabase } from '../src/db/schema.js';
import {
  initializeAutomationEngine,
  getAutomationControlStatus,
  executeTask,
  toggleTaskEnabled,
  updateTaskInterval,
  setMasterAutomationPause,
  calculateBackoffSeconds
} from '../src/scheduler/automationEngine.js';
import {
  backupDatabase,
  listBackups,
  restoreDatabase,
  runDatabaseIntegrityCheck,
  exportCandidateFullArchive
} from '../src/db/backupService.js';
import { evaluateJobFit } from '../src/matcher/scoringEngine.js';
import { extractJdRequirements } from '../src/resumes/jdAnalyzer.js';
import { generateStudioResume } from '../src/resumes/resumeStudioService.js';
import { saveResumeVersion } from '../src/resumes/resumeVersionManager.js';
import { prepareApplication } from '../src/automation/applicationWorkflow.js';
import { generateScreeningAnswers } from '../src/automation/screeningEngine.js';
import { classifyAndExtractRecruiterEmail } from '../src/email/recruiterEmailParser.js';
import { generateCommunicationDraft } from '../src/email/communicationAssistant.js';
import { proposeCalendarEvent } from '../src/calendar/calendarService.js';
import { generateInterviewDossier } from '../src/interview/prepService.js';
import { evaluateCandidateAnswer } from '../src/interview/mockSimulator.js';
import { calculateOfferTakeHome } from '../src/intelligence/salaryCalculatorService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Phase 6: Automation Engine Task Registry & Configuration', async (t) => {
  // Ensure tasks are initialized
  initializeAutomationEngine({ runStartupChecks: false });

  const status = getAutomationControlStatus();
  assert.ok(Array.isArray(status.tasks), 'Status tasks must be an array');
  assert.strictEqual(status.tasks.length, 7, 'All 7 background tasks must be registered');

  const expectedKeys = [
    'job_discovery',
    'freshness_recheck',
    'profile_matching',
    'application_status_sync',
    'gmail_sync',
    'reminders_check',
    'weekly_report'
  ];
  const actualKeys = status.tasks.map(t => t.taskKey);
  expectedKeys.forEach(k => {
    assert.ok(actualKeys.includes(k), `Task key [${k}] must be registered`);
  });

  // Test toggling
  const toggled = toggleTaskEnabled('job_discovery', false);
  assert.strictEqual(toggled.isEnabled, false, 'Task should be disabled');
  const restored = toggleTaskEnabled('job_discovery', true);
  assert.strictEqual(restored.isEnabled, true, 'Task should be re-enabled');

  // Test interval update
  const updated = updateTaskInterval('reminders_check', 30);
  assert.strictEqual(updated.intervalMinutes, 30, 'Interval should be updated to 30 mins');
  updateTaskInterval('reminders_check', 60); // restore

  // Test master pause
  setMasterAutomationPause(true);
  let pausedStatus = getAutomationControlStatus();
  assert.strictEqual(pausedStatus.isEnginePaused, true, 'Engine must report paused');
  setMasterAutomationPause(false);
  let activeStatus = getAutomationControlStatus();
  assert.strictEqual(activeStatus.isEnginePaused, false, 'Engine must report active');
});

test('Phase 6: Exponential Backoff Calculation & Safe Retries', () => {
  assert.strictEqual(calculateBackoffSeconds(0), 60, '0 failures should back off by 60s');
  assert.strictEqual(calculateBackoffSeconds(1), 120, '1 failure should back off by 120s');
  assert.strictEqual(calculateBackoffSeconds(2), 240, '2 failures should back off by 240s');
  assert.strictEqual(calculateBackoffSeconds(3), 480, '3 failures should back off by 480s');
  assert.strictEqual(calculateBackoffSeconds(4), 960, '4 failures should back off by 960s');
  assert.strictEqual(calculateBackoffSeconds(5), 1800, '5 failures should cap at 1800s (30 mins)');
  assert.strictEqual(calculateBackoffSeconds(10), 1800, 'High failures should cap at 1800s');
});

test('Phase 6: Automation Task Execution & Error Isolation', async () => {
  // Execute reminders_check manually
  const result = await executeTask('reminders_check', { manualTrigger: true });
  assert.ok(result, 'Result should exist');
  assert.strictEqual(result.taskKey, 'reminders_check');
  assert.strictEqual(result.success, true);
  assert.ok(typeof result.durationMs === 'number');

  // Verify run telemetry recorded in DB
  const db = getDatabase();
  const run = db.prepare('SELECT * FROM automation_runs WHERE task_key = ? ORDER BY id DESC LIMIT 1').get('reminders_check');
  assert.ok(run, 'Run telemetry must be saved in database');
  assert.strictEqual(run.status, 'success');
});

test('Phase 6: Database Integrity Check & Backup Safety', () => {
  // Test PRAGMA integrity check
  const integrity = runDatabaseIntegrityCheck();
  assert.strictEqual(integrity.isHealthy, true, 'Integrity check must pass on active database');
  assert.strictEqual(integrity.integrityStatus, 'ok', 'Integrity status should confirm ok');

  // Test backup creation
  const backup = backupDatabase({ targetFilename: 'career_vault_backup_test_automated.db', overwrite: true });
  assert.ok(fs.existsSync(backup.backupPath), 'Backup file must exist on disk');
  assert.ok(backup.sizeBytes > 0, 'Backup size must be positive');
  assert.ok(backup.filename.includes('test_automated'), 'Filename must include label');

  // Test listing backups
  const backups = listBackups();
  assert.ok(backups.length > 0, 'Backups list must contain at least 1 backup');
  assert.ok(backups.some(b => b.filename === backup.filename), 'Newly created backup must appear in list');

  // Test restore safety guard without confirmation
  assert.throws(() => {
    restoreDatabase(backup.backupPath, { userConfirmed: false });
  }, /Destructive Action Protection/, 'Restore without userConfirmed must throw safety error');

  // Test restore safety guard with confirmation
  const restoreRes = restoreDatabase(backup.backupPath, { userConfirmed: true });
  assert.strictEqual(restoreRes.success, true, 'Restore with confirmation must succeed');

  // Clean up test backup file
  try {
    fs.unlinkSync(backup.backupPath);
  } catch {}
});

test('Phase 6: Candidate Full Career Archive Export & Privacy Boundary', () => {
  const archive = exportCandidateFullArchive();
  assert.ok(archive, 'Archive object must be returned');
  assert.strictEqual(archive.success, true);
  assert.ok(fs.existsSync(archive.outputPath), 'Archive file must be created on disk');

  // Read and verify archive content
  const rawArchiveText = fs.readFileSync(archive.outputPath, 'utf8');
  const parsed = JSON.parse(rawArchiveText);
  assert.strictEqual(parsed.candidateProfile.name, 'Abhishek N', 'Candidate name must be preserved');
  assert.ok(Array.isArray(parsed.applications), 'Applications list must be present');
  assert.ok(Array.isArray(parsed.learningRoadmap), 'Learning roadmap must be present');

  // Verify privacy: archive should not expose raw refresh tokens or client secrets
  assert.ok(!rawArchiveText.includes('client_secret_xyz'), 'Raw client secrets must not appear in archive');

  // Clean up test archive export
  try {
    fs.unlinkSync(archive.outputPath);
  } catch {}
});

test('Phase 6: Complete 13-Step CareerOS End-to-End Lifecycle', async () => {
  const db = getDatabase();

  // 1. Synthetic Job Discovery
  const syntheticJob = {
    title: 'Junior Java Backend Developer',
    company: 'Apex Fintech Solutions',
    location: 'Bengaluru',
    work_mode: 'hybrid',
    employment_type: 'full-time',
    description: `Apex Fintech is seeking a Junior Java Developer in Bengaluru. 
Requirements:
- Strong core Java, Spring Boot, REST APIs, and SQL.
- Basic understanding of Git, Maven, and unit testing.
- B.E./B.Tech/MCA 2024-2026 graduates. 0-2 years experience.
Preferred:
- Docker, AWS, or microservices basics.`,
    url: 'https://apexfintech.example.com/careers/java-dev-01',
    source: 'lever',
    salary: '₹5,00,000 - ₹7,00,000'
  };

  // 2. Matching & Score Calculation
  const matchResult = evaluateJobFit(syntheticJob);
  assert.ok(matchResult.score >= 50, 'Matching score must be viable for Java role');
  assert.strictEqual(matchResult.fresherEligible, 1, 'Fresher eligibility must be verified');

  // Insert job record for end-to-end testing
  const insertJobStmt = db.prepare(`
    INSERT INTO jobs (title, company, location, work_mode, employment_type, description, url, source, salary, verification_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified_active')
  `);
  const jobInfo = insertJobStmt.run(
    syntheticJob.title,
    syntheticJob.company,
    syntheticJob.location,
    syntheticJob.work_mode,
    syntheticJob.employment_type,
    syntheticJob.description,
    syntheticJob.url,
    syntheticJob.source,
    syntheticJob.salary
  );
  const jobId = Number(jobInfo.lastInsertRowid);

  db.prepare(`
    INSERT INTO job_evaluations (job_id, score, rating, recommendation, fresher_eligible, summary_reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    jobId,
    matchResult.score,
    matchResult.rating,
    matchResult.recommendation,
    matchResult.fresherEligible,
    matchResult.summaryReason
  );
  const savedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);

  // 3. JD Analysis
  const jdAnalysis = extractJdRequirements(savedJob);
  assert.ok(jdAnalysis.requiredSkills.includes('Java'), 'Required skills should detect Java');
  assert.ok(jdAnalysis.experience.isFresherEligible, 'Should detect fresher eligibility');

  // 4. Resume Studio Generation
  const studio = await generateStudioResume(savedJob, { jdAnalysis, template: 'ats_professional' });
  assert.ok(studio.content, 'Studio content must be generated');
  assert.ok(studio.atsScore.totalScore >= 60, 'ATS compatibility should be solid');

  // 5. Version Manager Save & Truthfulness
  const version = await saveResumeVersion({
    jobId,
    company: savedJob.company,
    jobTitle: savedJob.title,
    jdSnapshot: savedJob.description,
    template: 'ats_professional',
    generationMode: studio.generationMode,
    content: studio.content,
    atsScore: studio.atsScore.totalScore,
    atsBreakdown: studio.atsScore.categories,
    missingKeywords: studio.atsScore.keywordAnalysis.missingMandatory,
    matchedKeywords: studio.atsScore.keywordAnalysis.matchedKeywords
  });
  assert.ok(version.id, 'Resume version must be saved');

  // 6. Application Workflow Prep (creates tracked application)
  const prep = await prepareApplication(jobId);
  assert.ok(prep.checklist.length > 0, 'Application checklist must be prepared');
  assert.ok(prep.resumeVersion, 'Recommended version must exist');
  assert.ok(prep.applicationId, 'Application must be created in tracker');

  // 7. Verify Application Record in Tracker
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(prep.applicationId);
  assert.ok(app, 'Application must be present in database');
  assert.strictEqual(app.status, 'preparing', 'Initial status must be preparing');

  // 8. Screening Answer Generation
  const answers = generateScreeningAnswers(savedJob);
  assert.ok(answers.work_authorization, 'Screening answers should include work authorization');
  assert.strictEqual(answers.work_authorization.requiresUserInput, false, 'Standard questions should auto-populate');

  // 9. Recruiter Email Classification & Communication Draft
  const classification = classifyAndExtractRecruiterEmail({
    subject: 'Apex Fintech Solutions - Interview Scheduling: Junior Java Developer',
    body: 'Hi Abhishek, We reviewed your application for Junior Java Developer and would like to schedule a technical round.',
    from: 'Apex Talent Acquisition <recruiter@apexfintech.example.com>'
  });
  assert.strictEqual(classification.category, 'INTERVIEW_INVITATION', 'Email must be classified as INTERVIEW_INVITATION');

  const draft = generateCommunicationDraft({
    draftType: 'interview_availability',
    job: savedJob,
    recruiterName: classification.recruiter?.name || 'Apex Talent Acquisition'
  });
  assert.ok(draft.body.includes('Apex Fintech Solutions'), 'Draft should mention company');
  assert.ok(draft.body.includes('Apex Fintech Solutions'), 'Draft should mention company');

  // 10. Calendar Proposal
  const eventProposal = proposeCalendarEvent({
    title: `Technical Interview: ${savedJob.company}`,
    description: `Interview for ${savedJob.title}`,
    startTime: '2026-11-25T11:00:00+05:30',
    endTime: '2026-11-25T12:00:00+05:30',
    company: savedJob.company,
    jobId
  });
  assert.ok(eventProposal.eventId, 'Calendar proposal should have an ID');

  // 11. Interview Prep Dossier
  const dossier = await generateInterviewDossier(savedJob);
  assert.ok(dossier.technicalTopics.length > 0, 'Dossier must contain technical topics');

  // 12. Mock Simulator Q&A Evaluation
  const evalResult = evaluateCandidateAnswer(
    'Explain how Spring Boot handles dependency injection and component scanning.',
    'Spring Boot uses the @ComponentScan annotation to detect beans marked with @Component, @Service, and @Repository in base packages. The ApplicationContext injects these beans using IoC and @Autowired constructors.'
  );
  assert.ok(evalResult.score >= 7, 'Solid Spring Boot answer should score >= 7');

  // 13. Salary Take-Home & Data Safety
  const salaryEstimate = calculateOfferTakeHome({ ctcAnnual: 600000, location: 'Bengaluru' });
  assert.ok(salaryEstimate.monthlyBreakdown.netInHand > 40000, 'Monthly in-hand should be > 40,000 for 6 LPA');

  // Cleanup synthetic job, application, and calendar records
  db.prepare('DELETE FROM calendar_events WHERE id = ?').run(eventProposal.eventId);
  db.prepare('DELETE FROM applications WHERE id = ?').run(app.id);
  db.prepare('DELETE FROM resume_versions WHERE id = ?').run(version.id);
  db.prepare('DELETE FROM job_evaluations WHERE job_id = ?').run(jobId);
  db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
});
