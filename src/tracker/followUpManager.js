/**
 * CareerOS — Follow-Up & Reminder Intelligence Manager
 * Connects follow-up reminders to application lifecycles, interview schedules,
 * and assessment deadlines with configurable reminder intervals.
 */

import { getDatabase } from '../db/schema.js';

export const REMINDER_TYPES = [
  'application_follow_up',
  'assessment_deadline',
  'interview_prep',
  'recruiter_response',
  'post_interview_thank_you'
];

/**
 * Creates or updates a follow-up reminder.
 */
export function createFollowUpReminder({
  jobId = null,
  applicationId = null,
  communicationId = null,
  reminderType = 'application_follow_up',
  title,
  dueDate,
  priority = 'medium',
  notes = '',
  suggestedAction = ''
}) {
  const db = getDatabase();
  const dueIso = new Date(dueDate).toISOString();

  // Deduplicate reminders: avoid creating the same reminder for the same application/job & type
  const existing = db.prepare(`
    SELECT id, status FROM follow_up_reminders
    WHERE (job_id = ? AND reminder_type = ? AND status = 'pending')
       OR (communication_id IS NOT NULL AND communication_id = ? AND reminder_type = ? AND status = 'pending')
  `).get(jobId, reminderType, communicationId, reminderType);

  if (existing) {
    db.prepare(`
      UPDATE follow_up_reminders
      SET due_date = ?, title = ?, notes = ?, suggested_action = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(dueIso, title, notes, suggestedAction, existing.id);

    return {
      reminderId: existing.id,
      status: 'pending',
      updated: true
    };
  }

  const res = db.prepare(`
    INSERT INTO follow_up_reminders (
      job_id, application_id, communication_id, reminder_type,
      title, due_date, status, priority, notes, suggested_action,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    jobId,
    applicationId,
    communicationId,
    reminderType,
    title,
    dueIso,
    priority,
    notes,
    suggestedAction
  );

  const reminderId = Number(res.lastInsertRowid);

  db.prepare(`
    INSERT INTO activity_audit_log (action, details)
    VALUES (?, ?)
  `).run(
    'REMINDER_CREATED',
    `Created follow-up reminder #${reminderId} (${reminderType}): "${title}". Due: ${dueIso}`
  );

  return {
    reminderId,
    status: 'pending',
    created: true
  };
}

/**
 * Retrieves follow-up reminders with optional status and priority filters.
 */
export function getReminders({ status = 'pending', limit = 50, offset = 0 } = {}) {
  const db = getDatabase();

  let query = `
    SELECT 
      r.id, r.job_id, r.application_id, r.communication_id, r.reminder_type,
      r.title, r.due_date, r.status, r.priority, r.notes, r.suggested_action,
      r.created_at, r.updated_at,
      j.title as job_title, j.company as job_company
    FROM follow_up_reminders r
    LEFT JOIN jobs j ON r.job_id = j.id
    WHERE 1=1
  `;
  const params = [];

  if (status && status !== 'all') {
    query += ' AND r.status = ?';
    params.push(status);
  }

  query += ' ORDER BY r.due_date ASC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(...params);
}

/**
 * Updates a reminder's status ('completed', 'dismissed', 'cancelled').
 */
export function updateReminderStatus(reminderId, newStatus) {
  const db = getDatabase();

  const existing = db.prepare('SELECT * FROM follow_up_reminders WHERE id = ?').get(reminderId);
  if (!existing) {
    throw new Error(`Reminder with ID #${reminderId} not found.`);
  }

  db.prepare(`
    UPDATE follow_up_reminders
    SET status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newStatus, reminderId);

  db.prepare(`
    INSERT INTO activity_audit_log (action, details)
    VALUES (?, ?)
  `).run(
    'REMINDER_STATUS_UPDATED',
    `Reminder #${reminderId} moved from ${existing.status} to ${newStatus}`
  );

  return {
    success: true,
    reminderId,
    status: newStatus
  };
}

/**
 * Automatically configures follow-up reminders when an application is submitted.
 * Uses a default 7-day interval (configurable via intervalDays).
 */
export function scheduleApplicationFollowUp(jobId, { intervalDays = 7 } = {}) {
  const db = getDatabase();
  const job = db.prepare('SELECT title, company FROM jobs WHERE id = ?').get(jobId);
  if (!job) return null;

  const due = new Date(Date.now() + intervalDays * 24 * 3600 * 1000).toISOString();

  return createFollowUpReminder({
    jobId,
    reminderType: 'application_follow_up',
    title: `Follow Up: ${job.title} at ${job.company}`,
    dueDate: due,
    priority: 'medium',
    notes: `Application was submitted. If no response received after ${intervalDays} days, consider sending a polite follow-up inquiry referencing your NearVia capstone project.`,
    suggestedAction: 'Send application follow-up draft via Communication Hub'
  });
}
