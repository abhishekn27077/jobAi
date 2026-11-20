import test from 'node:test';
import assert from 'node:assert';
import { searchFreehireJobs } from '../src/discovery/freehireClient.js';
import { saveOrUpdateJob, getJobs } from '../src/tracker/jobTracker.js';

test('FreeHire API returns valid live job listings', async () => {
  const result = await searchFreehireJobs({
    query: 'Junior Java',
    countries: ['in'],
    limit: 3
  });

  assert.ok(result.jobs.length > 0, 'Should return at least 1 job');
  const job = result.jobs[0];
  assert.ok(job.title, 'Job must have a title');
  assert.ok(job.url, 'Job must have an application url');
  assert.ok(job.externalSlug, 'Job must have a slug');

  // Test saving into local SQLite tracker
  const saveRes = saveOrUpdateJob(job);
  assert.ok(saveRes.jobId > 0, 'Job must be assigned an ID in database');
  assert.ok(saveRes.evaluation, 'Job must have an evaluation result');

  // Verify retrieval
  const storedJobs = getJobs({ limit: 1 });
  assert.ok(storedJobs.length > 0);
});
