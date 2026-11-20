/**
 * CareerOS — Google Calendar Integration & Interview Scheduling Service
 * Detects interview schedules, resolves conflicts, and manages calendar events
 * with strict human approval gates.
 */

import { getDatabase } from '../db/schema.js';
import { getValidAccessToken, isGoogleAuthenticated } from '../email/googleOAuthClient.js';
import { createFollowUpReminder } from '../tracker/followUpManager.js';

/**
 * Checks for overlapping calendar events in the given time window.
 */
export function checkSchedulingConflicts(startTime, endTime, excludeEventId = null) {
  const db = getDatabase();
  const newStart = new Date(startTime).toISOString();
  const newEnd = new Date(endTime).toISOString();

  let query = `
    SELECT id, title, company, role, start_time, end_time, meeting_link, status
    FROM calendar_events
    WHERE status != 'cancelled'
      AND start_time < ?
      AND end_time > ?
  `;
  const params = [newEnd, newStart];

  if (excludeEventId) {
    query += ' AND id != ?';
    params.push(excludeEventId);
  }

  const conflicting = db.prepare(query).all(...params);

  return {
    hasConflict: conflicting.length > 0,
    conflicts: conflicting,
    summary: conflicting.length > 0
      ? `Conflicts with ${conflicting.map(c => `"${c.title}" (${new Date(c.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(c.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`).join(', ')}`
      : null
  };
}

/**
 * Proposes a new calendar event (status: 'proposed') without silently adding it.
 */
export function proposeCalendarEvent({
  jobId = null,
  communicationId = null,
  title,
  company = '',
  role = '',
  recruiterName = '',
  recruiterEmail = '',
  startTime,
  endTime,
  timezone = 'Asia/Kolkata',
  meetingLink = '',
  location = '',
  description = ''
}) {
  const db = getDatabase();

  const startIso = new Date(startTime).toISOString();
  const endIso = endTime ? new Date(endTime).toISOString() : new Date(new Date(startTime).getTime() + 45 * 60 * 1000).toISOString();

  // 1. Prevent duplicate calendar events
  const existing = db.prepare(`
    SELECT * FROM calendar_events 
    WHERE (job_id = ? AND start_time = ? AND status != 'cancelled')
       OR (communication_id IS NOT NULL AND communication_id = ?)
  `).get(jobId, startIso, communicationId);

  if (existing) {
    return {
      eventId: existing.id,
      isDuplicate: true,
      event: existing,
      status: existing.status
    };
  }

  // 2. Conflict detection
  const conflictCheck = checkSchedulingConflicts(startIso, endIso);

  const eventTitle = title || `Interview: ${role || 'Software Engineer'} at ${company || 'Company'}`;
  const eventDesc = description || `Technical interview for ${role} with ${company}.\nRecruiter: ${recruiterName} (${recruiterEmail})\nMeeting: ${meetingLink || 'Link to be provided'}`;

  const res = db.prepare(`
    INSERT INTO calendar_events (
      job_id, communication_id, title, company, role, recruiter_name, recruiter_email,
      start_time, end_time, timezone, meeting_link, location, description,
      status, conflict_detected, conflict_details, user_approved
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, 0)
  `).run(
    jobId,
    communicationId,
    eventTitle,
    company,
    role,
    recruiterName,
    recruiterEmail,
    startIso,
    endIso,
    timezone,
    meetingLink,
    location || meetingLink,
    eventDesc,
    conflictCheck.hasConflict ? 1 : 0,
    conflictCheck.summary
  );

  const eventId = Number(res.lastInsertRowid);

  // 3. Automatically schedule an interview preparation reminder
  try {
    const prepDueDate = new Date(new Date(startIso).getTime() - 24 * 3600 * 1000).toISOString();
    createFollowUpReminder({
      jobId,
      communicationId,
      reminderType: 'interview_prep',
      title: `Prep for Interview: ${role} at ${company}`,
      dueDate: prepDueDate,
      priority: 'high',
      notes: `Review NearVia, Spring Boot, and company JD before interview on ${new Date(startIso).toLocaleDateString()}. Meeting link: ${meetingLink || 'N/A'}`
    });
  } catch {}

  db.prepare(`
    INSERT INTO activity_audit_log (action, details)
    VALUES (?, ?)
  `).run(
    'CALENDAR_EVENT_PROPOSED',
    `Proposed calendar event #${eventId}: "${eventTitle}" for ${startIso}. Conflict: ${conflictCheck.hasConflict ? 'YES' : 'NO'}`
  );

  return {
    eventId,
    isDuplicate: false,
    status: 'proposed',
    conflictDetected: conflictCheck.hasConflict,
    conflictDetails: conflictCheck.summary
  };
}

/**
 * STRICT HUMAN APPROVAL GATE:
 * Approves a proposed calendar event and creates it in Google Calendar if connected.
 */
export async function approveAndCreateCalendarEvent(eventId, { userConfirmed = false } = {}) {
  if (!userConfirmed) {
    const err = new Error('Human Approval Gate: Explicit user confirmation is required to create or approve calendar events.');
    err.code = 'APPROVAL_REQUIRED';
    throw err;
  }

  const db = getDatabase();
  const event = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(eventId);

  if (!event) {
    throw new Error(`Calendar event #${eventId} not found.`);
  }

  let externalEventId = event.external_event_id || null;
  const isAuth = isGoogleAuthenticated();

  if (isAuth && !externalEventId) {
    try {
      const accessToken = await getValidAccessToken();
      if (accessToken) {
        const resp = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            summary: event.title,
            description: event.description,
            start: { dateTime: event.start_time, timeZone: event.timezone || 'Asia/Kolkata' },
            end: { dateTime: event.end_time, timeZone: event.timezone || 'Asia/Kolkata' },
            location: event.meeting_link || event.location || ''
          })
        });

        if (resp.ok) {
          const created = await resp.json();
          externalEventId = created.id;
        } else {
          console.warn(`[Google Calendar Notice] API responded with ${resp.status}`);
        }
      }
    } catch (err) {
      console.warn(`[Google Calendar Notice] Live creation fallback: ${err.message}`);
    }
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE calendar_events
    SET status = 'approved_created', user_approved = 1, external_event_id = COALESCE(?, external_event_id), updated_at = ?
    WHERE id = ?
  `).run(externalEventId, now, eventId);

  // Sync with interviews table in SQLite
  if (event.job_id) {
    try {
      db.prepare(`
        INSERT INTO interviews (job_id, round_name, scheduled_at, confirmed_by_user, meeting_link, status, prep_notes)
        VALUES (?, ?, ?, 1, ?, 'scheduled', ?)
      `).run(
        event.job_id,
        event.title,
        event.start_time,
        event.meeting_link,
        event.description
      );
    } catch {}
  }

  db.prepare(`
    INSERT INTO activity_audit_log (action, details)
    VALUES (?, ?)
  `).run(
    'CALENDAR_EVENT_APPROVED',
    `Approved and scheduled event #${eventId} ("${event.title}"). Google Event ID: ${externalEventId || 'offline_scheduled'}`
  );

  return {
    success: true,
    eventId,
    status: 'approved_created',
    externalEventId
  };
}

