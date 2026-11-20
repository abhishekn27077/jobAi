import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDatabase } from '../src/db/schema.js';
import {
  getGoogleAuthUrl,
  GOOGLE_OAUTH_SCOPES,
  saveTokens,
  loadStoredTokens,
  disconnectAccount,
  getOAuthStatus
} from '../src/email/googleOAuthClient.js';
import {
  classifyAndExtractRecruiterEmail,
  classifyRecruiterEmail
} from '../src/email/recruiterEmailParser.js';
import {
  generateCommunicationDraft,
  saveDraftToVault,
  approveAndPublishDraft
} from '../src/email/communicationAssistant.js';
import {
  proposeCalendarEvent,
  checkSchedulingConflicts,
  approveAndCreateCalendarEvent,
  updateCalendarEvent,
  cancelCalendarEvent,
  getCalendarEvents
} from '../src/calendar/calendarService.js';
import {
  createFollowUpReminder,
  getReminders,
  updateReminderStatus,
  scheduleApplicationFollowUp
} from '../src/tracker/followUpManager.js';
import { syncRecruiterEmails } from '../src/email/emailSyncService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Google OAuth Client enforces minimum scopes and handles token lifecycle', async () => {
  // Test Scopes
  assert.strictEqual(GOOGLE_OAUTH_SCOPES.length, 4);
  assert.ok(GOOGLE_OAUTH_SCOPES.includes('https://www.googleapis.com/auth/gmail.readonly'));
  assert.ok(GOOGLE_OAUTH_SCOPES.includes('https://www.googleapis.com/auth/gmail.compose'));
  assert.ok(GOOGLE_OAUTH_SCOPES.includes('https://www.googleapis.com/auth/calendar.events'));
  assert.ok(GOOGLE_OAUTH_SCOPES.includes('https://www.googleapis.com/auth/calendar.readonly'));

  // Test Auth URL generation
  process.env.GMAIL_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
  process.env.GMAIL_CLIENT_SECRET = 'test-client-secret';
  const authUrl = getGoogleAuthUrl('http://localhost:3000/oauth2callback');
  assert.ok(authUrl.startsWith('https://accounts.google.com/o/oauth2/v2/auth'));
  assert.ok(authUrl.includes('client_id=test-client-id'));
  assert.ok(authUrl.includes('scope='));
  assert.ok(authUrl.includes('access_type=offline'));

  // Test Token storage and retrieval
  const dummyTokens = {
    access_token: 'dummy_access_token_123',
    refresh_token: 'dummy_refresh_token_456',
    token_type: 'Bearer',
    expires_in: 3600,
    expires_at: Date.now() + 3600000
  };
  saveTokens(dummyTokens);

  const loaded = loadStoredTokens();
  assert.strictEqual(loaded.access_token, 'dummy_access_token_123');

  const status = getOAuthStatus();
  assert.strictEqual(status.configured, true);
  assert.strictEqual(status.authenticated, true);
  assert.strictEqual(status.hasRefreshToken, true);

  // Test Disconnect and revocation
  const disconnectRes = await disconnectAccount();
  assert.strictEqual(disconnectRes.success, true);
  assert.strictEqual(loadStoredTokens(), null);
});

