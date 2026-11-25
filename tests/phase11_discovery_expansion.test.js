import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchWorkableJobs, clearWorkableCache } from '../src/discovery/workableClient.js';
import { fetchRecruiteeJobs, clearRecruiteeCache } from '../src/discovery/recruiteeClient.js';
import { 
  SOURCES, 
  getAllSources, 
  resolveSource, 
  recordSourceScanTelemetry, 
  getSourceTelemetry,
  INTEGRATION_LEVELS,
  SOURCE_TIERS
} from '../src/discovery/sourceRegistry.js';
import { executeUnifiedSearch } from '../src/discovery/unifiedSearchService.js';
import { extractAtsJobId } from '../src/discovery/urlNormalizer.js';
import { saveOrUpdateJob } from '../src/tracker/jobTracker.js';

test('Phase 11 — Discovery Source Expansion & Integration', async (t) => {

  await t.test('1. Workable Adapter: Normal response extraction and field normalization (Mocked)', async () => {
    clearWorkableCache();

    // Spin up local mock Workable server
    const mockServer = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('/api/v1/widget/accounts/techcorp')) {
        res.writeHead(200);
        res.end(JSON.stringify({
          name: 'TechCorp India',
          jobs: [
            {
              title: 'Junior Java Developer (Fresher)',
              shortcode: 'TECH-101',
              department: 'Backend Engineering',
              employment_type: 'Full-time',
              telecommuting: false,
              country: 'India',
              city: 'Bengaluru',
              state: 'Karnataka',
              description: '<p>Looking for a Java developer with Spring Boot and SQL knowledge. 0-1 years experience.</p>',
              application_url: 'https://apply.workable.com/techcorp/j/TECH-101/apply',
              published_on: '2026-11-20'
            },
            {
              title: 'Frontend React Intern',
              shortcode: 'TECH-102',
              department: 'UI Engineering',
              employment_type: 'Internship',
              telecommuting: true,
              country: 'India',
              city: 'Remote',
              description: '<p>React frontend development intern. Fresher welcome.</p>',
              application_url: 'https://apply.workable.com/techcorp/j/TECH-102/apply',
              published_on: '2026-11-22'
            }
          ]
        }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
    const port = mockServer.address().port;

    // Temporarily point fetch to local server by passing a custom token or intercepting
    // We test the normalization logic by mocking global fetch for this isolated block
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const localUrl = String(url).replace('https://apply.workable.com', `http://127.0.0.1:${port}`);
      return originalFetch(localUrl, opts);
    };

    try {
      const jobs = await fetchWorkableJobs('techcorp', { bypassCache: true });
      assert.strictEqual(jobs.length, 2);

      const j1 = jobs[0];
      assert.strictEqual(j1.title, 'Junior Java Developer (Fresher)');
      assert.strictEqual(j1.company, 'TechCorp India');
      assert.strictEqual(j1.source, 'workable');
      assert.strictEqual(j1.workMode, 'onsite');
      assert.strictEqual(j1.employmentType, 'full_time');
      assert.strictEqual(j1.experienceMin, 0);
      assert.strictEqual(j1.experienceMax, 1);
      assert.ok(j1.location.includes('Bengaluru'));
      assert.ok(j1.skills.includes('Java'));
      assert.ok(j1.skills.includes('Spring Boot'));
      assert.strictEqual(j1.externalSlug, 'workable-TECH-101');

      const j2 = jobs[1];
      assert.strictEqual(j2.workMode, 'remote');
      assert.strictEqual(j2.employmentType, 'internship');
      assert.ok(j2.skills.includes('React'));
    } finally {
      global.fetch = originalFetch;
      await new Promise(resolve => mockServer.close(resolve));
    }
  });

  await t.test('2. Workable Adapter: Empty results, pagination, malformed data & caching (Mocked)', async () => {
    clearWorkableCache();

    const mockServer = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('/emptycorp')) {
        res.writeHead(200);
        res.end(JSON.stringify({ name: 'EmptyCorp', jobs: [] }));
      } else if (req.url.includes('/malformed')) {
        res.writeHead(200);
        res.end('NOT_JSON_DATA');
      } else if (req.url.includes('/servererror')) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      } else if (req.url.includes('/pagedcorp')) {
        res.writeHead(200);
        res.end(JSON.stringify({
          name: 'PagedCorp',
          jobs: [
            { title: 'Job 1', shortcode: 'P-1', city: 'Bengaluru', country: 'India' },
            { title: 'Job 2', shortcode: 'P-2', city: 'Bengaluru', country: 'India' },
            { title: 'Job 3', shortcode: 'P-3', city: 'Bengaluru', country: 'India' }
          ]
        }));
      }
    });

    await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
    const port = mockServer.address().port;

    const originalFetch = global.fetch;
    let fetchCount = 0;
    global.fetch = async (url, opts) => {
      fetchCount++;
      const localUrl = String(url).replace('https://apply.workable.com', `http://127.0.0.1:${port}`);
      return originalFetch(localUrl, opts);
    };

    try {
      // 2a. Empty results
      const emptyJobs = await fetchWorkableJobs('emptycorp', { bypassCache: true });
      assert.deepStrictEqual(emptyJobs, []);

      // 2b. Malformed JSON handling
      await assert.rejects(
        async () => { await fetchWorkableJobs('malformed', { bypassCache: true }); },
        /Workable malformed JSON response/
      );

      // 2c. Server error handling
      await assert.rejects(
        async () => { await fetchWorkableJobs('servererror', { bypassCache: true }); },
        /Workable API error for servererror: HTTP 500/
      );

      // 2d. Pagination
      const page1 = await fetchWorkableJobs('pagedcorp', { page: 1, limit: 2, bypassCache: true });
      assert.strictEqual(page1.length, 2);
      assert.strictEqual(page1[0].title, 'Job 1');
      assert.strictEqual(page1[1].title, 'Job 2');

      const page2 = await fetchWorkableJobs('pagedcorp', { page: 2, limit: 2, bypassCache: true });
      assert.strictEqual(page2.length, 1);
      assert.strictEqual(page2[0].title, 'Job 3');

      // 2e. In-memory TTL caching verification
      fetchCount = 0;
      await fetchWorkableJobs('pagedcorp', { page: 1, limit: 2, bypassCache: false });
      assert.strictEqual(fetchCount, 0, 'Second call within TTL must return cached data without network call');
    } finally {
      global.fetch = originalFetch;
      await new Promise(resolve => mockServer.close(resolve));
    }
  });

  await t.test('3. Workable Adapter: Live verified fetch against active employer (LIVE TEST)', async () => {
    try {
      const jobs = await fetchWorkableJobs('mercari-india', { timeoutMs: 15000, bypassCache: true });
      assert.ok(Array.isArray(jobs), 'Workable live call must return an array of jobs');
      assert.ok(jobs.length > 0, `Mercari India must expose live jobs (found ${jobs.length})`);
      const sample = jobs[0];
      assert.strictEqual(sample.source, 'workable');
      assert.ok(sample.company.includes('Mercari'));
      assert.ok(sample.url.includes('apply.workable.com'));
      assert.ok(sample.location.includes('Bengaluru') || sample.location.includes('India'));
    } catch (err) {
      if (err.message.includes('fetch failed') || err.message.includes('timeout')) {
        console.warn('  [Live Workable test skipped due to external network unavailability]');
      } else {
        throw err;
      }
    }
  });

  await t.test('4. Recruitee Adapter: Normal response extraction and field normalization (Mocked)', async () => {
    clearRecruiteeCache();

    const mockServer = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('/api/offers/')) {
        res.writeHead(200);
        res.end(JSON.stringify({
          offers: [
            {
              id: 9001,
              slug: 'junior-java-engineer-9001',
              title: 'Junior Java Engineer',
              company_name: 'FinScale Global',
              department: 'Core Banking',
              city: 'Bengaluru',
              country: 'India',
              remote: false,
              hybrid: true,
              employment_type_code: 'full_time',
              description: '<p>Building high throughput payment microservices in Java and Spring Boot.</p>',
              requirements: '<p>Core Java, SQL, REST APIs, Git. 0-2 years experience.</p>',
              published_at: '2026-11-24T10:00:00Z',
              careers_url: 'https://finscale.recruitee.com/o/junior-java-engineer-9001'
            }
          ]
        }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
    const port = mockServer.address().port;

    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const localUrl = `http://127.0.0.1:${port}/api/offers/`;
      return originalFetch(localUrl, opts);
    };

    try {
      const jobs = await fetchRecruiteeJobs('finscale', { bypassCache: true });
      assert.strictEqual(jobs.length, 1);
      const j = jobs[0];
      assert.strictEqual(j.title, 'Junior Java Engineer');
      assert.strictEqual(j.company, 'FinScale Global');
      assert.strictEqual(j.source, 'recruitee');
      assert.strictEqual(j.workMode, 'hybrid');
      assert.strictEqual(j.employmentType, 'full_time');
      assert.strictEqual(j.experienceMin, 0);
      assert.strictEqual(j.experienceMax, 2);
      assert.ok(j.location.includes('Bengaluru'));
      assert.ok(j.skills.includes('Java'));
      assert.ok(j.skills.includes('Spring Boot'));
      assert.ok(j.skills.includes('Git'));
      assert.strictEqual(j.externalSlug, 'recruitee-9001');
    } finally {
      global.fetch = originalFetch;
      await new Promise(resolve => mockServer.close(resolve));
    }
  });

  await t.test('5. Recruitee Adapter: Live verified fetch against active employer (LIVE TEST)', async () => {
    try {
      const jobs = await fetchRecruiteeJobs('bunq', { timeoutMs: 15000, bypassCache: true });
      assert.ok(Array.isArray(jobs), 'Recruitee live call must return an array of jobs');
      assert.ok(jobs.length > 0, `bunq must expose live jobs (found ${jobs.length})`);
      const sample = jobs[0];
      assert.strictEqual(sample.source, 'recruitee');
      assert.ok(sample.url.includes('recruitee.com') || sample.url.includes('bunq.com'));
    } catch (err) {
      if (err.message.includes('fetch failed') || err.message.includes('timeout')) {
        console.warn('  [Live Recruitee test skipped due to external network unavailability]');
      } else {
        throw err;
      }
    }
  });

  await t.test('6. Source Registry: Metadata completeness & dynamic scan telemetry', async () => {
    const all = getAllSources();
    assert.strictEqual(all.length, 14, 'Registry must contain exactly 14 designated sources');

    // Verify every source has required attributes
    for (const src of all) {
      assert.ok(src.id, 'Source must have id');
      assert.ok(src.name, 'Source must have display name');
      assert.ok(src.tier, 'Source must have tier');
      assert.ok(src.status, 'Source must have status');
      assert.ok(src.integrationLevel, 'Source must have integrationLevel');
      assert.ok(Array.isArray(src.supportedSearchCapabilities), 'Source must define supportedSearchCapabilities');
      assert.strictEqual(typeof src.supportedPagination, 'boolean', 'Source must declare pagination support');
      assert.ok(src.rateLimitInfo, 'Source must declare rateLimitInfo');
      assert.ok(src.sourceUrl, 'Source must have sourceUrl');
    }

    // Verify dynamic telemetry updates
    const testTimestamp = new Date().toISOString();
    recordSourceScanTelemetry('workable', {
      success: true,
      jobsFound: 15,
      newJobsAdded: 5,
      timestamp: testTimestamp
    });

    const workableTel = getSourceTelemetry('workable');
    assert.strictEqual(workableTel.lastSuccessfulScan, testTimestamp);
    assert.strictEqual(workableTel.lastScanJobsCount, 15);
    assert.strictEqual(workableTel.errorState, null);
    assert.strictEqual(workableTel.consecutiveErrors, 0);

    // Verify error telemetry
    recordSourceScanTelemetry('workable', {
      success: false,
      error: 'HTTP 429 Rate limited'
    });
    const errorTel = getSourceTelemetry('workable');
    assert.ok(errorTel.lastFailedScan);
    assert.strictEqual(errorTel.errorState, 'HTTP 429 Rate limited');
    assert.strictEqual(errorTel.consecutiveErrors, 1);
  });

  await t.test('7. ATS Job ID Extraction: Workable and Recruitee URL identifiers', async () => {
    const workableId1 = extractAtsJobId('https://apply.workable.com/j/68368CD6BE');
    assert.strictEqual(workableId1, 'workable-68368CD6BE');

    const workableId2 = extractAtsJobId('https://apply.workable.com/mercari-india/j/68368CD6BE/apply?utm_source=linkedin');
    assert.strictEqual(workableId2, 'workable-68368CD6BE');

    const recruiteeId1 = extractAtsJobId('https://bunq.recruitee.com/o/compliance-agent-legal-account-restriction-3');
    assert.strictEqual(recruiteeId1, 'recruitee-compliance-agent-legal-account-restriction-3');
  });

  await t.test('8. Cross-Source Deduplication with new sources (Workable + FreeHire + Lever)', async () => {
    // Insert mock jobs to test cross-source deduplication in unified search
    const nowIso = new Date().toISOString();

    // Workable primary
    saveOrUpdateJob({
      externalSlug: 'workable-test-dedup-1',
      source: 'workable',
      sourceConfidence: 1.0,
      title: 'Phase 11 Platform Engineer Intern',
      company: 'UnifiedExpansion Corp',
      location: 'Bengaluru, Karnataka, India',
      url: 'https://apply.workable.com/j/EXPAND01',
      canonicalUrl: 'https://apply.workable.com/j/EXPAND01',
      description: 'Java and Spring Boot platform engineering internship in Bengaluru.',
      postedAt: nowIso,
      experienceMin: 0,
      experienceMax: 1,
      workMode: 'onsite',
      employmentType: 'internship',
      skills: ['Java', 'Spring Boot']
    });

    // FreeHire duplicate of same job
    saveOrUpdateJob({
      externalSlug: 'freehire-test-dedup-1',
      source: 'freehire',
      sourceConfidence: 0.85,
      title: 'Phase 11 Platform Engineer Intern',
      company: 'UnifiedExpansion Corp',
      location: 'Bengaluru, Karnataka, India',
      url: 'https://freehire.org/jobs/expand-01?utm_source=aggregator',
      canonicalUrl: 'https://freehire.org/jobs/expand-01',
      description: 'Java and Spring Boot platform engineering internship in Bengaluru.',
      postedAt: nowIso,
      experienceMin: 0,
      experienceMax: 1,
      workMode: 'onsite',
      employmentType: 'internship',
      skills: ['Java', 'Spring Boot']
    });

    const searchRes = executeUnifiedSearch({
      q: 'Phase 11 Platform Engineer Intern',
      excludeDuplicates: true
    });

    assert.ok(searchRes.results.length >= 1);
    const primary = searchRes.results.find(j => j.title === 'Phase 11 Platform Engineer Intern');
    assert.ok(primary, 'Primary deduplicated job must exist');
    assert.strictEqual(primary.source, 'workable', 'Higher confidence Workable listing must be preferred over FreeHire');
    assert.ok(primary.alternateSources && primary.alternateSources.length >= 1, 'Alternate source from FreeHire must be attached');
    assert.strictEqual(primary.alternateSources[0].source, 'freehire');
  });

  await t.test('9. Search Engine: Multi-Criteria Search across expanded sources with Fresher priority', async () => {
    const searchRes = executeUnifiedSearch({
      skills: ['Java'],
      fresherOnly: true,
      location: 'bengaluru'
    });

    assert.ok(searchRes.summary.totalSourceResults > 0, 'Search must discover matching roles in vault');
    assert.ok(searchRes.summary.eligibleRoles > 0, 'Eligible fresher roles must be identified');
    assert.strictEqual(searchRes.sourcesStatus.length, 14, 'Sources status list must contain exactly 14 designated sources');
    
    // Ensure Workable is present in sourcesStatus
    const workableStatus = searchRes.sourcesStatus.find(s => s.id === 'workable');
    assert.ok(workableStatus, 'Workable must be present in sourcesStatus');
    assert.strictEqual(workableStatus.tier, SOURCE_TIERS.LIVE_FEED);
  });
});
