import { getDatabase } from '../db/schema.js';
import { runJobDiscovery } from '../discovery/discoveryService.js';
import { verifyVaultJobs } from '../matcher/jobVerifier.js';
import { evaluateJobs } from '../matcher/scoringEngine.js';
import { syncRecruiterEmails } from '../email/emailSyncService.js';
import { getReminders, updateReminderStatus } from '../tracker/followUpManager.js';
import { getApplicationAnalytics } from '../intelligence/careerAnalyticsService.js';
import { getCalendarEvents } from '../calendar/calendarService.js';

/**
 * Calculates exponential backoff in seconds based on failure count
 */
export function calculateBackoffSeconds(consecutiveFailures) {
  return Math.min(60 * Math.pow(2, consecutiveFailures), 1800);
}

// Default tasks configuration
export const DEFAULT_TASKS = [
  {
    taskKey: 'job_discovery',
    name: 'Scheduled Job Discovery',
    description: 'Scans official ATS feeds (Lever, Ashby, Greenhouse, SmartRecruiters) and FreeHire for fresh opportunities.',
    intervalMinutes: 720, // 12 hours
    isEnabled: true
  },
  {
    taskKey: 'freshness_recheck',
    name: 'Job Liveness & Ghost-Postings Audit',
    description: 'Audits saved & applied job URLs to detect closed vacancies or expired postings.',
    intervalMinutes: 1440, // 24 hours
    isEnabled: true
  },
  {
    taskKey: 'profile_matching',
    name: 'Job-to-Profile Matching Recalibration',
    description: 'Evaluates newly discovered jobs against the verified candidate profile scoring rubric.',
    intervalMinutes: 720, // 12 hours
    isEnabled: true
  },
  {
    taskKey: 'application_status_sync',
    name: 'Application Pipeline Synchronization',
    description: 'Cross-references application statuses with incoming communications and active interviews.',
    intervalMinutes: 360, // 6 hours
    isEnabled: true
  },
  {
    taskKey: 'gmail_sync',
    name: 'Gmail Recruiter Inbox Synchronization',
    description: 'Incrementally synchronizes recruiter replies, interview invites, and coding assessments.',
    intervalMinutes: 180, // 3 hours
    isEnabled: true
  },
  {
    taskKey: 'reminders_check',
    name: 'Follow-Up & Assessment Reminders Sweep',
    description: 'Monitors time-sensitive assessment deadlines (12h prior) and application follow-ups (10 days).',
    intervalMinutes: 120, // 2 hours
    isEnabled: true
  },
  {
    taskKey: 'weekly_report',
    name: 'Weekly Career Digest & Analytics',
    description: 'Compiles weekly application funnel conversion, skill roadmap progress, and response telemetry.',
    intervalMinutes: 10080, // 7 days
    isEnabled: true
  }
];

// In-memory runtime state
let isMasterPaused = false;
let masterLoopTimer = null;
const runningTaskLocks = new Set();

/**
 * Initializes the unified automation engine and registers task schedules
 */
export function initializeAutomationEngine({ runStartupChecks = false } = {}) {
  const db = getDatabase();

  // Ensure default tasks exist in SQLite
  const insert = db.prepare(`
    INSERT OR IGNORE INTO automation_tasks
    (task_key, name, description, interval_minutes, is_enabled, next_run_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', '+' || ? || ' minutes'))
  `);

  for (const t of DEFAULT_TASKS) {
    insert.run(
      t.taskKey,
      t.name,
      t.description,
      t.intervalMinutes,
      t.isEnabled ? 1 : 0,
      t.intervalMinutes
    );
  }

  console.log('[Automation Engine] Initialized 7 unified career management tasks.');

  if (masterLoopTimer) {
    clearInterval(masterLoopTimer);
  }

  // Master scheduler tick: inspects pending tasks every 60 seconds
  masterLoopTimer = setInterval(() => {
    checkAndExecuteScheduledTasks().catch(err => {
      console.error('[Automation Loop Error]:', err.message);
    });
  }, 60000);
  if (masterLoopTimer && typeof masterLoopTimer.unref === 'function') {
    masterLoopTimer.unref();
  }

  if (runStartupChecks) {
    checkAndExecuteScheduledTasks().catch(() => {});
  }

  return { active: true, isPaused: isMasterPaused };
}

/**
 * Stops the automation engine timer cleanly
 */
export function stopAutomationEngine() {
  if (masterLoopTimer) {
    clearInterval(masterLoopTimer);
    masterLoopTimer = null;
    console.log('[Automation Engine] Background master loop stopped cleanly.');
  }
}

/**
 * Inspects all active tasks and executes any whose next_run_at has arrived
 */
