/**
 * CareerOS — Communication Assistant & Draft Generator
 * Generates editable, evidence-grounded drafts for all recruiter communication archetypes.
 * Enforces mandatory Human Approval Gate before any outbound action.
 */

import { loadCandidateProfile } from '../profile/profileManager.js';
import { getDatabase } from '../db/schema.js';
import { createGmailDraft, isGoogleAuthenticated } from './googleOAuthClient.js';

export function generateCommunicationDraft({
  draftType = 'recruiter_reply',
  job = null,
  recruiterName = 'Hiring Team',
  recruiterEmail = '',
  proposedSlots = [],
  assessmentDetails = null,
  interviewDetails = null,
  customContext = ''
}) {
  const profile = loadCandidateProfile();
  const p = profile.personal;
  const company = job ? job.company : 'your team';
  const role = job ? job.title : 'Software Engineer';

  let subject = `Re: Application for ${role} - ${p.fullName}`;
  let body = '';

  switch (draftType) {
    case 'application_follow_up':
      subject = `Follow-Up: Application for ${role} — ${p.fullName}`;
      body = `Dear ${recruiterName},

I hope this email finds you well.

I am writing to respectfully follow up on my recent application for the ${role} position at ${company}. Having recently completed my Master of Computer Applications (MCA) from AIMS Institutes, Bangalore, alongside advanced Java Full Stack training at Anudip Foundation, I remain very enthusiastic about the opportunity to contribute to your engineering team.

As a quick summary, I have hands-on experience building full-stack web applications with Core Java, Spring Boot, React.js, and relational databases (PostgreSQL/MySQL), demonstrated in projects like NearVia (a hyperlocal job marketplace with location-based PostGIS queries) and an Employee Leave Management System.

I have attached my tailored resume for your convenience. Please let me know if there are any additional details or work samples I can provide to support my application.

Thank you for your time and continued consideration.

Best regards,
${p.fullName}
${p.phone} | ${p.email}
LinkedIn: ${p.linkedIn}
Portfolio: ${p.portfolio}`;
      break;

    case 'interview_confirmation':
      const confirmedTimeStr = (interviewDetails && interviewDetails.rawTime) 
        ? `${interviewDetails.rawDate || 'the scheduled date'} at ${interviewDetails.rawTime} (${interviewDetails.timezone || 'IST'})`
        : (proposedSlots[0] || 'the scheduled time');

      subject = `Confirmation: Technical Interview for ${role} — ${p.fullName}`;
      body = `Dear ${recruiterName},

Thank you for confirming the interview schedule. I am pleased to confirm my attendance for the ${role} technical discussion on ${confirmedTimeStr}.

I have tested my camera, microphone, and internet connection in advance to ensure a smooth discussion. I look forward to speaking with the team and discussing how my hands-on background in Java, Spring Boot, React, and full-stack system architecture (including my hyperlocal marketplace project, NearVia) aligns with ${company}'s goals.

Thank you again for coordinating this.

Best regards,
${p.fullName}
${p.phone} | ${p.email}`;
      break;

    case 'interview_availability':
      const slotsText = proposedSlots.length > 0
        ? proposedSlots.map(s => `- ${s}`).join('\n')
        : `- Monday to Friday, between 10:00 AM and 6:00 PM IST\n- Alternate times available upon request`;

      subject = `Interview Availability: ${role} — ${p.fullName}`;
      body = `Dear ${recruiterName},

Thank you very much for considering my application for the ${role} role at ${company} and inviting me to discuss my background.

I am available for an interview during the following windows:
${slotsText}

Please let me know which time slot is most convenient for the interview panel, and I will gladly confirm my attendance. Should you require any additional portfolio details or GitHub repositories in the interim, they can be accessed at:
- GitHub: ${p.gitHub}
- Portfolio: ${p.portfolio}

Thank you for your time and coordination.

Best regards,
${p.fullName}
${p.phone} | ${p.email}`;
      break;

    case 'thank_you_message':
      subject = `Thank You — ${role} Interview Discussion — ${p.fullName}`;
      body = `Dear ${recruiterName},

Thank you for taking the time to speak with me today regarding the ${role} position at ${company}.

I thoroughly enjoyed learning more about the engineering challenges your team is addressing. Our discussion reinforced my strong interest in joining ${company}, and I am confident that my practical experience in Core Java, Spring Boot REST APIs, and React frontend architecture—as demonstrated in NearVia and my MCA capstone projects—will allow me to make meaningful contributions to your team from day one.

Please let me know if there is any additional information or documentation I can provide as you proceed with the next steps.

Thank you again for your time and consideration.

Best regards,
${p.fullName}
${p.phone} | ${p.email}`;
      break;

    case 'assessment_acknowledgement':
      const platformName = assessmentDetails?.platform || 'technical assessment';
      subject = `Acknowledgement: ${platformName} for ${role} — ${p.fullName}`;
      body = `Dear ${recruiterName},

Thank you for sharing the ${platformName} link for the ${role} position at ${company}.

I have received the test instructions and will complete the assessment carefully within the designated timeframe. Once submitted, I will send a brief confirmation email.

Thank you for the opportunity to demonstrate my technical problem-solving skills.

Best regards,
${p.fullName}
${p.phone} | ${p.email}`;
      break;

    case 'offer_questions':
      subject = `Inquiry: Offer of Employment — ${role} — ${p.fullName}`;
      body = `Dear ${recruiterName},

Thank you very much for extending the offer for the ${role} position at ${company}. I am genuinely excited about the prospect of joining the team!

Before formally signing, I would appreciate clarification on a few specific details:
1. Tentative onboarding and start date timeline.
2. Work location and hybrid schedule guidelines (onsite days per week in Bengaluru).
3. Any pre-joining documentation or onboarding requirements.

I look forward to your guidance so we can finalize the next steps. Thank you again for this wonderful opportunity.

Warm regards,
${p.fullName}
${p.phone} | ${p.email}`;
      break;

    case 'referral_request':
      subject = `Inquiry regarding ${role} at ${company} — Abhishek N (AIMS MCA '26)`;
      body = `Hi ${recruiterName},

I hope you are doing well!

I noticed the ${role} opening at ${company} and wanted to reach out. I recently completed my MCA from AIMS Institutes, Bangalore (recipient of the Best AI Innovation medal) and completed Java Full Stack training through Anudip Foundation.

I have built full-stack applications using Core Java, Spring Boot, React.js, and PostgreSQL (including NearVia, a hyperlocal marketplace with PostGIS location queries). If you feel my background aligns with the team, I would be deeply grateful for a referral or a brief connection to the hiring manager.

Thank you so much for your time and support!

Best regards,
${p.fullName}
${p.phone} | ${p.email}
LinkedIn: ${p.linkedIn}`;
      break;

    case 'recruiter_reply':
    default:
      body = `Dear ${recruiterName},

Thank you for reaching out regarding the ${role} position at ${company}.

I am eager to contribute with my verified hands-on skills in Core Java, Spring Boot, React.js, and relational database systems. ${customContext ? customContext + '\n\n' : ''}Please let me know the best next steps for our discussion.

Best regards,
${p.fullName}
${p.phone} | ${p.email}
LinkedIn: ${p.linkedIn}`;
      break;
  }

  return {
    draftType,
    to: recruiterEmail,
    subject,
    body,
    safetyNotice: 'DRAFT ONLY: In accordance with safety rules, this draft requires explicit human review and approval before transmission.'
  };
}

