/**
 * CareerOS — Application Tracker Manager
 * Manages application lifecycle states, status progression, notes,
 * and user-confirmed submissions with complete audit history.
 */

import { getDatabase } from '../db/schema.js';
import { getPortalSupportMatrix } from '../automation/portalAdapters/portalRegistry.js';
import { normalizeCanonicalUrl, extractAtsJobId } from '../discovery/urlNormalizer.js';

export const VALID_APPLICATION_STATUSES = [
  'discovered',
  'saved',
  'interested',
  'preparing',
  'ready_for_review',
  'submission_verification_pending',
  'user_submitted',
  'submitted',
  'recruiter_contacted',
  'applied',
  'assessment',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
  'on_hold',
  'closed',
  'expired'
];

export function getApplications({ status = null, limit = 50, offset = 0 } = {}) {
  const db = getDatabase();

  let query = `
    SELECT 
      a.id, a.job_id, a.portal_type, a.resume_version, a.cover_letter_path,
      a.applied_date, a.user_approved, a.confirmation_number, a.notes,
      a.status, a.job_url, a.job_source, a.checklist_json, a.screening_answers_json,
      a.status_history_json, a.created_at, a.updated_at,
      j.title as job_title, j.company as job_company, j.location as job_location,
      j.salary as job_salary, j.work_mode, j.experience_min, j.experience_max,
      e.score as eval_score, e.recommendation as eval_recommendation
    FROM applications a
    JOIN jobs j ON a.job_id = j.id
    LEFT JOIN job_evaluations e ON j.id = e.job_id
    WHERE 1=1
  `;
  const params = [];

  if (status && status !== 'all') {
    query += ' AND a.status = ?';
    params.push(status);
  }

  query += ' ORDER BY a.id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params);

  return rows.map(r => ({
    ...r,
    checklist: r.checklist_json ? JSON.parse(r.checklist_json) : [],
    screening_answers: r.screening_answers_json ? JSON.parse(r.screening_answers_json) : {},
    status_history: r.status_history_json ? JSON.parse(r.status_history_json) : []
  }));
}

export function getApplicationByJobId(jobId) {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT 
      a.id, a.job_id, a.portal_type, a.resume_version, a.cover_letter_path,
      a.applied_date, a.user_approved, a.confirmation_number, a.notes,
      a.status, a.job_url, a.job_source, a.checklist_json, a.screening_answers_json,
      a.status_history_json, a.created_at, a.updated_at,
      j.title as job_title, j.company as job_company, j.location as job_location
    FROM applications a
    JOIN jobs j ON a.job_id = j.id
    WHERE a.job_id = ?
  `).get(jobId);

  if (!row) return null;

  return {
    ...row,
    checklist: row.checklist_json ? JSON.parse(row.checklist_json) : [],
    screening_answers: row.screening_answers_json ? JSON.parse(row.screening_answers_json) : {},
    status_history: row.status_history_json ? JSON.parse(row.status_history_json) : []
  };
}

export function updateApplicationStatus(jobId, newStatus, { notes = '', confirmationNumber = null, userConfirmed = false } = {}) {
  if (!VALID_APPLICATION_STATUSES.includes(newStatus)) {
    throw new Error(`Invalid application status "${newStatus}". Must be one of: ${VALID_APPLICATION_STATUSES.join(', ')}`);
  }

  // Strict Rule: Never mark application as submitted/applied without confirmed user action
  if (['submitted', 'applied', 'user_submitted'].includes(newStatus) && !userConfirmed) {
    throw new Error(`Approval Gate Violation: An application cannot be marked as "${newStatus}" without explicit user confirmation of submission.`);
  }

  const db = getDatabase();
  let existing = db.prepare('SELECT * FROM applications WHERE job_id = ?').get(jobId);
  if (!existing) {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) {
      throw new Error(`No application record found for job #${jobId}.`);
    }
    const insertRes = db.prepare(`
      INSERT INTO applications (
        job_id, portal_type, resume_version, applied_date, user_approved,
        notes, status, job_url, job_source, checklist_json, screening_answers_json, status_history_json
      ) VALUES (?, ?, 'v1_Resume.pdf', NULL, 0, ?, 'preparing', ?, ?, '[]', '{}', '[]')
    `).run(
      jobId,
      job.source || 'Direct',
      notes || `Application initiated for ${job.title} @ ${job.company}`,
      job.url || '',
      job.source || 'direct'
    );
    existing = db.prepare('SELECT * FROM applications WHERE id = ?').get(insertRes.lastInsertRowid);
  }

  let history = [];
  try {
    history = existing.status_history_json ? JSON.parse(existing.status_history_json) : [];
  } catch {}

  const now = new Date().toISOString();
  history.push({
    from: existing.status,
    to: newStatus,
    timestamp: now,
    notes: notes || undefined,
    userConfirmed: Boolean(userConfirmed)
  });

  const updatedNotes = notes ? `${existing.notes ? existing.notes + ' | ' : ''}${notes}` : existing.notes;

  db.prepare(`
    UPDATE applications 
    SET status = ?, 
        notes = ?,
        confirmation_number = COALESCE(?, confirmation_number),
        user_approved = CASE WHEN ? = 1 THEN 1 ELSE user_approved END,
        applied_date = CASE WHEN ? = 'submitted' THEN ? ELSE applied_date END,
        status_history_json = ?,
        updated_at = datetime('now')
    WHERE job_id = ?
  `).run(
    newStatus,
    updatedNotes,
    confirmationNumber,
    userConfirmed ? 1 : 0,
    newStatus,
    now,
    JSON.stringify(history),
    jobId
  );

  // Sync jobs table status
  const jobStatusMap = {
    'interested': 'saved',
    'preparing': 'saved',
    'ready_for_review': 'ready_to_apply',
    'submission_verification_pending': 'ready_to_apply',
    'user_submitted': 'applied',
    'submitted': 'applied',
    'applied': 'applied',
    'assessment': 'applied',
    'interview': 'interviewing',
    'rejected': 'rejected',
    'offer': 'offer',
    'withdrawn': 'dismissed',
    'closed': 'expired',
    'expired': 'expired'
  };

  const syncJobStatus = jobStatusMap[newStatus];
  if (syncJobStatus) {
    db.prepare(`UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(syncJobStatus, jobId);
  }

  // Audit Log
  db.prepare(`
    INSERT INTO activity_audit_log (action, details)
    VALUES (?, ?)
  `).run(
    'APPLICATION_STATUS_UPDATED',
    `Application for Job #${jobId} moved from ${existing.status} to ${newStatus}. User confirmed: ${userConfirmed}`
  );

  return {
    success: true,
    jobId,
    previousStatus: existing.status,
    newStatus,
    updatedAt: now
  };
}

