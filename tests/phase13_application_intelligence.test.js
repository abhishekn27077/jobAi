/**
 * CareerOS — Phase 13 Test Suite: Application Intelligence, ATS Readiness & Quality
 * Validates:
 * 1. 3-Tier Application Readiness Assessment (READY TO REVIEW, NEEDS ATTENTION, BLOCKED)
 * 2. 14-Dimension Resume ATS Quality Checker & Non-Fabrication Audit
 * 3. Screening Question Intelligence, Reusable Vault, and Truthfulness Validation
 * 4. Application Package Generator (JSON bundle, document checklist, submission guide)
 * 5. Application Tracker 11-Stage Lifecycle & Strict Human Approval Gate
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assessApplicationReadiness, READINESS_TIERS } from '../src/automation/applicationReadiness.js';
import { checkResumeAtsQuality, ATS_QUALITY_TIERS } from '../src/resumes/atsQualityChecker.js';
import {
  generateScreeningAnswers,
  saveScreeningAnswerOverride,
  getScreeningAnswersVault,
  validateAnswerTruthfulness
} from '../src/automation/screeningEngine.js';
import { generateApplicationPackage, prepareApplication } from '../src/automation/applicationWorkflow.js';
import {
  updateApplicationStatus,
  getApplicationByJobId,
  VALID_APPLICATION_STATUSES
} from '../src/tracker/applicationTracker.js';
import { getDatabase } from '../src/db/schema.js';
import { loadCandidateProfile } from '../src/profile/profileManager.js';

describe('Phase 13: Application Intelligence & Readiness Assessment', () => {
  const profile = loadCandidateProfile();

  it('1. Application Readiness: Correctly classifies eligible, verified job as READY TO REVIEW', () => {
    const job = {
      id: 99101,
      title: 'Junior Java Developer',
      company: 'TechCorp India',
      location: 'Bengaluru, Karnataka, India',
      url: 'https://boards.greenhouse.io/techcorp/jobs/99101',
      source: 'Greenhouse',
      verification_status: 'verified_active',
      status: 'discovered',
      fresher_eligible: 1,
      experience_min: 0,
      experience_max: 1,
      score: 88,
      required_skills: JSON.stringify(['Java', 'Spring Boot', 'SQL'])
    };

    const resumeVersion = {
      id: 1,
      version_number: 1,
      pdf_path: 'output/resumes/test_tailored_resume.pdf',
      template: 'ats_professional',
      ats_score: 92,
      content: {
        name: profile.name,
        contact: { email: profile.email, phone: profile.phone, location: profile.location },
        skills: { backend: ['Java', 'Spring Boot', 'SQL'] },
        education: profile.education,
        projects: profile.projects,
        experience: profile.experience,
        summary: 'Java Backend Developer'
      }
    };

    const evaluation = {
      score: 88,
      rating: 5,
      recommendation: 'RECOMMENDED',
      fresherEligible: 1,
      eligibilityTier: 'ELIGIBLE',
      summaryReason: 'Explicitly open to freshers with strong Java alignment.'
    };

    const report = assessApplicationReadiness(job, null, resumeVersion, evaluation);

    assert.equal(report.readinessTier, READINESS_TIERS.READY_TO_REVIEW);
    assert.ok(report.readinessScore >= 80, `Expected score >= 80, got ${report.readinessScore}`);
    assert.equal(report.blockers.length, 0);
    assert.ok(report.checklist.length >= 8);
    assert.ok(report.nextActions.length > 0);
  });

  it('2. Application Readiness: Strictly BLOCKS expired or closed job listings', () => {
    const expiredJob = {
      id: 99102,
      title: 'Java Engineer',
      company: 'ClosedCorp',
      location: 'Bengaluru',
      url: 'https://jobs.lever.co/closedcorp/99102',
      verification_status: 'expired',
      status: 'expired',
      fresher_eligible: 1
    };

    const report = assessApplicationReadiness(expiredJob);

    assert.equal(report.readinessTier, READINESS_TIERS.BLOCKED);
    assert.ok(report.blockers.some(b => b.toLowerCase().includes('expired') || b.toLowerCase().includes('closed')));
    assert.ok(report.readinessScore < 60);
  });

  it('3. Application Readiness: Strictly BLOCKS ineligible roles (Senior / Excessive Experience)', () => {
    const seniorJob = {
      id: 99103,
      title: 'Senior Java Architect',
      company: 'Enterprise Inc',
      location: 'Bengaluru',
      url: 'https://jobs.lever.co/enterprise/99103',
      verification_status: 'verified_active',
      status: 'discovered',
      fresher_eligible: 0,
      experience_min: 6
    };

    const evaluation = {
      score: 30,
      fresherEligible: 0,
      eligibilityTier: 'INELIGIBLE',
      summaryReason: 'Requires 6+ years experience, ineligible for freshers.'
    };

    const report = assessApplicationReadiness(seniorJob, null, null, evaluation);

    assert.equal(report.readinessTier, READINESS_TIERS.BLOCKED);
    assert.ok(report.blockers.some(b => b.includes('eligible') || b.includes('6+ years')));
  });

  it('4. Application Readiness: Flags NEEDS ATTENTION when tailored resume is uncompiled', () => {
    const job = {
      id: 99104,
      title: 'Software Engineer Trainee',
      company: 'InnovateTech',
      location: 'Bengaluru',
      url: 'https://innovatetech.com/careers/104',
      verification_status: 'unverified',
      status: 'discovered',
      fresher_eligible: 1,
      experience_min: 0,
      score: 75
    };

    const report = assessApplicationReadiness(job, null, null, { fresherEligible: 1, score: 75 });

    assert.equal(report.readinessTier, READINESS_TIERS.NEEDS_ATTENTION);
    assert.ok(report.warnings.some(w => w.toLowerCase().includes('resume')));
    assert.ok(report.missingFields.includes('Tailored Resume Version'));
  });

  it('5. Application Readiness: Strictly BLOCKS duplicate applications already submitted', () => {
    const job = {
      id: 99105,
      title: 'Java Developer',
      company: 'AppliedCorp',
      location: 'Bengaluru',
      url: 'https://appliedcorp.com/careers/105',
      verification_status: 'verified_active',
      status: 'discovered',
      fresher_eligible: 1
    };

    const existingApp = {
      status: 'submitted',
      applied_date: '2026-11-20T10:00:00.000Z'
    };

    const report = assessApplicationReadiness(job, existingApp, null, { fresherEligible: 1 });

    assert.equal(report.readinessTier, READINESS_TIERS.BLOCKED);
    assert.ok(report.blockers.some(b => b.toLowerCase().includes('already submitted')));
  });
});

describe('Phase 13: 14-Dimension Resume ATS Quality Checker', () => {
  const profile = loadCandidateProfile();

  it('6. ATS Quality: High score for truthful candidate resume satisfying all 14 dimensions', () => {
    const validResumeContent = {
      name: profile.personal?.fullName || 'Abhishek N',
      title: 'Java Backend Developer',
      contact: {
        email: profile.personal?.email || 'abhishek27077@gmail.com',
        phone: profile.personal?.phone || '+91-8792213854',
        location: profile.personal?.location || 'Bangalore, Karnataka, India',
        linkedin: 'https://linkedin.com/in/abhishekn',
        github: 'https://github.com/abhishekn27077'
      },
      summary: 'Disciplined Java Backend Developer with strong foundations in Core Java, OOP principles, and Spring Boot REST APIs.',
      skills: {
        languages: ['Java', 'Python', 'SQL'],
        frameworks: ['Spring Boot', 'Hibernate/JPA', 'React.js'],
        databases: ['MySQL', 'PostgreSQL']
      },
      education: profile.education,
      projects: profile.projects,
      experience: profile.experience,
      template: 'ats_professional'
    };

    const job = {
      title: 'Java Developer',
      company: 'Alpha Innovations',
      required_skills: JSON.stringify(['Java', 'Spring Boot', 'SQL'])
    };

    const audit = checkResumeAtsQuality(validResumeContent, job);

    assert.ok(audit.atsQualityScore >= 85, `Expected score >= 85, got ${audit.atsQualityScore}`);
    assert.ok(audit.tier.includes('ATS EXCELLENT') || audit.tier.includes('ATS READY'));
    assert.equal(audit.checks.length, 14, `Expected 14 dimension checks, found ${audit.checks.length}`);
    assert.equal(audit.checksFailed, 0, `Expected 0 failed checks, got ${audit.checksFailed}`);
  });

  it('7. ATS Quality: Catches missing contact details and penalizes score', () => {
    const incompleteContent = {
      name: 'Candidate',
      title: 'Developer',
      summary: 'Java developer',
      skills: ['Java'],
      education: profile.education,
      projects: profile.projects,
      experience: profile.experience
    };

    const audit = checkResumeAtsQuality(incompleteContent, { title: 'Java Developer' });

    assert.ok(audit.findings.some(f => f.toLowerCase().includes('contact')));
    assert.ok(audit.atsQualityScore < 90);
    const contactCheck = audit.checks.find(c => c.id === '1_contact_details');
    assert.equal(contactCheck.status, 'failed');
  });

  it('8. ATS Quality: Strictly catches fabricated projects and unverified credentials', () => {
    const fabricatedContent = {
      name: profile.name,
      contact: { email: profile.email, phone: profile.phone, location: profile.location, github: 'https://github.com/abhishekn27077', linkedin: 'https://linkedin.com/in/abhishekn' },
      summary: 'Enterprise architect managing production kubernetes clusters.',
      skills: { languages: ['Java', 'SQL'] },
      education: profile.education,
      projects: [
        { name: 'Ultra Fake Enterprise Cloud Bank', description: 'Architected fake microservices system.' }
      ],
      experience: profile.experience
    };

    const audit = checkResumeAtsQuality(fabricatedContent, { title: 'Java Developer' });

    assert.ok(audit.findings.some(f => f.toLowerCase().includes('unverified project') || f.toLowerCase().includes('truthfulness')));
    const projCheck = audit.checks.find(c => c.id === '6_projects_grounding');
    assert.equal(projCheck.status, 'failed');
  });
});

describe('Phase 13: Screening Question Intelligence & Vault Persistence', () => {
  const profile = loadCandidateProfile();

  it('9. Screening Engine: Generates grounded answers for behavioral and logistical questions', () => {
    const job = { company: 'Cisco Systems', title: 'Software Engineer' };
    const answers = generateScreeningAnswers(job);

    assert.ok(answers.work_authorization, 'work_authorization question missing');
    assert.ok(answers.work_authorization.answer.includes('India'));

    assert.ok(answers.total_experience, 'total_experience question missing');
    assert.ok(answers.total_experience.answer.includes('Fresher') || answers.total_experience.answer.includes('0 years'));

    assert.ok(answers.why_company, 'why_company question missing');
    assert.ok(answers.why_company.answer.includes('Cisco Systems'));

    assert.ok(answers.tell_me_about_yourself, 'tell_me_about_yourself question missing');
    assert.ok(answers.tell_me_about_yourself.answer.includes('MCA'));

    assert.ok(answers.describe_project, 'describe_project question missing');
    assert.ok(answers.describe_project.answer.includes('Employee Leave Management System'));

    assert.ok(answers.strengths_weaknesses, 'strengths_weaknesses question missing');
  });

  it('10. Answer Vault: Persists user-customized answer overrides', () => {
    const testKey = 'salary_expectations';
    const customAnswer = 'Open to industry standard entry-level salary benchmark for Bengaluru (INR 4.5-6.5 LPA).';

    const saved = saveScreeningAnswerOverride(testKey, customAnswer);
    assert.equal(saved, true);

    const vault = getScreeningAnswersVault();
    assert.equal(vault[testKey]?.answer, customAnswer);

    const generated = generateScreeningAnswers({ company: 'TestCorp' });
    assert.equal(generated[testKey]?.answer, customAnswer);
  });

  it('11. Truthfulness Validator: Blocks experience or degree inflation in screening answers', () => {
    const validAnswer = 'Fresher with hands-on MCA coursework and Anudip Foundation Java internship.';
    const validRes = validateAnswerTruthfulness(validAnswer, profile);
    assert.equal(validRes.valid, true);

    const inflatedAnswer = 'I have 5 years of professional work experience and a PhD in Artificial Intelligence.';
    const invalidRes = validateAnswerTruthfulness(inflatedAnswer, profile);
    assert.equal(invalidRes.valid, false);
    assert.ok(invalidRes.issues.length >= 2);
  });
});

describe('Phase 13: 11-Stage Application Lifecycle & Human Approval Gate', () => {
  it('12. Application Tracker: Supports all 11+ lifecycle stages', () => {
    const expectedStages = [
      'discovered', 'saved', 'interested', 'preparing',
      'ready_for_review', 'user_submitted', 'submitted',
      'applied', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn', 'expired'
    ];

    expectedStages.forEach(st => {
      assert.ok(VALID_APPLICATION_STATUSES.includes(st), `Expected status ${st} to be valid`);
    });
  });

  it('13. Approval Gate: Throws error when attempting to mark submitted without userConfirmed', () => {
    const db = getDatabase();
    const testJob = db.prepare('SELECT id FROM jobs LIMIT 1').get();
    if (!testJob) return;

    assert.throws(
      () => updateApplicationStatus(testJob.id, 'submitted', { userConfirmed: false }),
      /Approval Gate Violation/i
    );

    assert.throws(
      () => updateApplicationStatus(testJob.id, 'applied', { userConfirmed: false }),
      /Approval Gate Violation/i
    );
  });
});

describe('Phase 13: End-to-End Application Package Generator', () => {
  it('14. Package Generator: Compiles complete package file on disk with all assets', async () => {
    const db = getDatabase();
    const testJob = db.prepare('SELECT id FROM jobs WHERE experience_min = 0 LIMIT 1').get() || db.prepare('SELECT id FROM jobs LIMIT 1').get();
    if (!testJob) return;

    const packageData = await generateApplicationPackage(testJob.id);

    assert.ok(packageData.packageId.startsWith('pkg_'));
    assert.equal(packageData.jobId, testJob.id);
    assert.ok(packageData.applicant.name.length > 0);
    assert.ok(packageData.applicant.email.includes('@'));
    assert.ok(packageData.readiness);
    assert.ok(packageData.atsQuality);
    assert.ok(packageData.coverLetter.length > 0);
    assert.ok(Object.keys(packageData.screeningAnswers).length > 0);
    assert.equal(packageData.humanApprovalGate.autoSubmitAllowed, false);

    assert.ok(packageData.packageFilePath);
    assert.ok(fs.existsSync(packageData.packageFilePath), `Package file not found at ${packageData.packageFilePath}`);

    const fileContent = JSON.parse(fs.readFileSync(packageData.packageFilePath, 'utf-8'));
    assert.equal(fileContent.jobId, testJob.id);
  });
});
