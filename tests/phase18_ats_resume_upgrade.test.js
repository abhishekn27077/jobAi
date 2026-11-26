import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCandidateProfile } from '../src/profile/profileManager.js';
import { generateTailoredResume, exportTailoredDocumentsForJob, auditDocumentTruthfulness } from '../src/resumes/resumeGenerator.js';
import { generateStudioResume } from '../src/resumes/resumeStudioService.js';
import { extractJdRequirements } from '../src/resumes/jdAnalyzer.js';
import { calculateAtsScore } from '../src/resumes/atsScorer.js';
import { renderResumeHtml } from '../src/resumes/templates/templateEngine.js';
import { exportToPdf, validateGeneratedPdf } from '../src/resumes/exporters/pdfExporter.js';

test('Phase 18.1: Master profile removes nearvia.app portfolio & places Employee Leave Management under Anudip internship', () => {
  const profile = loadCandidateProfile();
  assert.equal(profile.personal.portfolio, undefined, 'Portfolio field must be absent until user provides one');
  assert.ok(profile.personal.linkedIn.includes('abhishekn27077'));
  assert.ok(profile.personal.gitHub.includes('abhishekn27077'));

  const anudip = (profile.experience || []).find(e => /anudip/i.test(e.company || ''));
  assert.ok(anudip, 'Anudip Foundation internship must exist');
  assert.ok(
    (anudip.bullets || []).some(b => /leave management/i.test(b)),
    'Employee Leave Management must be placed under Anudip Foundation internship'
  );

  const projectNames = (profile.projects || []).map(p => p.name);
  assert.equal(projectNames.length, 7, 'Master registry must preserve all 7 verified projects');
  assert.ok(projectNames.some(n => /leave management/i.test(n)), 'Employee Leave Management must exist in master registry');
  assert.ok(projectNames.some(n => /voting/i.test(n)), 'Online Voting System must exist in master registry');
  assert.ok(/nearvia/i.test(projectNames[0]), 'NearVia must be #1 flagship project');
  assert.ok(/finsight/i.test(projectNames[1]), 'FinSight must be #2 project');
  assert.ok(/aquaponics/i.test(projectNames[2]), 'Smart Aquaponics must be #3 project');
});

test('Phase 18.2: Java/Full-Stack tailoring prioritizes NearVia #1 & places Leave Management under Internship', async () => {
  const job = {
    id: 102055,
    title: 'Software Engineer-Full Stack Java Developer',
    company: 'NeST Digital',
    description: 'Junior Full Stack Java Developer with Java, Spring Boot, Hibernate/JPA, REST APIs, TypeScript, SQL, Git, Maven.'
  };
  const studio = await generateStudioResume(job);
  assert.equal(studio.audit.passed, true, 'Truthfulness audit must pass');
  assert.equal(studio.content.personal.portfolio, undefined);
  assert.ok(/nearvia/i.test(studio.content.projects[0].name), 'NearVia must be #1 project for Java Full Stack');
  assert.ok(/finsight/i.test(studio.content.projects[1].name), 'FinSight must be #2 project');

  // Transparent 5-pillar ATS breakdown
  const tb = studio.atsScore.transparentBreakdown;
  assert.ok(tb.A_keywordAlignment);
  assert.ok(tb.B_evidenceTechnicalMatch);
  assert.ok(tb.C_formattingAndReadability);
  assert.ok(tb.D_contentQuality);
  assert.ok(tb.E_eligibilityOrQualificationGaps);
});

test('Phase 18.3: Python/AI tailoring prioritizes FinSight, Smart Rover, and Drowsiness Detection', async () => {
  const job = {
    id: 99918,
    title: 'Junior Python & Computer Vision Engineer',
    company: 'VisionAI Labs',
    description: 'Looking for Python, FastAPI, OpenCV, Computer Vision, and Machine Learning project experience.'
  };
  const studio = await generateStudioResume(job);
  assert.equal(studio.audit.passed, true);
  const topTwo = studio.content.projects.slice(0, 2).map(p => p.name.toLowerCase());
  assert.ok(topTwo.some(n => n.includes('finsight') || n.includes('rover') || n.includes('drowsiness')));
});

test('Phase 18.4: Auditor rejects nearvia.app as portfolio and fabricated claims', () => {
  const profile = loadCandidateProfile();
  const badAudit = auditDocumentTruthfulness('Portfolio: nearvia.app | Built production-grade microservices', profile);
  assert.equal(badAudit.passed, false);
  assert.ok(badAudit.flags.some(f => f.category === 'INCORRECT_PORTFOLIO_URL'));
  assert.ok(badAudit.flags.some(f => f.category === 'UNVERIFIED_PRODUCTION_CLAIM'));
});

