import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractJdRequirements } from '../src/resumes/jdAnalyzer.js';
import { calculateAtsScore } from '../src/resumes/atsScorer.js';
import { generateStudioResume } from '../src/resumes/resumeStudioService.js';
import { renderResumeHtml, renderResumeMarkdown } from '../src/resumes/templates/templateEngine.js';
import { exportToDocx } from '../src/resumes/exporters/docxExporter.js';
import { exportToPdf } from '../src/resumes/exporters/pdfExporter.js';
import {
  saveResumeVersion,
  getResumeVersionsForJob,
  getResumeVersionById,
  approveResumeVersion,
  deleteResumeVersion
} from '../src/resumes/resumeVersionManager.js';
import { getDatabase } from '../src/db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.resolve(__dirname, '../output');

// Realistic Job Descriptions for Testing
const JAVA_JD = {
  id: 8881,
  title: 'Junior Java Developer',
  company: 'Infosys BPM',
  location: 'Bangalore, India',
  description: `
    Role: Junior Java Software Engineer (Fresher / 0-1 Years)
    We are looking for an MCA / B.Tech graduate in Computer Science to join our backend engineering team.
    
    Requirements:
    - Strong knowledge of Java, OOP principles, Collections, and Multithreading.
    - Hands-on experience with Spring Boot and RESTful API development.
    - Relational databases knowledge (MySQL or PostgreSQL).
    - Familiarity with Git, Postman, and Maven.
    
    Good to have:
    - Knowledge of Docker and CI/CD pipelines.
    - Basic frontend familiarity with React or JavaScript.
    
    Responsibilities:
    - Develop clean, maintainable backend microservices using Spring Boot.
    - Write unit tests and participate in agile sprints.
  `
};

const PYTHON_AI_JD = {
  id: 8882,
  title: 'Associate AI/ML Engineer',
  company: 'CognitiveScale',
  location: 'Bangalore, India',
  description: `
    We are hiring freshers (0-1 years) for an Associate AI/ML Engineer position.
    
    Required Skills:
    - Strong programming proficiency in Python.
    - Experience in Computer Vision using OpenCV.
    - Familiarity with REST APIs using FastAPI or Flask.
    - Understanding of Machine Learning algorithms and data processing with Pandas and NumPy.
    
    Qualifications:
    - MCA or Degree in Computer Science with strong academic project record.
  `
};

const SENIOR_JD = {
  id: 8883,
  title: 'Senior Lead Java Architect',
  company: 'Enterprise Systems',
  location: 'Bangalore, India',
  description: `
    Requires 7+ years of commercial software experience designing enterprise distributed architectures, Kubernetes clusters, and cloud-native microservices.
  `
};

test('JD Analyzer extracts mandatory vs preferred skills and detects fresher eligibility', () => {
  const analysis = extractJdRequirements(JAVA_JD);

  assert.ok(analysis.languages.includes('Java'), 'Should identify Java language');
  assert.ok(analysis.frameworksAndTools.includes('Spring Boot'), 'Should identify Spring Boot');
  assert.ok(analysis.databases.includes('MySQL') || analysis.databases.includes('PostgreSQL'), 'Should identify relational databases');
  assert.ok(analysis.requiredSkills.includes('Java'), 'Java must be in required skills');
  assert.ok(analysis.preferredSkills.includes('Docker'), 'Docker should be recognized as preferred/good-to-have');
  assert.strictEqual(analysis.experience.isFresherEligible, true, 'Should be fresher eligible');
  assert.strictEqual(analysis.education.isEligibleForMCA, true, 'MCA should be recognized as eligible');
});

