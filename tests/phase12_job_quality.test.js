import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectListingQuality,
  classifyJobEligibility,
  calculateJobPriority,
  generateExplainableMatch,
  calculateEvidenceBreakdown,
  ELIGIBILITY_TIERS,
  PRIORITY_TIERS,
  LOW_QUALITY_FLAGS
} from '../src/matcher/qualityDetector.js';
import { evaluateJobFit } from '../src/matcher/scoringEngine.js';
import { executeUnifiedSearch, expandSmartRoleTerms } from '../src/discovery/unifiedSearchService.js';
import { classifyDegreeRequirement } from '../src/matcher/degreeClassifier.js';

test('Phase 12 Audit 1: Evidence-Based Job Quality Scoring & Breakdown', async (t) => {
  const highQualityJob = {
    id: 9001,
    title: 'Junior Java Developer',
    company: 'FinTech Innovations Lab',
    location: 'Bengaluru, Karnataka, India',
    description: 'We are hiring a Junior Java Developer with Spring Boot, MySQL, and REST APIs. MCA or B.Tech graduates from 2026 batch welcome. 0-1 years experience.',
    source: 'greenhouse',
    source_confidence: 1.0,
    freshnessStatus: 'verified_active',
    status: 'discovered'
  };

  const evalResult = evaluateJobFit(highQualityJob);

  assert.ok(evalResult.score >= 75, `Expected high composite score >= 75, got ${evalResult.score}`);
  assert.equal(evalResult.jobEligibility, ELIGIBILITY_TIERS.ELIGIBLE, 'Should be confirmed ELIGIBLE for MCA');
  assert.equal(evalResult.priorityCode, 'P1', 'Top candidate fit should be PRIORITY 1 — APPLY FIRST');

  // Verify multi-factor evidence breakdown exists with all 7 factors
  assert.ok(evalResult.evidenceBreakdown, 'evidenceBreakdown must be present');
  const eb = evalResult.evidenceBreakdown;
  assert.ok(eb.skillsMatch.score >= 20, `Skills match should be >= 20/30, got ${eb.skillsMatch.score}`);
  assert.equal(eb.degreeEligibility.score, 15, 'Explicit MCA should receive full 15/15 degree score');
  assert.ok(eb.experienceEligibility.score >= 12, 'Fresher 0-1 yr should receive >= 12/15 experience score');
  assert.equal(eb.locationFit.score, 10, 'Bengaluru should receive 10/10 location score');
  assert.equal(eb.freshness.score, 10, 'Verified active should receive 10/10 freshness score');
  assert.equal(eb.sourceConfidence.score, 10, 'Greenhouse direct ATS should receive 10/10 source score');
  assert.ok(evalResult.jobQualityScore >= 80, `Job quality score should be >= 80/100, got ${evalResult.jobQualityScore}`);
});

test('Phase 12 Audit 2: 4-Tier Eligibility Classification & Strict Exclusion Precedence', async (t) => {
  // Case A: Strict B.Tech Exclusivity MUST be NOT_ELIGIBLE and DISQUALIFIED
  const strictBtechJob = {
    id: 9002,
    title: 'Software Engineer',
    company: 'Legacy Corp',
    location: 'Bengaluru',
    description: 'Only B.Tech / B.E. computer science graduates are eligible. MCA or non-engineering candidates need not apply.',
    source: 'lever',
    status: 'discovered'
  };

  const evalStrict = evaluateJobFit(strictBtechJob);
  assert.equal(evalStrict.jobEligibility, ELIGIBILITY_TIERS.NOT_ELIGIBLE, 'Strict B.Tech exclusion must yield NOT_ELIGIBLE');
  assert.equal(evalStrict.score, 0, 'Score must be forced to 0 for strictly ineligible roles');
  assert.equal(evalStrict.priorityCode, 'DISQUALIFIED', 'Strict exclusion must be DO NOT APPLY — DISQUALIFIED');
  assert.notEqual(evalStrict.priorityCode, 'P1', 'Strict exclusion must NEVER be P1');
  assert.notEqual(evalStrict.priorityCode, 'P2', 'Strict exclusion must NEVER be P2');

  // Case B: Explicit MCA Acceptance -> ELIGIBLE
  const mcaExplicitJob = {
    id: 9003,
    title: 'Java Backend Engineer',
    company: 'CloudStart',
    location: 'Bengaluru',
    description: 'Hiring fresh graduates. Qualification: MCA or M.Tech in Computer Science. Strong Java and Spring Boot knowledge required.',
    source: 'ashby',
    status: 'discovered'
  };
  const evalMca = evaluateJobFit(mcaExplicitJob);
  assert.equal(evalMca.jobEligibility, ELIGIBILITY_TIERS.ELIGIBLE, 'Explicit MCA mention must yield ELIGIBLE');
  assert.equal(evalMca.isConfirmedEligible, true);

  // Case C: Non-exclusive B.Tech mention -> LIKELY_ELIGIBLE
  const nonExclusiveJob = {
    id: 9004,
    title: 'Associate Software Developer',
    company: 'TechCorp',
    location: 'Bengaluru',
    description: 'B.Tech / B.E. or similar technical degree. Entry level software engineer.',
    source: 'workable',
    status: 'discovered'
  };
  const evalNonExcl = evaluateJobFit(nonExclusiveJob);
  assert.equal(evalNonExcl.jobEligibility, ELIGIBILITY_TIERS.LIKELY_ELIGIBLE, 'Non-exclusive engineering mention must yield LIKELY_ELIGIBLE');

  // Case D: Unstated qualification -> UNCERTAIN
  const unstatedJob = {
    id: 9005,
    title: 'Software Developer',
    company: 'Acme Software',
    location: 'Bengaluru',
    description: 'Looking for a developer with Java and SQL knowledge to build web apps.',
    source: 'direct',
    status: 'discovered'
  };
  const evalUnstated = evaluateJobFit(unstatedJob);
  assert.equal(evalUnstated.jobEligibility, ELIGIBILITY_TIERS.UNCERTAIN, 'Unstated educational qualification must yield UNCERTAIN');
});

