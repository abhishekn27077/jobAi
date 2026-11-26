/**
 * CareerOS — AI Agent Task Manager & Apply-With-AI Context Orchestrator (Phase 15)
 * Manages structured job-specific tasks for Google Antigravity with safe SQLite
 * persistence, duplicate-task prevention, lifecycle controls, and crash recovery.
 */

import crypto from 'node:crypto';
import { getDatabase } from '../db/schema.js';
import { loadCandidateProfile } from '../profile/profileManager.js';
import { getResumeVersionsForJob } from '../resumes/resumeVersionManager.js';
import { getApplicationByJobId } from '../tracker/applicationTracker.js';
import { recordTimelineEvent } from '../tracker/timelineService.js';

export const TASK_STATUSES = [
  'queued',
  'agent_disconnected',
  'running',
  'paused',
  'browser_connection_required',
  'waiting_for_user',
  'needs_manual_action',
  'awaiting_approval',
  'waiting_for_approval',
  'completed',
  'failed',
  'cancelled'
];

export const ACTIVE_TASK_STATUSES = [
  'queued',
  'agent_disconnected',
  'running',
  'paused',
  'browser_connection_required',
  'waiting_for_user',
  'needs_manual_action',
  'awaiting_approval',
  'waiting_for_approval'
];

let lastAgentHeartbeatAt = null;
let lastAgentToolName = null;

export function recordAgentHeartbeat(toolName = 'mcp') {
  lastAgentHeartbeatAt = new Date().toISOString();
  lastAgentToolName = toolName;
}

export function getAgentBridgeStatus() {
  const now = Date.now();
  const lastMs = lastAgentHeartbeatAt ? new Date(lastAgentHeartbeatAt).getTime() : 0;
  const ageSeconds = lastMs ? Math.round((now - lastMs) / 1000) : null;
  const connected = Boolean(lastMs && ageSeconds !== null && ageSeconds <= 300);
  return {
    connected,
    status: connected ? 'connected' : 'offline',
    lastSeenAt: lastAgentHeartbeatAt,
    lastTool: lastAgentToolName,
    ageSeconds
  };
}

function safeJson(str, fallback) {
  try {
    return str ? JSON.parse(str) : fallback;
  } catch {
    return fallback;
  }
}

function formatTaskRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskUid: row.task_uid,
    jobId: row.job_id,
    canonicalUrl: row.canonical_url,
    company: row.company,
    title: row.title,
    taskType: row.task_type,
    instructions: row.instructions,
    status: row.status,
    agentSessionRef: row.agent_session_ref,
    progressEvents: safeJson(row.progress_events_json, []),
    errorDetails: row.error_details,
    manualActionRequired: row.manual_action_required,
    approvalRequired: Boolean(row.approval_required),
    browserStatus: row.browser_status || null,
    currentStep: row.current_step || null,
    resultSummary: row.result_summary,
    artifacts: safeJson(row.artifacts_json, []),
    createdAt: row.created_at,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}

/**
 * Builds the minimum required grounded context for Antigravity to execute Apply-with-AI.
 * Strictly excludes OAuth tokens, secrets, and unrelated personal files.
 */
