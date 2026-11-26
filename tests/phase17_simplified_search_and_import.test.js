import test from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase } from '../src/db/schema.js';
import { normalizeDiscoveryQueries } from '../src/discovery/discoveryService.js';
import {
  fetchRemotiveJobs,
  fetchArbeitnowJobs,
  fetchHimalayasJobs,
  fetchJobicyJobs,
  fetchRemoteOkJobs,
  fetchWeWorkRemotelyJobs,
  fetchHnWhoIsHiringJobs,
  fetchHasjobJobs,
  fetchUnstopJobs
} from '../src/discovery/publicFeedsClient.js';
import { getSourceHealthReport, recordSourceScanTelemetry, resolveSource } from '../src/discovery/sourceRegistry.js';
import { executeUnifiedSearch } from '../src/discovery/unifiedSearchService.js';
import {
  importJobsFromInput,
  isLinkedInSearchUrl,
  isRestrictedSearchResultsUrl,
  parseLinkedInGuestSearchHtml,
  parseLinkedInGuestJobHtml,
  parseCsvJobs
} from '../src/discovery/jobImportService.js';
import { updateApplicationStatus, undoSubmittedApplication } from '../src/tracker/applicationTracker.js';
import { executeAgentTool } from '../src/agent/agentBridge.js';

test('Phase 17.1: Multi-query normalization deduplicates and splits comma/newline queries', () => {
  const queries = normalizeDiscoveryQueries('Java Developer, Junior Java Developer, java developer\nSpring Boot Developer');
  assert.deepEqual(queries, ['Java Developer', 'Junior Java Developer', 'Spring Boot Developer']);
});

test('Phase 17.2: Source Health Report exposes all live and assisted sources accurately', () => {
  recordSourceScanTelemetry('himalayas', { success: true, jobsFound: 15, newJobsAdded: 5, durationMs: 420 });
  const report = getSourceHealthReport();
  const himalayas = report.find(s => s.id === 'himalayas');
  const naukri = report.find(s => s.id === 'naukri');
  assert.ok(himalayas);
  assert.equal(himalayas.supportsDirectIngestion, true);
  assert.equal(himalayas.jobsRetrieved, 15);
  assert.equal(himalayas.searchDurationMs, 420);
  assert.equal(himalayas.dataFreshness, 'fresh');
  assert.ok(naukri);
  assert.equal(naukri.supportsDirectIngestion, false);
  assert.equal(naukri.importStatus, 'assisted_only');
  assert.equal(resolveSource('himalayas').id, 'himalayas');
  assert.equal(resolveSource('foundit').id, 'foundit');
});

test('Phase 17.3: LinkedIn search HTML parser extracts multiple job records (no single-job collapse)', () => {
  const sampleHtml = `
    <ul>
      <li>
        <div class="base-card">
          <a href="https://www.linkedin.com/jobs/view/1111111111?refId=abc">Link</a>
          <h3 class="base-search-card__title">Junior Java Developer</h3>
          <h4 class="base-search-card__subtitle">Acme Tech</h4>
          <span class="job-search-card__location">Bengaluru, India</span>
          <time datetime="2026-11-25">1 day ago</time>
        </div>
      </li>
      <li>
        <div class="base-card">
          <a href="https://www.linkedin.com/jobs/view/2222222222?trk=xyz">Link</a>
          <h3 class="base-search-card__title">Spring Boot Associate</h3>
          <h4 class="base-search-card__subtitle">Beta Systems</h4>
          <span class="job-search-card__location">Hyderabad, India</span>
          <time datetime="2026-11-24">2 days ago</time>
        </div>
      </li>
    </ul>
  `;
  const parsed = parseLinkedInGuestSearchHtml(sampleHtml);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].title, 'Junior Java Developer');
  assert.equal(parsed[0].company, 'Acme Tech');
  assert.equal(parsed[1].title, 'Spring Boot Associate');
  assert.equal(isLinkedInSearchUrl('https://www.linkedin.com/jobs/search-results/?keywords=Java'), true);

  const singleHtml = `
    <h1 class="top-card-layout__title">Software Engineer - Java</h1>
    <a class="topcard__org-name-link">NeST Digital</a>
    <span class="topcard__flavor--bullet">Bengaluru, Karnataka, India</span>
    <div class="show-more-less-html__markup"><p>Java and Spring Boot fresher role</p></div>
  `;
  const single = parseLinkedInGuestJobHtml(singleHtml, 'https://www.linkedin.com/jobs/view/4484739808/');
  assert.equal(single.title, 'Software Engineer - Java');
  assert.equal(single.company, 'NeST Digital');
});

