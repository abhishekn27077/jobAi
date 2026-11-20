import { runJobDiscovery } from '../discovery/discoveryService.js';
import { getJobs } from '../tracker/jobTracker.js';
import { exportTailoredDocumentsForJob } from '../resumes/resumeGenerator.js';
import { getDatabase } from '../db/schema.js';

let activeTimer = null;

export async function runAutomatedScanCycle() {
  console.log(`\n[Scheduler] [${new Date().toLocaleTimeString('en-IN')}] Running automated career scan cycle...`);
  const db = getDatabase();

  try {
    const summary = await runJobDiscovery();

    // Check for high-scoring roles (>= 90%)
    const topRoles = getJobs({ recommendation: 'RECOMMENDED', minScore: 90, limit: 10 });
    console.log(`[Scheduler] Detected ${topRoles.length} top-tier (>=90%) roles in vault.`);

    // Auto-compile tailored ATS resumes for roles scored >= 95
    for (const r of topRoles) {
      if (r.score >= 95) {
        try {
          await exportTailoredDocumentsForJob(r);
        } catch (genErr) {
          console.warn(`[Scheduler] Notice compiling resume for Job #${r.id}: ${genErr.message}`);
        }
      }
    }

    db.prepare(`
      INSERT INTO activity_audit_log (action, details)
      VALUES (?, ?)
    `).run(
      'SCHEDULED_SCAN_COMPLETED',
      `Auto scan finished. ${summary.newJobsInserted} new jobs added. ${topRoles.length} high-fit roles ready.`
    );

    return { success: true, summary, topRolesCount: topRoles.length };
  } catch (err) {
    console.error('[Scheduler Error]:', err.message);
    return { success: false, error: err.message };
  }
}

export function startDailyScanner(intervalHours = 24, runImmediate = true) {
  if (activeTimer) {
    clearInterval(activeTimer);
  }

  const intervalMs = intervalHours * 60 * 60 * 1000;
  console.log(`[Scheduler] Daily scanner initialized. Scanning every ${intervalHours} hour(s).`);

  if (runImmediate) {
    runAutomatedScanCycle().catch(() => {});
  }

  activeTimer = setInterval(() => {
    runAutomatedScanCycle().catch(() => {});
  }, intervalMs);

  return { active: true, intervalHours };
}

export function stopDailyScanner() {
  if (activeTimer) {
    clearInterval(activeTimer);
    activeTimer = null;
    console.log('[Scheduler] Daily scanner stopped.');
  }
}
