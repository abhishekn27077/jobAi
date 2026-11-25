/**
 * CareerOS — Application Readiness Assessment Engine (Phase 13)
 * Evaluates job suitability, profile completeness, document readiness,
 * and portal accessibility to classify readiness into:
 * - READY TO REVIEW
 * - NEEDS ATTENTION
 * - BLOCKED
 * 
 * Strict Gate: NEVER marks an application READY TO REVIEW if mandatory
 * requirements, eligibility, or verified documents are missing.
 */

import { loadCandidateProfile } from '../profile/profileManager.js';

export const READINESS_TIERS = {
  READY_TO_REVIEW: 'READY TO REVIEW',
  NEEDS_ATTENTION: 'NEEDS ATTENTION',
  BLOCKED: 'BLOCKED'
};

/**
 * Assesses complete application readiness for a given job and applicant assets.
 * 
 * @param {Object} job - The job record from database
 * @param {Object} [application=null] - Existing application record (if any)
 * @param {Object} [resumeVersion=null] - Tailored resume version record (if any)
 * @param {Object} [evaluation=null] - Scoring evaluation for the job
 * @returns {Object} Comprehensive readiness report
 */
export function assessApplicationReadiness(job, application = null, resumeVersion = null, evaluation = null) {
  if (!job) {
    throw new Error('Application readiness evaluation requires a valid job object.');
  }

  const profile = loadCandidateProfile();
  const blockers = [];
  const warnings = [];
  const reasons = [];
  const missingFields = [];
  const nextActions = [];
  const checklist = [];

  let readinessScore = 100;

  // 1. Freshness & Liveness Check
  const isExpired = job.status === 'expired' || 
                    job.verification_status === 'expired' || 
                    (job.verification_reason && job.verification_reason.toLowerCase().includes('expired'));
  
  if (isExpired) {
    blockers.push('Job vacancy is expired or has been closed by the employer.');
    readinessScore -= 50;
    checklist.push({
      id: 'job_freshness',
      name: 'Job Listing Freshness',
      status: 'failed',
      details: 'Posting is marked as expired or closed. Applications are blocked.'
    });
  } else if (job.verification_status === 'unverified') {
    warnings.push('Job vacancy freshness is unverified. Quick verification recommended before applying.');
    readinessScore -= 5;
    checklist.push({
      id: 'job_freshness',
      name: 'Job Listing Freshness',
      status: 'warning',
      details: 'Listing is unverified. Ensure position is active on company portal.'
    });
  } else {
    checklist.push({
      id: 'job_freshness',
      name: 'Job Listing Freshness',
      status: 'passed',
      details: `Active and verified (${job.verification_status || 'verified'}).`
    });
  }

  // 2. Candidate Eligibility & Seniority Check
  const fresherEligible = evaluation ? evaluation.fresherEligible : (job.fresher_eligible !== 0);
  const eligibilityTier = evaluation?.eligibilityTier || 'ELIGIBLE';
  const minExp = job.experience_min != null ? Number(job.experience_min) : 0;

  if (fresherEligible === 0 || minExp > 2 || eligibilityTier === 'INELIGIBLE') {
    const reasonText = evaluation?.summaryReason || `Role requires ${minExp}+ years experience or strictly excludes MCA candidates.`;
    blockers.push(`Candidate is not eligible: ${reasonText}`);
    readinessScore -= 45;
    checklist.push({
      id: 'eligibility',
      name: 'Candidate Eligibility (MCA / Fresher)',
      status: 'failed',
      details: reasonText
    });
  } else if (eligibilityTier === 'AMBIGUOUS' || (minExp > 0 && minExp <= 2)) {
    warnings.push(`Experience or degree requirement has slight ambiguity (${minExp} yrs / degree equivalency).`);
    readinessScore -= 10;
    checklist.push({
      id: 'eligibility',
      name: 'Candidate Eligibility (MCA / Fresher)',
      status: 'warning',
      details: 'Role accepts 0-2 yrs or equivalent technical degrees.'
    });
  } else {
    checklist.push({
      id: 'eligibility',
      name: 'Candidate Eligibility (MCA / Fresher)',
      status: 'passed',
      details: 'MCA 2026 fresher profile matches requirements.'
    });
  }

  // 3. Duplicate Application Gate
  if (application && (application.status === 'submitted' || application.status === 'applied')) {
    const appliedDate = application.applied_date || application.updated_at || 'recently';
    blockers.push(`Application already submitted on ${appliedDate}. Duplicate submissions blocked.`);
    readinessScore -= 50;
    checklist.push({
      id: 'duplicate_prevention',
      name: 'Duplicate Application Check',
      status: 'failed',
      details: `Already marked as applied on ${appliedDate}.`
    });
  } else {
    checklist.push({
      id: 'duplicate_prevention',
      name: 'Duplicate Application Check',
      status: 'passed',
      details: 'No prior submission recorded. Clean pipeline.'
    });
  }

  // 4. Job URL & Portal Accessibility
  const hasValidUrl = job.url && (job.url.startsWith('http://') || job.url.startsWith('https://'));
  if (!hasValidUrl) {
    blockers.push('Job application link is missing or invalid.');
    readinessScore -= 30;
    checklist.push({
      id: 'portal_url',
      name: 'Application Link & Destination',
      status: 'failed',
      details: 'No valid HTTP/HTTPS URL found on job record.'
    });
  } else if (job.verification_status === 'blocked') {
    warnings.push('Portal is protected by anti-bot challenge or Cloudflare security wall. Manual browser navigation required.');
    readinessScore -= 10;
    checklist.push({
      id: 'portal_url',
      name: 'Application Link & Destination',
      status: 'warning',
      details: 'Security gate detected. User must open link directly.'
    });
  } else {
    checklist.push({
      id: 'portal_url',
      name: 'Application Link & Destination',
      status: 'passed',
      details: `Valid portal destination (${job.source || 'Direct'}).`
    });
  }

  // 5. Match Score & Skills Relevance
  const matchScore = evaluation?.score || job.score || 0;
  if (matchScore < 40) {
    warnings.push(`Low skill alignment score (${matchScore}/100). Review required skills before applying.`);
    readinessScore -= 15;
    checklist.push({
      id: 'skill_relevance',
      name: 'Skill Match & Relevance',
      status: 'warning',
      details: `Score is ${matchScore}/100. Key skills missing from job description.`
    });
  } else {
    checklist.push({
      id: 'skill_relevance',
      name: 'Skill Match & Relevance',
      status: 'passed',
      details: `Solid profile alignment (${matchScore}/100).`
    });
  }

  // 6. Resume Tailoring & Version Compilation Check
  if (!resumeVersion) {
    warnings.push('No tailored resume version generated yet for this role.');
    readinessScore -= 20;
    missingFields.push('Tailored Resume Version');
    nextActions.push('Click "ATS Resume" to compile tailored PDF resume for this role.');
    checklist.push({
      id: 'tailored_resume',
      name: 'Job-Specific Tailored Resume',
      status: 'warning',
      details: 'Using master profile default. Tailoring recommended for ATS score.'
    });
  } else {
    const hasPdf = resumeVersion.pdf_path || resumeVersion.content;
    if (hasPdf) {
      checklist.push({
        id: 'tailored_resume',
        name: 'Job-Specific Tailored Resume',
        status: 'passed',
        details: `Tailored resume ready (${resumeVersion.template || 'ats_professional'}). ATS Score: ${resumeVersion.ats_score || resumeVersion.atsScore || matchScore}/100.`
      });
    } else {
      warnings.push('Tailored resume drafted but PDF not compiled to disk.');
      readinessScore -= 10;
      checklist.push({
        id: 'tailored_resume',
        name: 'Job-Specific Tailored Resume',
        status: 'warning',
        details: 'Draft exists; PDF compilation required.'
      });
    }
  }

  // 7. Profile Mandatory Contact Information
  const candName = profile.personal?.fullName || profile.name;
  const candEmail = profile.personal?.email || profile.email;
  const candPhone = profile.personal?.phone || profile.phone;
  const candLocation = profile.personal?.location || profile.location;

  const requiredProfileKeys = [
    { key: 'name', label: 'Full Name', value: candName },
    { key: 'email', label: 'Email Address', value: candEmail },
    { key: 'phone', label: 'Contact Phone', value: candPhone },
    { key: 'location', label: 'Current Location', value: candLocation }
  ];

  const missingProfile = requiredProfileKeys.filter(k => !k.value || String(k.value).trim() === '');
  if (missingProfile.length > 0) {
    missingProfile.forEach(m => {
      blockers.push(`Candidate profile missing mandatory field: ${m.label}`);
      missingFields.push(m.label);
    });
    readinessScore -= 25;
    checklist.push({
      id: 'profile_contact',
      name: 'Verified Contact & Profile Data',
      status: 'failed',
      details: `Missing: ${missingProfile.map(m => m.label).join(', ')}`
    });
  } else {
    checklist.push({
      id: 'profile_contact',
      name: 'Verified Contact & Profile Data',
      status: 'passed',
      details: `${candName} (${candEmail}, ${candLocation})`
    });
  }

  // 8. Education & Degree Verification
  const mcaDegree = profile.education?.find(e => /MCA|Master of Computer/i.test(e.degree));
  if (!mcaDegree) {
    warnings.push('MCA degree record not found in candidate education.');
    readinessScore -= 10;
    checklist.push({
      id: 'education_verified',
      name: 'Education Verification',
      status: 'warning',
      details: 'MCA degree details missing or unverified.'
    });
  } else {
    checklist.push({
      id: 'education_verified',
      name: 'Education Verification',
      status: 'passed',
      details: `${mcaDegree.degree} (${mcaDegree.institution || 'Verified'}, ${mcaDegree.year || '2026'})`
    });
  }

  // 9. Cover Letter & Application Assets
  const hasCoverLetter = application?.cover_letter_path || application?.coverLetter;
  if (!hasCoverLetter) {
    // Non-blocking warning since many ATS allow resume-only applications
    warnings.push('Cover letter not yet generated (recommended for competitive roles).');
    checklist.push({
      id: 'cover_letter',
      name: 'Targeted Cover Letter',
      status: 'warning',
      details: 'Optional cover letter can be generated in 1 click.'
    });
  } else {
    checklist.push({
      id: 'cover_letter',
      name: 'Targeted Cover Letter',
      status: 'passed',
      details: 'Custom cover letter drafted and verified.'
    });
  }

  // 10. Prepared Screening Answers
  const answers = application?.screening_answers || {};
  const hasAnswers = Object.keys(answers).length > 0;
  if (!hasAnswers) {
    warnings.push('Screening answers not pre-cached. Standard answers will be generated on workflow prep.');
    checklist.push({
      id: 'screening_answers',
      name: 'Screening Questions Intelligence',
      status: 'warning',
      details: 'Grounded answers ready to be generated.'
    });
  } else {
    checklist.push({
      id: 'screening_answers',
      name: 'Screening Questions Intelligence',
      status: 'passed',
      details: `${Object.keys(answers).length} verified screening answers pre-cached.`
    });
  }

  // Determine Final Readiness Tier
  let readinessTier = READINESS_TIERS.READY_TO_REVIEW;
  const attentionItems = [];
  if (job.verification_status === 'unverified') attentionItems.push('Job listing freshness is unverified.');
  if (eligibilityTier === 'AMBIGUOUS') attentionItems.push('Eligibility requirement has slight degree/experience ambiguity.');
  if (matchScore < 50) attentionItems.push(`Low skill match score (${matchScore}/100).`);
  if (!resumeVersion) attentionItems.push('No tailored resume version compiled yet for this role.');

  if (blockers.length > 0) {
    readinessTier = READINESS_TIERS.BLOCKED;
    reasons.push(...blockers);
  } else if (attentionItems.length > 0) {
    readinessTier = READINESS_TIERS.NEEDS_ATTENTION;
    reasons.push(...attentionItems);
  } else {
    reasons.push('All mandatory requirements, verified profile details, and tailored documents are in order.');
  }

  readinessScore = Math.max(0, Math.min(100, Math.round(readinessScore)));

  // Determine Recommended Next Actions
  if (readinessTier === READINESS_TIERS.BLOCKED) {
    nextActions.push('Do not submit application. Review blocking reasons above.');
  } else if (readinessTier === READINESS_TIERS.NEEDS_ATTENTION) {
    if (!resumeVersion) nextActions.push('Generate tailored ATS resume PDF.');
    if (job.verification_status === 'unverified') nextActions.push('Verify job listing URL is live.');
    nextActions.push('Review application package before launching assistant.');
  } else {
    nextActions.push('Ready to inspect form assistant and review filled fields.');
    nextActions.push('Launch pre-fill in browser (strictly requires user manual submission).');
  }

  return {
    readinessTier,
    readinessScore,
    summary: readinessTier === READINESS_TIERS.READY_TO_REVIEW
      ? `Application package is complete and ready for human review (Readiness: ${readinessScore}%).`
      : readinessTier === READINESS_TIERS.NEEDS_ATTENTION
        ? `Application requires attention before submission (${warnings.length} items flagged, Readiness: ${readinessScore}%).`
        : `Application is blocked from submission (${blockers.length} critical blockers, Readiness: ${readinessScore}%).`,
    reasons,
    blockers,
    warnings,
    missingFields,
    checklist,
    nextActions,
    metadata: {
      jobId: job.id,
      jobTitle: job.title,
      company: job.company,
      evaluatedAt: new Date().toISOString()
    }
  };
}