test('Phase 17.4: Restricted search URLs (Naukri/Indeed) are flagged unsupported instead of saved as fake single jobs', async () => {
  assert.equal(isRestrictedSearchResultsUrl('https://www.naukri.com/java-developer-jobs-in-bengaluru?k=java'), true);
  assert.equal(isRestrictedSearchResultsUrl('https://in.indeed.com/jobs?q=java&l=Bengaluru'), true);

  const res = await importJobsFromInput({
    urlsText: 'https://www.naukri.com/java-developer-jobs-in-bengaluru?k=java\nnot-a-valid-url',
    preview: true,
    fetchRemote: false
  });
  assert.equal(res.discovered, 0);
  assert.equal(res.imported, 0);
  assert.equal(res.invalidLinks.length, 1);
  assert.equal(res.unsupportedExtraction.length, 1);
  assert.equal(res.unsupportedExtraction[0].source, 'naukri');
});

test('Phase 17.5: Batch JSON/CSV import preview & deduplication without DB corruption', async () => {
  const uniqueSlug = Date.now();
  const csv = `title,company,url,location\nJava Trainee,Phase17Corp,https://example.com/jobs/p17-${uniqueSlug},Bengaluru`;
  const previewRes = await importJobsFromInput({ csvText: csv, preview: true, fetchRemote: false });
  assert.equal(previewRes.preview, true);
  assert.equal(previewRes.discovered, 1);
  assert.equal(previewRes.imported, 1);

  const parsedCsv = parseCsvJobs(csv);
  assert.equal(parsedCsv.length, 1);

  const saveRes = await importJobsFromInput({ csvText: csv, preview: false, fetchRemote: false });
  assert.equal(saveRes.imported, 1);
  const jobId = saveRes.items[0].jobId;

  // Re-importing same URL must count as duplicate
  const dupRes = await importJobsFromInput({ csvText: csv, preview: false, fetchRemote: false });
  assert.equal(dupRes.duplicates, 1);
  assert.equal(dupRes.imported, 0);

  // Clean up test row
  const db = getDatabase();
  db.prepare('DELETE FROM job_evaluations WHERE job_id = ?').run(jobId);
  db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
});

test('Phase 17.6: Multi-query search & manual Submitted hiding behavior', () => {
  const db = getDatabase();
  const ts = Date.now();
  const j1 = db.prepare(`
    INSERT INTO jobs (external_slug, source, title, company, location, url, canonical_url, description, status)
    VALUES (?, 'direct', 'Junior Java Developer', 'TestAlpha', 'Bengaluru, India', ?, ?, 'Java Spring Boot fresher', 'discovered')
  `).run(`p17-java-${ts}`, `https://example.com/p17-java-${ts}`, `https://example.com/p17-java-${ts}`).lastInsertRowid;

  const j2 = db.prepare(`
    INSERT INTO jobs (external_slug, source, title, company, location, url, canonical_url, description, status)
    VALUES (?, 'direct', 'Python Backend Trainee', 'TestBeta', 'Bengaluru, India', ?, ?, 'Python FastAPI SQL fresher', 'discovered')
  `).run(`p17-py-${ts}`, `https://example.com/p17-py-${ts}`, `https://example.com/p17-py-${ts}`).lastInsertRowid;

  // Multi-query OR search should find both
  const multiRes = executeUnifiedSearch({ q: `TestAlpha, TestBeta`, excludeExpired: false });
  const ids = multiRes.results.map(r => r.id);
  assert.ok(ids.includes(j1));
  assert.ok(ids.includes(j2));

  // Mark j1 manually submitted -> hidden when excludeApplied: true
  updateApplicationStatus(j1, 'submitted', { userConfirmed: true, notes: 'Phase 17 test' });
  const filteredRes = executeUnifiedSearch({ q: `TestAlpha, TestBeta`, excludeApplied: true, excludeExpired: false });
  const filteredIds = filteredRes.results.map(r => r.id);
  assert.equal(filteredIds.includes(j1), false);
  assert.ok(filteredIds.includes(j2));

  // Add a senior/disqualified job and verify excludeNonMatching hides it
  const jSenior = db.prepare(`
    INSERT INTO jobs (external_slug, source, title, company, location, url, canonical_url, description, experience_min, status)
    VALUES (?, 'direct', 'Principal Java Architect 10+ Years', 'TestAlpha', 'Bengaluru, India', ?, ?, 'Requires 10+ years and strictly B.Tech only', 10, 'discovered')
  `).run(`p17-senior-${ts}`, `https://example.com/p17-senior-${ts}`, `https://example.com/p17-senior-${ts}`).lastInsertRowid;

  const matchedOnly = executeUnifiedSearch({ q: `TestAlpha, TestBeta`, excludeApplied: true, excludeNonMatching: true, excludeExpired: false });
  const matchedIds = matchedOnly.results.map(r => r.id);
  assert.equal(matchedIds.includes(jSenior), false);

  // Clean up
  db.prepare('DELETE FROM applications WHERE job_id IN (?, ?, ?)').run(j1, j2, jSenior);
  db.prepare('DELETE FROM job_evaluations WHERE job_id IN (?, ?, ?)').run(j1, j2, jSenior);
  db.prepare('DELETE FROM jobs WHERE id IN (?, ?, ?)').run(j1, j2, jSenior);
});

