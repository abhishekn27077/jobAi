import { searchFreehireJobs } from './freehireClient.js';
import { fetchSmartRecruitersJobs, fetchGreenhouseJobs } from './directAtsClient.js';
import { saveOrUpdateJob } from '../tracker/jobTracker.js';
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

  // 1. FreeHire Live Ingestion
  for (const q of queries) {
    console.log(`[Discovery] Querying FreeHire: "${q}" (Country: ${countries.join(', ')})...`);
    try {
      const result = await searchFreehireJobs({
        query: q,
        countries,
        limit: maxPerQuery
      });

      console.log(`  -> Fetched ${result.jobs.length} listings (total matches on board: ${result.total})`);

      for (const job of result.jobs) {
        totalFound++;
        const saveRes = saveOrUpdateJob(job);
        if (saveRes.isNew) {
          newAdded++;
        } else {
          updatedCount++;
        }
        if (saveRes.evaluation.recommendation === 'RECOMMENDED') {
          recommendedCount++;
        }
      }
    } catch (err) {
      console.error(`  -> Failed search for "${q}":`, err.message);
    }
  }

  // 2. Direct ATS Feeds Ingestion (SmartRecruiters, Greenhouse)
  if (includeDirectAts && fs.existsSync(COMPANIES_PATH)) {
    try {
      const companies = JSON.parse(fs.readFileSync(COMPANIES_PATH, 'utf-8'));
      console.log(`[Discovery] Checking ${companies.length} direct corporate ATS feeds...`);

      for (const c of companies) {
        if (!c.enabled) continue;
        try {
          let directJobs = [];
          if (c.portal === 'smartrecruiters' && c.companyToken) {
            directJobs = await fetchSmartRecruitersJobs(c.companyToken, 'Java');
          } else if (c.portal === 'greenhouse' && c.companyToken) {
            directJobs = await fetchGreenhouseJobs(c.companyToken);
          }

          for (const job of directJobs) {
            totalFound++;
            const saveRes = saveOrUpdateJob(job);
            if (saveRes.isNew) newAdded++;
            else updatedCount++;
            if (saveRes.evaluation.recommendation === 'RECOMMENDED') recommendedCount++;
          }
        } catch (atsErr) {
          console.warn(`  -> Notice on direct feed for ${c.name}: ${atsErr.message}`);
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
    recommendedJobsFound: recommendedCount
  };

  console.log(`[Discovery] Scan complete: ${newAdded} new jobs saved, ${recommendedCount} high-fit recommended roles.`);
  return summary;
}
