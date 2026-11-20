/**
 * CareerOS — Gmail & Recruiter Communication Service
 * Unified service coordinating classification, draft generation, and vault synchronization.
 */

import { classifyAndExtractRecruiterEmail, classifyRecruiterEmail } from './recruiterEmailParser.js';
import { generateCommunicationDraft, saveDraftToVault, approveAndPublishDraft } from './communicationAssistant.js';

export {
  classifyAndExtractRecruiterEmail,
  classifyRecruiterEmail,
  generateCommunicationDraft,
  saveDraftToVault,
  approveAndPublishDraft
};

/**
 * Backwards compatibility helper for existing workflow callers.
 */
export function generateRecruiterDraftReply({ job, emailType, recruiterName = 'Hiring Team', proposedSlots = [] }) {
  let draftType = 'recruiter_reply';
  if (emailType === 'INTERVIEW_INVITATION') {
    draftType = proposedSlots.length > 0 ? 'interview_availability' : 'interview_confirmation';
  } else if (emailType === 'APPLICATION_ACKNOWLEDGED') {
    draftType = 'recruiter_reply';
  }

  const draft = generateCommunicationDraft({
    draftType,
    job,
    recruiterName,
    proposedSlots
  });

  return {
    subject: draft.subject,
    body: draft.body,
    safetyNotice: draft.safetyNotice
  };
}

export function saveEmailDraftToVault(jobId, recruiterEmail, subject, body) {
  const result = saveDraftToVault({
    jobId,
    recipient: recruiterEmail,
    subject,
    body,
    draftType: 'recruiter_reply'
  });

  return {
    draftId: result.draftId,
    status: result.status
  };
}