test('Recruiter Email Intelligence accurately classifies categories and extracts entities', () => {
  const knownJobs = [
    { id: 1, company: 'TrueID', title: 'Junior Java Developer' },
    { id: 2, company: 'Swiggy', title: 'Associate Software Engineer' }
  ];

  // 1. Interview Invitation with date/time, recruiter, and Google Meet
  const interviewEmail = {
    subject: 'Interview Invitation for Junior Java Developer at TrueID',
    body: `Hi Abhishek,

We were impressed by your profile and your NearVia project. We would like to invite you for a Technical Interview on Wednesday, 25th Nov 2026 at 2:00 PM IST.

Meeting Link: https://meet.google.com/abc-defg-hij

Best regards,
Priya Sharma
Talent Acquisition, TrueID
Phone: +91-9876543210`,
    from: 'Priya Sharma <priya.sharma@trueid.com>',
    date: '2026-11-20T10:00:00Z',
    knownJobs
  };

  const parsedInvite = classifyAndExtractRecruiterEmail(interviewEmail);
  assert.strictEqual(parsedInvite.category, 'INTERVIEW_INVITATION');
  assert.strictEqual(parsedInvite.urgency, 'HIGH');
  assert.strictEqual(parsedInvite.company, 'TrueID');
  assert.strictEqual(parsedInvite.role, 'Junior Java Developer');
  assert.strictEqual(parsedInvite.jobId, 1);
  assert.strictEqual(parsedInvite.recruiter.name, 'Priya Sharma');
  assert.strictEqual(parsedInvite.recruiter.email, 'priya.sharma@trueid.com');
  assert.strictEqual(parsedInvite.meetingLink, 'https://meet.google.com/abc-defg-hij');
  assert.ok(parsedInvite.interview);
  assert.strictEqual(parsedInvite.interview.hasConfirmedTime, true);
  assert.strictEqual(parsedInvite.interview.timezone, 'IST');

  // 2. Coding Assessment with deadline
  const assessmentEmail = {
    subject: 'Online Assessment: Software Engineer at Swiggy',
    body: `Hello Abhishek,

Thank you for your interest in Swiggy. Please complete the following HackerRank coding assessment within 48 hours.

Test Link: https://hackerrank.com/tests/sample-test-id
Deadline: Complete within 48 hours.

Regards,
Campus Hiring Team`,
    from: 'Swiggy Careers <careers@swiggy.com>',
    date: '2026-11-20T10:00:00Z',
    knownJobs
  };

  const parsedAssessment = classifyAndExtractRecruiterEmail(assessmentEmail);
  assert.strictEqual(parsedAssessment.category, 'ASSESSMENT');
  assert.strictEqual(parsedAssessment.assessment.platform, 'HackerRank');
  assert.ok(parsedAssessment.assessment.deadline);

  // 3. Job Offer
  const offerEmail = {
    subject: 'Offer of Employment: Junior Java Developer - TrueID',
    body: 'We are pleased to extend an offer of employment to you. Attached is your offer letter with compensation details.',
    from: 'hr@trueid.com',
    knownJobs
  };
  const parsedOffer = classifyAndExtractRecruiterEmail(offerEmail);
  assert.strictEqual(parsedOffer.category, 'OFFER');
  assert.strictEqual(parsedOffer.urgency, 'HIGH');

  // 4. Rejection
  const rejectionEmail = {
    subject: 'Application Status Update',
    body: 'Thank you for your time. Unfortunately, we are pursuing other candidates whose experience more closely matches our current needs.',
    from: 'no-reply@company.com',
    knownJobs
  };
  const parsedRejection = classifyAndExtractRecruiterEmail(rejectionEmail);
  assert.strictEqual(parsedRejection.category, 'REJECTION');
  assert.strictEqual(parsedRejection.urgency, 'LOW');

  // 5. Uncertain Email -> Manual Review
  const ambiguousEmail = {
    subject: 'Update regarding your note',
    body: 'We received your message. Let us coordinate internally.',
    from: 'someone@domain.com',
    knownJobs: []
  };
  const parsedAmbiguous = classifyAndExtractRecruiterEmail(ambiguousEmail);
  assert.strictEqual(parsedAmbiguous.requiresManualReview, true);
  assert.strictEqual(parsedAmbiguous.confidence, 'uncertain');
});