test('Phase 18.5: PDF generation, text extraction & layout validation (no nearvia.app portfolio, correct project order, master profile preserved)', async () => {
  const profileBefore = fs.readFileSync(path.resolve('data/candidate_profile.json'), 'utf-8');
  const job = {
    id: 102055,
    title: 'Software Engineer-Full Stack Java Developer',
    company: 'NeST Digital',
    description: 'Java, Spring Boot, Hibernate/JPA, Angular, TypeScript, HTML, CSS, REST APIs, SQL, Git, Maven.'
  };

  const studio = await generateStudioResume(job, { template: 'ats_professional' });
  const html = renderResumeHtml(studio.content, 'ats_professional');
  const samplePdfPath = path.resolve('output/resumes/102055_Phase18_NeST_Digital_Resume.pdf');
  await exportToPdf(html, samplePdfPath);

  const validation = await validateGeneratedPdf(samplePdfPath, {
    expectedName: 'Abhishek N',
    expectedProjectOrder: ['NearVia', 'FinSight', 'Aquaponics'],
    requireLeaveManagementUnderInternship: true
  });

  assert.equal(validation.valid, true, `PDF validation failed: ${validation.errors.join('; ')}`);
  assert.ok(validation.pageCount >= 1 && validation.pageCount <= 2, `Expected 1-2 pages, got ${validation.pageCount}`);
  assert.equal(/portfolio[^\n]*nearvia\.app/i.test(validation.extractedText), false);

  const profileAfter = JSON.parse(fs.readFileSync(path.resolve('data/candidate_profile.json'), 'utf-8'));
  const profileBeforeObj = JSON.parse(profileBefore);
  assert.equal(profileAfter.personal.portfolio, undefined, 'Master candidate profile must not gain a portfolio URL');
  assert.equal(profileAfter.projects.length, profileBeforeObj.projects.length, 'Master candidate profile projects must remain unchanged');
  assert.equal(profileAfter.experience.length, profileBeforeObj.experience.length, 'Master candidate profile experience must remain unchanged');
});

test('Phase 18.6: Cisco Evergreen Fresher job (with Chennai/Mumbai locations) selects NearVia #1, FinSight #2, Smart Aquaponics #3 & deduplicates Best AI Innovation', async () => {
  const ciscoJob = {
    id: 102,
    title: 'Software Engineer – Evergreen (Fresher)',
    company: 'Cisco',
    description: 'Cisco is hiring freshers for the Software Engineer – Evergreen, Full-Time role. Eligibility: Bachelor’s Degree in a relevant technical discipline. Experience: Freshers / 0 Years. Locations: Bangalore, Chennai, Gurgaon, Hyderabad, Mumbai, Pune.'
  };
  const studio = await generateStudioResume(ciscoJob, { template: 'ats_professional' });
  assert.equal(studio.audit.passed, true);
  assert.equal(studio.content.personal.portfolio, undefined);
  assert.ok(/nearvia/i.test(studio.content.projects[0].name), 'NearVia must be #1 for Cisco Software Engineer');
  assert.ok(/finsight/i.test(studio.content.projects[1].name), 'FinSight must be #2');
  assert.ok(/aquaponics/i.test(studio.content.projects[2].name), 'Smart Aquaponics must be #3');

  const html = renderResumeHtml(studio.content, 'ats_professional');
  const pdfPath = path.resolve('output/resumes/102_v2_Cisco_Resume.pdf');
  await exportToPdf(html, pdfPath);
  const val = await validateGeneratedPdf(pdfPath, {
    expectedName: 'Abhishek N',
    expectedProjectOrder: ['NearVia', 'FinSight', 'Smart Aquaponics'],
    requireLeaveManagementUnderInternship: true
  });
  assert.equal(val.valid, true, `Cisco PDF validation failed: ${val.errors.join('; ')}`);
  assert.equal(val.pageCount, 1, `Cisco resume should fit cleanly on 1 balanced page without orphan spillover, got ${val.pageCount}`);
  const aiAwardCount = (val.extractedText.match(/best ai innovation/gi) || []).length;
  assert.ok(aiAwardCount <= 1, `Best AI Innovation must appear at most once, found ${aiAwardCount}`);
  const headerLines = val.extractedText.split('\n').slice(0, 3).join(' ');
  assert.equal(/nearvia\.app/i.test(headerLines), false, 'nearvia.app must not appear in personal header');
});
