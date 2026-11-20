import { getDatabase } from '../db/schema.js';

export async function verifyJobUrl(url) {
  if (!url) return { isAlive: false, reason: 'Empty URL' };

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000)
    });

    if (resp.status >= 400) {
      return { isAlive: false, statusCode: resp.status, reason: `HTTP ${resp.status} status` };
    }

    const html = await resp.text();
    const textLower = html.toLowerCase();

    // Check for ghost-job / closed posting markers
    const closedMarkers = [
      'this job is no longer available',
      'this position has been closed',
      'this position has been filled',
      'no longer accepting applications',
      'job expired',
      'posting has expired',
      'the job you are looking for is no longer open',
      'job not found',
      'this listing has expired'
    ];

    for (const marker of closedMarkers) {
      if (textLower.includes(marker)) {
        return { isAlive: false, statusCode: resp.status, reason: `Closed banner detected: "${marker}"` };
      }
    }

    return { isAlive: true, statusCode: resp.status, finalUrl: resp.url };
  } catch (err) {
    return { isAlive: false, reason: `Network error: ${err.message}` };
  }
}

export async function verifyVaultJobs({ limit = 20, minScore = 70 } = {}) {
  const db = getDatabase();
  console.log(`\n[Job Verifier] Checking link validity and ghost-job signals for top ${limit} listings...`);

  const jobs = db.prepare(`
    SELECT j.id, j.title, j.company, j.url, j.status, e.score
    FROM jobs j
    JOIN job_evaluations e ON j.id = e.job_id
    WHERE j.status IN ('discovered', 'saved', 'ready_to_apply') AND e.score >= ?
    ORDER BY e.score DESC
    LIMIT ?
  `).all(minScore, limit);

  let verifiedCount = 0;
  let expiredCount = 0;

  for (const job of jobs) {
    process.stdout.write(`  Checking Job #${job.id} (${job.company})... `);
    const result = await verifyJobUrl(job.url);

    if (result.isAlive) {
      console.log('✅ Active');
      verifiedCount++;
    } else {
      console.log(`❌ Expired (${result.reason})`);
      expiredCount++;
      db.prepare(`UPDATE jobs SET status = 'expired', updated_at = datetime('now') WHERE id = ?`).run(job.id);
      db.prepare(`
        INSERT INTO activity_audit_log (action, details)
        VALUES (?, ?)
      `).run(
        'JOB_MARKED_EXPIRED',
        `Job #${job.id} (${job.title} @ ${job.company}) marked expired: ${result.reason}`
      );
    }
  }

  console.log(`\n[Job Verifier] Audit complete: ${verifiedCount} confirmed active, ${expiredCount} expired / closed.\n`);
  return { verifiedCount, expiredCount };
}