test('Phase 12 Audit 3: Low-Quality Listing Detection (Expired, Talent Pool, Excessive Experience, Unclear Employer)', async (t) => {
  // Case A: Expired listing
  const expiredJob = {
    id: 9006,
    title: 'Java Developer',
    company: 'Good Co',
    status: 'expired',
    verification_status: 'expired'
  };
  const qualityExp = detectListingQuality(expiredJob);
  assert.ok(qualityExp.flags.includes(LOW_QUALITY_FLAGS.EXPIRED));
  assert.equal(qualityExp.qualityScore, 0, 'Expired listing quality score must be 0');

  // Case B: Generic Talent Pool / Ongoing Resume Harvester
  const talentPoolJob = {
    id: 9007,
    title: 'Engineering Talent Pool - Future Opportunities',
    company: 'MegaCorp',
    description: 'Join our talent community! We keep your resume on file for future reference. Not an immediate opening.',
    source: 'workable'
  };
  const qualityPool = detectListingQuality(talentPoolJob);
  assert.ok(qualityPool.flags.includes(LOW_QUALITY_FLAGS.TALENT_POOL));
  const evalPool = evaluateJobFit(talentPoolJob);
  assert.equal(evalPool.priorityCode, 'DISQUALIFIED', 'Talent pool listing must be DISQUALIFIED from active applications');

  // Case C: Excessive Experience (Senior / Lead role)
  const seniorJob = {
    id: 9008,
    title: 'Senior Java Architect',
    company: 'BigTech',
    experience_min: 7,
    description: 'Requires 7+ years of experience leading engineering teams.'
  };
  const qualitySenior = detectListingQuality(seniorJob);
  assert.ok(qualitySenior.flags.includes(LOW_QUALITY_FLAGS.EXCESSIVE_EXPERIENCE));
  const evalSenior = evaluateJobFit(seniorJob);
  assert.equal(evalSenior.priorityCode, 'DISQUALIFIED', 'Excessive experience must be DISQUALIFIED');

  // Case D: Unclear / Anonymous Employer
  const agencyJob = {
    id: 9009,
    title: 'Java Developer',
    company: 'Confidential Client',
    description: 'Hiring for a top product client in Bengaluru. Java and Spring Boot required.'
  };
  const qualityAgency = detectListingQuality(agencyJob);
  assert.ok(qualityAgency.flags.includes(LOW_QUALITY_FLAGS.UNCLEAR_EMPLOYER));
  assert.equal(qualityAgency.authenticityTier, 'AGENCY_OR_ANONYMOUS');

  // Case E: Duplicate listing cross-source
  const dupeJob = {
    id: 9010,
    title: 'Java Developer',
    company: 'Good Co',
    is_duplicate: 1,
    status: 'duplicate'
  };
  const qualityDupe = detectListingQuality(dupeJob);
  assert.ok(qualityDupe.flags.includes(LOW_QUALITY_FLAGS.DUPLICATE));
  const evalDupe = evaluateJobFit(dupeJob);
  assert.equal(evalDupe.priorityCode, 'DISQUALIFIED', 'Duplicate listing must be DISQUALIFIED');
});