test('ATS Scoring Engine evaluates candidate profile truthfully with 7-category breakdown', () => {
  const analysis = extractJdRequirements(JAVA_JD);
  const studioResult = generateStudioResume(JAVA_JD, { jdAnalysis: analysis });

  return studioResult.then(res => {
    const ats = res.atsScore;
    assert.ok(ats.totalScore >= 75, `Expected high ATS score for matching Java fresher role, got ${ats.totalScore}`);
    assert.strictEqual(ats.maxScore, 100);
    assert.strictEqual(ats.label, 'CareerOS ATS Compatibility Estimate');

    // Dual Indicators
    assert.ok(ats.resumeCompatibilityScore >= 75, `Expected high compatibility score, got ${ats.resumeCompatibilityScore}`);
    assert.strictEqual(ats.eligibilityAssessment.status, 'ELIGIBLE', 'Java Fresher role should be ELIGIBLE');
    assert.strictEqual(ats.eligibilityAssessment.unmetMandatoryRequirements.length, 0);

    // Check all 7 categories exist
    const cats = ats.categories;
    assert.ok(cats.requiredSkillCoverage.score >= 18, 'Required skills should score high');
    assert.ok(cats.technicalRelevance.score > 12, 'Technical relevance should score high');
    assert.strictEqual(cats.experienceEligibility.score, 15, 'Fresher eligibility should get full 15 pts');
    assert.strictEqual(cats.educationMatch.score, 10, 'MCA qualification should get full 10 pts');
    assert.ok(cats.projectRelevance.score >= 7, 'Relevant projects should get points');
    assert.ok(cats.atsReadability.score >= 8, 'ATS readability should score high');
    assert.ok(cats.achievementsAndClarity.score >= 4, 'Achievements should score high');

    // Check keyword analysis
    assert.ok(ats.keywordAnalysis.matchedKeywords.includes('Java'));
    assert.ok(ats.keywordAnalysis.matchedKeywords.includes('Spring Boot'));
  });
});

test('ATS Scoring Engine strictly deducts points for Senior role seniority mismatch', () => {
  const analysis = extractJdRequirements(SENIOR_JD);
  const studioResult = generateStudioResume(SENIOR_JD, { jdAnalysis: analysis });

  return studioResult.then(res => {
    const ats = res.atsScore;
    assert.strictEqual(ats.categories.experienceEligibility.score, 0, 'Senior role must get 0 for experience');
    assert.ok(ats.categories.experienceEligibility.reason.includes('Strict mismatch'), 'Should state strict mismatch');
    
    // Dual Indicators: Ineligible role must have MANDATORY_NOT_MET and capped overall score
    assert.strictEqual(ats.eligibilityAssessment.status, 'MANDATORY_NOT_MET');
    assert.ok(ats.eligibilityAssessment.unmetMandatoryRequirements.length > 0);
    assert.ok(ats.totalScore <= 45, `Senior role overall match score should be strictly capped at <= 45, got ${ats.totalScore}`);
    assert.ok(ats.overallMatch.alert !== null);
  });
});

test('Resume Generator preserves absolute truthfulness and never invents unverified claims', () => {
  return generateStudioResume(JAVA_JD).then(res => {
    const content = res.content;

    // Must never claim fabricated degrees or companies
    assert.strictEqual(content.education[0].institution, 'AIMS Institutes, Bangalore');
    assert.strictEqual(content.education[0].degree, 'Master of Computer Applications (MCA)');
    assert.strictEqual(content.education[1].degree, 'Bachelor of Computer Applications (BCA)');
    assert.strictEqual(content.experience[0].company, 'Anudip Foundation, Bangalore');
    assert.strictEqual(content.experience[0].role, 'Advanced Java Full Stack Development Intern');

    // Must pass auditor verification
    assert.strictEqual(res.audit.passed, true, 'Auditor gate must pass without fabrication warnings');
  });
});

test('Resume Studio recalibrates project prioritization for AI/ML job description', () => {
  return generateStudioResume(PYTHON_AI_JD).then(res => {
    const projects = res.content.projects;
    const projectNames = projects.map(p => p.name);

    // AI/ML JD must feature FinSight or Smart Rover at the top
    assert.ok(
      projectNames[0].includes('FinSight') || projectNames[0].includes('Smart Rover'),
      `Expected AI project at top for AI JD, got ${projectNames[0]}`
    );
  });
});

