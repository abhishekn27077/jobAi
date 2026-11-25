import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { getDatabase } from '../src/db/schema.js';
import {
  SOURCES,
  SOURCE_TIERS,
  SOURCE_STATUS,
  resolveSource,
  getAllSources,
  generateAssistedSearchLinks
} from '../src/discovery/sourceRegistry.js';
import {
  executeUnifiedSearch,
  classifyFreshness,
  FRESHNESS_STATUSES
} from '../src/discovery/unifiedSearchService.js';
import { saveOrUpdateJob } from '../src/tracker/jobTracker.js';

describe('Phase 10 — Unified Job Search Engine & 14-Source Architecture', () => {
  let db;

  before(() => {
    db = getDatabase();
  });

  // ==========================================
  // PART 3 & 4: SOURCE REGISTRY & LEGAL TIERS
  // ==========================================
  test('Part 3 & 4: Exactly 14 designated sources are registered with honest capability tiers', () => {
    const allSources = getAllSources();
    assert.strictEqual(allSources.length, 14, 'Must register exactly 14 designated sources');

    const expectedSourceIds = [
      'all',
      'career_pages',
      'greenhouse',
      'lever',
      'ashby',
      'smartrecruiters',
      'freehire',
      'workable',
      'naukri',
      'indeed',
      'linkedin',
      'apna',
      'workindia',
      'other'
    ];

    for (const expectedId of expectedSourceIds) {
      const src = allSources.find(s => s.id === expectedId);
      assert.ok(src, `Source ${expectedId} must exist in registry`);
      assert.ok(src.name, `Source ${expectedId} must have human-readable name`);
      assert.ok(src.badgeColor, `Source ${expectedId} must have badgeColor`);
      assert.ok(src.icon, `Source ${expectedId} must have icon`);
      assert.ok(src.description, `Source ${expectedId} must have description`);
    }

    // Verify Active Live Feed sources
    const liveFeeds = allSources.filter(s => s.tier === SOURCE_TIERS.LIVE_FEED || s.tier === SOURCE_TIERS.LIVE_AGGREGATOR);
    assert.ok(liveFeeds.length >= 5, 'Should have at least 5 live feeds/aggregators (Greenhouse, Lever, Ashby, SmartRecruiters, FreeHire, Workable)');

    // Verify Restricted Anti-Bot sources strictly documented without scraping claims
    const restrictedSources = allSources.filter(s => s.tier === SOURCE_TIERS.RESTRICTED_EXTERNAL);
    assert.strictEqual(restrictedSources.length, 5, 'Exactly 5 sources must be marked RESTRICTED_EXTERNAL (Naukri, Indeed, LinkedIn, Apna, WorkIndia)');

    for (const rs of restrictedSources) {
      assert.strictEqual(rs.status, SOURCE_STATUS.RESTRICTED, `${rs.id} must have RESTRICTED status`);
      assert.strictEqual(rs.supportsDirectIngestion, false, `${rs.id} must not claim direct ingestion`);
      assert.ok(rs.antiBotProtected, `${rs.id} must be flagged as antiBotProtected`);
      assert.strictEqual(typeof rs.generateSearchUrl, 'function', `${rs.id} must provide lawful search URL generator`);
    }
  });

  test('Part 3: resolveSource correctly maps database aliases and portal strings', () => {
    assert.strictEqual(resolveSource('direct').id, 'career_pages');
    assert.strictEqual(resolveSource('career_pages').id, 'career_pages');
    assert.strictEqual(resolveSource('lever').id, 'lever');
    assert.strictEqual(resolveSource('ashby').id, 'ashby');
    assert.strictEqual(resolveSource('ashbyhq').id, 'ashby');
    assert.strictEqual(resolveSource('greenhouse').id, 'greenhouse');
    assert.strictEqual(resolveSource('smartrecruiters').id, 'smartrecruiters');
    assert.strictEqual(resolveSource('freehire').id, 'freehire');
    assert.strictEqual(resolveSource('instahyre').id, 'freehire');
    assert.strictEqual(resolveSource('workable').id, 'workable');
    assert.strictEqual(resolveSource('naukri').id, 'naukri');
    assert.strictEqual(resolveSource('indeed').id, 'indeed');
    assert.strictEqual(resolveSource('linkedin').id, 'linkedin');
    assert.strictEqual(resolveSource('apna').id, 'apna');
    assert.strictEqual(resolveSource('workindia').id, 'workindia');
    assert.strictEqual(resolveSource('unrecognized_random').id, 'other');
    assert.strictEqual(resolveSource(null).id, 'other');
  });

  test('Part 4: Lawful search URL generators build valid, ToS-compliant external links', () => {
    const assisted = generateAssistedSearchLinks('Java Developer', 'Bengaluru', { fresherOnly: true });
    assert.strictEqual(assisted.length, 5, 'Must generate assisted links for all 5 restricted portals');

    const naukriLink = assisted.find(l => l.sourceId === 'naukri');
    assert.ok(naukriLink.url.includes('naukri.com'), 'Naukri link must target naukri.com');
    assert.ok(naukriLink.url.includes('Bengaluru') || naukriLink.url.includes('bengaluru'), 'Naukri link must include Bengaluru');
    assert.ok(naukriLink.url.includes('experience=0'), 'Naukri link must include experience=0 for freshers');

    const linkedinLink = assisted.find(l => l.sourceId === 'linkedin');
    assert.ok(linkedinLink.url.includes('linkedin.com/jobs/search'), 'LinkedIn link must target search endpoint');
    assert.ok(linkedinLink.url.includes('Java%20Developer') || linkedinLink.url.includes('Java+Developer'), 'LinkedIn link must encode query');
    assert.ok(linkedinLink.url.includes('f_E=1%2C2'), 'LinkedIn link must filter by entry-level / intern');

    const indeedLink = assisted.find(l => l.sourceId === 'indeed');
    assert.ok(indeedLink.url.includes('in.indeed.com/jobs'), 'Indeed link must target India domain');
    assert.ok(indeedLink.url.includes('explvl=entry_level'), 'Indeed link must target entry level');
  });

  // ==========================================
  // PART 9: 8-TIER FRESHNESS CLASSIFICATION
  // ==========================================
  test('Part 9: classifyFreshness handles all 8 freshness lifecycle states accurately', () => {
    // 1. Verified Active
    const activeJob = { verification_status: 'verified_active', status: 'discovered' };
    assert.strictEqual(classifyFreshness(activeJob), FRESHNESS_STATUSES.VERIFIED_ACTIVE);

    // 2. Explicit Expired
    const expiredJob = { verification_status: 'expired', status: 'expired' };
    assert.strictEqual(classifyFreshness(expiredJob), FRESHNESS_STATUSES.EXPIRED);

    // 3. Recommendation EXPIRED cannot be overridden
    const recExpiredJob = { verification_status: 'unverified', recommendation: 'EXPIRED' };
    assert.strictEqual(classifyFreshness(recExpiredJob), FRESHNESS_STATUSES.EXPIRED);

    // 4. Closed Vacancy Banner
    const closedJob = { verification_status: 'closed', verification_reason: 'Closed vacancy detected' };
    assert.strictEqual(classifyFreshness(closedJob), FRESHNESS_STATUSES.CLOSED);

    // 5. Inaccessible / Verification Failed (Never marked expired!)
    const failedJob = { verification_status: 'inaccessible', verification_reason: 'Connection timeout' };
    assert.strictEqual(classifyFreshness(failedJob), FRESHNESS_STATUSES.VERIFICATION_FAILED);

    // 6. Recently Posted (≤ 3 days)
    const recentDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentJob = { posted_at: recentDate, verification_status: 'unverified' };
    assert.strictEqual(classifyFreshness(recentJob), FRESHNESS_STATUSES.RECENTLY_POSTED);

    // 7. Needs Reverification (15–45 days)
    const staleDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const staleJob = { posted_at: staleDate, verification_status: 'unverified' };
    assert.strictEqual(classifyFreshness(staleJob), FRESHNESS_STATUSES.NEEDS_REVERIFICATION);

    // 8. Possibly Expired (> 45 days)
    const veryOldDate = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString();
    const veryOldJob = { posted_at: veryOldDate, verification_status: 'unverified' };
    assert.strictEqual(classifyFreshness(veryOldJob), FRESHNESS_STATUSES.POSSIBLY_EXPIRED);
  });

  // ==========================================
  // PART 2, 5, 8: UNIFIED SEARCH & METRICS
  // ==========================================
  test('Part 2 & 5: executeUnifiedSearch executes multi-criteria search with location and skills', () => {
    const searchRes = executeUnifiedSearch({
      q: 'Java',
      location: 'Bengaluru',
      fresherOnly: true,
      minScore: 0,
      limit: 50
    });

    assert.ok(Array.isArray(searchRes.results), 'Results must be an array');
    assert.ok(searchRes.summary, 'Summary metrics must be present');
    assert.ok(typeof searchRes.summary.totalSourceResults === 'number', 'totalSourceResults must be number');
    assert.ok(typeof searchRes.summary.uniqueResults === 'number', 'uniqueResults must be number');
    assert.ok(typeof searchRes.summary.duplicateResultsRemoved === 'number', 'duplicateResultsRemoved must be number');
    assert.ok(typeof searchRes.summary.freshResults === 'number', 'freshResults must be number');
    assert.ok(typeof searchRes.summary.strongMatches === 'number', 'strongMatches must be number');
    assert.ok(typeof searchRes.summary.eligibleRoles === 'number', 'eligibleRoles must be number');
    assert.ok(typeof searchRes.summary.reviewRequired === 'number', 'reviewRequired must be number');
    assert.ok(typeof searchRes.summary.expiredExcluded === 'number', 'expiredExcluded must be number');
    assert.ok(searchRes.summary.sourceCounts, 'sourceCounts map must exist');

    // Verify all 14 sources are tracked in sourceCounts
    const allSourceIds = SOURCES.map(s => s.id);
    for (const sId of allSourceIds) {
      assert.ok(sId in searchRes.summary.sourceCounts, `Source count for ${sId} must be tracked`);
    }

    // Results verification
    if (searchRes.results.length > 0) {
      const firstJob = searchRes.results[0];
      assert.ok(firstJob.id, 'Job must have ID');
      assert.ok(firstJob.title, 'Job must have title');
      assert.ok(firstJob.company, 'Job must have company');
      assert.ok(firstJob.source, 'Job must have source');
      assert.ok(firstJob.score !== undefined, 'Job must have score');
      assert.ok(firstJob.freshnessStatus, 'Job must have classified freshnessStatus');
    }
  });

  test('Part 5: Excluded keywords strictly removes matching jobs from search results', () => {
    // 1. Search without exclusion
    const baseSearch = executeUnifiedSearch({
      q: 'Engineer',
      location: 'all',
      excludeExpired: false,
      limit: 200
    });

    // 2. Search with excluded keyword 'Staff' and 'Senior'
    const filteredSearch = executeUnifiedSearch({
      q: 'Engineer',
      location: 'all',
      excludedKeywords: ['Senior', 'Staff'],
      excludeExpired: false,
      limit: 200
    });

    assert.ok(
      filteredSearch.results.length <= baseSearch.results.length,
      'Excluded search must return fewer or equal results'
    );

    // Verify that NO job in the filtered search contains 'Senior' or 'Staff' in title or description
    for (const job of filteredSearch.results) {
      const text = `${job.title} ${job.description} ${job.summary_reason}`.toLowerCase();
      assert.strictEqual(/\bsenior\b/i.test(text), false, `Job #${job.id} should not contain "senior"`);
      assert.strictEqual(/\bstaff\b/i.test(text), false, `Job #${job.id} should not contain "staff"`);
    }
  });

  test('Part 5: Multi-location array filtering matches jobs across selected hubs', () => {
    const multiLocSearch = executeUnifiedSearch({
      location: ['Bengaluru', 'Remote'],
      limit: 100
    });

    assert.ok(Array.isArray(multiLocSearch.results));
    for (const job of multiLocSearch.results) {
      const loc = (job.location || '').toLowerCase();
      const wp = (job.work_mode || '').toLowerCase();
      const isBlr = loc.includes('bengaluru') || loc.includes('bangalore') || loc.includes('karnataka');
      const isRem = loc.includes('remote') || wp === 'remote';
      assert.ok(isBlr || isRem, `Job #${job.id} location "${job.location}" must match Bengaluru or Remote`);
    }
  });

  // ==========================================
  // PART 10: DEDUPLICATION & PROVENANCE
  // ==========================================
  test('Part 10: Cross-source deduplication preserves primary job and attributes alternate sources', () => {
    // Insert two test jobs with identical title, company, and city across two different sources
    const ts = Date.now();
    const jobA = {
      externalSlug: `test-dedup-a-${ts}`,
      source: 'freehire',
      sourceConfidence: 0.85,
      title: `Test Deduplication Role ${ts}`,
      company: `Apex Innovations ${ts}`,
      location: 'Bengaluru, Karnataka, India',
      url: `https://freehire.example.com/job/${ts}`,
      description: 'Java Spring Boot role for freshers',
      workMode: 'onsite',
      employmentType: 'full_time'
    };

    const jobB = {
      externalSlug: `test-dedup-b-${ts}`,
      source: 'lever',
      sourceConfidence: 1.0,
      title: `Test Deduplication Role ${ts}`,
      company: `Apex Innovations ${ts}`,
      location: 'Bengaluru, Karnataka, India',
      url: `https://jobs.lever.co/apexinnovations/${ts}`,
      description: 'Java Spring Boot role for freshers directly from Lever',
      workMode: 'onsite',
      employmentType: 'full_time'
    };

    const resA = saveOrUpdateJob(jobA);
    const resB = saveOrUpdateJob(jobB);

    assert.ok(resA.jobId, 'Job A must be saved');
    assert.ok(resB.jobId, 'Job B must be saved');

    // Run unified search matching this exact company
    const searchRes = executeUnifiedSearch({
      company: `Apex Innovations ${ts}`,
      excludeDuplicates: true
    });

    // Should return exactly 1 deduplicated primary role
    assert.strictEqual(searchRes.results.length, 1, 'Duplicate listings across FreeHire and Lever must be deduplicated to 1 primary role');
    const primary = searchRes.results[0];

    // Lever has higher source confidence (1.0 vs 0.85), so Lever should be elected primary
    assert.strictEqual(primary.source, 'lever', 'Lever listing must be elected primary due to higher source confidence');
    assert.ok(primary.alternateSources && primary.alternateSources.length > 0, 'Must attach alternateSources array');
    assert.strictEqual(primary.alternateSources[0].source, 'freehire', 'FreeHire listing must be preserved as alternate source');

    // Deduplication metrics must record 1 removed
    assert.strictEqual(searchRes.summary.totalSourceResults, 2, 'Raw total source results must be 2');
    assert.strictEqual(searchRes.summary.uniqueResults, 1, 'Unique results must be 1');
    assert.strictEqual(searchRes.summary.duplicateResultsRemoved, 1, 'duplicateResultsRemoved must equal 1');

    // Cleanup test records
    db.prepare('DELETE FROM jobs WHERE company = ?').run(`Apex Innovations ${ts}`);
  });

  test('Part 10: Genuinely distinct ATS requisitions are NOT merged', () => {
    const ts = Date.now();
    const req1 = {
      externalSlug: `req-001-${ts}`,
      source: 'lever',
      title: `Software Engineer Intern ${ts}`,
      company: `Global Corp ${ts}`,
      location: 'Bengaluru, Karnataka',
      url: `https://jobs.lever.co/globalcorp/req-001-${ts}`,
      description: 'Backend Intern requisition 1'
    };

    const req2 = {
      externalSlug: `req-002-${ts}`,
      source: 'lever',
      title: `Software Engineer Intern ${ts}`,
      company: `Global Corp ${ts}`,
      location: 'Bengaluru, Karnataka',
      url: `https://jobs.lever.co/globalcorp/req-002-${ts}`,
      description: 'Frontend Intern requisition 2'
    };

    saveOrUpdateJob(req1);
    saveOrUpdateJob(req2);

    const searchRes = executeUnifiedSearch({
      company: `Global Corp ${ts}`,
      excludeDuplicates: true
    });

    assert.strictEqual(searchRes.results.length, 2, 'Distinct ATS requisitions must NOT be merged');

    // Cleanup
    db.prepare('DELETE FROM jobs WHERE company = ?').run(`Global Corp ${ts}`);
  });
});