export function buildApplyWithAiContext(jobId) {
  const db = getDatabase();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`Job #${jobId} not found.`);

  const evaluation = db.prepare('SELECT * FROM job_evaluations WHERE job_id = ?').get(jobId);
  const profile = loadCandidateProfile();
  const application = getApplicationByJobId(jobId);
  const resumeVersions = getResumeVersionsForJob(jobId);

  const recruiters = db.prepare(`
    SELECT id, company, name, role, email, verification_status, discovery_source, source_url, profile_url, outreach_status, evidence_notes
    FROM recruiter_contacts
    WHERE job_id = ? OR LOWER(company) = LOWER(?)
    ORDER BY id DESC LIMIT 10
  `).all(jobId, job.company);

  const communications = db.prepare(`
    SELECT id, job_id, thread_id, sender, recipient, subject, direction, category, urgency, received_at
    FROM communications
    WHERE job_id = ?
    ORDER BY id DESC LIMIT 10
  `).all(jobId);

  const masterSkills = [
    ...(profile.skills?.languages || []),
    ...(profile.skills?.backend || []),
    ...(profile.skills?.frontend || []),
    ...(profile.skills?.databases || []),
    ...(profile.skills?.tools || [])
  ];

  const tailoredResume = resumeVersions[0] || null;

  const instructions = [
    `1. Analyze job #${job.id} (${job.title} @ ${job.company}) and verify eligibility/concerns.`,
    `2. Prepare the application package using verified candidate profile & projects only (no fabrication).`,
    `3. Generate or verify a tailored ATS resume (never alter master profile).`,
    `4. Prepare verified answers to application questions.`,
    `5. Assist with browser form filling where permitted (never bypass CAPTCHA/OTP/auth walls).`,
    `6. Verify filled fields and resume attachment, then STOP before final submission.`,
    `7. Call request_user_approval before any final submission or external email send.`,
    `8. Research hiring team/contacts from public sources (1-3 relevant contacts, no LinkedIn scraping) and save outreach drafts.`
  ].join('\n');

  return {
    job: {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      url: job.url,
      canonicalUrl: job.canonical_url || job.url,
      source: job.source,
      workMode: job.work_mode,
      employmentType: job.employment_type,
      description: job.description || '',
      requiredSkills: safeJson(job.required_skills, []),
      preferredSkills: safeJson(job.preferred_skills, [])
    },
    eligibility: evaluation ? {
      score: evaluation.score,
      recommendation: evaluation.recommendation,
      fresherEligible: Boolean(evaluation.fresher_eligible),
      summaryReason: evaluation.summary_reason,
      skillsMatched: safeJson(evaluation.skills_matched, []),
      skillsMissing: safeJson(evaluation.skills_missing, [])
    } : null,
    candidateProfile: {
      personal: profile.personal,
      education: profile.education,
      verifiedSkills: masterSkills,
      projects: profile.projects || [],
      experience: profile.experience || [],
      certifications: profile.certifications || []
    },
    resumes: {
      masterResumePath: 'data/candidate_profile.json',
      tailoredResume: tailoredResume ? {
        id: tailoredResume.id,
        versionNumber: tailoredResume.version_number,
        atsScore: tailoredResume.ats_score,
        pdfPath: tailoredResume.pdf_path,
        docxPath: tailoredResume.docx_path,
        isApproved: Boolean(tailoredResume.is_approved)
      } : null
    },
    applicationHistory: application || null,
    recruiterHistory: recruiters,
    communicationHistory: communications,
    applicationInstructions: instructions
  };
}

/**
 * Creates a structured Agent Task with duplicate-task prevention.
 */
export function createAgentTask({
  jobId,
  taskType = 'apply_with_ai',
  instructions = '',
  agentSessionRef = null
}) {
  if (!jobId) throw new Error('jobId is required.');
  const db = getDatabase();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`Job #${jobId} not found.`);

  // Duplicate-task prevention: check active tasks for the same job & task_type
  const placeholders = ACTIVE_TASK_STATUSES.map(() => '?').join(',');
  const existing = db.prepare(`
    SELECT * FROM agent_tasks
    WHERE job_id = ? AND task_type = ? AND status IN (${placeholders})
    ORDER BY id DESC LIMIT 1
  `).get(jobId, taskType, ...ACTIVE_TASK_STATUSES);

  if (existing) {
    return {
      created: false,
      duplicatePrevented: true,
      task: formatTaskRow(existing)
    };
  }

  const context = buildApplyWithAiContext(jobId);
  const finalInstructions = instructions.trim() || context.applicationInstructions;
  const taskUid = `task_${jobId}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const initialEvents = [{
    timestamp: new Date().toISOString(),
    status: 'queued',
    message: `Task queued for ${job.title} @ ${job.company}`
  }];

  const res = db.prepare(`
    INSERT INTO agent_tasks (
      task_uid, job_id, canonical_url, company, title, task_type,
      instructions, status, agent_session_ref, progress_events_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
  `).run(
    taskUid,
    jobId,
    job.canonical_url || job.url,
    job.company,
    job.title,
    taskType,
    finalInstructions,
    agentSessionRef,
    JSON.stringify(initialEvents)
  );

  const taskId = res.lastInsertRowid;
  recordTimelineEvent({
    jobId,
    taskId,
    eventType: 'agent_task_created',
    title: `AI Agent task created (${taskType})`,
    details: `Task UID: ${taskUid}`
  });

  return {
    created: true,
    duplicatePrevented: false,
    task: getAgentTask(taskId)
  };
}

export function getAgentTask(idOrUid) {
  const db = getDatabase();
  const row = typeof idOrUid === 'number' || /^\d+$/.test(String(idOrUid))
    ? db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(Number(idOrUid))
    : db.prepare('SELECT * FROM agent_tasks WHERE task_uid = ?').get(String(idOrUid));
  return formatTaskRow(row);
}

export function listAgentTasks({ status = null, jobId = null, limit = 100 } = {}) {
  const db = getDatabase();
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (jobId) {
    clauses.push('job_id = ?');
    params.push(jobId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM agent_tasks ${where} ORDER BY id DESC LIMIT ?`).all(...params, limit);
  return rows.map(formatTaskRow);
}

