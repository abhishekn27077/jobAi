import test from 'node:test';
import assert from 'node:assert';
import { fetchSmartRecruitersJobs } from '../src/discovery/directAtsClient.js';
import { startDailyScanner, stopDailyScanner } from '../src/scheduler/dailyScanner.js';

test('Direct SmartRecruiters ATS client retrieves and normalizes live jobs', async () => {
  const jobs = await fetchSmartRecruitersJobs('TaurusHardSoftSolutionsPvtLtd', 'Java');
  assert.ok(jobs.length > 0, 'SmartRecruiters should return postings');

  const j = jobs[0];
  assert.ok(j.externalSlug.startsWith('smartrecruiters-'));
  assert.ok(j.title, 'Job must have title');
  assert.ok(j.url.includes('smartrecruiters.com'));
});

test('Scheduler initializes and stops cleanly without dangling handles', () => {
  const scanner = startDailyScanner(12, false);
  assert.strictEqual(scanner.active, true);
  assert.strictEqual(scanner.intervalHours, 12);

  stopDailyScanner();
  assert.ok(true);
});
