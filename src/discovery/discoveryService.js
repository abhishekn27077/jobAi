import { searchFreehireJobs } from './freehireClient.js';
import {
  fetchSmartRecruitersJobs,
  fetchGreenhouseJobs,
  fetchLeverJobs,
  fetchAshbyJobs,
  fetchWorkableJobs,
  fetchRecruiteeJobs
} from './directAtsClient.js';
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
} from './publicFeedsClient.js';
import { recordSourceScanTelemetry, getSourceHealthReport, SOURCES, SOURCE_TIERS } from './sourceRegistry.js';
import { saveOrUpdateJob, recordScanHistory } from '../tracker/jobTracker.js';
import { executeUnifiedSearch } from './unifiedSearchService.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PREFS_PATH = path.resolve(__dirname, '../../config/preferences.json');
const COMPANIES_PATH = path.resolve(__dirname, '../../config/companies.json');

/**
 * Normalizes multi-query input (string with commas/newlines or array) into deduplicated queries.
 */
export function normalizeDiscoveryQueries(customQuery, customQueries, defaultQueries = ['Junior Java Developer']) {
  const rawList = [];
  if (Array.isArray(customQueries) && customQueries.length > 0) {
    rawList.push(...customQueries);
  } else if (typeof customQuery === 'string' && customQuery.trim()) {
    rawList.push(...customQuery.split(/[,;\n]+/));
  } else {
    rawList.push(...defaultQueries);
  }

  const seen = new Set();
  const normalized = [];
  for (const item of rawList) {
    const clean = String(item || '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(clean);
    }
  }
  return normalized.length > 0 ? normalized : ['Junior Java Developer'];
}

function ingestBatchJobs(jobs, statsBucket) {
  let scanned = 0;
  let newCount = 0;
  let updatedCount = 0;
  let recommendedCount = 0;
  let errorCount = 0;

  for (const job of jobs) {
    scanned++;
    statsBucket.scanned++;
    try {
      const saveRes = saveOrUpdateJob(job);
      if (!saveRes || !saveRes.jobId || saveRes.isValid === false) {
        errorCount++;
        statsBucket.errors++;
        continue;
      }
      if (saveRes.isNew) {
        newCount++;
        statsBucket.new++;
      } else {
        updatedCount++;
        statsBucket.updated++;
      }
      if (saveRes.evaluation?.recommendation === 'RECOMMENDED') {
        recommendedCount++;
      }
    } catch {
      errorCount++;
      statsBucket.errors++;
    }
  }

  return { scanned, newCount, updatedCount, recommendedCount, errorCount };
}

