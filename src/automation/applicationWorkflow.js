/**
 * CareerOS — Job-to-Application Workflow Orchestrator
 * Connects Job Discovery, Matching, Verification, Resume Studio, and Application Tracking.
 * Prepares, validates, and manages job applications with strict human-in-the-loop safety.
 */

import { getDatabase } from '../db/schema.js';
import { verifyJobUrl } from '../matcher/jobVerifier.js';
import { evaluateJobFit } from '../matcher/scoringEngine.js';
import { getPortalAdapter } from './portalAdapters/portalRegistry.js';
import { generateScreeningAnswers } from './screeningEngine.js';
import { getResumeVersionsForJob, saveResumeVersion } from '../resumes/resumeVersionManager.js';
import { generateTailoredResume, generateTailoredCoverLetter } from '../resumes/resumeGenerator.js';
import { generateStudioResume } from '../resumes/resumeStudioService.js';
import { loadCandidateProfile } from '../profile/profileManager.js';
import path from 'node:path';
import fs from 'node:fs';

import { updateApplicationStatus } from '../tracker/applicationTracker.js';
import { normalizeCanonicalUrl } from '../discovery/urlNormalizer.js';

export async function prepareApplication(jobId) {
  const db = getDatabase();

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) {
    throw new Error(`Job with ID ${jobId} not found in Career Vault.`);
  }

  // 1. Freshness & Liveness Check
  let freshness = { verificationStatus: job.verification_status || 'unverified', isAlive: job.verification_status !== 'expired' && job.status !== 'expired' };
  if (job.status === 'expired' || job.verification_status === 'expired') {
    freshness = {
      verificationStatus: 'expired',
      isAlive: false,
      reason: job.verification_reason || 'Job marked as expired or vacancy closed'
    };
  } else {
    try {
      if (job.url && job.url.startsWith('http')) {
        freshness = await verifyJobUrl(job.url);
        // Update database if changed
        db.prepare(`
          UPDATE jobs 
          SET verification_status = ?, last_verified_at = datetime('now'), verification_reason = ? 
          WHERE id = ?
        `).run(freshness.verificationStatus, freshness.reason || null, jobId);
      }
    } catch (err) {
      console.warn(`[Workflow Notice] Freshness check fallback: ${err.message}`);
    }
  }

  const isExpired = job.status === 'expired' || job.verification_status === 'expired' || freshness.verificationStatus === 'expired';
  if (isExpired) {
    freshness.isAlive = false;
    db.prepare(`
      UPDATE job_evaluations
      SET recommendation = 'EXPIRED', score = 0
      WHERE job_id = ?
    `).run(jobId);
  }

  // 2. Eligibility & Matching Re-evaluation
  const evaluation = evaluateJobFit(job);

  // 3. Collect Freshness, Security & Eligibility Warnings
  const warnings = [];
  if (isExpired) {
    warnings.push(`Job #${jobId} is marked as expired or closed. Autofill is blocked.`);
  }
  if (freshness.verificationStatus === 'blocked') {
    warnings.push('Job URL is protected by anti-bot verification or security checkpoint. Manual review and navigation required.');
  } else if (freshness.verificationStatus === 'inaccessible') {
    warnings.push('Job URL is inaccessible (HTTP error or network failure). Manual verification required.');
  } else if (freshness.verificationStatus === 'unverified') {
    warnings.push('Job listing is unverified for active status. Please verify before applying.');
  }

  if (evaluation.fresherEligible === 0) {
    warnings.push(`Candidate fresher profile is not eligible for this role: ${evaluation.summaryReason}. Autofill is blocked.`);
  }

  const isAutofillAllowed = !isExpired && evaluation.fresherEligible === 1;

  // 4. Portal Detection & Support Level
  const portalAdapter = getPortalAdapter(job.url);
  const portalType = portalAdapter.name;
  const supportLevel = portalAdapter.getSupportLevel();

  // 5. Recommend Most Relevant Verified Resume Version
  let existingVersions = getResumeVersionsForJob(jobId);
  let selectedVersion = null;

  if (existingVersions.length > 0) {
    // Prefer approved version, else latest version
    selectedVersion = existingVersions.find(v => v.is_approved === 1) || existingVersions[0];
  } else {
    // Generate tailored resume version
    const studioRes = await generateStudioResume(job);
    const saved = await saveResumeVersion({
      jobId,
      company: job.company,
      jobTitle: job.title,
      jdSnapshot: { title: job.title, company: job.company, description: job.description },
      template: 'ats_professional',
      generationMode: studioRes.generationMode,
      content: studioRes.content,
      atsScore: studioRes.atsScore?.overallScore || evaluation.score,
      atsBreakdown: studioRes.atsScore?.breakdown || evaluation.breakdown,
      matchedKeywords: evaluation.matchedSkills,
      missingKeywords: evaluation.missingSkills
    });
    existingVersions = getResumeVersionsForJob(jobId);
    selectedVersion = existingVersions[0] || saved;
  }

  // 6. Generate JD-Specific Cover Letter
  const profile = loadCandidateProfile();
  const coverLetter = generateTailoredCoverLetter(job, profile);

  // 7. Screening Questions & Answers
  const screeningAnswers = generateScreeningAnswers(job);

  // 8. Job-Specific Application Checklist
  const checklist = [
    { id: 'freshness', label: 'Job URL freshness verified', completed: freshness.isAlive && !isExpired, status: freshness.verificationStatus },
    { id: 'eligibility', label: 'Candidate fresher eligibility confirmed', completed: evaluation.fresherEligible === 1, details: evaluation.summaryReason },
    { id: 'resume', label: `Tailored resume ready (${selectedVersion.version_number ? 'v' + selectedVersion.version_number : 'v1'})`, completed: Boolean(selectedVersion.pdf_path), path: selectedVersion.pdf_path },
    { id: 'cover_letter', label: 'JD-specific cover letter generated', completed: true },
    { id: 'portal', label: `Portal detected: ${portalType} (${supportLevel})`, completed: true, portalType, supportLevel },
    { id: 'screening', label: 'Screening answers prepared from verified profile', completed: true },
    { id: 'user_approval', label: 'Human approval before filling', completed: false, required: true },
    { id: 'manual_submission', label: 'Manual final submission on employer site', completed: false, required: true }
  ];

  // 9. Prevent Duplicate Applications — Create or Update Application Tracker Record
  // CRITICAL REQUIREMENT: Do NOT set applied_date when preparing an application.
  // applied_date remains NULL until explicit user-confirmed submission.
  const canonicalUrl = normalizeCanonicalUrl(job.url || '');
  const canonicalUrlAlt = canonicalUrl.endsWith('/') ? canonicalUrl.slice(0, -1) : (canonicalUrl + '/');
  const jobUrlAlt = (job.url || '').endsWith('/') ? (job.url || '').slice(0, -1) : ((job.url || '') + '/');

  let existingApp = db.prepare(`
    SELECT a.* FROM applications a
    LEFT JOIN jobs j ON a.job_id = j.id
    WHERE a.job_id = ?
       OR a.job_url IN (?, ?, ?, ?)
       OR (j.canonical_url IS NOT NULL AND j.canonical_url IN (?, ?, ?, ?))
    LIMIT 1
  `).get(
    jobId,
    job.url, jobUrlAlt, canonicalUrl, canonicalUrlAlt,
    job.url, jobUrlAlt, canonicalUrl, canonicalUrlAlt
  );
  let applicationId;

  const now = new Date().toISOString();
  const initialHistory = [{ status: existingApp ? existingApp.status : 'preparing', timestamp: now, note: 'Application dossier compiled' }];

  if (existingApp) {
    applicationId = existingApp.id;
    let history = [];
    try {
      history = existingApp.status_history_json ? JSON.parse(existingApp.status_history_json) : [];
    } catch { }
    history.push({ status: existingApp.status || 'preparing', timestamp: now, note: 'Application dossier refreshed' });

    db.prepare(`
      UPDATE applications 
      SET portal_type = ?, resume_version = ?,
          job_url = ?, job_source = ?, checklist_json = ?, screening_answers_json = ?,
          status_history_json = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      portalType,
      selectedVersion.pdf_path ? path.basename(selectedVersion.pdf_path) : 'v1_Resume.pdf',
      job.url,
      job.source || 'direct',
      JSON.stringify(checklist),
      JSON.stringify(screeningAnswers),
      JSON.stringify(history),
      applicationId
    );
  } else {
    const insertRes = db.prepare(`
      INSERT INTO applications (
        job_id, portal_type, resume_version, applied_date, user_approved,
        notes, status, job_url, job_source, checklist_json, screening_answers_json, status_history_json
      ) VALUES (?, ?, ?, NULL, 0, ?, 'preparing', ?, ?, ?, ?, ?)
    `).run(
      jobId,
      portalType,
      selectedVersion.pdf_path ? path.basename(selectedVersion.pdf_path) : 'v1_Resume.pdf',
      `Application prepared for ${job.title} @ ${job.company}`,
      job.url,
      job.source || 'direct',
      JSON.stringify(checklist),
      JSON.stringify(screeningAnswers),
      JSON.stringify(initialHistory)
    );
    applicationId = Number(insertRes.lastInsertRowid);
  }

  // Audit Log Entry
  db.prepare(`
    INSERT INTO activity_audit_log (action, details)
    VALUES (?, ?)
  `).run(
    'APPLICATION_PREPARED',
    `Prepared application dossier for Job #${jobId} (${job.title} @ ${job.company}). Portal: ${portalType} (${supportLevel}). Resume: ${selectedVersion.pdf_path ? path.basename(selectedVersion.pdf_path) : 'v1'}`
  );

  return {
    applicationId,
    jobId,
    job: {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      url: job.url,
      source: job.source,
      experienceMin: job.experience_min,
      experienceMax: job.experience_max,
      salary: job.salary
    },
    freshness,
    evaluation: {
      score: evaluation.score,
      rating: evaluation.rating,
      recommendation: evaluation.recommendation,
      fresherEligible: evaluation.fresherEligible,
      summaryReason: evaluation.summaryReason,
      matchedSkills: evaluation.matchedSkills,
      missingSkills: evaluation.missingSkills
    },
    warnings,
    isAutofillAllowed,
    portal: {
      name: portalType,
      supportLevel
    },
    resumeVersion: {
      id: selectedVersion.id,
      versionNumber: selectedVersion.version_number,
      pdfPath: selectedVersion.pdf_path,
      pdfUrl: `/api/download/resume/${jobId}`,
      atsScore: selectedVersion.ats_score
    },
    coverLetter: {
      markdown: coverLetter.markdown
    },
    screeningAnswers,
    checklist
  };
}

/**
 * Confirms manual user submission of an application on employer portal.
 * STRICT APPROVAL GATE: Sets applied_date ONLY upon explicit user confirmation.
 */
export function confirmApplicationSubmission(jobId, { confirmationNumber = null, notes = null, userConfirmed = false } = {}) {
  if (!userConfirmed) {
    throw new Error('Approval Gate Violation: Cannot confirm application submission without explicit user confirmation.');
  }

  const result = updateApplicationStatus(jobId, 'submitted', {
    confirmationNumber,
    notes: notes || 'User confirmed submission on employer portal',
    userConfirmed: true
  });

  const db = getDatabase();
  db.prepare(`
    INSERT INTO activity_audit_log (action, details)
    VALUES (?, ?)
  `).run(
    'APPLICATION_SUBMISSION_CONFIRMED',
    `User confirmed manual submission for Job #${jobId}. Confirmation: ${confirmationNumber || 'None'}`
  );

  return result;
}

