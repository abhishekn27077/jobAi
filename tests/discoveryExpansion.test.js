import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchLeverJobs } from '../src/discovery/leverClient.js';
import { fetchAshbyJobs } from '../src/discovery/ashbyClient.js';
import { validateJobRecord } from '../src/discovery/jobValidator.js';
import { normalizeCanonicalUrl, normalizeLocation, isBengaluruLocation, isIndiaOrRemote } from '../src/discovery/urlNormalizer.js';
import { saveOrUpdateJob, getJobs, updateJobStatus, recordScanHistory, getScanHistory } from '../src/tracker/jobTracker.js';
import { evaluateJobFit } from '../src/matcher/scoringEngine.js';
import { getDatabase } from '../src/db/schema.js';

test('Discovery Expansion: Lever client normalizes postings, work mode, and skills', async () => {
  // Setup in-memory mock Lever HTTP server
  const mockServer = http.createServer((req, res) => {
    if (req.url.includes('/zeta')) {
      const sampleLeverPostings = [
        {
          id: 'lever-test-1',
          text: 'Junior Java Developer',
          createdAt: 1700000000000,
          descriptionPlain: 'Looking for a Junior Java Developer with Spring Boot and SQL knowledge. 0-2 years of experience. Hybrid work model.',
          hostedUrl: 'https://jobs.lever.co/zeta/lever-test-1?utm_source=test',
          applyUrl: 'https://jobs.lever.co/zeta/lever-test-1/apply?utm_campaign=campus',
          workplaceType: 'hybrid',
          categories: {
            commitment: 'Full-time',
            department: 'Engineering',
            location: 'Bengaluru, India',
            team: 'Backend'
          }
        },
        {
          id: 'lever-test-2',
          text: 'Software Engineer Intern',
          createdAt: 1700000500000,
          descriptionPlain: '6-month MCA or B.Tech internship. Work from anywhere remote friendly. Python, React.',
          hostedUrl: 'https://jobs.lever.co/zeta/lever-test-2',
          applyUrl: 'https://jobs.lever.co/zeta/lever-test-2/apply',
          workplaceType: 'remote',
          categories: {
            commitment: 'Intern',
            department: 'Product',
            location: 'Remote - India'
          }
        }
      ];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sampleLeverPostings));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Company not found' }));
    }
  });

  await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  const port = mockServer.address().port;

  // Temporarily monkey-patch fetch or call through mock URL
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('api.lever.co')) {
      const mockUrl = url.replace('https://api.lever.co/v0/postings', `http://127.0.0.1:${port}`);
      return originalFetch(mockUrl, opts);
    }
    return originalFetch(url, opts);
  };

  try {
    const jobs = await fetchLeverJobs('zeta');
    assert.equal(jobs.length, 2, 'Should retrieve and parse 2 Lever postings');

    const job1 = jobs[0];
    assert.equal(job1.source, 'lever');
    assert.equal(job1.sourceConfidence, 1.0);
    assert.equal(job1.title, 'Junior Java Developer');
    assert.equal(job1.workMode, 'hybrid');
    assert.equal(job1.employmentType, 'full_time');
    assert.equal(job1.experienceMin, 0);
    assert.equal(job1.experienceMax, 2);
    assert.ok(job1.skills.includes('Java'), 'Extracted Java skill');
    assert.ok(job1.skills.includes('Spring Boot'), 'Extracted Spring Boot skill');
    assert.ok(!job1.canonicalUrl.includes('utm_source'), 'Stripped tracking parameters');

    const job2 = jobs[1];
    assert.equal(job2.workMode, 'remote');
    assert.equal(job2.employmentType, 'internship');
    assert.equal(job2.experienceMin, 0);

    // Verify 404 handling
    await assert.rejects(
      async () => fetchLeverJobs('nonexistent_company'),
      /HTTP 404/
    );
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise(resolve => mockServer.close(resolve));
  }
});