export async function runJobDiscovery({
  customQuery = null,
  queries: explicitQueries = null,
  maxPerQuery = 20,
  countries = ['in'],
  includeDirectAts = true,
  includePublicFeeds = true
} = {}) {
  const preferences = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8'));
  const queries = normalizeDiscoveryQueries(
    customQuery,
    explicitQueries,
    preferences.search.queries || ['Junior Java Developer']
  );

  console.log(`[Discovery] Initiating multi-query discovery across ${queries.length} query(ies)...`);

  let totalFound = 0;
  let newAdded = 0;
  let updatedCount = 0;
  let recommendedCount = 0;

  const sourceStats = {
    freehire: { scanned: 0, new: 0, updated: 0, errors: 0 },
    smartrecruiters: { scanned: 0, new: 0, updated: 0, errors: 0 },
    greenhouse: { scanned: 0, new: 0, updated: 0, errors: 0 },
    lever: { scanned: 0, new: 0, updated: 0, errors: 0 },
    ashby: { scanned: 0, new: 0, updated: 0, errors: 0 },
    workable: { scanned: 0, new: 0, updated: 0, errors: 0 },
    recruitee: { scanned: 0, new: 0, updated: 0, errors: 0 },
    remotive: { scanned: 0, new: 0, updated: 0, errors: 0 },
    arbeitnow: { scanned: 0, new: 0, updated: 0, errors: 0 },
    himalayas: { scanned: 0, new: 0, updated: 0, errors: 0 },
    jobicy: { scanned: 0, new: 0, updated: 0, errors: 0 },
    remoteok: { scanned: 0, new: 0, updated: 0, errors: 0 },
    weworkremotely: { scanned: 0, new: 0, updated: 0, errors: 0 },
    hn_hiring: { scanned: 0, new: 0, updated: 0, errors: 0 },
    hasjob: { scanned: 0, new: 0, updated: 0, errors: 0 },
    unstop: { scanned: 0, new: 0, updated: 0, errors: 0 }
  };

  // 1. FreeHire Live Ingestion (multi-query)
  for (const q of queries) {
    const startTime = Date.now();
    try {
      const result = await searchFreehireJobs({ query: q, countries, limit: maxPerQuery });
      const batch = ingestBatchJobs(result.jobs || [], sourceStats.freehire);
      totalFound += batch.scanned;
      newAdded += batch.newCount;
      updatedCount += batch.updatedCount;
      recommendedCount += batch.recommendedCount;

      const durationMs = Date.now() - startTime;
      recordScanHistory({
        source: 'freehire',
        targetName: 'FreeHire Aggregator',
        query: q,
        jobsFound: result.jobs.length,
        newJobsAdded: batch.newCount,
        jobsUpdated: batch.updatedCount,
        durationMs,
        status: 'success'
      });
      recordSourceScanTelemetry('freehire', {
        success: true,
        jobsFound: result.jobs.length,
        newJobsAdded: batch.newCount,
        durationMs
      });
    } catch (err) {
      sourceStats.freehire.errors++;
      const durationMs = Date.now() - startTime;
      console.warn(`[Discovery] FreeHire skipped for "${q}": ${err.message}`);
      recordScanHistory({
        source: 'freehire',
        targetName: 'FreeHire Aggregator',
        query: q,
        jobsFound: 0,
        newJobsAdded: 0,
        jobsUpdated: 0,
        durationMs,
        status: 'error',
        errorMessage: err.message
      });
      recordSourceScanTelemetry('freehire', {
        success: false,
        durationMs,
        error: err.message
      });
    }
  }

  // 2. Direct Corporate ATS Feeds (parallelized with Promise.allSettled for fault isolation)
  if (includeDirectAts && fs.existsSync(COMPANIES_PATH)) {
    try {
      const companies = JSON.parse(fs.readFileSync(COMPANIES_PATH, 'utf-8')).filter(c => c.enabled);
      const primaryQuery = queries[0] || null;
      const BATCH_SIZE = 5;

      for (let i = 0; i < companies.length; i += BATCH_SIZE) {
        const chunk = companies.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(chunk.map(async (c) => {
          const portal = (c.portal || '').toLowerCase();
          const startTime = Date.now();
          if (!sourceStats[portal]) {
            sourceStats[portal] = { scanned: 0, new: 0, updated: 0, errors: 0 };
          }

          try {
            let directJobs = [];
            if (portal === 'smartrecruiters' && c.companyToken) {
              directJobs = await fetchSmartRecruitersJobs(c.companyToken, primaryQuery || 'Java');
            } else if (portal === 'greenhouse' && c.companyToken) {
              directJobs = await fetchGreenhouseJobs(c.companyToken);
            } else if (portal === 'lever' && c.companyToken) {
              directJobs = await fetchLeverJobs(c.companyToken, { query: primaryQuery });
            } else if (portal === 'ashby' && c.companyToken) {
              directJobs = await fetchAshbyJobs(c.companyToken, { query: primaryQuery });
            } else if (portal === 'workable' && c.companyToken) {
              directJobs = await fetchWorkableJobs(c.companyToken, { query: primaryQuery });
            } else if (portal === 'recruitee' && c.companyToken) {
              directJobs = await fetchRecruiteeJobs(c.companyToken, { query: primaryQuery });
            }

            const batch = ingestBatchJobs(directJobs, sourceStats[portal]);
            totalFound += batch.scanned;
            newAdded += batch.newCount;
            updatedCount += batch.updatedCount;
            recommendedCount += batch.recommendedCount;

            const durationMs = Date.now() - startTime;
            recordScanHistory({
              source: portal,
              targetName: c.name || c.companyToken,
              query: primaryQuery,
              jobsFound: directJobs.length,
              newJobsAdded: batch.newCount,
              jobsUpdated: batch.updatedCount,
              durationMs,
              status: 'success'
            });
            recordSourceScanTelemetry(portal, {
              success: true,
              jobsFound: directJobs.length,
              newJobsAdded: batch.newCount,
              durationMs
            });
          } catch (atsErr) {
            sourceStats[portal].errors++;
            const durationMs = Date.now() - startTime;
            console.warn(`[Discovery] Direct ATS notice for ${c.name} (${portal}): ${atsErr.message}`);
            recordScanHistory({
              source: portal,
              targetName: c.name || c.companyToken,
              query: primaryQuery,
              jobsFound: 0,
              newJobsAdded: 0,
              jobsUpdated: 0,
              durationMs,
              status: 'error',
              errorMessage: atsErr.message
            });
            recordSourceScanTelemetry(portal, {
              success: false,
              durationMs,
              error: atsErr.message
            });
          }
        }));
      }
    } catch (e) {
      console.warn('[Discovery] Direct ATS error:', e.message);
    }
  }

  // 3. Public Remote & International Feeds (parallel, error-isolated)
  if (includePublicFeeds) {
    const queryHint = queries.join(' ');
    const feedRunners = [
      { id: 'remotive', name: 'Remotive', fn: () => fetchRemotiveJobs({ limit: 25, query: queries[0] || '' }) },
      { id: 'arbeitnow', name: 'Arbeitnow', fn: () => fetchArbeitnowJobs({ limit: 25, query: queryHint }) },
      { id: 'himalayas', name: 'Himalayas', fn: () => fetchHimalayasJobs({ limit: 25, query: queryHint }) },
      { id: 'jobicy', name: 'Jobicy', fn: () => fetchJobicyJobs({ count: 25, query: queries[0] || '' }) },
      { id: 'remoteok', name: 'RemoteOK', fn: () => fetchRemoteOkJobs({ limit: 25, query: queryHint }) },
      { id: 'weworkremotely', name: 'We Work Remotely', fn: () => fetchWeWorkRemotelyJobs({ limit: 25, query: queryHint }) },
      { id: 'hn_hiring', name: 'HN Who is Hiring', fn: () => fetchHnWhoIsHiringJobs({ limit: 25, query: queryHint }) },
      { id: 'hasjob', name: 'Hasjob', fn: () => fetchHasjobJobs({ limit: 25, query: queryHint }) },
      { id: 'unstop', name: 'Unstop', fn: () => fetchUnstopJobs({ limit: 25, query: queries[0] || '' }) }
    ];

    await Promise.allSettled(feedRunners.map(async (feed) => {
      const startTime = Date.now();
      try {
        const jobs = await feed.fn();
        const batch = ingestBatchJobs(jobs, sourceStats[feed.id]);
        totalFound += batch.scanned;
        newAdded += batch.newCount;
        updatedCount += batch.updatedCount;
        recommendedCount += batch.recommendedCount;

        const durationMs = Date.now() - startTime;
        recordScanHistory({
          source: feed.id,
          targetName: feed.name,
          query: queries[0] || null,
          jobsFound: jobs.length,
          newJobsAdded: batch.newCount,
          jobsUpdated: batch.updatedCount,
          durationMs,
          status: 'success'
        });
        recordSourceScanTelemetry(feed.id, {
          success: true,
          jobsFound: jobs.length,
          newJobsAdded: batch.newCount,
          durationMs
        });
      } catch (err) {
        sourceStats[feed.id].errors++;
        const durationMs = Date.now() - startTime;
        recordSourceScanTelemetry(feed.id, {
          success: false,
          durationMs,
          error: err.message
        });
      }
    }));
  }

  const summary = {
    queriesExecuted: queries.length,
    queries,
    totalScannedThisRun: totalFound,
    newJobsInserted: newAdded,
    jobsUpdated: updatedCount,
    recommendedJobsFound: recommendedCount,
    sources: sourceStats
  };

  console.log(`[Discovery] Scan complete: ${newAdded} new jobs saved, ${recommendedCount} high-fit recommended roles.`);
  return summary;
}