test('Incremental Email Synchronization prevents duplicates and links application tracking', async () => {
  const db = getDatabase();

  // Create clean test job
  db.prepare("DELETE FROM communications WHERE message_id LIKE 'test_synced_%'").run();
  db.prepare("DELETE FROM jobs WHERE company = 'Sync Test Corp'").run();

  const ins = db.prepare(`
    INSERT INTO jobs (title, company, location, url, source)
    VALUES ('Java Backend Engineer', 'Sync Test Corp', 'Bengaluru', 'https://synctest.com/job/1', 'direct')
  `).run();
  const testJobId = Number(ins.lastInsertRowid);

  // Synthetic email batch
  const syntheticEmails = [
    {
      id: 'test_synced_msg_001',
      threadId: 'thread_001',
      subject: 'Interview Invitation for Java Backend Engineer at Sync Test Corp',
      body: 'Hi Abhishek, we invite you to an interview on 28th Nov 2026 at 3:00 PM IST via https://meet.google.com/syn-ctes-tcr. Regards, HR Team',
      from: 'HR Sync Test <hr@synctest.com>',
      to: 'candidate@example.com',
      date: '2026-11-20T12:00:00Z'
    },
    {
      id: 'test_synced_msg_002',
      threadId: 'thread_002',
      subject: 'Coding Assessment: Sync Test Corp',
      body: 'Please complete the HackerRank challenge within 48 hours.',
      from: 'assessments@synctest.com',
      to: 'candidate@example.com',
      date: '2026-11-20T12:30:00Z'
    }
  ];

  // 1. Initial Sync Run
  const run1 = await syncRecruiterEmails({ mockMessages: syntheticEmails });
  assert.strictEqual(run1.success, true);
  assert.strictEqual(run1.messagesImported, 2);
  assert.strictEqual(run1.messagesSkippedDuplicate, 0);
  assert.strictEqual(run1.interviewsDetected, 1);
  assert.strictEqual(run1.assessmentsDetected, 1);

  // 2. Re-run Sync with same messages (Deduplication Check)
  const run2 = await syncRecruiterEmails({ mockMessages: syntheticEmails });
  assert.strictEqual(run2.success, true);
  assert.strictEqual(run2.messagesImported, 0, 'Must import 0 duplicate messages');
  assert.strictEqual(run2.messagesSkippedDuplicate, 2, 'Must skip all 2 duplicate messages');

  // Verify records in communications table
  const comms = db.prepare("SELECT * FROM communications WHERE message_id LIKE 'test_synced_%'").all();
  assert.strictEqual(comms.length, 2);
});

test('Communication Assistant generates grounded drafts and strictly enforces Approval Gate', async () => {
  const job = { id: 1, title: 'Junior Java Developer', company: 'TrueID' };

  // 1. Application Follow-Up Draft
  const followUpDraft = generateCommunicationDraft({
    draftType: 'application_follow_up',
    job,
    recruiterName: 'Priya Sharma'
  });
  assert.ok(followUpDraft.subject.includes('Follow-Up'));
  assert.ok(followUpDraft.body.includes('Abhishek N'));
  assert.ok(followUpDraft.body.includes('TrueID'));
  assert.ok(followUpDraft.body.includes('NearVia'));
  assert.ok(followUpDraft.safetyNotice.includes('DRAFT ONLY'));

  // 2. Thank You Message
  const thankYouDraft = generateCommunicationDraft({
    draftType: 'thank_you_message',
    job,
    recruiterName: 'Priya Sharma'
  });
  assert.ok(thankYouDraft.subject.includes('Thank You'));
  assert.ok(thankYouDraft.body.includes('Spring Boot'));

  // 3. Save draft to vault in 'pending_approval' state
  const saved = saveDraftToVault({
    jobId: job.id,
    recipient: 'priya.sharma@trueid.com',
    subject: followUpDraft.subject,
    body: followUpDraft.body,
    draftType: 'application_follow_up'
  });
  assert.strictEqual(saved.status, 'pending_approval');
  assert.ok(saved.draftId > 0);

  // 4. STRICT APPROVAL GATE: approveAndPublishDraft must reject without userConfirmedApproval
  await assert.rejects(
    async () => {
      await approveAndPublishDraft(saved.draftId, { userConfirmedApproval: false });
    },
    (err) => err.code === 'APPROVAL_REQUIRED',
    'Must throw APPROVAL_REQUIRED when confirmation is missing'
  );

  // 5. Successful approval with confirmed user action
  const approved = await approveAndPublishDraft(saved.draftId, { userConfirmedApproval: true });
  assert.strictEqual(approved.success, true);
  assert.strictEqual(approved.approvalStatus, 'approved_draft_created');
});