test('Phase 12 Audit 4: 5-Tier Smart Job Priority System & Safety Gates', async (t) => {
  // Priority 1 — Apply First
  const p1Job = {
    id: 9011,
    title: 'Java Software Engineer (Fresher)',
    company: 'Prime Solutions',
    location: 'Bengaluru, Karnataka',
    description: 'Core Java, Spring Boot, PostgreSQL, REST APIs. MCA 2026 batch candidates welcome. 0-1 years experience.',
    source: 'lever',
    source_confidence: 1.0,
    freshnessStatus: 'verified_active',
    status: 'discovered'
  };
  const evalP1 = evaluateJobFit(p1Job);
  assert.equal(evalP1.priorityCode, 'P1', 'Should be P1');
  assert.equal(evalP1.priorityTier, PRIORITY_TIERS.PRIORITY_1);

  // Priority 2 — Strong Match
  const p2Job = {
    id: 9012,
    title: 'Software Developer',
    company: 'Alpha Tech',
    location: 'Pune, Maharashtra',
    description: 'Java and SQL developer for entry-level backend role. MCA / B.Tech accepted.',
    source: 'workable',
    source_confidence: 1.0,
    freshnessStatus: 'verified_active',
    status: 'discovered'
  };
  const evalP2 = evaluateJobFit(p2Job);
  assert.equal(evalP2.priorityCode, 'P2', 'Should be P2');
  assert.equal(evalP2.priorityTier, PRIORITY_TIERS.PRIORITY_2);

  // Priority 3 — Review
  const p3Job = {
    id: 9013,
    title: 'Software Engineer',
    company: 'Consulting Co',
    location: 'Bengaluru',
    description: 'Software development role. Skills: C++, Java basics.',
    source: 'freehire',
    status: 'discovered'
  };
  const evalP3 = evaluateJobFit(p3Job);
  assert.equal(evalP3.priorityCode, 'P3', 'Should be P3');
  assert.equal(evalP3.priorityTier, PRIORITY_TIERS.PRIORITY_3);

  // Disqualified (Safety Gate: NEVER in P1 or P2)
  const disqExpired = {
    id: 9014,
    title: 'Java Developer',
    company: 'Old Corp',
    location: 'Bengaluru',
    description: 'Java developer. Notice: This position has expired.',
    status: 'expired'
  };
  const evalDisq = evaluateJobFit(disqExpired);
  assert.equal(evalDisq.priorityCode, 'DISQUALIFIED');
  assert.notEqual(evalDisq.priorityCode, 'P1');
  assert.notEqual(evalDisq.priorityCode, 'P2');
});

test('Phase 12 Audit 5: Grounded Explainable Recommendations (Why this matches & Potential concerns)', async (t) => {
  const job = {
    id: 9015,
    title: 'Java Backend Trainee',
    company: 'Fintech Corp',
    location: 'Bengaluru',
    description: 'Java, Spring Boot, MySQL. Looking for freshers with good problem solving. Degree: MCA / B.Tech.',
    source: 'greenhouse',
    status: 'discovered'
  };

  const evalResult = evaluateJobFit(job);
  assert.ok(Array.isArray(evalResult.whyMatches), 'whyMatches must be an array');
  assert.ok(evalResult.whyMatches.length >= 2, 'Should provide at least 2 grounded match reasons');

  // Verify grounded in verified candidate stack
  const matchedText = evalResult.whyMatches.join(' ');
  assert.ok(matchedText.includes('Java') || matchedText.includes('Spring Boot'), 'Should ground matched skills in explanation');
  assert.ok(matchedText.includes('MCA') || matchedText.includes('Degree'), 'Should ground degree compatibility');

  assert.ok(Array.isArray(evalResult.concerns), 'concerns must be an array');
});

test('Phase 12 Audit 6: Smart Search Role Expansion & Semantic Discovery', async (t) => {
  // Test term expansions
  const javaVariants = expandSmartRoleTerms('Java Developer');
  assert.ok(javaVariants.includes('java'), 'Must include java');
  assert.ok(javaVariants.includes('spring boot'), 'Must include spring boot');
  assert.ok(javaVariants.includes('core java'), 'Must include core java');
  assert.ok(javaVariants.includes('java software engineer'), 'Must include java software engineer');
  assert.ok(!javaVariants.includes('python developer'), 'Must not blindly pull unrelated python roles');
  assert.ok(!javaVariants.includes('sales executive'), 'Must not pull non-tech roles');

  const sdeVariants = expandSmartRoleTerms('Software Engineer');
  assert.ok(sdeVariants.includes('associate software engineer'), 'Must include associate software engineer');
  assert.ok(sdeVariants.includes('trainee software engineer'), 'Must include trainee software engineer');
  assert.ok(sdeVariants.includes('graduate engineer trainee'), 'Must include graduate engineer trainee');
});

test('Phase 12 Audit 7: Unified Search Engine Priority Filtering & Phase 12 Analytics', async (t) => {
  // Test search with priority = 'all'
  const allResp = executeUnifiedSearch({ priority: 'all', limit: 50 });
  assert.ok(allResp.results, 'Results must exist');
  assert.ok(allResp.summary, 'Summary must exist');
  assert.ok(allResp.summary.priorityCounts, 'priorityCounts must exist in summary');
  assert.ok(allResp.summary.eligibilityCounts, 'eligibilityCounts must exist in summary');
  assert.ok(allResp.summary.qualityFlagsCounts, 'qualityFlagsCounts must exist in summary');

  // Test priority filtering for P1
  const p1Resp = executeUnifiedSearch({ priority: 'p1', limit: 50 });
  for (const job of p1Resp.results) {
    assert.equal(job.priorityCode, 'P1', 'Every job in P1 filter must have priorityCode P1');
  }

  // Test priority filtering for Disqualified
  const disqResp = executeUnifiedSearch({ priority: 'disqualified', excludeExpired: false, limit: 50 });
  for (const job of disqResp.results) {
    assert.equal(job.priorityCode, 'DISQUALIFIED', 'Every job in disqualified filter must have priorityCode DISQUALIFIED');
  }
});