/**
 * Phase 18 — Unified Discovery Command: CAREEROS JOB SWEEP
 * Orchestrates multi-query discovery across all live sources, computes
 * honest run telemetry, and returns the structured Phase 17 Run Summary.
 */
export async function runCareerOsJobSweep(options = {}) {
  const startedAt = new Date().toISOString();
  const discoveryRes = await runJobDiscovery(options);

  const health = getSourceHealthReport();
  const liveAttempted = Object.entries(discoveryRes.sources || {});
  const sourceErrors = [];
  let sourcesSuccessful = 0;
  let sourcesFailed = 0;

  for (const [srcId, st] of liveAttempted) {
    if (st.scanned > 0 || st.errors === 0) {
      sourcesSuccessful++;
    } else {
      sourcesFailed++;
      const tel = health.find(h => h.id === srcId);
      sourceErrors.push({
        source: srcId,
        error: tel?.lastError || `${st.errors} error(s) during scan`
      });
    }
  }

  // Evaluate current vault breakdown transparently
  const searchSnap = executeUnifiedSearch({ excludeExpired: false, limit: 5000 });
  const allJobs = searchSnap.results || [];
  const jobsAlreadyApplied = allJobs.filter(j => j.alreadySubmitted).length;
  const jobsRejected = allJobs.filter(j => j.priorityCode === 'DISQUALIFIED' || j.recommendation === 'REJECTED').length;
  const freshJobs = searchSnap.summary?.freshResults || 0;
  const strongMatches = searchSnap.summary?.priorityCounts?.p1 + searchSnap.summary?.priorityCounts?.p2 || searchSnap.summary?.strongMatches || 0;
  const reviewJobs = searchSnap.summary?.priorityCounts?.p3 || 0;

  const browserAssistedSources = SOURCES
    .filter(s => s.tier === SOURCE_TIERS.RESTRICTED_EXTERNAL)
    .map(s => s.id);

  return {
    command: 'CAREEROS JOB SWEEP',
    startedAt,
    completedAt: new Date().toISOString(),
    queriesExecuted: discoveryRes.queriesExecuted,
    queries: discoveryRes.queries,
    totalSourcesAttempted: liveAttempted.length,
    sourcesSuccessful,
    sourcesFailed,
    jobsDiscovered: discoveryRes.totalScannedThisRun,
    jobsImported: discoveryRes.newJobsInserted,
    jobsUpdated: discoveryRes.jobsUpdated,
    duplicateJobs: Math.max(0, discoveryRes.totalScannedThisRun - discoveryRes.newJobsInserted - discoveryRes.jobsUpdated),
    jobsRejected,
    jobsAlreadyApplied,
    freshJobs,
    strongMatches,
    reviewJobs,
    sourceErrors,
    browserAssistedSources,
    sourcesRequiringManualAction: browserAssistedSources,
    sources: discoveryRes.sources
  };
}
