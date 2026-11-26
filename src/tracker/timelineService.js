/**
 * CareerOS — Unified Application Timeline Service (Phase 15)
 * Combines explicit timeline events with historical job, application, resume,
 * agent task, recruiter, outreach, communication, and interview records.
 */

import { getDatabase } from '../db/schema.js';

export const TIMELINE_EVENT_TYPES = [
  'job_discovered',
  'job_saved',
  'agent_task_created',
  'resume_generated',
  'application_prepared',
  'application_submitted',
  'recruiter_identified',
  'outreach_draft_created',
  'email_sent_verified',
  'reply_received',
  'interview_scheduled',
  'interview_completed',
  'follow_up',
  'rejection',
  'offer'
];

/**
 * Records a persisted timeline event for a job/application.
 */
export function recordTimelineEvent({
  jobId,
  applicationId = null,
  contactId = null,
  taskId = null,
  threadId = null,
  eventType,
  title,
  details = '',
  metadata = {},
  occurredAt = null
}) {
  if (!jobId) throw new Error('jobId is required to record a timeline event.');
  if (!eventType || !title) throw new Error('eventType and title are required.');

  const db = getDatabase();
  const ts = occurredAt || new Date().toISOString();
  const res = db.prepare(`
    INSERT INTO application_timeline_events (
      job_id, application_id, contact_id, task_id, thread_id,
      event_type, title, details, metadata_json, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    jobId,
    applicationId,
    contactId,
    taskId,
    threadId,
    eventType,
    title,
    details,
    JSON.stringify(metadata || {}),
    ts
  );

  return db.prepare('SELECT * FROM application_timeline_events WHERE id = ?').get(res.lastInsertRowid);
}

function safeParseJson(str, fallback = {}) {
  try {
    return str ? JSON.parse(str) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Builds one unified chronological timeline for a job by merging
 * explicit timeline events with existing persisted records.
 */
export function getUnifiedTimeline(jobId) {
  const db = getDatabase();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`Job #${jobId} not found.`);

  const events = [];

  // 1. Explicit persisted timeline events
  const explicit = db.prepare(`
    SELECT * FROM application_timeline_events WHERE job_id = ? ORDER BY occurred_at ASC, id ASC
  `).all(jobId);
  for (const e of explicit) {
    events.push({
      id: `tl_${e.id}`,
      eventType: e.event_type,
      title: e.title,
      details: e.details || '',
      occurredAt: e.occurred_at,
      jobId: e.job_id,
      applicationId: e.application_id,
      contactId: e.contact_id,
      taskId: e.task_id,
      threadId: e.thread_id,
      metadata: safeParseJson(e.metadata_json, {})
    });
  }

  const hasType = (type) => events.some(ev => ev.eventType === type);

  // 2. Job discovered / saved
  if (!hasType('job_discovered') && job.created_at) {
    events.push({
      id: `job_disc_${job.id}`,
      eventType: 'job_discovered',
      title: `Job discovered from ${job.source}`,
      details: `${job.title} @ ${job.company}`,
      occurredAt: job.created_at,
      jobId: job.id
    });
  }
  if (!hasType('job_saved') && job.status === 'saved') {
    events.push({
      id: `job_saved_${job.id}`,
      eventType: 'job_saved',
      title: 'Job saved to workspace',
      details: `${job.title} @ ${job.company}`,
      occurredAt: job.updated_at || job.created_at,
      jobId: job.id
    });
  }

  // 3. Resume versions
  const resumes = db.prepare('SELECT * FROM resume_versions WHERE job_id = ? ORDER BY created_at ASC').all(jobId);
  for (const r of resumes) {
    events.push({
      id: `res_${r.id}`,
      eventType: 'resume_generated',
      title: `Tailored resume v${r.version_number} generated (ATS ${Math.round(r.ats_score)}/100)`,
      details: r.pdf_path || r.template,
      occurredAt: r.created_at,
      jobId: job.id,
      metadata: { resumeVersionId: r.id, pdfPath: r.pdf_path, approved: Boolean(r.is_approved) }
    });
  }

  // 4. Applications
  const app = db.prepare('SELECT * FROM applications WHERE job_id = ?').get(jobId);
  if (app) {
    if (!hasType('application_prepared')) {
      events.push({
        id: `app_prep_${app.id}`,
        eventType: 'application_prepared',
        title: `Application prepared (${app.portal_type || 'portal'})`,
        details: `Status: ${app.status}`,
        occurredAt: app.created_at,
        jobId: job.id,
        applicationId: app.id
      });
    }
    if (app.status === 'submitted' && app.applied_date && !hasType('application_submitted')) {
      events.push({
        id: `app_sub_${app.id}`,
        eventType: 'application_submitted',
        title: 'Application manually submitted & confirmed',
        details: app.confirmation_number ? `Confirmation: ${app.confirmation_number}` : 'Confirmed by user',
        occurredAt: app.applied_date,
        jobId: job.id,
        applicationId: app.id
      });
    }
  }

  // 5. Communications
  const comms = db.prepare('SELECT * FROM communications WHERE job_id = ? ORDER BY created_at ASC').all(jobId);
  for (const c of comms) {
    let evType = c.direction === 'outbound' ? 'email_sent_verified' : 'reply_received';
    if (c.category === 'REJECTION') evType = 'rejection';
    else if (c.category === 'OFFER') evType = 'offer';
    else if (c.category === 'INTERVIEW_INVITATION') evType = 'interview_scheduled';

    events.push({
      id: `comm_${c.id}`,
      eventType: evType,
      title: c.subject || `Email (${c.category || c.direction})`,
      details: `${c.sender || ''} -> ${c.recipient || ''}`,
      occurredAt: c.received_at || c.created_at,
      jobId: job.id,
      threadId: c.thread_id || null
    });
  }

  // 6. Interviews
  const interviews = db.prepare('SELECT * FROM interviews WHERE job_id = ? ORDER BY created_at ASC').all(jobId);
  for (const iv of interviews) {
    events.push({
      id: `iv_${iv.id}`,
      eventType: iv.status === 'completed' ? 'interview_completed' : 'interview_scheduled',
      title: `Interview: ${iv.round_name || iv.stage}`,
      details: iv.scheduled_at ? `Scheduled: ${iv.scheduled_at}` : iv.status,
      occurredAt: iv.scheduled_at || iv.created_at,
      jobId: job.id
    });
  }

  events.sort((a, b) => String(a.occurredAt || '').localeCompare(String(b.occurredAt || '')));
  return { jobId, company: job.company, title: job.title, events };
}
