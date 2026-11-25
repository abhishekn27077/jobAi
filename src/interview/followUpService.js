import { getDatabase } from '../db/schema.js';
import { loadCandidateProfile } from '../profile/profileManager.js';

export const FOLLOW_UP_TYPES = [
  'post_screening',
  'post_technical',
  'assignment_submission',
  'delayed_response_nudge',
  'offer_clarification'
];

/**
 * Generate a contextual, professional follow-up draft for an interview or application
 * STRICT SAFETY RULE: NEVER AUTO-SEND. MUST REQUIRE MANUAL USER APPROVAL.
 */
export function generateFollowUpDraft(interviewId, type = 'post_technical', options = {}) {
  const db = getDatabase();

  const interview = db.prepare(`
    SELECT i.*, j.title as job_title, j.company, j.location, j.url as job_url
    FROM interviews i
    JOIN jobs j ON i.job_id = j.id
    WHERE i.id = ?
  `).get(interviewId);

  if (!interview) {
    throw new Error(`Interview not found with id: ${interviewId}`);
  }

  const profile = loadCandidateProfile();
  const candidateName = profile.personal?.fullName || profile.name || 'Abhishek N';
  const candidateEmail = profile.personal?.email || 'abhishek2707n@gmail.com';
  const candidatePhone = profile.personal?.phone || '+91-8762212694';
  const candidateGithub = profile.links?.github || 'https://github.com/abhishekn27077';
  const company = interview.company || 'the Team';
  const role = interview.job_title || 'Software Engineer';
  const interviewer = options.interviewerName || interview.interviewer_info || 'Hiring Team';

  let subject = '';
  let body = '';

  switch (type) {
    case 'post_screening':
      subject = `Thank you — Recruiter Conversation for ${role} | ${candidateName}`;
      body = `Hi ${interviewer},

Thank you very much for taking the time to speak with me today regarding the ${role} position at ${company}. I truly enjoyed learning more about the team's engineering priorities and culture.

Our conversation reaffirmed my enthusiasm for this opportunity. With my MCA degree from AIMS Institutes (graduating in 2026), rigorous enterprise Java Full Stack development training at Anudip Foundation, and hands-on capstone projects like NearVia (React, TypeScript, Express, PostGIS) and my Spring Boot Employee Leave Management platform, I am confident in my ability to hit the ground running.

Please let me know if you need any additional details, transcripts, or project links from my side. I look forward to the next steps in the technical evaluation process.

Warm regards,

${candidateName}
MCA 2026 | Full Stack Java Engineer
GitHub: ${candidateGithub}
Phone: ${candidatePhone} | Email: ${candidateEmail}`;
      break;

    case 'post_technical':
      const techTopic = options.technicalDiscussionTopic || 'our discussion on backend data integrity and concurrency';
      subject = `Thank you — Technical Interview for ${role} | ${candidateName}`;
      body = `Hi ${interviewer},

Thank you for your time during our technical interview today. I particularly enjoyed diving deep into ${techTopic} and hearing about how ${company}'s engineering team tackles scalable architecture.

The discussion reinforced my strong interest in joining the team. Applying production concepts—such as the PostgreSQL pessimistic row-level locking I used in NearVia and the transactional state machines in my Spring Boot projects—to ${company}'s domain would be an exciting challenge.

Please feel free to explore my open-source code and project repositories at ${candidateGithub}. I look forward to hearing your feedback and continuing the conversation.

Best regards,

${candidateName}
${candidatePhone} | ${candidateEmail}
${candidateGithub}`;
      break;

    case 'assignment_submission':
      const repoUrl = options.repoUrl || candidateGithub;
      subject = `Take-Home Coding Assignment Submission — ${role} | ${candidateName}`;
      body = `Dear ${interviewer},

I have completed the technical assessment for the ${role} position at ${company}. You can access the complete source code, documentation, and test suite here:

Repository: ${repoUrl}

Key Highlights:
- Architecture: Followed clean layered architecture with strict separation of concerns.
- Reliability & Edge Cases: Implemented comprehensive unit tests and transactional boundary safety.
- Setup Instructions: Included a detailed README.md with zero-friction local setup and execution commands.

I thoroughly enjoyed building this solution and welcome any feedback or questions from the review team. I look forward to discussing the implementation during our code walkthrough round.

Sincerely,

${candidateName}
${candidatePhone} | ${candidateEmail}`;
      break;

    case 'delayed_response_nudge':
      subject = `Following Up: ${role} Interview Status — ${candidateName}`;
      body = `Hi ${interviewer},

I hope this message finds you well.

I am writing to politely follow up on the status of my application and recent interview for the ${role} position at ${company}. I remain very enthusiastic about the opportunity to contribute to your engineering team.

Please let me know if there are any updates or if there is any further information I can provide to support your decision. Thank you again for your time and guidance throughout the process.

Warm regards,

${candidateName}
${candidatePhone} | ${candidateEmail}`;
      break;

    case 'offer_clarification':
      subject = `Offer Acknowledgement & Next Steps — ${role} | ${candidateName}`;
      body = `Dear ${interviewer},

Thank you very much for extending the offer to join ${company} as ${role}! I am genuinely thrilled and honored by the confidence the engineering team has placed in me.

I am carefully reviewing the formal offer letter and agreement terms. In the meantime, I wanted to quickly confirm the expected start date and ask if there are any onboarding documents or background verification forms I should begin assembling right away.

Thank you once again for this wonderful opportunity.

Warm regards,

${candidateName}
${candidatePhone} | ${candidateEmail}`;
      break;

    default:
      throw new Error(`Unsupported follow-up type: ${type}`);
  }

  // Update interview next_action and follow_up_date
  try {
    const nextFollowUp = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    db.prepare(`
      UPDATE interviews
      SET next_action = ?, follow_up_date = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(`Follow-up prepared: ${type}`, nextFollowUp, interviewId);
  } catch (err) {}

  return {
    interviewId,
    jobId: interview.job_id,
    company,
    role,
    type,
    subject,
    body,
    status: 'DRAFT_PENDING_USER_APPROVAL',
    requiresUserApproval: true,
    autoSent: false,
    generatedAt: new Date().toISOString(),
    safetyNotice: 'This follow-up draft is created for your review. CareerOS enforces a strict human-in-the-loop policy and will never send messages or emails automatically without your explicit action.'
  };
}