test('Template Engine renders all 3 templates correctly', () => {
  return generateStudioResume(JAVA_JD).then(res => {
    const atsHtml = renderResumeHtml(res.content, 'ats_professional');
    assert.ok(atsHtml.includes('ABHISHEK N'), 'ATS professional should contain name in uppercase');
    assert.ok(atsHtml.includes('Professional Summary'));

    const modernHtml = renderResumeHtml(res.content, 'modern_professional');
    assert.ok(modernHtml.includes('Modern Resume'));
    assert.ok(modernHtml.includes('#1e3a8a'), 'Modern template should use navy accent');

    const compactHtml = renderResumeHtml(res.content, 'compact_one_page');
    assert.ok(compactHtml.includes('Compact One-Page'));

    const md = renderResumeMarkdown(res.content);
    assert.ok(md.includes('## PROFESSIONAL SUMMARY'));
    assert.ok(md.includes('## TECHNICAL SKILLS'));
  });
});

test('DOCX Exporter generates a valid .docx file on disk', async () => {
  const res = await generateStudioResume(JAVA_JD);
  const testDocxPath = path.join(OUTPUT_DIR, 'resumes', 'test_sample_resume.docx');

  await exportToDocx(res.content, testDocxPath);
  assert.ok(fs.existsSync(testDocxPath), 'DOCX file must be created on disk');
  const stats = fs.statSync(testDocxPath);
  assert.ok(stats.size > 5000, `DOCX file should be > 5KB, got ${stats.size} bytes`);
});

test('Playwright PDF Exporter compiles valid PDF on disk', async () => {
  const res = await generateStudioResume(JAVA_JD);
  const html = renderResumeHtml(res.content, 'ats_professional');
  const testPdfPath = path.join(OUTPUT_DIR, 'resumes', 'test_sample_resume.pdf');

  await exportToPdf(html, testPdfPath);
  assert.ok(fs.existsSync(testPdfPath), 'PDF file must be created on disk');
  const stats = fs.statSync(testPdfPath);
  assert.ok(stats.size > 20000, `PDF file should be > 20KB, got ${stats.size} bytes`);
});

test('Resume Version Manager persists, approves, and integrates with application tracker', async () => {
  const db = getDatabase();

  // Insert a test job into jobs table to satisfy foreign key
  const testJobId = 99999;
  db.prepare(`
    INSERT OR REPLACE INTO jobs (id, external_slug, source, title, company, location, url, status)
    VALUES (?, 'test-slug-99999', 'test', 'Junior Java Developer', 'Apex Labs', 'Bangalore', 'https://example.com/job/99999', 'discovered')
  `).run(testJobId);

  const res = await generateStudioResume(JAVA_JD);

  // 1. Save version 1
  const v1 = await saveResumeVersion({
    jobId: testJobId,
    company: 'Apex Labs',
    jobTitle: 'Junior Java Developer',
    jdSnapshot: JAVA_JD.description,
    template: 'ats_professional',
    generationMode: 'Local Deterministic Engine',
    content: res.content,
    atsScore: res.atsScore.totalScore,
    atsBreakdown: res.atsScore.categories,
    missingKeywords: res.atsScore.keywordAnalysis.missingMandatory,
    matchedKeywords: res.atsScore.keywordAnalysis.matchedKeywords
  });

  assert.ok(v1.id > 0, 'Version record should have ID');
  assert.strictEqual(v1.version_number, 1);
  assert.strictEqual(v1.is_approved, 0);

  // 2. Save version 2
  const v2 = await saveResumeVersion({
    jobId: testJobId,
    company: 'Apex Labs',
    jobTitle: 'Junior Java Developer',
    jdSnapshot: JAVA_JD.description,
    template: 'modern_professional',
    generationMode: 'Local Deterministic Engine',
    content: res.content,
    atsScore: res.atsScore.totalScore,
    atsBreakdown: res.atsScore.categories,
    missingKeywords: res.atsScore.keywordAnalysis.missingMandatory,
    matchedKeywords: res.atsScore.keywordAnalysis.matchedKeywords
  });

  assert.strictEqual(v2.version_number, 2);

  // 3. Query versions for job
  const versions = getResumeVersionsForJob(testJobId);
  assert.strictEqual(versions.length, 2);

  // 4. Approve version 2
  const approved = await approveResumeVersion(v2.id);
  assert.strictEqual(approved.is_approved, 1);

  // Check job status updated in jobs table
  const jobRow = db.prepare('SELECT status FROM jobs WHERE id = ?').get(testJobId);
  assert.strictEqual(jobRow.status, 'ready_to_apply', 'Job status must be updated to ready_to_apply');

  // Check applications table integration
  const appRow = db.prepare('SELECT * FROM applications WHERE job_id = ?').get(testJobId);
  assert.ok(appRow, 'Application record must exist');
  assert.strictEqual(appRow.user_approved, 1);
  assert.ok(appRow.resume_version.includes('v2'));

  // 5. Delete version 1
  const delRes = deleteResumeVersion(v1.id);
  assert.strictEqual(delRes.deleted, true);

  const remaining = getResumeVersionsForJob(testJobId);
  assert.strictEqual(remaining.length, 1);

  // Clean up test job
  db.prepare('DELETE FROM jobs WHERE id = ?').run(testJobId);
});