/**
 * Updates a calendar event with confirmation.
 */
export async function updateCalendarEvent(eventId, updates = {}, { userConfirmed = false } = {}) {
  if (!userConfirmed) {
    const err = new Error('Human Approval Gate: Explicit confirmation is required to update calendar events.');
    err.code = 'APPROVAL_REQUIRED';
    throw err;
  }

  const db = getDatabase();
  const event = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(eventId);

  if (!event) {
    throw new Error(`Calendar event #${eventId} not found.`);
  }

  const newStart = updates.startTime ? new Date(updates.startTime).toISOString() : event.start_time;
  const newEnd = updates.endTime ? new Date(updates.endTime).toISOString() : event.end_time;
  const newTitle = updates.title || event.title;
  const newLink = updates.meetingLink || event.meeting_link;

  const conflictCheck = checkSchedulingConflicts(newStart, newEnd, eventId);

  db.prepare(`
    UPDATE calendar_events
    SET title = ?, start_time = ?, end_time = ?, meeting_link = ?,
        conflict_detected = ?, conflict_details = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    newTitle,
    newStart,
    newEnd,
    newLink,
    conflictCheck.hasConflict ? 1 : 0,
    conflictCheck.summary,
    eventId
  );

  return {
    success: true,
    eventId,
    conflictDetected: conflictCheck.hasConflict,
    conflictDetails: conflictCheck.summary
  };
}

/**
 * Cancels a calendar event with confirmation.
 */
export async function cancelCalendarEvent(eventId, { userConfirmed = false } = {}) {
  if (!userConfirmed) {
    const err = new Error('Human Approval Gate: Explicit confirmation is required to cancel calendar events.');
    err.code = 'APPROVAL_REQUIRED';
    throw err;
  }

  const db = getDatabase();
  const event = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(eventId);

  if (!event) {
    throw new Error(`Calendar event #${eventId} not found.`);
  }

  db.prepare(`
    UPDATE calendar_events
    SET status = 'cancelled', updated_at = datetime('now')
    WHERE id = ?
  `).run(eventId);

  db.prepare(`
    INSERT INTO activity_audit_log (action, details)
    VALUES (?, ?)
  `).run(
    'CALENDAR_EVENT_CANCELLED',
    `Cancelled calendar event #${eventId} ("${event.title}")`
  );

  return {
    success: true,
    eventId,
    status: 'cancelled'
  };
}

/**
 * Retrieves calendar events with optional status or upcoming filter.
 */
export function getCalendarEvents({ status = null, limit = 50, upcomingOnly = false } = {}) {
  const db = getDatabase();

  let query = `
    SELECT 
      c.id, c.job_id, c.communication_id, c.external_event_id, c.title,
      c.company, c.role, c.recruiter_name, c.recruiter_email,
      c.start_time, c.end_time, c.timezone, c.meeting_link, c.location,
      c.description, c.status, c.conflict_detected, c.conflict_details,
      c.user_approved, c.created_at, c.updated_at,
      j.title as job_title, j.company as job_company
    FROM calendar_events c
    LEFT JOIN jobs j ON c.job_id = j.id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    query += ' AND c.status = ?';
    params.push(status);
  }

  if (upcomingOnly) {
    query += " AND c.end_time >= datetime('now')";
  }

  query += ' ORDER BY c.start_time ASC LIMIT ?';
  params.push(limit);

  return db.prepare(query).all(...params);
}