/**
 * Saves generated draft to SQLite communications table in 'pending_approval' state.
 */
export function saveDraftToVault({
  jobId = null,
  recipient = '',
  subject = '',
  body = '',
  draftType = 'recruiter_reply',
  extractedData = {}
}) {
  const db = getDatabase();
  const profile = loadCandidateProfile();

  const res = db.prepare(`
    INSERT INTO communications (
      job_id, sender, recipient, subject, body, direction,
      category, approval_status, extracted_data_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'outgoing', ?, 'pending_approval', ?, datetime('now'), datetime('now'))
  `).run(
    jobId,
    profile.personal.email,
    recipient,
    subject,
    body,
    draftType,
    JSON.stringify(extractedData || {})
  );

  const draftId = Number(res.lastInsertRowid);

  db.prepare(`
    INSERT INTO activity_audit_log (action, details)
    VALUES (?, ?)
  `).run(
    'EMAIL_DRAFT_CREATED',
    `Created draft ${draftType} for Job #${jobId || 'N/A'} (Subject: ${subject}). Status: pending_approval`
  );

  return {
    success: true,
    draftId,
    status: 'pending_approval'
  };
}

/**
 * STRICT HUMAN APPROVAL GATE:
 * Publishes an approved draft to Gmail as a draft message.
 * NEVER transmits or creates drafts without explicit user approval.
 */
export async function approveAndPublishDraft(draftId, { userConfirmedApproval = false }) {
  if (!userConfirmedApproval) {
    const error = new Error('Human Approval Gate: You must explicitly confirm approval before an email draft can be saved or published to Gmail.');
    error.code = 'APPROVAL_REQUIRED';
    throw error;
  }

  const db = getDatabase();
  const draft = db.prepare('SELECT * FROM communications WHERE id = ?').get(draftId);

  if (!draft) {
    throw new Error(`Draft with ID ${draftId} not found in database.`);
  }

  let gmailDraftResult = null;
  const isAuth = isGoogleAuthenticated();

  if (isAuth && draft.recipient) {
    try {
      gmailDraftResult = await createGmailDraft({
        to: draft.recipient,
        subject: draft.subject,
        body: draft.body
      });
    } catch (err) {
      console.warn(`[Gmail Draft Notice] Could not push to live Gmail: ${err.message}`);
    }
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE communications
    SET approval_status = 'approved_draft_created', updated_at = ?
    WHERE id = ?
  `).run(now, draftId);

  db.prepare(`
    INSERT INTO activity_audit_log (action, details)
    VALUES (?, ?)
  `).run(
    'EMAIL_DRAFT_APPROVED',
    `Approved and staged draft ID #${draftId} for "${draft.recipient || 'N/A'}". Google Draft ID: ${gmailDraftResult?.id || 'offline_staged'}`
  );

  return {
    success: true,
    draftId,
    approvalStatus: 'approved_draft_created',
    gmailDraftId: gmailDraftResult?.id || null,
    isLiveGmailCreated: Boolean(gmailDraftResult?.id)
  };
}