test('Truthfulness Auditor strictly blocks saving or approving resumes with unverified claims', async () => {
  const db = getDatabase();
  const testJobId = 7779;
  db.prepare(`
    INSERT OR REPLACE INTO jobs (id, title, company, location, url, description, status, source)
    VALUES (?, 'Java Engineer', 'Audit Corp', 'Bengaluru', 'https://example.com/job/7779', 'Java Spring Boot role', 'saved', 'test')
  `).run(testJobId);

  // Content with unverified claim: "production-grade"
  const badContent1 = {
    personal: { fullName: 'Abhishek N', email: 'test@example.com', phone: '+91-9999999999' },
    summary: 'Built production-grade enterprise microservices architectures.',
    technicalSkills: { languages: ['Java'] },
    experience: [],
    projects: [],
    education: [{ degree: 'Master of Computer Applications (MCA)' }]
  };

  await assert.rejects(
    async () => {
      await saveResumeVersion({
        jobId: testJobId,
        company: 'Audit Corp',
        jobTitle: 'Java Engineer',
        content: badContent1,
        atsScore: 75
      });
    },
    (err) => {
      assert.strictEqual(err.statusCode, 422);
      assert.ok(err.message.includes('Truthfulness Auditor blocked save'));
      assert.ok(err.audit.flags.some(f => f.category === 'UNVERIFIED_PRODUCTION_CLAIM'));
      assert.ok(err.audit.flags.some(f => f.category === 'UNVERIFIED_ARCHITECTURE_CLAIM'));
      return true;
    }
  );

  // Content with forbidden degree: "B.Tech"
  const badContent2 = {
    personal: { fullName: 'Abhishek N', email: 'test@example.com', phone: '+91-9999999999' },
    summary: 'Full stack Java developer.',
    technicalSkills: { languages: ['Java'] },
    experience: [],
    projects: [],
    education: [{ degree: 'Bachelor of Technology (B.Tech)' }]
  };

  await assert.rejects(
    async () => {
      await saveResumeVersion({
        jobId: testJobId,
        company: 'Audit Corp',
        jobTitle: 'Java Engineer',
        content: badContent2,
        atsScore: 75
      });
    },
    (err) => {
      assert.strictEqual(err.statusCode, 422);
      assert.ok(err.audit.flags.some(f => f.category === 'UNVERIFIED_DEGREE'));
      return true;
    }
  );

  db.prepare('DELETE FROM jobs WHERE id = ?').run(testJobId);
});