test('Discovery Expansion: Ashby client normalizes postings, remote status, and compensation', async () => {
  const mockServer = http.createServer((req, res) => {
    if (req.url.includes('/sentry')) {
      const sampleAshby = {
        apiVersion: '1.0',
        jobs: [
          {
            id: 'ashby-uuid-1',
            title: 'Full Stack Engineer (Fresher / Junior)',
            department: 'Application Engineering',
            team: 'Core Platform',
            employmentType: 'FullTime',
            isRemote: true,
            workplaceType: 'Remote',
            location: 'Bengaluru / Remote',
            publishedAt: '2026-01-15T10:00:00.000Z',
            jobUrl: 'https://jobs.ashbyhq.com/sentry/ashby-uuid-1',
            applyUrl: 'https://jobs.ashbyhq.com/sentry/ashby-uuid-1/application',
            descriptionHtml: '<p>Join our team building high throughput distributed systems in <strong>Python</strong>, <strong>TypeScript</strong>, and <strong>React</strong>.</p>',
            compensation: {
              compensationTierSummary: '₹12,00,000 - ₹18,00,000 INR'
            }
          }
        ]
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sampleAshby));
    } else {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server error' }));
    }
  });

  await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  const port = mockServer.address().port;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('api.ashbyhq.com')) {
      const mockUrl = url.replace('https://api.ashbyhq.com/posting-api/job-board', `http://127.0.0.1:${port}`);
      return originalFetch(mockUrl, opts);
    }
    return originalFetch(url, opts);
  };

  try {
    const jobs = await fetchAshbyJobs('sentry');
    assert.equal(jobs.length, 1);
    const job = jobs[0];

    assert.equal(job.source, 'ashby');
    assert.equal(job.sourceConfidence, 1.0);
    assert.equal(job.title, 'Full Stack Engineer (Fresher / Junior)');
    assert.equal(job.workMode, 'remote');
    assert.equal(job.employmentType, 'full_time');
    assert.equal(job.salary, '₹12,00,000 - ₹18,00,000 INR');
    assert.ok(job.skills.includes('Python'), 'Skills extracted Python');
    assert.ok(job.skills.includes('React'), 'Skills extracted React');
    assert.ok(!job.description.includes('<p>'), 'HTML stripped from description');

    // Test error handling
    await assert.rejects(
      async () => fetchAshbyJobs('error_company'),
      /HTTP 500/
    );
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise(resolve => mockServer.close(resolve));
  }
});

test('Discovery Expansion: Cross-source deduplication and pipeline status preservation', () => {
  const uniqueId = Date.now();
  const directUrl = `https://jobs.lever.co/acme-corp/role-${uniqueId}`;

  // 1. Ingest job via FreeHire aggregator
  const aggregatorJob = {
    externalSlug: `freehire-agg-${uniqueId}`,
    source: 'freehire',
    sourceConfidence: 0.85,
    title: 'Junior Java Software Engineer',
    company: 'Acme Technologies Pvt Ltd',
    location: 'Bengaluru, India',
    url: `${directUrl}?ref=freehire_in&utm_campaign=agg`,
    description: 'Looking for a Junior Java Software Engineer with Spring Boot and SQL skills.',
    experienceMin: 0,
    experienceMax: 2,
    salary: null,
    workMode: 'onsite'
  };

  const save1 = saveOrUpdateJob(aggregatorJob);
  assert.ok(save1.isNew, 'Initial aggregator listing should be inserted as new');
  const jobId = save1.jobId;

  // User manually moves job to 'saved' pipeline status
  updateJobStatus(jobId, 'saved');

  // 2. Later, direct ATS crawl from Lever encounters the authoritative source
  const directLeverJob = {
    externalSlug: `lever-acme-${uniqueId}`,
    source: 'lever',
    sourceConfidence: 1.0,
    title: 'Junior Java Software Engineer',
    company: 'Acme',
    location: 'Bengaluru, Karnataka, India',
    url: directUrl, // Same canonical URL
    description: 'Authoritative description directly from Acme Engineering Lever ATS portal.',
    experienceMin: 0,
    experienceMax: 2,
    salary: '₹6,00,000 - ₹9,00,000',
    workMode: 'hybrid',
    employmentType: 'full_time'
  };

  const save2 = saveOrUpdateJob(directLeverJob);
  assert.equal(save2.isNew, false, 'Direct ATS entry with matching canonical URL must be identified as duplicate');
  assert.equal(save2.jobId, jobId, 'Should match existing job record ID');

  // Verify DB state
  const db = getDatabase();
  const updatedRow = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  assert.equal(updatedRow.status, 'saved', 'User pipeline status "saved" must be preserved across deduplication updates');
  assert.equal(updatedRow.source_confidence, 1.0, 'Source confidence updated to authoritative 1.0');
  assert.equal(updatedRow.salary, '₹6,00,000 - ₹9,00,000', 'Missing salary field was enriched from direct source');
  assert.equal(updatedRow.work_mode, 'hybrid', 'Work mode updated from authoritative ATS');
});

test('Discovery Expansion: India and Bengaluru location normalization and relevance', () => {
  // Test Bengaluru sub-regions
  assert.equal(normalizeLocation('Whitefield, Bangalore'), 'Bengaluru, Karnataka, India');
  assert.equal(normalizeLocation('Electronic City Phase 1'), 'Bengaluru, Karnataka, India');
  assert.equal(normalizeLocation('Bellandur EcoSpace, Bengaluru'), 'Bengaluru, Karnataka, India');
  assert.equal(normalizeLocation('Koramangala 4th Block'), 'Bengaluru, Karnataka, India');
  assert.equal(normalizeLocation('Indiranagar, Bangalore (Hybrid)'), 'Bengaluru, Karnataka, India (Hybrid)');

  assert.ok(isBengaluruLocation('Whitefield, Bangalore'));
  assert.ok(isBengaluruLocation('Bellandur EcoSpace'));
  assert.ok(!isBengaluruLocation('Cyber City, Gurgaon'));

  // Test India Tech Hubs
  assert.equal(normalizeLocation('HITEC City, Hyderabad'), 'Hyderabad, Telangana, India');
  assert.equal(normalizeLocation('Hinjewadi Phase 2, Pune'), 'Pune, Maharashtra, India');
  assert.equal(normalizeLocation('DLF Cyber City, Gurgaon'), 'Delhi NCR, India');
  assert.equal(normalizeLocation('OMR, Chennai'), 'Chennai, Tamil Nadu, India');
  assert.equal(normalizeLocation('Work from Anywhere (Remote)'), 'Remote');

  assert.ok(isIndiaOrRemote('Bengaluru, Karnataka, India'));
  assert.ok(isIndiaOrRemote('Hyderabad, Telangana, India'));
  assert.ok(isIndiaOrRemote('Remote - Worldwide'));

  // Scoring engine gives top location score (20/20) for Bengaluru
  const blrJob = {
    title: 'Junior Java Developer',
    company: 'Test Corp',
    location: 'Whitefield, Bangalore',
    description: 'Java Spring Boot MySQL developer',
    experienceMin: 0,
    experienceMax: 1,
    skills: ['Java', 'Spring Boot']
  };
  const evalBlr = evaluateJobFit(blrJob);
  assert.equal(evalBlr.breakdown.locationScore, 20, 'Bengaluru sub-region receives full 20/20 location score');
});

