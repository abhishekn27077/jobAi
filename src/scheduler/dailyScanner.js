import { runJobDiscovery } from '../discovery/discoveryService.js';
import { getJobs } from '../tracker/jobTracker.js';
import { exportTailoredDocumentsForJob } from '../resumes/resumeGenerator.js';
import { getDatabase } from '../db/schema.js';
import { initializeAutomationEngine, stopAutomationEngine, executeTask } from './automationEngine.js';

let activeTimer = null;

export async function runAutomatedScanCycle() {
  console.log(`\n[Scheduler] [${new Date().toLocaleTimeString('en-IN')}] Running automated career scan cycle...`);
  return await executeTask('job_discovery');
}

export function startDailyScanner(intervalHours = 24, runImmediate = true) {
  if (activeTimer) {
    clearInterval(activeTimer);
  }

  initializeAutomationEngine({ runStartupChecks: false });

  const intervalMs = intervalHours * 60 * 60 * 1000;
  console.log(`[Scheduler] Daily scanner initialized. Scanning every ${intervalHours} hour(s).`);

  if (runImmediate) {
    runAutomatedScanCycle().catch(() => { });
  }

  activeTimer = setInterval(() => {
    runAutomatedScanCycle().catch(() => { });
  }, intervalMs);

  return { active: true, intervalHours };
}

export function stopDailyScanner() {
  if (activeTimer) {
    clearInterval(activeTimer);
    activeTimer = null;
    console.log('[Scheduler] Daily scanner stopped.');
  }
  stopAutomationEngine();
}