const APPLIED_STATUSES = new Set(['submitted', 'applied', 'user_submitted', 'assessment', 'interview', 'offer']);
const IN_PROGRESS_STATUSES = new Set(['preparing', 'ready_for_review', 'interested']);

/**
 * Checks whether a job (by ID or job object) is already applied or has an active
 * application in progress, using job_id, canonical_url, ATS job ID, and company+title.
 */
export function checkDuplicateApplication(jobOrId) {
  const db = getDatabase();
  const job = typeof jobOrId === 'object' && jobOrId !== null
    ? jobOrId
    : db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobOrId);

  if (!job) {
    return { isDuplicate: false, state: 'NONE', existingApplication: null, reason: null };
  }

  const allApps = db.prepare(`
    SELECT a.*, j.title as job_title, j.company as job_company, j.url as job_record_url, j.canonical_url
    FROM applications a
    JOIN jobs j ON a.job_id = j.id
  `).all();

  const targetCanonical = normalizeCanonicalUrl(job.canonical_url || job.url || '');
  const targetAtsId = extractAtsJobId(job.url || '');
  const normCompany = (job.company || '').toLowerCase().trim();
  const normTitle = (job.title || '').toLowerCase().trim();

  let matchedApp = null;
  let matchReason = null;

  for (const app of allApps) {
    if (app.job_id === job.id) {
      matchedApp = app;
      matchReason = 'Exact job record in applications';
      break;
    }
    const appCanonical = normalizeCanonicalUrl(app.canonical_url || app.job_url || app.job_record_url || '');
    if (targetCanonical && appCanonical && targetCanonical === appCanonical) {
      matchedApp = app;
      matchReason = 'Matching canonical job URL';
      break;
    }
    const appAtsId = extractAtsJobId(app.job_url || app.job_record_url || '');
    if (targetAtsId && appAtsId && targetAtsId === appAtsId) {
      matchedApp = app;
      matchReason = `Matching ATS requisition ID (${targetAtsId})`;
      break;
    }
    if (
      normCompany && normTitle &&
      (app.job_company || '').toLowerCase().trim() === normCompany &&
      (app.job_title || '').toLowerCase().trim() === normTitle
    ) {
      matchedApp = app;
      matchReason = 'Matching company and job title';
      break;
    }
  }

  if (!matchedApp) {
    return { isDuplicate: false, state: 'NONE', existingApplication: null, reason: null };
  }

  const st = (matchedApp.status || '').toLowerCase();
  if (APPLIED_STATUSES.has(st)) {
    return {
      isDuplicate: true,
      state: 'ALREADY_APPLIED',
      existingApplication: matchedApp,
      reason: `${matchReason} (Status: ${matchedApp.status})`
    };
  }
  if (IN_PROGRESS_STATUSES.has(st)) {
    return {
      isDuplicate: true,
      state: 'APPLICATION_IN_PROGRESS',
      existingApplication: matchedApp,
      reason: `${matchReason} (Status: ${matchedApp.status})`
    };
  }

  return {
    isDuplicate: false,
    state: 'PREVIOUS_CLOSED',
    existingApplication: matchedApp,
    reason: `${matchReason} (Status: ${matchedApp.status})`
  };
}

export { getPortalSupportMatrix };

/**
 * Undoes an accidental "Mark as Submitted" action while preserving full status history.
 */
export function undoSubmittedApplication(jobId, reason = 'User undid submitted status') {
  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM applications WHERE job_id = ?').get(jobId);
  if (!existing) {
    throw new Error(`No application record found for job #${jobId}.`);
  }

  let history = [];
  try {
    history = existing.status_history_json ? JSON.parse(existing.status_history_json) : [];
  } catch {}

  history.push({
    from: existing.status,
    to: 'preparing',
    timestamp: new Date().toISOString(),
    notes: reason,
    userConfirmed: true
  });

  db.prepare(`
    UPDATE applications
    SET status = 'preparing',
        applied_date = NULL,
        user_approved = 0,
        status_history_json = ?,
        updated_at = datetime('now')
    WHERE job_id = ?
  `).run(JSON.stringify(history), jobId);

  db.prepare(`UPDATE jobs SET status = 'discovered', updated_at = datetime('now') WHERE id = ?`).run(jobId);
  return getApplicationByJobId(jobId);
}
