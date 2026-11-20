/**
 * CareerOS — Application Tracker Manager
 * Manages application lifecycle states, status progression, notes,
 * and user-confirmed submissions with complete audit history.
 */

import { getDatabase } from '../db/schema.js';
import { getPortalSupportMatrix } from '../automation/portalAdapters/portalRegistry.js';

export const VALID_APPLICATION_STATUSES = [
  'interested',
  'preparing',
  'ready_for_review',
  'submitted',
  'assessment',
  'interview',
  'rejected',
  'offer',
  'withdrawn'
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

  // Strict Rule: Never mark application as submitted without confirmed user action
  if (newStatus === 'submitted' && !userConfirmed) {
    throw new Error('Approval Gate Violation: An application cannot be marked as "submitted" without explicit user confirmation of submission.');
  }

  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM applications WHERE job_id = ?').get(jobId);
  if (!existing) {
    throw new Error(`No application record found for job #${jobId}.`);
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
    'submitted': 'applied',
    'assessment': 'applied',
    'interview': 'interviewing',
    'rejected': 'rejected',
    'offer': 'offer',
    'withdrawn': 'dismissed'
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

export { getPortalSupportMatrix };
