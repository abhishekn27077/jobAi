import { getDatabase } from '../db/schema.js';

/**
 * CareerOS — Job Link & Freshness Verifier
 * Verifies live postings while accurately distinguishing between:
 * - 'verified_active': Confirmed 200 OK without closed posting markers
 * - 'expired': Confirmed 404/410 or verified vacancy closed text
 * - 'blocked': 403, 429, Cloudflare, or anti-bot challenge (NEVER marked expired)
 * - 'inaccessible': Network timeout, DNS failure, 5xx server downtime
 * - 'unverified': Initial state prior to verification
 */

export async function verifyJobUrl(url) {
  if (!url) {
    return {
      verificationStatus: 'inaccessible',
      isAlive: false,
      reason: 'Empty or invalid URL'
    };
  }

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

    // 1. Explicit Gone / Not Found
    if (resp.status === 404 || resp.status === 410) {
      return {
        verificationStatus: 'expired',
        isAlive: false,
        statusCode: resp.status,
        reason: `HTTP ${resp.status} Vacancy removed or not found`
      };
    }

    // 2. Automated Request Blocked / Rate-Limited (NEVER MARK EXPIRED)
    if (resp.status === 403 || resp.status === 429 || resp.status === 401) {
      return {
        verificationStatus: 'blocked',
        isAlive: true,
        isBlocked: true,
        statusCode: resp.status,
        reason: `HTTP ${resp.status} Origin blocked automated request; job preserved for manual browser check`
      };
    }

    // 3. Server-side transient failures
    if (resp.status >= 500) {
      return {
        verificationStatus: 'inaccessible',
        isAlive: false,
        statusCode: resp.status,
        reason: `HTTP ${resp.status} Origin server error`
      };
    }

    const html = await resp.text();
    const textLower = html.toLowerCase();

    // 4. Check for Bot Challenge / Turnstile / WAF (NEVER MARK EXPIRED)
    const isBotChallenge = textLower.includes('cf-browser-verification') ||
                           textLower.includes('challenge-platform') ||
                           textLower.includes('please enable javascript and cookies') ||
                           textLower.includes('verify you are a human') ||
                           textLower.includes('just a moment...') ||
                           textLower.includes('attention required! | cloudflare');

    if (isBotChallenge) {
      return {
        verificationStatus: 'blocked',
        isAlive: true,
        isBlocked: true,
        statusCode: resp.status,
        reason: 'Bot challenge / WAF screen detected; preserved for manual browser inspection'
      };
    }

    // 5. Check for genuine ghost-job / closed posting markers
    const closedMarkers = [
      'this job is no longer available',
      'this position has been closed',
      'this position has been filled',
      'no longer accepting applications',
      'job expired',
      'posting has expired',
      'the job you are looking for is no longer open',
      'job not found',
      'this listing has expired',
      'applications are closed'
    ];

    for (const marker of closedMarkers) {
      if (textLower.includes(marker)) {
        return {
          verificationStatus: 'expired',
          isAlive: false,
          statusCode: resp.status,
          reason: `Closed vacancy banner detected: "${marker}"`
        };
      }
    }

    // 6. Confirmed Active Vacancy
    return {
      verificationStatus: 'verified_active',
      isAlive: true,
      statusCode: resp.status,
      finalUrl: resp.url,
      reason: 'Active vacancy confirmed via HTTP 200'
    };
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError' || /timeout/i.test(err.message);
    return {
      verificationStatus: 'inaccessible',
      isAlive: false,
      reason: isTimeout ? 'Connection timed out (8s)' : `Network unreachable: ${err.message}`
    };
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

  let activeCount = 0;
  let expiredCount = 0;
  let blockedCount = 0;
  let inaccessibleCount = 0;

  for (const job of jobs) {
    process.stdout.write(`  Auditing Job #${job.id} (${job.company} - ${job.title.substring(0, 25)})... `);
    const result = await verifyJobUrl(job.url);

    // Update verification telemetry in database
    db.prepare(`
      UPDATE jobs 
      SET last_verified_at = datetime('now'),
          verification_status = ?,
          verification_reason = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(result.verificationStatus, result.reason, job.id);

    if (result.verificationStatus === 'verified_active') {
      console.log('✅ Active');
      activeCount++;
    } else if (result.verificationStatus === 'expired') {
      console.log(`❌ Expired (${result.reason})`);
      expiredCount++;
      db.prepare(`UPDATE jobs SET status = 'expired', updated_at = datetime('now') WHERE id = ?`).run(job.id);
      db.prepare(`
        UPDATE job_evaluations
        SET recommendation = 'EXPIRED',
            score = 0,
            summary_reason = ?
        WHERE job_id = ?
      `).run(`Listing expired or closed: ${result.reason}`, job.id);
      db.prepare(`
        INSERT INTO activity_audit_log (action, details)
        VALUES (?, ?)
      `).run('JOB_MARKED_EXPIRED', `Job #${job.id} (${job.title} @ ${job.company}) marked expired: ${result.reason}`);
    } else if (result.verificationStatus === 'blocked') {
      console.log(`🛡️ Blocked by Bot Filter (${result.reason}) [Preserved Active]`);
      blockedCount++;
    } else {
      console.log(`⚠️ Inaccessible (${result.reason}) [Preserved Active]`);
      inaccessibleCount++;
    }
  }

  console.log(`\n[Job Verifier] Audit complete: ${activeCount} active, ${expiredCount} expired, ${blockedCount} blocked (preserved), ${inaccessibleCount} inaccessible.\n`);
  return { activeCount, expiredCount, blockedCount, inaccessibleCount, verifiedCount: activeCount };
}
