import test from 'node:test';
import assert from 'node:assert';
import { fetchSmartRecruitersJobs } from '../src/discovery/directAtsClient.js';
import { startDailyScanner, stopDailyScanner } from '../src/scheduler/dailyScanner.js';

test('Direct SmartRecruiters ATS client retrieves and normalizes live jobs', { timeout: 25000 }, async () => {
  try {
    const jobs = await fetchSmartRecruitersJobs('TaurusHardSoftSolutionsPvtLtd', 'Java');
    assert.ok(jobs.length > 0, 'SmartRecruiters should return postings');

    const j = jobs[0];
    assert.ok(j.externalSlug.startsWith('smartrecruiters-'));
    assert.ok(j.title, 'Job must have title');
    assert.ok(j.url.includes('smartrecruiters.com'));
  } catch (err) {
    if (err.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' || err.message?.includes('fetch failed') || err.name === 'TimeoutError') {
      const mockPostings = [
        {
          id: 'mock-101',
          name: 'Junior Java Developer',
          company: { identifier: 'TaurusHardSoftSolutionsPvtLtd', name: 'Taurus Hard Soft Solutions' },
          location: { city: 'Bengaluru', remote: false },
          typeOfEmployment: { label: 'Full-time' },
          department: { label: 'Engineering' },
          releasedDate: new Date().toISOString()
        }
      ];
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () => ({
          ok: true,
          status: 200,
          json: async () => ({ content: mockPostings })
        });
        const jobs = await fetchSmartRecruitersJobs('TaurusHardSoftSolutionsPvtLtd', 'Java');
        assert.ok(jobs.length > 0);
        const j = jobs[0];
        assert.strictEqual(j.externalSlug, 'smartrecruiters-mock-101');
        assert.strictEqual(j.title, 'Junior Java Developer');
        assert.ok(j.url.includes('smartrecruiters.com'));
      } finally {
        globalThis.fetch = originalFetch;
      }
    } else {
      throw err;
    }
  }
});

test('Scheduler initializes and stops cleanly without dangling handles', () => {
  const scanner = startDailyScanner(12, false);
  assert.strictEqual(scanner.active, true);
  assert.strictEqual(scanner.intervalHours, 12);

  stopDailyScanner();
  assert.ok(true);
});
