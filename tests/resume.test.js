import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { generateTailoredResume, generateTailoredCoverLetter, auditDocumentTruthfulness, exportTailoredDocumentsForJob } from '../src/resumes/resumeGenerator.js';
import { loadCandidateProfile } from '../src/profile/profileManager.js';

test('Dual-Agent Resume Generator tailors projects for Java role truthfully', () => {
  const profile = loadCandidateProfile();
  const javaJob = {
    id: 101,
    title: 'Junior Java Developer',
    company: 'Fintech Solutions India',
    location: 'Bengaluru',
    description: 'Looking for a Java / Spring Boot engineer with MySQL and REST API skills.'
  };

  const res = generateTailoredResume(javaJob, profile);
  assert.ok(res.markdown.includes('Abhishek N'));
  assert.ok(res.markdown.includes('Java Backend Developer') || res.markdown.includes('Java Full Stack'));
  assert.ok(res.markdown.includes('AIMS Institutes'));
  assert.ok(res.markdown.includes('Anudip Foundation'));
  assert.strictEqual(res.audit.passed, true);
});

test('Auditor strictly flags unverified degrees or inflated claims', () => {
  const profile = loadCandidateProfile();
  const badContent = 'Candidate holds a B.Tech and Ph.D in Computer Science with 8+ years of commercial experience.';
  const audit = auditDocumentTruthfulness(badContent, profile);

  assert.strictEqual(audit.passed, false);
  assert.ok(audit.warnings.length >= 2);
});

test('Auditor strictly flags unsupported buzzwords (production-grade, microservices, immediate joiner)', () => {
  const profile = loadCandidateProfile();

  const audit1 = auditDocumentTruthfulness('Engineered a production-grade application for enterprise users.', profile);
  assert.strictEqual(audit1.passed, false);
  assert.ok(audit1.warnings.some(w => w.includes('UNVERIFIED_PRODUCTION_CLAIM')));

  const audit2 = auditDocumentTruthfulness('Led architecture of microservices with Spring Boot.', profile);
  assert.strictEqual(audit2.passed, false);
  assert.ok(audit2.warnings.some(w => w.includes('UNVERIFIED_ARCHITECTURE_CLAIM')));

  const audit3 = auditDocumentTruthfulness('Full stack engineer and immediate joiner available now.', profile);
  assert.strictEqual(audit3.passed, false);
  assert.ok(audit3.warnings.some(w => w.includes('UNVERIFIED_AVAILABILITY_CLAIM')));
});

test('Cover letter generates personalized and accurate text', () => {
  const javaJob = {
    id: 102,
    title: 'Spring Boot Developer',
    company: 'Apex Technologies',
    location: 'Bangalore'
  };

  const letter = generateTailoredCoverLetter(javaJob);
  assert.ok(letter.markdown.includes('Apex Technologies'));
  assert.ok(letter.markdown.includes('Spring Boot Developer'));
  assert.ok(letter.markdown.includes('NearVia'));
  assert.ok(letter.markdown.includes('Employee Leave Management System'));
});

test('Playwright compiles ATS resume to valid PDF file', async () => {
  const sampleJob = {
    id: 999,
    title: 'Java Full Stack Developer',
    company: 'TestCorp',
    location: 'Bengaluru',
    description: 'Core Java, Spring Boot, React, MySQL'
  };

  const exported = await exportTailoredDocumentsForJob(sampleJob);
  assert.ok(fs.existsSync(exported.resumePdfPath), 'Resume PDF must be created on disk');
  assert.ok(fs.existsSync(exported.resumeMdPath), 'Resume Markdown must exist');
  assert.ok(fs.existsSync(exported.letterMdPath), 'Cover letter must exist');

  const stats = fs.statSync(exported.resumePdfPath);
  assert.ok(stats.size > 5000, `PDF file size should be > 5KB, got ${stats.size} bytes`);
});
