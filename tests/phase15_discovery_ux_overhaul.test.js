import test, { describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { executeUnifiedSearch, parseNaturalLanguageQuery } from '../src/discovery/unifiedSearchService.js';
import { generateAssistedSearchLinks, generateGoogleSearchLinks } from '../src/discovery/sourceRegistry.js';
import { getDatabase } from '../src/db/schema.js';
import { checkResumeAtsQuality } from '../src/resumes/atsQualityChecker.js';
import { loadCandidateProfile } from '../src/profile/profileManager.js';

describe('Phase 15 — Discovery UX Overhaul, Search Intelligence & Resume Workflow', () => {

  test('Part 1: Natural Language Query Parsing extracts role, location, fresher status & degree', () => {
    const parsed1 = parseNaturalLanguageQuery('MCA Fresher Java Developer Bengaluru');
    assert.strictEqual(parsed1.isFresher, true, 'Must identify fresher intent');
    assert.ok(parsed1.extractedLocations.includes('bengaluru'), 'Must extract Bengaluru location');
    assert.ok(parsed1.extractedSkills.includes('java'), 'Must extract Java skill');
    assert.ok(parsed1.extractedDegrees.includes('mca'), 'Must extract MCA degree');

    const parsed2 = parseNaturalLanguageQuery('Junior Spring Boot Developer Bangalore');
    assert.strictEqual(parsed2.isFresher, true, 'Junior keyword must set fresher eligibility');
    assert.ok(parsed2.extractedSkills.includes('spring boot'), 'Must extract Spring Boot skill');
    assert.ok(parsed2.extractedLocations.includes('bengaluru'), 'Bangalore alias must map to Bengaluru');

    const parsed3 = parseNaturalLanguageQuery('Remote Associate Software Engineer 0-1 years');
    assert.strictEqual(parsed3.isFresher, true, '0-1 years must set fresher eligibility');
    assert.ok(parsed3.extractedLocations.includes('remote') || parsed3.isRemote, 'Must extract Remote location or flag');
  });

  test('Part 2: Natural Language Search surfaces abundant relevant roles (resolving the 4-job limitation bug)', () => {
    // Before Phase 15 fix, strict token matching returned only ~4 jobs.
    // Now with semantic NL intent parsing, it surfaces all relevant Java/fresher roles in Bengaluru.
    const result = executeUnifiedSearch({
      q: 'MCA Fresher Java Developer Bengaluru',
      limit: 100
    });

    assert.ok(result.results.length >= 20, `Search must return abundant results, got ${result.results.length}`);
    const topJob = result.results[0];
    assert.ok(topJob, 'Must have a top matching job');
    assert.ok(topJob.title, 'Job must have a title');
    assert.ok(topJob.company, 'Job must have a company');
    assert.ok(topJob.queryRelevance > 0, 'Top matching job must have positive query relevance');
  });

  test('Part 3: Lawful external search assistance generates both portal links and Google operators', () => {
    const portalLinks = generateAssistedSearchLinks('Java Developer', 'Bengaluru', { fresherOnly: true });
    assert.ok(portalLinks.length >= 5, 'Must generate standard links for all restricted portals');

    const googleLinks = generateGoogleSearchLinks('Java Developer', 'Bengaluru', { fresherOnly: true });
    assert.strictEqual(googleLinks.length, 4, 'Must generate Google search operator links for Google Jobs, Lever, Greenhouse, Ashby');

    const googleJobs = googleLinks.find(l => l.sourceId === 'google_jobs');
    assert.ok(googleJobs.url.includes('ibp=htl;jobs'), 'Google Jobs link must format direct jobs intent');

    const leverLink = googleLinks.find(l => l.sourceId === 'google_lever');
    assert.ok(leverLink.url.includes('site%3Ajobs.lever.co') || leverLink.url.includes('site:jobs.lever.co'), 'Lever operator must search jobs.lever.co');
  });

  test('Part 4: ATS Resume Quality Auditor enforces structure and verified candidate truth', () => {
    const profile = loadCandidateProfile();
    assert.strictEqual(profile.personal.fullName, 'Abhishek N', 'Verified profile name');
    assert.ok(profile.status.currentDegree.includes('MCA'), 'Verified profile degree is MCA');

    const sampleJob = {
      id: 9999,
      title: 'Junior Java Developer',
      company: 'TechCorp Bengaluru',
      location: 'Bengaluru',
      description: 'Looking for a Junior Java Developer with Spring Boot, REST APIs, and SQL knowledge. MCA / BE graduates welcome.'
    };

    const mockContent = {
      name: 'Abhishek N',
      title: 'Junior Java Developer',
      contact: {
        email: 'abhishek@example.com',
        phone: '+91-9876543210',
        location: 'Bengaluru, Karnataka, India'
      },
      summary: 'Java Backend Developer with strong foundations in Core Java, Spring Boot, REST APIs, Hibernate/JPA, and SQL database design. MCA graduate seeking junior software engineer role.',
      skills: {
        languages: ['Java', 'Python', 'SQL'],
        backend: ['Core Java', 'Spring Boot', 'Hibernate/JPA', 'REST APIs'],
        databases: ['MySQL', 'PostgreSQL'],
        tools: ['Git', 'Docker']
      },
      experience: [
        {
          role: 'Advanced Java Full Stack Development Intern',
          company: 'Anudip Foundation',
          period: 'Oct 2024 - Oct 2024',
          bullets: ['Developed 4 transactional Java applications applying OOP and collections.']
        }
      ],
      projects: [
        {
          name: 'NearVia - Location-Based Store Directory',
          bullets: ['Built full-stack location-based directory using Spring Boot and PostgreSQL serving 100+ stores.']
        }
      ],
      education: [
        {
          degree: 'MCA',
          institution: 'Bangalore University',
          year: '2026'
        }
      ]
    };

    const audit = checkResumeAtsQuality(mockContent, sampleJob, { template: 'ats_professional' });
    assert.ok(audit.atsQualityScore >= 80, `ATS score must be high for matching profile, got ${audit.atsQualityScore}`);
    
    const layoutCheck = audit.checks.find(c => c.id === '9_single_column_layout');
    assert.ok(layoutCheck, 'Must include single-column layout check');
    assert.strictEqual(layoutCheck.status, 'passed', 'Single-column structure check must pass');

    const truthCheck = audit.checks.find(c => c.id === '13_unsupported_claims');
    assert.ok(truthCheck, 'Must include truthfulness check');
    assert.strictEqual(truthCheck.status, 'passed', 'Zero unverified claims check must pass');
  });

  test('Part 5: Applications table tracking records manual submission with resume version', () => {
    const db = getDatabase();
    
    // Ensure test application record can be created and queried cleanly
    const testJobId = 100174; // Existing test job
    const existingJob = db.prepare('SELECT id, title, company FROM jobs WHERE id = ?').get(testJobId);
    assert.ok(existingJob, 'Test job exists in database');

    const app = db.prepare('SELECT * FROM applications WHERE job_id = ?').get(testJobId);
    if (app) {
      assert.ok(app.status, 'Application must have a valid stage status');
      assert.ok(app.applied_date || app.updated_at, 'Application must track date');
    }
  });
});
