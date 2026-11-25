import { searchFreehireJobs } from './freehireClient.js';
import { fetchSmartRecruitersJobs, fetchGreenhouseJobs, fetchLeverJobs, fetchAshbyJobs, fetchWorkableJobs, fetchRecruiteeJobs } from './directAtsClient.js';
import { recordSourceScanTelemetry } from './sourceRegistry.js';
import { saveOrUpdateJob, recordScanHistory } from '../tracker/jobTracker.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PREFS_PATH = path.resolve(__dirname, '../../config/preferences.json');
const COMPANIES_PATH = path.resolve(__dirname, '../../config/companies.json');

export async function runJobDiscovery({ customQuery = null, maxPerQuery = 20, countries = ['in'], includeDirectAts = true } = {}) {
  const preferences = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8'));
  const queries = customQuery ? [customQuery] : (preferences.search.queries || ['Junior Java Developer']);

  console.log(`[Discovery] Initiating job discovery across ${queries.length} targeted search queries in India...`);

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
    recruitee: { scanned: 0, new: 0, updated: 0, errors: 0 }
  };

  // 1. FreeHire Live Ingestion
  for (const q of queries) {
    const startTime = Date.now();
    console.log(`[Discovery] Querying FreeHire: "${q}" (Country: ${countries.join(', ')})...`);
    try {
      const result = await searchFreehireJobs({
        query: q,
        countries,
        limit: maxPerQuery
      });

      console.log(`  -> Fetched ${result.jobs.length} listings (total matches on board: ${result.total})`);

      let qNew = 0;
      let qUpdated = 0;

      for (const job of result.jobs) {
        totalFound++;
        sourceStats.freehire.scanned++;
        const saveRes = saveOrUpdateJob(job);
        if (!saveRes.jobId || saveRes.isValid === false) {
          sourceStats.freehire.errors = (sourceStats.freehire.errors || 0) + 1;
          continue;
        }
        if (saveRes.isNew) {
          newAdded++;
          qNew++;
          sourceStats.freehire.new++;
        } else {
          updatedCount++;
          qUpdated++;
          sourceStats.freehire.updated++;
        }
        if (saveRes.evaluation.recommendation === 'RECOMMENDED') {
          recommendedCount++;
        }
      }

      recordScanHistory({
        source: 'freehire',
        targetName: 'FreeHire Aggregator',
        query: q,
        jobsFound: result.jobs.length,
        newJobsAdded: qNew,
        jobsUpdated: qUpdated,
        durationMs: Date.now() - startTime,
        status: 'success'
      });
      recordSourceScanTelemetry('freehire', {
        success: true,
        jobsFound: result.jobs.length,
        newJobsAdded: qNew
      });
    } catch (err) {
      sourceStats.freehire.errors++;
      console.error(`  -> Failed search for "${q}":`, err.message);
      recordScanHistory({
        source: 'freehire',
        targetName: 'FreeHire Aggregator',
        query: q,
        jobsFound: 0,
        newJobsAdded: 0,
        jobsUpdated: 0,
        durationMs: Date.now() - startTime,
        status: 'error',
        errorMessage: err.message
      });
      recordSourceScanTelemetry('freehire', {
        success: false,
        error: err.message
      });
    }
  }

  // 2. Direct Corporate ATS Feeds (SmartRecruiters, Greenhouse, Lever, Ashby)
  if (includeDirectAts && fs.existsSync(COMPANIES_PATH)) {
    try {
      const companies = JSON.parse(fs.readFileSync(COMPANIES_PATH, 'utf-8'));
      console.log(`[Discovery] Checking ${companies.length} direct corporate ATS feeds (Lever, Ashby, Greenhouse, SmartRecruiters)...`);

      for (const c of companies) {
        if (!c.enabled) continue;
        const portal = (c.portal || '').toLowerCase();
        const startTime = Date.now();

        try {
          let directJobs = [];
          if (portal === 'smartrecruiters' && c.companyToken) {
            directJobs = await fetchSmartRecruitersJobs(c.companyToken, customQuery || 'Java');
          } else if (portal === 'greenhouse' && c.companyToken) {
            directJobs = await fetchGreenhouseJobs(c.companyToken);
          } else if (portal === 'lever' && c.companyToken) {
            directJobs = await fetchLeverJobs(c.companyToken, { query: customQuery });
          } else if (portal === 'ashby' && c.companyToken) {
            directJobs = await fetchAshbyJobs(c.companyToken, { query: customQuery });
          } else if (portal === 'workable' && c.companyToken) {
            directJobs = await fetchWorkableJobs(c.companyToken, { query: customQuery });
          } else if (portal === 'recruitee' && c.companyToken) {
            directJobs = await fetchRecruiteeJobs(c.companyToken, { query: customQuery });
          }

          if (!sourceStats[portal]) {
            sourceStats[portal] = { scanned: 0, new: 0, updated: 0, errors: 0 };
          }

          let cNew = 0;
          let cUpdated = 0;

          for (const job of directJobs) {
            totalFound++;
            sourceStats[portal].scanned++;
            const saveRes = saveOrUpdateJob(job);
            if (!saveRes.jobId || saveRes.isValid === false) {
              sourceStats[portal].errors++;
              continue;
            }
            if (saveRes.isNew) {
              newAdded++;
              cNew++;
              sourceStats[portal].new++;
            } else {
              updatedCount++;
              cUpdated++;
              sourceStats[portal].updated++;
            }
            if (saveRes.evaluation.recommendation === 'RECOMMENDED') {
              recommendedCount++;
            }
          }

          recordScanHistory({
            source: portal,
            targetName: c.name || c.companyToken,
            query: customQuery || null,
            jobsFound: directJobs.length,
            newJobsAdded: cNew,
            jobsUpdated: cUpdated,
            durationMs: Date.now() - startTime,
            status: 'success'
          });

          recordSourceScanTelemetry(portal, {
            success: true,
            jobsFound: directJobs.length,
            newJobsAdded: cNew
          });

          console.log(`  -> [${portal.toUpperCase()}] ${c.name}: ${directJobs.length} jobs retrieved (${cNew} new)`);
        } catch (atsErr) {
          if (sourceStats[portal]) sourceStats[portal].errors++;
          console.warn(`  -> Notice on direct feed for ${c.name} (${portal}): ${atsErr.message}`);
          recordScanHistory({
            source: portal,
            targetName: c.name || c.companyToken,
            query: customQuery || null,
            jobsFound: 0,
            newJobsAdded: 0,
            jobsUpdated: 0,
            durationMs: Date.now() - startTime,
            status: 'error',
            errorMessage: atsErr.message
          });

          recordSourceScanTelemetry(portal, {
            success: false,
            error: atsErr.message
          });
        }
      }
    } catch (e) {
      console.warn('[Discovery] Direct ATS error:', e.message);
    }
  }

  const summary = {
    queriesExecuted: queries.length,
    totalScannedThisRun: totalFound,
    newJobsInserted: newAdded,
    jobsUpdated: updatedCount,
    recommendedJobsFound: recommendedCount,
    sources: sourceStats
  };

  console.log(`[Discovery] Scan complete: ${newAdded} new jobs saved, ${recommendedCount} high-fit recommended roles.`);
  return summary;
}
