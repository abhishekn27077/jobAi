/**
 * CareerOS — Email Synchronization Service
 * Handles incremental Gmail synchronization, deduplication, recruiter extraction,
 * and automated application tracker & calendar integration.
 */

import { getDatabase } from '../db/schema.js';
import { getValidAccessToken, isGoogleAuthenticated } from './googleOAuthClient.js';
import { classifyAndExtractRecruiterEmail } from './recruiterEmailParser.js';
import { proposeCalendarEvent } from '../calendar/calendarService.js';
import { createFollowUpReminder } from '../tracker/followUpManager.js';
import { updateApplicationStatus } from '../tracker/applicationTracker.js';

/**
 * Synchronizes incoming recruiter emails from Gmail incrementally.
 * Can accept mockMessages for automated offline testing.
 */
export async function syncRecruiterEmails({ mockMessages = null, forceFull = false } = {}) {
  const db = getDatabase();
  const startTime = Date.now();

  let messagesFound = 0;
  let messagesImported = 0;
  let messagesSkippedDuplicate = 0;
  let interviewsDetected = 0;
  let assessmentsDetected = 0;
  let errorMessage = null;

  try {
    let rawMessages = [];

    if (mockMessages && Array.isArray(mockMessages)) {
      rawMessages = mockMessages;
      messagesFound = rawMessages.length;
    } else {
      // Live Gmail API sync
      if (!isGoogleAuthenticated()) {
        return {
          success: false,
          error: 'Google account not authenticated. Please connect your account in Settings.',
          requiresAuth: true
        };
      }

      const accessToken = await getValidAccessToken();
      if (!accessToken) {
        return {
          success: false,
          error: 'Access token expired or unavailable. Re-authentication required.',
          requiresAuth: true
        };
      }

      // Query Gmail messages targeting recruiter communications
      const query = "subject:(interview OR application OR offer OR assessment OR test OR rejection OR 'hiring') -from:me";
      const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=30`;

      const listResp = await fetch(listUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (!listResp.ok) {
        throw new Error(`Gmail API messages list failed: ${listResp.status} ${await listResp.text()}`);
      }

      const listData = await listResp.json();
      const messageIds = (listData.messages || []).map(m => m.id);
      messagesFound = messageIds.length;

      // Fetch message details
      for (const id of messageIds) {
        try {
          const msgResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });
          if (msgResp.ok) {
            const msgData = await msgResp.json();
            rawMessages.push(parseRawGmailMessage(msgData));
          }
        } catch {}
      }
    }

    // Process and ingest each message
    const knownJobs = db.prepare('SELECT id, company, title FROM jobs ORDER BY id DESC').all();

    for (const msg of rawMessages) {
      const messageId = msg.messageId || msg.id;

      // 1. Deduplication check
      const existing = db.prepare('SELECT id FROM communications WHERE message_id = ?').get(messageId);
      if (existing) {
        messagesSkippedDuplicate++;
        continue;
      }

      // 2. Classify and extract metadata
      const extraction = classifyAndExtractRecruiterEmail({
        subject: msg.subject,
        body: msg.body,
        from: msg.from,
        date: msg.date,
        knownJobs
      });

      // 3. Persist incoming communication
      const insertRes = db.prepare(`
        INSERT INTO communications (
          job_id, message_id, thread_id, sender, recipient, subject, body,
          direction, category, urgency, extracted_data_json, confidence,
          requires_manual_review, received_at, approval_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'incoming', ?, ?, ?, ?, ?, ?, 'received', datetime('now'), datetime('now'))
      `).run(
        extraction.jobId || null,
        messageId,
        msg.threadId || null,
        msg.from || 'Recruiter',
        msg.to || 'Candidate',
        msg.subject,
        msg.body,
        extraction.category,
        extraction.urgency,
        JSON.stringify(extraction),
        extraction.confidence,
        extraction.requiresManualReview ? 1 : 0,
        extraction.originalDate
      );

      const commId = Number(insertRes.lastInsertRowid);
      messagesImported++;

      // 4. Automated Workflow Actions
      if (extraction.category === 'INTERVIEW_INVITATION') {
        interviewsDetected++;

        // If specific interview date/time found, propose calendar event
        if (extraction.interview && extraction.interview.hasConfirmedTime) {
          try {
            proposeCalendarEvent({
              jobId: extraction.jobId,
              communicationId: commId,
              title: `Technical Interview: ${extraction.role || 'Software Engineer'} at ${extraction.company || 'Company'}`,
              company: extraction.company,
              role: extraction.role,
              recruiterName: extraction.recruiter?.name,
              recruiterEmail: extraction.recruiter?.email,
              startTime: extraction.interview.startTime,
              endTime: extraction.interview.endTime,
              timezone: extraction.interview.timezone,
              meetingLink: extraction.meetingLink
            });
          } catch (e) {
            console.warn(`[Calendar Proposal Notice] ${e.message}`);
          }
        }

        // Update application tracker status to 'interview'
        if (extraction.jobId) {
          try {
            updateApplicationStatus(extraction.jobId, 'interview', {
              notes: `Interview invitation received from ${extraction.company} (${msg.subject})`,
              userConfirmed: true
            });
          } catch {}
        }
      } else if (extraction.category === 'ASSESSMENT') {
        assessmentsDetected++;

        // Schedule assessment deadline reminder
        if (extraction.assessment && extraction.assessment.deadline) {
          try {
            createFollowUpReminder({
              jobId: extraction.jobId,
              communicationId: commId,
              reminderType: 'assessment_deadline',
              title: `Assessment Deadline: ${extraction.assessment.platform} for ${extraction.company || 'Company'}`,
              dueDate: extraction.assessment.deadline,
              priority: 'high',
              notes: `Complete ${extraction.assessment.platform} assessment for ${extraction.role || 'Role'} at ${extraction.company}.`,
              suggestedAction: 'Take assessment in focused environment'
            });
          } catch {}
        }

        // Update application status to 'assessment'
        if (extraction.jobId) {
          try {
            updateApplicationStatus(extraction.jobId, 'assessment', {
              notes: `Technical assessment assigned: ${extraction.assessment?.platform || 'Online test'}`,
              userConfirmed: true
            });
          } catch {}
        }
      } else if (extraction.category === 'REJECTION' && extraction.jobId) {
        try {
          updateApplicationStatus(extraction.jobId, 'rejected', {
            notes: `Application not moving forward at ${extraction.company}`,
            userConfirmed: true
          });
        } catch {}
      } else if (extraction.category === 'OFFER' && extraction.jobId) {
        try {
          updateApplicationStatus(extraction.jobId, 'offer', {
            notes: `Offer extended by ${extraction.company}`,
            userConfirmed: true
          });
        } catch {}
      }
    }
  } catch (err) {
    errorMessage = err.message;
  }

  // 5. Record telemetry in email_sync_history
  const durationMs = Date.now() - startTime;
  db.prepare(`
    INSERT INTO email_sync_history (
      messages_found, messages_imported, messages_skipped_duplicate,
      interviews_detected, assessments_detected, status, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    messagesFound,
    messagesImported,
    messagesSkippedDuplicate,
    interviewsDetected,
    assessmentsDetected,
    errorMessage ? 'error' : 'success',
    errorMessage
  );

  return {
    success: !errorMessage,
    durationMs,
    messagesFound,
    messagesImported,
    messagesSkippedDuplicate,
    interviewsDetected,
    assessmentsDetected,
    error: errorMessage
  };
}

/**
 * Parses raw Gmail REST API payload into standard internal format.
 */
function parseRawGmailMessage(msgData) {
  const headers = msgData.payload?.headers || [];
  const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  const subject = getHeader('Subject');
  const from = getHeader('From');
  const to = getHeader('To');
  const date = getHeader('Date') ? new Date(getHeader('Date')).toISOString() : new Date().toISOString();

  // Extract body snippet or text
  let body = msgData.snippet || '';
  if (msgData.payload?.parts) {
    for (const part of msgData.payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        try {
          body = Buffer.from(part.body.data, 'base64').toString('utf-8');
          break;
        } catch {}
      }
    }
  }

  return {
    messageId: msgData.id,
    threadId: msgData.threadId,
    subject,
    from,
    to,
    date,
    body
  };
}
