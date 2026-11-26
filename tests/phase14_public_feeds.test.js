import test, { describe } from 'node:test';
import assert from 'node:assert';
import { fetchRemotiveJobs, fetchArbeitnowJobs } from '../src/discovery/publicFeedsClient.js';
import { resolveSource } from '../src/discovery/sourceRegistry.js';

describe('Phase 14 — Public Remote & International Feeds (Remotive & Arbeitnow)', () => {
  test('1. Source Registry cleanly resolves remotive and arbeitnow', () => {
    const rem = resolveSource('remotive');
    const arb = resolveSource('arbeitnow');
    assert.ok(rem && rem.id, 'Remotive must resolve to a registered source bucket');
    assert.ok(arb && arb.id, 'Arbeitnow must resolve to a registered source bucket');
  });

  test('2. Remotive live public API returns normalized remote jobs or fails gracefully on timeout', async () => {
    const jobs = await fetchRemotiveJobs({ limit: 5 });
    assert.ok(Array.isArray(jobs), 'Must always return an array even if offline');
    if (jobs.length > 0) {
      assert.strictEqual(jobs[0].source, 'remotive');
      assert.strictEqual(jobs[0].workMode, 'remote');
      assert.ok(jobs[0].url && jobs[0].title);
    }
  });

  test('3. Arbeitnow live public API returns normalized international/remote jobs or fails gracefully', async () => {
    const jobs = await fetchArbeitnowJobs({ limit: 5 });
    assert.ok(Array.isArray(jobs), 'Must always return an array even if offline');
    if (jobs.length > 0) {
      assert.strictEqual(jobs[0].source, 'arbeitnow');
      assert.ok(jobs[0].url && jobs[0].title);
    }
  });
});