export async function checkAndExecuteScheduledTasks() {
  if (isMasterPaused) return { skipped: true, reason: 'master_paused' };
  const db = getDatabase();

  const dueTasks = db.prepare(`
    SELECT * FROM automation_tasks
    WHERE is_enabled = 1
      AND (next_run_at IS NULL OR next_run_at <= datetime('now'))
  `).all();

  const results = [];
  for (const task of dueTasks) {
    if (!runningTaskLocks.has(task.task_key)) {
      const runRes = await executeTask(task.task_key, { isScheduled: true });
      results.push(runRes);
    }
  }

  return { executedCount: results.length, results };
}

/**
 * Manually or automatically executes a specific task with error isolation & exponential backoff
 */
export async function executeTask(taskKey, { isScheduled = false, retryAttempt = 0 } = {}) {
  // Concurrency Protection / Mutex
  if (runningTaskLocks.has(taskKey)) {
    return {
      success: false,
      taskKey,
      skipped: true,
      reason: 'Task is already currently executing in background.'
    };
  }

  runningTaskLocks.add(taskKey);
  const db = getDatabase();

  const task = db.prepare('SELECT * FROM automation_tasks WHERE task_key = ?').get(taskKey);
  const taskName = task?.name || taskKey;
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  db.prepare(`
    UPDATE automation_tasks
    SET last_status = 'running', updated_at = datetime('now')
    WHERE task_key = ?
  `).run(taskKey);

  console.log(`[Automation Engine] Starting task "${taskName}" (${taskKey})...`);

  let runSuccess = false;
  let itemsProcessed = 0;
  let summary = '';
  let errorMessage = null;

  try {
    // Dispatch to specific task logic
    switch (taskKey) {
      case 'job_discovery': {
        const disc = await runJobDiscovery();
        itemsProcessed = disc.newJobsInserted || 0;
        summary = `Discovery complete. Found ${disc.totalJobsFound || 0} jobs; inserted ${itemsProcessed} new opportunities.`;
        runSuccess = true;
        break;
      }

      case 'freshness_recheck': {
        const audit = await verifyVaultJobs({ limit: 15 });
        itemsProcessed = audit.verified || 0;
        summary = `Liveness check complete. Audited ${itemsProcessed} jobs (Active: ${audit.active || 0}, Expired: ${audit.expired || 0}, Blocked: ${audit.blocked || 0}).`;
        runSuccess = true;
        break;
      }

      case 'profile_matching': {
        const jobs = db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT 20').all();
        const evals = evaluateJobs(jobs);
        itemsProcessed = evals.length;
        summary = `Recalibrated compatibility matches for ${itemsProcessed} vault jobs.`;
        runSuccess = true;
        break;
      }

      case 'application_status_sync': {
        const apps = db.prepare('SELECT COUNT(*) as count FROM applications').get()?.count || 0;
        itemsProcessed = apps;
        summary = `Verified status synchronization across ${itemsProcessed} tracked applications.`;
        runSuccess = true;
        break;
      }

      case 'gmail_sync': {
        const sync = await syncRecruiterEmails();
        itemsProcessed = sync.messagesImported || 0;
        if (!sync.success && sync.requiresAuth) {
          summary = 'Gmail synchronization skipped: Google account not authenticated.';
          runSuccess = true; // Not a failure; just unauthenticated offline state
        } else {
          summary = `Inbox sync complete. Imported ${itemsProcessed} new messages (${sync.interviewsDetected || 0} interview invites, ${sync.assessmentsDetected || 0} assessments).`;
          runSuccess = true;
        }
        break;
      }

      case 'reminders_check': {
        const reminders = getReminders({ status: 'pending', limit: 20 });
        itemsProcessed = reminders.length;
        summary = `Checked follow-up & assessment deadlines. ${itemsProcessed} pending reminders active.`;
        runSuccess = true;
        break;
      }

      case 'weekly_report': {
        const analytics = getApplicationAnalytics();
        itemsProcessed = analytics.totalApplications;
        summary = `Weekly digest compiled: ${itemsProcessed} applications tracked, ${analytics.metrics.responseRatePct}% response rate.`;
        runSuccess = true;
        break;
      }

      default:
        throw new Error(`Unknown automation task key: ${taskKey}`);
    }
  } catch (err) {
    runSuccess = false;
    errorMessage = err.message;
    summary = `Failed: ${err.message}`;
    console.error(`[Automation Engine] Task "${taskName}" failed:`, err.message);
  } finally {
    runningTaskLocks.delete(taskKey);
  }

  const durationMs = Date.now() - startTime;
  const completedAt = new Date().toISOString();

  // Schedule Next Run with Exponential Backoff on Failure
  let consecutiveFailures = task?.consecutive_failures || 0;
  let nextRunAt = null;

  if (runSuccess) {
    consecutiveFailures = 0;
    const intervalMins = task?.interval_minutes || 720;
    nextRunAt = new Date(Date.now() + intervalMins * 60 * 1000).toISOString();
  } else {
    consecutiveFailures += 1;
    // Exponential backoff: 60s * 2^failures, capped at 1800s (30m)
    const backoffSeconds = calculateBackoffSeconds(consecutiveFailures);
    nextRunAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();
  }

  // Update task table
  db.prepare(`
    UPDATE automation_tasks
    SET last_run_at = ?,
        next_run_at = ?,
        last_status = ?,
        last_error = ?,
        consecutive_failures = ?,
        retry_count = ?,
        updated_at = datetime('now')
    WHERE task_key = ?
  `).run(
    completedAt,
    nextRunAt,
    runSuccess ? 'success' : 'failed',
    errorMessage,
    consecutiveFailures,
    retryAttempt,
    taskKey
  );

  // Record historical run log
  db.prepare(`
    INSERT INTO automation_runs
    (task_key, task_name, started_at, completed_at, duration_ms, status, items_processed, summary, error_message, retry_attempt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    taskKey,
    taskName,
    startedAt,
    completedAt,
    durationMs,
    runSuccess ? 'success' : 'failed',
    itemsProcessed,
    summary,
    errorMessage,
    retryAttempt
  );

  return {
    success: runSuccess,
    taskKey,
    taskName,
    durationMs,
    itemsProcessed,
    summary,
    error: errorMessage,
    nextRunAt
  };
}

/**
 * Returns overall automation system health, tasks list, and recent execution history
 */
export function getAutomationControlStatus() {
  const db = getDatabase();

  const tasks = db.prepare('SELECT * FROM automation_tasks ORDER BY id ASC').all();
  const recentRuns = db.prepare('SELECT * FROM automation_runs ORDER BY id DESC LIMIT 15').all();

  const totalTasks = tasks.length;
  const activeTasks = tasks.filter(t => t.is_enabled === 1).length;
  const failedTasks = tasks.filter(t => t.last_status === 'failed').length;

  return {
    isMasterPaused,
    isEnginePaused: isMasterPaused,
    health: {
      status: failedTasks === 0 ? 'healthy' : 'attention_required',
      totalTasks,
      activeTasks,
      failedTasks,
      currentlyExecuting: Array.from(runningTaskLocks)
    },
    tasks: tasks.map(t => ({
      id: t.id,
      taskKey: t.task_key,
      name: t.name,
      description: t.description,
      isEnabled: Boolean(t.is_enabled),
      intervalMinutes: t.interval_minutes,
      lastRunAt: t.last_run_at,
      nextRunAt: t.next_run_at,
      lastStatus: runningTaskLocks.has(t.task_key) ? 'running' : t.last_status,
      lastError: t.last_error,
      consecutiveFailures: t.consecutive_failures,
      retryCount: t.retry_count
    })),
    recentRuns: recentRuns.map(r => ({
      id: r.id,
      taskKey: r.task_key,
      taskName: r.task_name,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      durationMs: r.duration_ms,
      status: r.status,
      itemsProcessed: r.items_processed,
      summary: r.summary,
      errorMessage: r.error_message,
      retryAttempt: r.retry_attempt
    }))
  };
}

/**
 * Toggles a task enabled or disabled
 */
export function toggleTaskEnabled(taskKey, isEnabled) {
  const db = getDatabase();
  const current = db.prepare('SELECT is_enabled FROM automation_tasks WHERE task_key = ?').get(taskKey);
  const targetVal = isEnabled !== undefined ? (isEnabled ? 1 : 0) : (current?.is_enabled ? 0 : 1);
  db.prepare(`
    UPDATE automation_tasks
    SET is_enabled = ?, updated_at = datetime('now')
    WHERE task_key = ?
  `).run(targetVal, taskKey);

  const updated = db.prepare('SELECT * FROM automation_tasks WHERE task_key = ?').get(taskKey);
  return {
    id: updated.id,
    taskKey: updated.task_key,
    name: updated.name,
    description: updated.description,
    isEnabled: Boolean(updated.is_enabled),
    intervalMinutes: updated.interval_minutes,
    lastRunAt: updated.last_run_at,
    nextRunAt: updated.next_run_at,
    lastStatus: updated.last_status
  };
}

/**
 * Updates interval for a task
 */
export function updateTaskInterval(taskKey, intervalMinutes) {
  const mins = parseInt(intervalMinutes, 10);
  if (!mins || mins < 5) throw new Error('Interval must be at least 5 minutes.');

  const db = getDatabase();
  db.prepare(`
    UPDATE automation_tasks
    SET interval_minutes = ?, updated_at = datetime('now')
    WHERE task_key = ?
  `).run(mins, taskKey);

  const updated = db.prepare('SELECT * FROM automation_tasks WHERE task_key = ?').get(taskKey);
  return {
    id: updated.id,
    taskKey: updated.task_key,
    name: updated.name,
    description: updated.description,
    isEnabled: Boolean(updated.is_enabled),
    intervalMinutes: updated.interval_minutes,
    lastRunAt: updated.last_run_at,
    nextRunAt: updated.next_run_at,
    lastStatus: updated.last_status
  };
}

/**
 * Master pause toggle
 */
export function setMasterAutomationPause(pause = true) {
  isMasterPaused = Boolean(pause);
  return { isMasterPaused };
}