export function appendTaskProgress(idOrUid, { message, status = null, agentSessionRef = null } = {}) {
  const db = getDatabase();
  const task = getAgentTask(idOrUid);
  if (!task) throw new Error(`Agent task "${idOrUid}" not found.`);

  if (status && !TASK_STATUSES.includes(status)) {
    throw new Error(`Invalid task status: ${status}`);
  }

  const events = [...task.progressEvents, {
    timestamp: new Date().toISOString(),
    status: status || task.status,
    message: String(message || 'Progress update')
  }];

  const nextStatus = status || task.status;
  const startedAt = task.startedAt || (nextStatus === 'running' ? new Date().toISOString() : null);
  const completedAt = ['completed', 'failed', 'cancelled'].includes(nextStatus)
    ? (task.completedAt || new Date().toISOString())
    : task.completedAt;

  db.prepare(`
    UPDATE agent_tasks
    SET status = ?,
        agent_session_ref = COALESCE(?, agent_session_ref),
        progress_events_json = ?,
        started_at = COALESCE(?, started_at),
        completed_at = COALESCE(?, completed_at),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(nextStatus, agentSessionRef, JSON.stringify(events), startedAt, completedAt, task.id);

  return getAgentTask(task.id);
}

export function transitionTaskStatus(idOrUid, nextStatus, { reason = '', errorDetails = null, manualAction = null, resultSummary = null } = {}) {
  if (!TASK_STATUSES.includes(nextStatus)) {
    throw new Error(`Invalid task status: ${nextStatus}`);
  }
  const db = getDatabase();
  const task = getAgentTask(idOrUid);
  if (!task) throw new Error(`Agent task "${idOrUid}" not found.`);

  const events = [...task.progressEvents, {
    timestamp: new Date().toISOString(),
    status: nextStatus,
    message: reason || `Status changed to ${nextStatus}`
  }];

  const startedAt = task.startedAt || (nextStatus === 'running' ? new Date().toISOString() : null);
  const completedAt = ['completed', 'failed', 'cancelled'].includes(nextStatus)
    ? new Date().toISOString()
    : null;

  db.prepare(`
    UPDATE agent_tasks
    SET status = ?,
        progress_events_json = ?,
        error_details = COALESCE(?, error_details),
        manual_action_required = COALESCE(?, manual_action_required),
        result_summary = COALESCE(?, result_summary),
        started_at = COALESCE(?, started_at),
        completed_at = COALESCE(?, completed_at),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(nextStatus, JSON.stringify(events), errorDetails, manualAction, resultSummary, startedAt, completedAt, task.id);

  return getAgentTask(task.id);
}

export function pauseAgentTask(idOrUid, reason = 'Paused by user') {
  const task = getAgentTask(idOrUid);
  if (!task) throw new Error(`Agent task "${idOrUid}" not found.`);
  if (['completed', 'cancelled', 'failed'].includes(task.status)) {
    throw new Error(`Cannot pause task in "${task.status}" state.`);
  }
  return transitionTaskStatus(task.id, 'paused', { reason });
}

export function resumeAgentTask(idOrUid, reason = 'Resumed by user') {
  const task = getAgentTask(idOrUid);
  if (!task) throw new Error(`Agent task "${idOrUid}" not found.`);
  if (!['paused', 'needs_manual_action', 'queued', 'agent_disconnected', 'browser_connection_required', 'waiting_for_user'].includes(task.status)) {
    throw new Error(`Cannot resume task from "${task.status}" state.`);
  }
  return transitionTaskStatus(task.id, 'running', { reason });
}

export function cancelAgentTask(idOrUid, reason = 'Cancelled by user') {
  const task = getAgentTask(idOrUid);
  if (!task) throw new Error(`Agent task "${idOrUid}" not found.`);
  if (task.status === 'completed') {
    throw new Error('Cannot cancel an already completed task.');
  }
  return transitionTaskStatus(task.id, 'cancelled', { reason });
}

export function attachTaskArtifact(idOrUid, artifact) {
  const db = getDatabase();
  const task = getAgentTask(idOrUid);
  if (!task) throw new Error(`Agent task "${idOrUid}" not found.`);
  const artifacts = [...task.artifacts, {
    ...artifact,
    addedAt: new Date().toISOString()
  }];
  db.prepare(`UPDATE agent_tasks SET artifacts_json = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(artifacts), task.id);
  return getAgentTask(task.id);
}

/**
 * Recovers any tasks left in 'running' state after an unexpected server restart.
 */
export function recoverStaleTasks() {
  const db = getDatabase();
  const running = db.prepare(`SELECT * FROM agent_tasks WHERE status = 'running'`).all();
  const recovered = [];
  for (const row of running) {
    recovered.push(transitionTaskStatus(row.id, 'agent_disconnected', {
      reason: 'Agent session interrupted or server restarted; ready to retry or resume.'
    }));
  }
  return recovered;
}

export function listPendingTasks(limit = 50) {
  const db = getDatabase();
  const placeholders = ACTIVE_TASK_STATUSES.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT * FROM agent_tasks
    WHERE status IN (${placeholders})
    ORDER BY id ASC LIMIT ?
  `).all(...ACTIVE_TASK_STATUSES, limit);
  return rows.map(formatTaskRow);
}

export function retryAgentTask(idOrUid, reason = 'Retried by user') {
  const task = getAgentTask(idOrUid);
  if (!task) throw new Error(`Agent task "${idOrUid}" not found.`);
  if (task.status === 'completed' || task.status === 'cancelled') {
    throw new Error(`Cannot retry task in "${task.status}" state.`);
  }
  const db = getDatabase();
  db.prepare(`UPDATE agent_tasks SET error_details = NULL, current_step = 'requeued_for_retry', updated_at = datetime('now') WHERE id = ?`).run(task.id);
  return transitionTaskStatus(task.id, 'queued', {
    reason: `${reason} (existing artifacts & completed steps preserved)`
  });
}

export function updateTaskBrowserAndStep(idOrUid, { browserStatus = null, currentStep = null } = {}) {
  const task = getAgentTask(idOrUid);
  if (!task) throw new Error(`Agent task "${idOrUid}" not found.`);
  const db = getDatabase();
  db.prepare(`
    UPDATE agent_tasks
    SET browser_status = COALESCE(?, browser_status),
        current_step = COALESCE(?, current_step),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(browserStatus, currentStep, task.id);
  return getAgentTask(task.id);
}

export function markTaskCompleted(idOrUid, resultSummary) {
  const task = getAgentTask(idOrUid);
  if (!task) throw new Error(`Agent task "${idOrUid}" not found.`);
  if (!resultSummary || String(resultSummary).trim().length < 5) {
    throw new Error('Cannot mark task completed without a genuine resultSummary.');
  }
  const hasRealWork = (task.progressEvents && task.progressEvents.length > 1) || (task.artifacts && task.artifacts.length > 0);
  if (!hasRealWork) {
    throw new Error('Cannot mark task completed: no progress steps or artifacts have been recorded yet.');
  }
  return transitionTaskStatus(task.id, 'completed', {
    reason: 'All required task steps verified and completed',
    resultSummary: String(resultSummary).trim()
  });
}
