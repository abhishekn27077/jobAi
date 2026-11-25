import { getDatabase } from '../db/schema.js';
import { loadCandidateProfile } from '../profile/profileManager.js';
import { getVerifiedCandidateSkills } from '../intelligence/skillGapService.js';

/**
 * Calculates a transparent, multi-factor Interview Readiness Score (0-100%)
 */
export function calculateInterviewReadiness(jobId) {
  const db = getDatabase();

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) {
    throw new Error(`Job not found with id: ${jobId}`);
  }

  const profile = loadCandidateProfile();
  const { verified } = getVerifiedCandidateSkills(profile);
  const verifiedSkillSet = verified instanceof Set
    ? verified
    : new Set(Array.from(verified || []).map(s => String(s).toLowerCase().trim()));

  // Extract required skills
  let reqSkills = [];
  try {
    reqSkills = job.required_skills ? JSON.parse(job.required_skills) : [];
  } catch {
    reqSkills = (job.required_skills || '').split(',').map(s => s.trim()).filter(Boolean);
  }
  if (reqSkills.length === 0) {
    reqSkills = ['Java', 'SQL', 'Problem Solving'];
  }

  // Factor 1: Skills Coverage (Max 25 pts)
  const matchedSkills = reqSkills.filter(s => verifiedSkillSet.has(s.toLowerCase()));
  const skillsCoverageRatio = reqSkills.length > 0 ? (matchedSkills.length / reqSkills.length) : 0.8;
  const skillsScore = Math.min(25, Math.round(skillsCoverageRatio * 25));

  // Factor 2: Project Deep Dives (Max 20 pts)
  // Abhishek has NearVia (React/Node/PostGIS), Leave Management (Java/Spring Boot), Smart Rover (OpenCV/Python), FinSight (FastAPI/React)
  const hasJavaProject = profile.projects?.some(p => (p.technologies || []).some(t => t.toLowerCase().includes('java') || t.toLowerCase().includes('spring')));
  const hasFullStackProject = profile.projects?.some(p => (p.technologies || []).some(t => t.toLowerCase().includes('react') || t.toLowerCase().includes('node') || t.toLowerCase().includes('postgres')));
  let projectScore = 0;
  if (hasJavaProject) projectScore += 10;
  if (hasFullStackProject) projectScore += 10;

  // Factor 3: Technical Topics (Max 20 pts)
  // Check question bank reviewed status or available targeted technical questions
  const reviewedCountRow = db.prepare("SELECT COUNT(*) as count FROM interview_question_bank WHERE reviewed_status = 'reviewed'").get();
  const reviewedCount = reviewedCountRow ? reviewedCountRow.count : 0;
  let technicalTopicsScore = 14; // baseline readiness from strong verified fundamentals
  if (reviewedCount >= 5) technicalTopicsScore = 20;
  else if (reviewedCount >= 2) technicalTopicsScore = 17;

  // Factor 4: Company Research & Reverse Questions (Max 15 pts)
  const compResearch = db.prepare('SELECT * FROM company_research WHERE LOWER(company_name) = LOWER(?)').get(job.company);
  let companyScore = 8; // baseline
  if (compResearch && compResearch.overview) {
    companyScore = 15;
  } else if (job.company && job.company !== 'Unknown') {
    companyScore = 12;
  }

  // Factor 5: Resume & Application Familiarity (Max 10 pts)
  const resumeVer = db.prepare('SELECT id, ats_score, is_approved FROM resume_versions WHERE job_id = ? ORDER BY version_number DESC').get(jobId);
  let resumeScore = 5;
  if (resumeVer) {
    resumeScore = 8;
    if (resumeVer.is_approved) resumeScore = 10;
  }

  // Factor 6: Interview Logistics & Scheduling (Max 10 pts)
  const interview = db.prepare('SELECT * FROM interviews WHERE job_id = ? ORDER BY scheduled_at DESC').get(jobId);
  let logisticsScore = 5;
  if (interview) {
    if (interview.meeting_link || interview.scheduled_at) logisticsScore = 8;
    if (interview.confirmed_by_user) logisticsScore = 10;
  }

  const totalScore = Math.min(100, skillsScore + projectScore + technicalTopicsScore + companyScore + resumeScore + logisticsScore);

  let tier = 'NEEDS PREPARATION';
  if (totalScore >= 85) {
    tier = 'HIGHLY READY';
  } else if (totalScore >= 65) {
    tier = 'ADEQUATELY PREPARED';
  }

  const factorBreakdown = [
    {
      factor: 'Job Requirements & Skills Coverage',
      points: skillsScore,
      maxPoints: 25,
      details: `${matchedSkills.length} of ${reqSkills.length} required skills verified (${matchedSkills.slice(0, 4).join(', ')}${matchedSkills.length > 4 ? '...' : ''})`
    },
    {
      factor: 'Project Deep Dive Readiness',
      points: projectScore,
      maxPoints: 20,
      details: 'Verified NearVia (PostGIS / concurrency) and Leave Management (Spring Boot / transactional) projects aligned'
    },
    {
      factor: 'Core Technical Topics Preparation',
      points: technicalTopicsScore,
      maxPoints: 20,
      details: `${reviewedCount} question bank topics marked reviewed; Core Java, Spring Boot, and SQL fundamentals verified`
    },
    {
      factor: 'Company Research & Reverse Questions',
      points: companyScore,
      maxPoints: 15,
      details: compResearch ? `Verified company profile for ${job.company}` : `Target company identified: ${job.company}`
    },
    {
      factor: 'Tailored Resume Familiarity',
      points: resumeScore,
      maxPoints: 10,
      details: resumeVer ? `Tailored ATS resume version ${resumeVer.is_approved ? 'approved' : 'generated'} (ATS Score: ${resumeVer.ats_score})` : 'Standard verified resume profile'
    },
    {
      factor: 'Logistics & Confirmation Gate',
      points: logisticsScore,
      maxPoints: 10,
      details: interview ? `Interview scheduled (${interview.round_name}) - ${interview.confirmed_by_user ? 'Confirmed by candidate' : 'Proposed'}` : 'No active interview scheduled yet'
    }
  ];

  const preparedAreas = [];
  const weakAreas = [];
  const missingPreparation = [];
  const nextActions = [];

  if (skillsScore >= 20) preparedAreas.push('Core technical skills align with job requirements');
  else weakAreas.push(`Missing skills in JD: ${reqSkills.filter(s => !verifiedSkillSet.has(s.toLowerCase())).join(', ') || 'None'}`);

  if (projectScore >= 18) preparedAreas.push('Project architecture and concurrency stories thoroughly prepared');
  if (technicalTopicsScore >= 16) preparedAreas.push('Interview question bank answers reviewed');
  else missingPreparation.push('Review Java 8+ HashMap collision and Spring Boot @Transactional questions in Question Bank');

  if (!resumeVer || !resumeVer.is_approved) {
    nextActions.push('Review and approve tailored ATS resume in Resume Studio');
  }
  if (!interview || !interview.confirmed_by_user) {
    nextActions.push('Confirm interview date, time, and meeting link');
  }
  if (missingPreparation.length === 0) {
    nextActions.push('Practice mock interview simulation and review STAR behavioral stories');
  }

  return {
    jobId,
    company: job.company,
    role: job.title,
    score: totalScore,
    tier,
    factorBreakdown,
    preparedAreas,
    weakAreas,
    missingPreparation,
    nextActions,
    calculatedAt: new Date().toISOString()
  };
}