test('Google Calendar Integration detects conflicts, prevents duplicates, and enforces approval', async () => {
  const db = getDatabase();

  // Clean test calendar data
  db.prepare("DELETE FROM calendar_events WHERE title LIKE 'Test Cal:%'").run();

  const startTime1 = '2026-11-25T14:00:00.000Z';
  const endTime1 = '2026-11-25T14:45:00.000Z';

  // 1. Propose first event
  const prop1 = proposeCalendarEvent({
    jobId: 1,
    title: 'Test Cal: Interview Round 1',
    company: 'TechCorp',
    role: 'Java Developer',
    startTime: startTime1,
    endTime: endTime1,
    meetingLink: 'https://meet.google.com/test-1'
  });
  assert.strictEqual(prop1.status, 'proposed');
  assert.strictEqual(prop1.conflictDetected, false);

  // 2. Prevent Duplicates: Proposing identical event
  const dupProp = proposeCalendarEvent({
    jobId: 1,
    title: 'Test Cal: Interview Round 1',
    company: 'TechCorp',
    role: 'Java Developer',
    startTime: startTime1,
    endTime: endTime1
  });
  assert.strictEqual(dupProp.isDuplicate, true);
  assert.strictEqual(dupProp.eventId, prop1.eventId);

  // 3. Propose overlapping event -> Conflict Detection
  const startTimeOverlap = '2026-11-25T14:30:00.000Z'; // 30 mins in, overlaps with event 1
  const endTimeOverlap = '2026-11-25T15:15:00.000Z';

  const prop2 = proposeCalendarEvent({
    jobId: 2,
    title: 'Test Cal: Interview Round 2',
    company: 'OtherCorp',
    role: 'React Developer',
    startTime: startTimeOverlap,
    endTime: endTimeOverlap
  });
  assert.strictEqual(prop2.conflictDetected, true);
  assert.ok(prop2.conflictDetails.includes('Conflicts with'));

  // 4. STRICT APPROVAL GATE: approveAndCreateCalendarEvent rejects without userConfirmed
  await assert.rejects(
    async () => {
      await approveAndCreateCalendarEvent(prop1.eventId, { userConfirmed: false });
    },
    (err) => err.code === 'APPROVAL_REQUIRED'
  );

  // 5. Approve event with user confirmation
  const approved = await approveAndCreateCalendarEvent(prop1.eventId, { userConfirmed: true });
  assert.strictEqual(approved.status, 'approved_created');

  // 6. Update and Cancel Event
  const updated = await updateCalendarEvent(prop1.eventId, { title: 'Test Cal: Updated Title' }, { userConfirmed: true });
  assert.strictEqual(updated.success, true);

  const cancelled = await cancelCalendarEvent(prop1.eventId, { userConfirmed: true });
  assert.strictEqual(cancelled.status, 'cancelled');
});

test('Follow-Up Manager manages application lifecycle reminders and status progression', () => {
  const db = getDatabase();

  // Create follow up reminder
  const due = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const rem = createFollowUpReminder({
    jobId: 1,
    reminderType: 'application_follow_up',
    title: 'Test Reminder: Follow up with TrueID',
    dueDate: due,
    priority: 'medium',
    suggestedAction: 'Send polite follow-up draft'
  });
  assert.ok(rem.reminderId > 0);
  assert.strictEqual(rem.status, 'pending');

  // Retrieve reminders
  const reminders = getReminders({ status: 'pending' });
  const found = reminders.find(r => r.id === rem.reminderId);
  assert.ok(found);
  assert.strictEqual(found.title, 'Test Reminder: Follow up with TrueID');

  // Complete reminder
  const completed = updateReminderStatus(rem.reminderId, 'completed');
  assert.strictEqual(completed.status, 'completed');

  // Test Application Follow-up auto scheduler
  const autoFollowUp = scheduleApplicationFollowUp(1, { intervalDays: 10 });
  assert.ok(autoFollowUp);
  assert.strictEqual(autoFollowUp.status, 'pending');
});
