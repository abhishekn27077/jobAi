import { test } from 'node:test';
import assert from 'node:assert';
import { calculateAtsScore } from '../src/resumes/atsScorer.js';
import { loadCandidateProfile } from '../src/profile/profileManager.js';

test('ATS Scoring Accuracy: All mandatory skills missing but all preferred skills present', () => {
  const profile = loadCandidateProfile();

  // JD requires Go and Kubernetes (missing), but lists React.js and Git as preferred (present)
  const jd = {
    title: 'Go Cloud Engineer',
    requiredSkills: ['Go', 'Kubernetes'],
    preferredSkills: ['React.js', 'Git'],
    languages: ['Go'],
    frameworksAndTools: ['Kubernetes', 'React.js', 'Git'],
    databases: [],
    experience: { min: 0, max: 1, isFresherEligible: true },
    education: { isEligibleForMCA: true }
  };

  // Resume contains React.js and Git (preferred), but NO Go or Kubernetes
  const resume = {
    personal: { fullName: 'Abhishek N', email: 'test@example.com', phone: '+91-9999999999' },
    summary: 'Full stack developer with React.js and Git experience.',
    technicalSkills: {
      languages: ['JavaScript', 'SQL'],
      backend: ['Node.js'],
      frontend: ['React.js'],
      databases: ['PostgreSQL']
    },
    experience: [],
    projects: [{ name: 'NearVia', techStack: ['React', 'TypeScript', 'Node.js'] }],
    education: [{ degree: 'Master of Computer Applications (MCA)' }],
    certificationsAndAwards: []
  };

  const result = calculateAtsScore(jd, resume, profile);
  const req = result.categories.requiredSkillCoverage;

  // CRITICAL VERIFICATION: Preferred skills MUST NOT increase mandatory skill coverage
  assert.strictEqual(req.mandatoryCoverage.score, 0, 'Mandatory score MUST be 0 when all mandatory skills are missing');
  assert.strictEqual(req.mandatoryCoverage.matched.length, 0);
  assert.deepStrictEqual(req.mandatoryCoverage.missing, ['Go', 'Kubernetes']);

  // Preferred skills scored separately (max 5)
  assert.ok(req.preferredCoverage.score > 0, 'Preferred skills should be scored in preferredCoverage');
  assert.ok(req.score <= 5, `Total skill coverage should be capped at preferred score (<= 5), got ${req.score}`);
});

test('ATS Scoring Accuracy: Some mandatory skills present and others missing', () => {
  const profile = loadCandidateProfile();

  // JD requires 4 skills: 2 verified present (Java, Spring Boot), 2 missing (Rust, Kafka)
  const jd = {
    title: 'Backend Systems Engineer',
    requiredSkills: ['Java', 'Spring Boot', 'Rust', 'Kafka'],
    preferredSkills: [],
    languages: ['Java', 'Rust'],
    frameworksAndTools: ['Spring Boot', 'Kafka'],
    databases: [],
    experience: { min: 0, max: 1, isFresherEligible: true },
    education: { isEligibleForMCA: true }
  };

  const resume = {
    personal: { fullName: 'Abhishek N', email: 'test@example.com', phone: '+91-9999999999' },
    summary: 'Backend developer with Java and Spring Boot experience.',
    technicalSkills: {
      languages: ['Java'],
      backend: ['Core Java', 'Spring Boot', 'REST APIs'],
      frontend: [],
      databases: ['MySQL']
    },
    experience: [],
    projects: [{ name: 'Employee Leave Management System', techStack: ['Java', 'Spring Boot', 'MySQL'] }],
    education: [{ degree: 'Master of Computer Applications (MCA)' }],
    certificationsAndAwards: []
  };

  const result = calculateAtsScore(jd, resume, profile);
  const req = result.categories.requiredSkillCoverage;

  // 2 out of 4 mandatory skills -> ratio = 0.5 -> score = Math.round(0.5 * 25) = 13
  assert.strictEqual(req.mandatoryCoverage.matched.length, 2);
  assert.ok(req.mandatoryCoverage.matched.includes('Java'));
  assert.ok(req.mandatoryCoverage.matched.includes('Spring Boot'));
  assert.deepStrictEqual(req.mandatoryCoverage.missing, ['Rust', 'Kafka']);
  assert.strictEqual(req.mandatoryCoverage.score, 13);
});

