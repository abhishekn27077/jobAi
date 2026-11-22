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

      // Incremental Sync: when forceFull is false, fetch messages after the last sync timestamp
      let finalQuery = "subject:(interview OR application OR offer OR assessment OR test OR rejection OR 'hiring') -from:me";
      if (!forceFull) {
        const lastSync = db.prepare("SELECT created_at FROM email_sync_history WHERE status = 'success' ORDER BY id DESC LIMIT 1").get();
        if (lastSync && lastSync.created_at) {
          const afterEpochSec = Math.floor(new Date(lastSync.created_at).getTime() / 1000) - 86400; // 1-day safety margin
          if (afterEpochSec > 0) {
            finalQuery += ` after:${afterEpochSec}`;
          }
        }
      }

      // Paginate through messages using nextPageToken (up to 5 pages / 150 messages max for safety)
      let pageToken = null;
      const messageIds = [];
      let pageCount = 0;
      const maxPages = 5;

      do {
        let listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(finalQuery)}&maxResults=30`;
        if (pageToken) {
          listUrl += `&pageToken=${encodeURIComponent(pageToken)}`;
        }

        const listResp = await fetch(listUrl, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (listResp.status === 401 || listResp.status === 403) {
          return {
            success: false,
            error: `Gmail authorization error (HTTP ${listResp.status}). Re-authentication required.`,
            requiresAuth: true
          };
        }

        if (!listResp.ok) {
          throw new Error(`Gmail API messages list failed: ${listResp.status} ${await listResp.text()}`);
        }

        const listData = await listResp.json();
        const batchIds = (listData.messages || []).map(m => m.id).filter(Boolean);
        messageIds.push(...batchIds);

        pageToken = listData.nextPageToken || null;
        pageCount++;
      } while (pageToken && pageCount < maxPages && messageIds.length < 150);

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
        } catch (fetchErr) {
          console.warn(`[Gmail Sync Warning] Failed to fetch message #${id}: ${fetchErr.message}`);
        }
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
 * Recursively extracts plain text or HTML body from Gmail MIME payload.
 * Handles single-part payloads, base64url decoding, and nested multipart parts.
 */
export function extractMimeBody(payload) {
  if (!payload) return '';

  // 1. Direct body data on single-part payload (e.g. text/plain or text/html)
  if (payload.body?.data && (!payload.parts || payload.parts.length === 0)) {
    try {
      return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
    } catch {
      try {
        return Buffer.from(payload.body.data, 'base64').toString('utf-8');
      } catch {}
    }
  }

  // 2. Multipart recursive traversal (prefer text/plain, fallback to text/html)
  let textPlain = '';
  let textHtml = '';

  function walkParts(parts = []) {
    for (const part of parts) {
      if (part.mimeType === 'text/plain' && part.body?.data && !textPlain) {
        try {
          textPlain = Buffer.from(part.body.data, 'base64url').toString('utf-8');
        } catch {
          try {
            textPlain = Buffer.from(part.body.data, 'base64').toString('utf-8');
          } catch {}
        }
      } else if (part.mimeType === 'text/html' && part.body?.data && !textHtml) {
        try {
          textHtml = Buffer.from(part.body.data, 'base64url').toString('utf-8');
        } catch {
          try {
            textHtml = Buffer.from(part.body.data, 'base64').toString('utf-8');
          } catch {}
        }
      }
      if (part.parts && Array.isArray(part.parts)) {
        walkParts(part.parts);
      }
    }
  }

  if (payload.parts && Array.isArray(payload.parts)) {
    walkParts(payload.parts);
  }

  if (textPlain) return textPlain;
  if (textHtml) {
    return textHtml
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return '';
}

/**
 * Parses raw Gmail REST API payload into standard internal format.
 */
export function parseRawGmailMessage(msgData) {
  if (!msgData) return null;
  const headers = msgData.payload?.headers || [];
  const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  const subject = getHeader('Subject');
  const from = getHeader('From');
  const to = getHeader('To');

  // Defensive RFC 2822 date parsing
  let date = null;
  const rawDate = getHeader('Date');
  if (rawDate) {
    const parsed = new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) {
      date = parsed.toISOString();
    }
  }
  if (!date && msgData.internalDate) {
    const parsed = new Date(Number(msgData.internalDate));
    if (!Number.isNaN(parsed.getTime())) {
      date = parsed.toISOString();
    }
  }

  const body = extractMimeBody(msgData.payload) || msgData.snippet || '';

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
