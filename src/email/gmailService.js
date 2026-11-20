import { getDatabase } from '../db/schema.js';
import { loadCandidateProfile } from '../profile/profileManager.js';

export function classifyRecruiterEmail(subject = '', body = '') {
  const text = `${subject} ${body}`.toLowerCase();

  if (/interview|discussion|coding\s*test|assessment|hackerrank|coderbyte|tech\s*round/i.test(text)) {
    return {
      type: 'INTERVIEW_INVITATION',
      urgency: 'HIGH',
      summary: 'Recruiter or platform inviting candidate for interview/assessment'
    };
  }

  if (/unfortunately|not\s*moving\s*forward|other\s*candidates|pursue\s*other/i.test(text)) {
    return {
      type: 'REJECTION',
      urgency: 'LOW',
      summary: 'Application status update: Position closed or not selected'
    };
  }

  if (/application\s*received|thank\s*you\s*for\s*applying|received\s*your\s*application/i.test(text)) {
    return {
      type: 'APPLICATION_ACKNOWLEDGED',
      urgency: 'LOW',
      summary: 'Automated confirmation that application was received'
    };
  }

  return {
    type: 'GENERAL_INQUIRY',
    urgency: 'MEDIUM',
    summary: 'Recruiter communication or status follow-up'
  };
}

export function generateRecruiterDraftReply({ job, emailType, recruiterName = 'Hiring Team', proposedSlots = [] }) {
  const profile = loadCandidateProfile();
  const p = profile.personal;
  const company = job ? job.company : 'your team';
  const role = job ? job.title : 'Software Engineer';

  let subject = `Re: Application for ${role} - ${p.fullName}`;
  let body = '';

  if (emailType === 'INTERVIEW_INVITATION') {
    const slotsText = proposedSlots.length > 0 
      ? `I can confirm my availability for: ${proposedSlots.join(', ')}.`
      : `I am available for an interview on weekdays between 10:00 AM and 6:00 PM IST, or at your earliest convenience.`;

    body = `Dear ${recruiterName},

Thank you very much for considering my application for the ${role} position at ${company}. I am excited about the opportunity to discuss my background and how my skills in Java, Spring Boot, React, and full-stack development align with your team.

${slotsText}

Please let me know which time works best or if you need any additional portfolio or project details (such as my hyperlocal marketplace project, NearVia) prior to the call.

Thank you again for your time and coordination.

Best regards,
${p.fullName}
${p.phone}
${p.email}
LinkedIn: ${p.linkedIn}
Portfolio: ${p.portfolio}`;
  } else if (emailType === 'APPLICATION_ACKNOWLEDGED') {
    body = `Dear ${recruiterName},

Thank you for acknowledging my application for the ${role} position at ${company}. I look forward to the team reviewing my qualifications and remain available should you require any additional information.

Best regards,
${p.fullName}
${p.phone} | ${p.email}`;
  } else {
    body = `Dear ${recruiterName},

Thank you for reaching out regarding the ${role} position at ${company}. 

I am eager to contribute with my verified hands-on skills in Core Java, Spring Boot, React.js, and relational database systems. Please let me know the best next steps for our discussion.

Best regards,
${p.fullName}
${p.phone} | ${p.email}`;
  }

  return {
    subject,
    body,
    safetyNotice: 'DRAFT ONLY: In accordance with safety rules, this draft requires explicit human review and approval before transmission.'
  };
}

export function saveEmailDraftToVault(jobId, recruiterEmail, subject, body) {
  const db = getDatabase();
  const profile = loadCandidateProfile();

  const res = db.prepare(`
    INSERT INTO communications (job_id, sender, recipient, subject, body, direction, approval_status, created_at)
    VALUES (?, ?, ?, ?, ?, 'outgoing', 'pending_approval', datetime('now'))
  `).run(
    jobId,
    profile.personal.email,
    recruiterEmail,
    subject,
    body
  );

  db.prepare(`
    INSERT INTO activity_audit_log (action, details)
    VALUES (?, ?)
  `).run(
    'EMAIL_DRAFT_CREATED',
    `Created draft reply for Job #${jobId || 'N/A'} (Subject: ${subject}). Status: pending_approval`
  );

  return {
    draftId: Number(res.lastInsertRowid),
    status: 'pending_approval'
  };
}