test('ATS Scoring Accuracy: JD has no explicit mandatory skills', () => {
  const profile = loadCandidateProfile();

  // JD has general skills without explicit mandatory partition
  const jd = {
    title: 'Software Engineer',
    requiredSkills: [],
    preferredSkills: [],
    allSkills: ['Java', 'Python', 'SQL'],
    languages: ['Java', 'Python'],
    frameworksAndTools: [],
    databases: ['SQL'],
    experience: { min: 0, max: 1, isFresherEligible: true },
    education: { isEligibleForMCA: true }
  };

  const resume = {
    personal: { fullName: 'Abhishek N', email: 'test@example.com', phone: '+91-9999999999' },
    summary: 'Software engineer proficient in Java, Python, and SQL.',
    technicalSkills: {
      languages: ['Java', 'Python', 'SQL'],
      backend: ['Core Java', 'FastAPI'],
      frontend: [],
      databases: ['PostgreSQL']
    },
    experience: [],
    projects: [{ name: 'FinSight', techStack: ['Python', 'FastAPI', 'MongoDB'] }],
    education: [{ degree: 'Master of Computer Applications (MCA)' }],
    certificationsAndAwards: []
  };

  const result = calculateAtsScore(jd, resume, profile);
  const req = result.categories.requiredSkillCoverage;

  assert.ok(req.mandatoryCoverage.score > 0, 'Should calculate baseline score against general skills');
  assert.ok(req.reason.includes('Baseline technical match') || req.reason.includes('General JD'));
});

test('ATS Scoring Accuracy: Unverified skills in generated content trigger strict penalty', () => {
  const profile = loadCandidateProfile();

  // JD requires Java, Spring Boot, and AWS
  const jd = {
    title: 'Cloud Java Developer',
    requiredSkills: ['Java', 'Spring Boot', 'AWS'],
    preferredSkills: [],
    languages: ['Java'],
    frameworksAndTools: ['Spring Boot', 'AWS'],
    databases: [],
    experience: { min: 0, max: 1, isFresherEligible: true },
    education: { isEligibleForMCA: true }
  };

  // Resume claims AWS (which is NOT in candidateProfile) along with Java and Spring Boot
  const resume = {
    personal: { fullName: 'Abhishek N', email: 'test@example.com', phone: '+91-9999999999' },
    summary: 'Java Developer with unverified cloud tool: AWS and Spring Boot.',
    technicalSkills: {
      languages: ['Java'],
      backend: ['Core Java', 'Spring Boot', 'AWS'],
      frontend: [],
      databases: []
    },
    experience: [],
    projects: [{ name: 'Employee Leave Management System', techStack: ['Java', 'Spring Boot'] }],
    education: [{ degree: 'Master of Computer Applications (MCA)' }],
    certificationsAndAwards: []
  };

  const result = calculateAtsScore(jd, resume, profile);
  const req = result.categories.requiredSkillCoverage;

  // The engine must detect that AWS is claimed in resume but absent from verified profile
  assert.ok(req.unverifiedInProfile.includes('AWS'), 'AWS must be identified as an unverified claimed skill');
  assert.ok(!req.mandatoryCoverage.matched.includes('AWS'), 'AWS must NOT be counted as a matched mandatory skill');
  assert.ok(req.reason.includes('Unverified skills'), 'Score reason should explicitly note the deduction');
});

test('ATS Scoring Accuracy: Ineligible role preserves high compatibility while capping overall match', () => {
  const profile = loadCandidateProfile();

  // Senior Java Developer requiring 7+ years
  const jd = {
    title: 'Senior Java Architect',
    requiredSkills: ['Java', 'Spring Boot'],
    preferredSkills: ['Postman'],
    languages: ['Java'],
    frameworksAndTools: ['Spring Boot', 'Postman'],
    databases: ['PostgreSQL'],
    experience: { min: 7, max: 10, isFresherEligible: false, rawText: '7+ years' },
    education: { isEligibleForMCA: true }
  };

  const resume = {
    personal: { fullName: 'Abhishek N', email: 'test@example.com', phone: '+91-9999999999' },
    summary: 'Java Full Stack Developer with Spring Boot and PostgreSQL experience.',
    technicalSkills: {
      languages: ['Java', 'SQL'],
      backend: ['Core Java', 'Spring Boot', 'REST APIs'],
      frontend: [],
      databases: ['PostgreSQL']
    },
    experience: [],
    projects: [{ name: 'Employee Leave Management System', techStack: ['Java', 'Spring Boot', 'MySQL'] }],
    education: [{ degree: 'Master of Computer Applications (MCA)' }],
    certificationsAndAwards: [{ title: 'Best AI Innovation medal' }]
  };

  const result = calculateAtsScore(jd, resume, profile);

  // Indicator A: Resume Compatibility can be solid because Java/Spring Boot matched
  assert.ok(result.resumeCompatibilityScore > 50, `Expected compatibility > 50, got ${result.resumeCompatibilityScore}`);

  // Indicator B: Eligibility Assessment must flag MANDATORY_NOT_MET
  assert.strictEqual(result.eligibilityAssessment.status, 'MANDATORY_NOT_MET');
  assert.ok(result.eligibilityAssessment.unmetMandatoryRequirements.length > 0);

  // Overall Match Score MUST be capped at <= 45 to protect candidate from applying mistakenly
  assert.ok(result.totalScore <= 45, `Overall match must be capped <= 45, got ${result.totalScore}`);
  assert.strictEqual(result.overallMatch.recommendation, 'NOT_ELIGIBLE');
  assert.strictEqual(result.overallMatch.alert.type, 'danger');
});
