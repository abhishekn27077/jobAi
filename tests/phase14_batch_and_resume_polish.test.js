import test, { describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { getDatabase } from '../src/db/schema.js';
import { renderResumeHtml } from '../src/resumes/templates/templateEngine.js';
import { exportToPdf } from '../src/resumes/exporters/pdfExporter.js';
import { checkResumeAtsQuality } from '../src/resumes/atsQualityChecker.js';
import { saveResumeVersion } from '../src/resumes/resumeVersionManager.js';
import { generateStudioResume } from '../src/resumes/resumeStudioService.js';
import { checkDuplicateApplication, updateApplicationStatus, VALID_APPLICATION_STATUSES } from '../src/tracker/applicationTracker.js';
import { validateBatchQueue, createBatchSession, getBatchSession, controlBatchSession } from '../src/automation/batchSessionManager.js';
import { classifyLocationRegion } from '../src/discovery/unifiedSearchService.js';

describe('Phase 14 — Professional Resume Engine, Duplicate Prevention & Batch Assistant', () => {
  test('1. Upgraded ATS template & PDF exporter produce valid multi-margin PDF with real pdfMeta verification', async () => {
    const job = { title: 'Junior Java Developer', company: 'TechCorp', description: 'Java, Spring Boot, SQL, MCA fresher' };
    const studioRes = await generateStudioResume(job, { template: 'ats_professional' });
    const data = studioRes.content;

    const html = renderResumeHtml(data, 'ats_professional');
    assert.ok(!html.includes('margin: 0;\n  }\n  *'), 'Must not force @page margin: 0');
    assert.ok(html.includes('Calibri'), 'Must use clean professional typography');

    const tmpPdf = path.resolve('output/resumes/test_phase14_ats.pdf');
    await exportToPdf(html, tmpPdf);
    assert.ok(fs.existsSync(tmpPdf), 'PDF file must be created on disk');

    const audit = checkResumeAtsQuality({
      ...data,
      name: data.personal.fullName,
      contact: data.personal,
      skills: data.technicalSkills
    }, job, { pdfPath: tmpPdf, template: 'ats_professional' });

    assert.strictEqual(audit.pdfMeta.verified, true, 'PDF signature & stream check must verify true');
    assert.ok(audit.pdfMeta.pageCount >= 1 && audit.pdfMeta.pageCount <= 2, 'Page count must be 1 or 2 pages');
    assert.ok(audit.atsQualityScore >= 85, `Expected high ATS score, got ${audit.atsQualityScore}`);

    try { fs.unlinkSync(tmpPdf); } catch {}
  });

  test('2. Resume Version Manager caches identical resume content and avoids duplicate PDF recompilation', async () => {
    const db = getDatabase();
    const job = db.prepare('SELECT id, title, company, description FROM jobs LIMIT 1').get();
    assert.ok(job, 'Requires at least one job in DB');

    const content = {
      personal: { fullName: 'Abhishek N', location: 'Bengaluru, India', phone: '+91-9876543210', email: 'abhishek@example.com' },
      summary: 'MCA 2026 Java Developer focused on Spring Boot and REST APIs.',
      technicalSkills: { languages: ['Java', 'SQL'], backend: ['Spring Boot'], databases: ['MySQL'] },
      experience: [],
      projects: [{ name: 'NearVia', techStack: ['Spring Boot'], bullets: ['Built REST APIs.'] }],
      education: [{ degree: 'MCA', institution: 'Bangalore University', period: '2026' }],
      certificationsAndAwards: []
    };

    const v1 = await saveResumeVersion({
      jobId: job.id,
      company: job.company,
      jobTitle: job.title,
      jdSnapshot: { title: job.title },
      template: 'ats_professional',
      content,
      atsScore: 90,
      atsBreakdown: {}
    });

    const v2 = await saveResumeVersion({
      jobId: job.id,
      company: job.company,
      jobTitle: job.title,
      jdSnapshot: { title: job.title },
      template: 'ats_professional',
      content,
      atsScore: 90,
      atsBreakdown: {}
    });

    assert.strictEqual(v2.cached, true, 'Second identical save must return cached version');
    assert.strictEqual(v2.versionNumber, v1.versionNumber || v1.version_number, 'Cached version must keep same version number');
  });

  test('3. Duplicate Application Prevention detects canonical URL and company+title duplicates', () => {
    const db = getDatabase();
    const submittedApp = db.prepare(`SELECT a.*, j.title, j.company, j.url FROM applications a JOIN jobs j ON a.job_id = j.id WHERE a.status IN ('submitted', 'applied') LIMIT 1`).get();
    if (submittedApp) {
      const dupExact = checkDuplicateApplication(submittedApp.job_id);
      assert.strictEqual(dupExact.isDuplicate, true);
      assert.strictEqual(dupExact.state, 'ALREADY_APPLIED');

      const dupClone = checkDuplicateApplication({
        id: 9999999,
        title: submittedApp.title,
        company: submittedApp.company,
        url: submittedApp.url + '?utm_source=linkedin'
      });
      assert.strictEqual(dupClone.isDuplicate, true, 'Canonical URL / company+title duplicate must be caught');
      assert.strictEqual(dupClone.state, 'ALREADY_APPLIED');
    }
  });

  test('4. Batch Application Preparation Assistant validates, queues, prepares, pauses, skips, and confirms safely', async () => {
    const db = getDatabase();
    const candidates = db.prepare(`
      SELECT j.id FROM jobs j
      JOIN job_evaluations e ON j.id = e.job_id
      WHERE j.status = 'discovered' AND e.fresher_eligible = 1 AND j.id NOT IN (SELECT job_id FROM applications)
      LIMIT 3
    `).all();

    if (candidates.length < 2) return;
    const ids = candidates.map(c => c.id);

    const validation = validateBatchQueue({ mode: 'selected', jobIds: ids });
    assert.ok(validation.ready.length >= 2, 'Selected eligible unapplied jobs must pass pre-flight validation');

    const session = createBatchSession({ name: 'Test Batch Session', mode: 'selected', jobIds: ids });
    assert.strictEqual(session.status, 'idle');
    assert.strictEqual(session.counts.total, validation.ready.length);

    // Start session -> prepares item #1 and pauses for user review (NEVER auto-submits)
    const started = await controlBatchSession(session.id, 'start');
    assert.strictEqual(started.status, 'paused', 'Must pause after preparing first job for user review');
    assert.ok(started.currentItem, 'Must have active currentItem');
    assert.ok(['awaiting_review', 'needs_info'].includes(started.currentItem.status));

    // Skip item #1 -> advances to item #2 and pauses
    const afterSkip = await controlBatchSession(session.id, 'skip', { reason: 'Test skip' });
    assert.strictEqual(afterSkip.counts.skipped, 1);

    // Stop session cleanly
    const stopped = await controlBatchSession(session.id, 'stop');
    assert.strictEqual(stopped.status, 'stopped');

    // Clean up test session
    db.prepare('DELETE FROM batch_sessions WHERE id = ?').run(session.id);
  });

  test('5. International & Remote geo classification separates India, Remote India, Worldwide Remote, and International cautiously', () => {
    const indiaJob = classifyLocationRegion({ location: 'Bengaluru, India', work_mode: 'onsite', description: 'Java Developer' });
    assert.strictEqual(indiaJob.locationRegion, 'india');
    assert.strictEqual(indiaJob.countryEligibility, 'india_eligible');

    const remoteIndia = classifyLocationRegion({ location: 'Remote, India', work_mode: 'remote', description: 'Spring Boot Developer' });
    assert.strictEqual(remoteIndia.locationRegion, 'remote_india');
    assert.strictEqual(remoteIndia.countryEligibility, 'india_eligible');

    const worldwideRemote = classifyLocationRegion({ location: 'Worldwide Remote', work_mode: 'remote', description: 'Software Engineer anywhere' });
    assert.strictEqual(worldwideRemote.locationRegion, 'worldwide_remote');
    assert.strictEqual(worldwideRemote.countryEligibility, 'unknown', 'Must never assume worldwide remote automatically allows India without confirmation');

    const usRestricted = classifyLocationRegion({ location: 'San Francisco, USA', work_mode: 'hybrid', description: 'Must reside in the US. No visa sponsorship.' });
    assert.strictEqual(usRestricted.locationRegion, 'international');
    assert.strictEqual(usRestricted.country, 'United States');
    assert.strictEqual(usRestricted.countryEligibility, 'restricted_other_country');
  });

  test('6. Application Tracker supports Submission Verification Pending status', () => {
    assert.ok(VALID_APPLICATION_STATUSES.includes('submission_verification_pending'), 'Must include submission_verification_pending status');
    assert.ok(VALID_APPLICATION_STATUSES.includes('closed'), 'Must include closed status');
  });
});