test('Discovery Expansion: Data completeness scoring calculation', () => {
  // Complete record
  const richRecord = {
    title: 'Junior Java Full Stack Developer',
    company: 'TCS Digital',
    url: 'https://careers.tcs.com/jobs/12345',
    location: 'Bengaluru, Karnataka, India',
    description: 'We are hiring a passionate Junior Java Full Stack Developer with Spring Boot, React, and MySQL skills for our Bengaluru center.',
    postedAt: '2026-02-01T00:00:00.000Z',
    experienceMin: 0,
    experienceMax: 2,
    skills: ['Java', 'Spring Boot', 'React'],
    source: 'lever'
  };

  const valRich = validateJobRecord(richRecord);
  assert.ok(valRich.isValid);
  assert.ok(valRich.completenessScore >= 0.9, `Rich record completeness should be >= 0.9, got ${valRich.completenessScore}`);

  // Sparse record
  const sparseRecord = {
    title: 'Developer',
    company: 'Tech',
    url: 'https://example.com/job/1',
    description: 'Small desc',
    location: 'India'
  };

  const valSparse = validateJobRecord(sparseRecord);
  assert.ok(valSparse.isValid);
  assert.ok(valSparse.completenessScore < 0.8, `Sparse record completeness should be < 0.8, got ${valSparse.completenessScore}`);
});

test('Discovery Expansion: Scan history telemetry recording and retrieval', () => {
  const db = getDatabase();
  const initialCount = db.prepare('SELECT count(*) as count FROM scan_history').get().count;

  recordScanHistory({
    source: 'lever',
    targetName: 'Zeta Technologies',
    query: 'Java',
    jobsFound: 15,
    newJobsAdded: 3,
    jobsUpdated: 12,
    durationMs: 450,
    status: 'success'
  });

  const newCount = db.prepare('SELECT count(*) as count FROM scan_history').get().count;
  assert.equal(newCount, initialCount + 1, 'Should record a new scan history row in database');

  const history = getScanHistory(5);
  const latest = history[0];
  assert.equal(latest.source, 'lever');
  assert.equal(latest.target_name, 'Zeta Technologies');
  assert.equal(latest.jobs_found, 15);
  assert.equal(latest.new_jobs_added, 3);
  assert.equal(latest.status, 'success');
  assert.ok(latest.duration_ms >= 0);
});

test('Discovery Expansion: Multi-source filtering in getJobs', () => {
  // Insert test records with distinct sources and work modes
  const t = Date.now();
  saveOrUpdateJob({
    externalSlug: `filter-lever-${t}`,
    source: 'lever',
    title: 'Lever Remote Role',
    company: 'Company L',
    location: 'Remote',
    url: `https://jobs.lever.co/comp-l/role-${t}`,
    description: 'Remote developer',
    workMode: 'remote'
  });

  saveOrUpdateJob({
    externalSlug: `filter-ashby-${t}`,
    source: 'ashby',
    title: 'Ashby Bengaluru Role',
    company: 'Company A',
    location: 'Whitefield, Bengaluru',
    url: `https://jobs.ashbyhq.com/comp-a/role-${t}`,
    description: 'Onsite developer',
    workMode: 'onsite'
  });

  // Query filtering by source
  const leverOnly = getJobs({ source: 'lever', limit: 10 });
  assert.ok(leverOnly.every(j => j.source.toLowerCase() === 'lever'), 'All returned jobs must have source=lever');

  // Query filtering by work mode
  const remoteOnly = getJobs({ workMode: 'remote', limit: 10 });
  assert.ok(remoteOnly.every(j => j.work_mode.toLowerCase() === 'remote'), 'All returned jobs must have work_mode=remote');

  // Query filtering by Bengaluru location
  const blrOnly = getJobs({ location: 'bengaluru', limit: 10 });
  assert.ok(blrOnly.every(j => /bengaluru|bangalore|karnataka/i.test(j.location)), 'All returned jobs must be in Bengaluru');
});