test('Phase 17.7: Live public feeds probe (Remotive, Arbeitnow, Himalayas, Jobicy, RemoteOK, WWR, HN, Hasjob, Unstop)', async () => {
  const results = await Promise.all([
    fetchRemotiveJobs({ limit: 3 }),
    fetchArbeitnowJobs({ limit: 3 }),
    fetchHimalayasJobs({ limit: 3 }),
    fetchJobicyJobs({ count: 3 }),
    fetchRemoteOkJobs({ limit: 3 }),
    fetchWeWorkRemotelyJobs({ limit: 3 }),
    fetchHnWhoIsHiringJobs({ limit: 3 }),
    fetchHasjobJobs({ limit: 3 }),
    fetchUnstopJobs({ limit: 3 })
  ]);
  const nonEmptyFeeds = results.filter(arr => Array.isArray(arr) && arr.length > 0).length;
  assert.ok(nonEmptyFeeds >= 6, `Expected >= 6 live feeds to return jobs, got ${nonEmptyFeeds}`);
});

test('Phase 17.8: Import Preview enriches jdText with dataQuality, matchScore & hasDescription', async () => {
  const res = await importJobsFromInput({
    jdText: 'Junior Java Developer\nLooking for Java, Spring Boot, React.js, and MySQL fresher in Bengaluru.',
    company: 'PreviewTestCorp',
    preview: true,
    fetchRemote: false
  });
  assert.equal(res.discovered, 1);
  assert.equal(res.items[0].hasDescription, true);
  assert.equal(res.items[0].dataQuality, 'complete');
  assert.equal(typeof res.items[0].matchScore, 'number');
});

test('Phase 17.9: Undo Submitted & on_hold status preserve application history', () => {
  const db = getDatabase();
  const ts = Date.now();
  const jobId = db.prepare(`
    INSERT INTO jobs (external_slug, source, title, company, location, url, canonical_url, description, status)
    VALUES (?, 'direct', 'Java Trainee', 'UndoCorp', 'Bengaluru', ?, ?, 'Java Spring Boot fresher', 'discovered')
  `).run(`undo-${ts}`, `https://example.com/undo-${ts}`, `https://example.com/undo-${ts}`).lastInsertRowid;

  updateApplicationStatus(jobId, 'submitted', { userConfirmed: true, notes: 'Submitted' });
  const reverted = undoSubmittedApplication(jobId, 'Accidental click');
  assert.equal(reverted.status, 'preparing');
  assert.equal(reverted.applied_date, null);
  assert.ok(reverted.status_history.length >= 2);

  const onHold = updateApplicationStatus(jobId, 'on_hold', { userConfirmed: true, notes: 'Waiting' });
  assert.equal(onHold.newStatus || onHold.application?.status, 'on_hold');

  db.prepare('DELETE FROM applications WHERE job_id = ?').run(jobId);
  db.prepare('DELETE FROM job_evaluations WHERE job_id = ?').run(jobId);
  db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
});

test('Phase 17.10: CAREEROS JOB SWEEP MCP tool executes live discovery and returns structured summary', async () => {
  const summary = await executeAgentTool('run_job_sweep', { query: 'Java Developer', maxPerQuery: 3 });
  assert.equal(summary.command, 'CAREEROS JOB SWEEP');
  assert.ok(summary.totalSourcesAttempted >= 10);
  assert.ok(summary.sourcesSuccessful >= 5);
  assert.ok(Array.isArray(summary.browserAssistedSources));
  assert.ok(summary.browserAssistedSources.includes('naukri'));
  assert.ok(summary.browserAssistedSources.includes('linkedin'));
});
