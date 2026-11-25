import test from 'node:test';
import assert from 'node:assert';
import { getDatabase } from '../src/db/schema.js';
import {
  analyzeSkillGaps,
  getSkillRoadmap,
  updateSkillRoadmapItem,
  getVerifiedCandidateSkills
} from '../src/intelligence/skillGapService.js';
import {
  getAllStories,
  getStoriesByCategory,
  searchStories,
  createOrUpdateStory
} from '../src/intelligence/storyBankService.js';
import { generateTargetedInterviewKit } from '../src/intelligence/interviewIntelligence.js';
import {
  startMockInterview,
  submitMockAnswer,
  getMockSession,
  getMockHistory,
  evaluateMockResponse,
  MOCK_DISCLAIMER
} from '../src/intelligence/mockInterviewService.js';
import {
  getApplicationAnalytics,
  getRejectionAnalysis,
  SMALL_SAMPLE_THRESHOLD
} from '../src/intelligence/careerAnalyticsService.js';
import { getCompanyResearch } from '../src/intelligence/companyResearchService.js';
import {
  calculateOfferTakeHome,
  compareOffers,
  saveOfferComparisonRecord,
  getSavedOfferComparisons,
  SALARY_DISCLAIMER
} from '../src/intelligence/salaryCalculatorService.js';

// Clean DB instance for test suite
const db = getDatabase();

test('Phase 5: Skill Extraction, Categorization & Market Demand Prioritization', () => {
  const gaps = analyzeSkillGaps({ limit: 50 });

  assert.ok(gaps.totalJobsAnalyzed >= 0, 'Should analyze jobs in vault');
  assert.ok(gaps.summary.totalSkillsTracked > 0, 'Should track skills across JDs');

  // Verify verified strengths include candidate's core technologies
  const strengthNames = gaps.verifiedStrengths.map(s => s.skill.toLowerCase());
  const hasJava = strengthNames.some(s => s.includes('java') || s.includes('spring') || s.includes('react'));
  assert.ok(hasJava, 'Verified strengths should recognize Java/Spring Boot/React from candidate profile');

  // Top gaps should contain missing skills
  for (const gap of gaps.topGaps) {
    assert.strictEqual(gap.status, 'missing', 'Top gaps must be classified as missing');
    assert.ok(['critical', 'high', 'medium', 'low'].includes(gap.priority), 'Must assign a valid priority tier');
    assert.ok(gap.learningResources.length > 0, 'Must provide practical learning resources');
    assert.ok(gap.recommendedProject.length > 10, 'Must provide a tangible project recommendation');
  }
});

test('Phase 5: Strict Skill Verification Gatekeeper (Cannot mark acquired without proof)', () => {
  // Test skill name for test suite
  const testSkill = 'test_kubernetes_skill';

  // Attempting to mark 'acquired' without proof must throw an error
  assert.throws(
    () => {
      updateSkillRoadmapItem(testSkill, {
        status: 'acquired',
        verifiedEvidence: '' // Empty proof
      });
    },
    /Strict Verification Rule/i,
    'Must strictly reject marking skill acquired without tangible evidence'
  );

  // Providing verified evidence must succeed
  const updated = updateSkillRoadmapItem(testSkill, {
    status: 'acquired',
    verifiedEvidence: 'Deployed NearVia to Minikube cluster with deployment and service YAMLs'
  });

  assert.strictEqual(updated.status, 'acquired');
  assert.ok(updated.verifiedEvidence.includes('Minikube'), 'Must record verified evidence');

  // Cleanup test row
  db.prepare('DELETE FROM skill_roadmap WHERE skill_name = ?').run(testSkill);
});

test('Phase 5: STAR Story Bank Evidence Integrity and Searchability', () => {
  const stories = getAllStories();
  assert.ok(stories.length >= 6, 'Must contain all canonical STAR stories');

  const nearViaStory = stories.find(s => s.contextSource.includes('NearVia'));
  assert.ok(nearViaStory, 'Must include NearVia project story');
  assert.ok(nearViaStory.situation.length > 20, 'Situation must be detailed');
  assert.ok(nearViaStory.task.length > 10, 'Task must be defined');
  assert.ok(nearViaStory.action.includes('PostGIS') || nearViaStory.action.includes('locking'), 'Action must reference verified technical mechanics');
  assert.ok(nearViaStory.result.includes('latency') || nearViaStory.result.includes('double-booking') || nearViaStory.result.includes('zero'), 'Result must state measurable outcome');

  // Category search
  const challengeStories = getStoriesByCategory('technical_challenge');
  assert.ok(challengeStories.length > 0, 'Should return technical challenge stories');
  assert.strictEqual(challengeStories[0].category, 'technical_challenge');

  // Keyword search
  const postgisSearch = searchStories('postgis');
  assert.ok(postgisSearch.length > 0, 'Should find story by PostGIS keyword');
});

test('Phase 5: Targeted Interview Preparation Grounded in Candidate Projects', () => {
  const syntheticJob = {
    id: 999,
    title: 'Junior Java Developer',
    company: 'FinTech Innovations India',
    description: 'Looking for a Junior Java Developer with Spring Boot, React, and SQL. Familiarity with Docker and Microservices is a plus.',
    required_skills: JSON.stringify(['Java', 'Spring Boot', 'SQL']),
    preferred_skills: JSON.stringify(['Docker', 'Microservices'])
  };

  const kit = generateTargetedInterviewKit(syntheticJob);

  assert.strictEqual(kit.company, 'FinTech Innovations India');
  assert.ok(kit.technicalQuestions.length >= 3, 'Must provide core technical questions');
  assert.ok(kit.projectQuestions.length >= 2, 'Must provide project deep-dive questions');

  // Project questions must strictly cite candidate's verified projects
  const hasNearVia = kit.projectQuestions.some(p => p.project.includes('NearVia'));
  const hasLeave = kit.projectQuestions.some(p => p.project.includes('Leave Management'));
  assert.ok(hasNearVia, 'Project questions must cite NearVia');
  assert.ok(hasLeave, 'Project questions must cite Leave Management');

  // Missing skill strategy must cover Docker or Microservices
  assert.ok(kit.missingSkillQuestions.length > 0, 'Must address missing skills');
  const dockerQuestion = kit.missingSkillQuestions.find(q => q.skill === 'Docker');
  assert.ok(dockerQuestion, 'Must generate Docker question without fabricating production experience');
  assert.ok(dockerQuestion.sampleAnswer.includes('docker-compose'), 'Sample answer must demonstrate valid design without lying');

  // Coding exercises
  assert.ok(kit.codingExercises.length >= 2, 'Must include coding challenges with solutions');
  assert.ok(kit.codingExercises[0].solutionCode.length > 20, 'Exercise must include executable solution');
});

test('Phase 5: Interactive Mock Interview System with Multi-Dimensional Evaluation', () => {
  // 1. Direct answer evaluation
  const goodAnswer = 'In NearVia, I handled location-based proximity using PostgreSQL and PostGIS. I indexed user coordinates with GIST spatial indexes and executed ST_DWithin queries on geography types, achieving sub-50ms query times. To prevent race conditions, I used SELECT FOR UPDATE pessimistic locking.';
  const evalGood = evaluateMockResponse('How did you implement proximity search and concurrency in NearVia?', goodAnswer, 'Technical: Project');

  assert.ok(evalGood.overallScore >= 8.0, 'Comprehensive answer must receive score >= 8.0');
  assert.ok(evalGood.strengths.length >= 2, 'Must identify multiple strengths');
  assert.ok(evalGood.scores.correctness >= 8, 'Depth score should be high for PostGIS and row-level locking');

  // Brief answer evaluation
  const briefAnswer = 'I used SQL and database queries.';
  const evalBrief = evaluateMockResponse('How did you optimize your database in NearVia?', briefAnswer, 'Technical: Database');

  assert.ok(evalBrief.overallScore < 6.0, 'Brief answers must receive score < 6.0');
  assert.ok(evalBrief.improvements.length > 0, 'Must provide actionable improvement suggestions');

  // 2. Full session flow
  const session = startMockInterview({ interviewType: 'technical', questionCount: 2 });
  assert.ok(session.sessionId > 0, 'Must create a mock interview session');
  assert.strictEqual(session.totalQuestions, 2);
  assert.strictEqual(session.currentQuestionNumber, 1);
  assert.strictEqual(session.status, 'in_progress');

  // Submit Answer 1 (HashMap question)
  const step1 = submitMockAnswer({
    sessionId: session.sessionId,
    answer: 'In Java 8+, HashMap handles collisions using linked lists initially, and transforms into a balanced Red-Black tree when a bucket exceeds the TREEIFY_THRESHOLD of 8 entries, ensuring O(log n) lookup performance.'
  });

  assert.strictEqual(step1.completedQuestionNumber, 1);
  assert.strictEqual(step1.isFinished, false);
  assert.ok(step1.nextQuestion, 'Must provide next question');

  // Submit Answer 2 (Spring Boot question)
  const step2 = submitMockAnswer({
    sessionId: session.sessionId,
    answer: 'In Spring Boot, @SpringBootApplication bootstraps component scanning, configuration, and auto-configuration starters. @Transactional creates dynamic proxies to ensure ACID transaction boundaries with automated rollback on runtime exceptions.'
  });

  assert.strictEqual(step2.completedQuestionNumber, 2);
  assert.strictEqual(step2.isFinished, true);
  assert.ok(step2.overallScore >= 7.0, 'Session should have completed overall score >= 7.0');
  assert.ok(step2.feedbackSummary.length > 10, 'Session must generate comprehensive feedback summary');

  // Verify DB record
  const recorded = getMockSession(session.sessionId);
  assert.strictEqual(recorded.status, 'completed');
  assert.strictEqual(recorded.completedQuestions, 2);
});

test('Phase 5: Mock Interview Disclaimer Enforced on all Sessions', () => {
  const session = startMockInterview({ interviewType: 'behavioral', questionCount: 1 });
  assert.strictEqual(session.disclaimer, MOCK_DISCLAIMER, 'Start session must include mandatory disclaimer');

  const step = submitMockAnswer({
    sessionId: session.sessionId,
    answer: 'During NearVia, I solved spatial latency by indexing with PostGIS, reducing latency by 85%.'
  });
  assert.strictEqual(step.disclaimer, MOCK_DISCLAIMER, 'Submitted evaluation must include disclaimer');
  assert.ok(step.disclaimer.includes('Practice evaluation only'), 'Must inform user scores are not employer hiring decisions');
});

test('Phase 5: Application Funnel Analytics and Small-Sample Warning Gate', () => {
  const analytics = getApplicationAnalytics();

  assert.ok(analytics.totalApplications >= 0);
  assert.ok(typeof analytics.metrics.responseRatePct === 'number');
  assert.ok(typeof analytics.metrics.interviewConversionRatePct === 'number');

  // Small sample size warning validation
  if (analytics.totalApplications < SMALL_SAMPLE_THRESHOLD) {
    assert.strictEqual(analytics.hasSmallSampleWarning, true, 'Must flag small sample warning when N < 10');
    assert.ok(analytics.smallSampleWarning.includes('preliminary'), 'Warning must caution against drawing firm conclusions');
  } else {
    assert.strictEqual(analytics.hasSmallSampleWarning, false);
  }

  // Funnel numbers must be consistent
  assert.ok(analytics.funnel.submitted <= analytics.totalApplications);
  assert.ok(analytics.funnel.offer <= analytics.totalApplications);
});

test('Phase 5: Rejection Pattern Intelligence (Strict Known vs Inferred Separation)', () => {
  const rejections = getRejectionAnalysis();

  assert.ok(typeof rejections.knownRejectionsCount === 'number');
  assert.ok(typeof rejections.inferredPossibilitiesCount === 'number');
  assert.ok(rejections.disclaimer.includes('Strict Separation'), 'Must include strict separation disclaimer');

  // Known rejections must only contain explicit recruiter feedback
  for (const known of rejections.knownRejections) {
    assert.strictEqual(known.reasonType, 'explicit_recruiter');
    assert.ok(known.reasonText.length > 0);
  }

  // Inferred hypotheses must be labelled as possibilities
  for (const inf of rejections.inferredPossibilities) {
    assert.strictEqual(inf.reasonType, 'inferred_possibility');
    assert.ok(inf.inferredHypotheses.length > 0);
  }

  // Must output action recommendations
  assert.ok(rejections.actionRecommendations.length > 0, 'Must output constructive action items');
});

test('Phase 5: Company and Recruiter Research Evidence Tiers', () => {
  // Ensure isolated deterministic test fixture for PradeepIT in database
  db.prepare('DELETE FROM company_research WHERE LOWER(company_name) = LOWER(?)').run('PradeepIT Consulting Services Pvt Ltd');
  db.prepare(`
    INSERT OR REPLACE INTO jobs (id, external_slug, source, title, company, location, url, description, required_skills, verification_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    40001,
    'test-pradeepit-fixture-slug',
    'freehire',
    'Java Backend Developer',
    'PradeepIT Consulting Services Pvt Ltd',
    'Bengaluru, Karnataka, India',
    'https://example.com/pradeepit-job',
    'PradeepIT is hiring a Java Spring Boot developer with SQL and REST API skills.',
    JSON.stringify(['Java', 'Spring Boot', 'SQL']),
    'discovered'
  );

  const research = getCompanyResearch('PradeepIT Consulting Services Pvt Ltd');

  assert.strictEqual(research.companyName, 'PradeepIT Consulting Services Pvt Ltd');
  assert.ok(research.overview.length > 20, 'Must contain company overview');
  assert.ok(research.techStack.length > 0, 'Must identify relevant tech stack');
  assert.ok(research.interviewExperienceNotes.includes('Round 1'), 'Must include standard interview stages');

  // Must distinguish evidence tiers
  assert.ok(['verified_official', 'community_reported', 'unverified'].includes(research.verifiedStatus));
  assert.ok(research.verificationGuide.companyDetails.includes('community_reported'));
});

test('Phase 5: Indian Salary & Offer Calculator (Taxes, Slabs, EPF & Net Savings)', () => {
  // Scenario 1: ₹5,00,000 CTC in Bengaluru (New Tax Regime FY 24-25)
  // Taxable income after Standard Deduction ₹75,000 is < ₹7,00,000 -> Tax is ₹0 under Sec 87A (PT is non-deductible under Section 115BAC)
  const offer1 = calculateOfferTakeHome({
    ctcAnnual: 500000,
    location: 'Bengaluru',
    workMode: 'onsite',
    taxRegime: 'new_2024'
  });

  assert.strictEqual(offer1.ctcAnnual, 500000);
  assert.strictEqual(offer1.monthlyBreakdown.incomeTaxTds, 0, 'Under ₹7 LPA taxable in New Regime has zero tax due to Section 87A');
  assert.strictEqual(offer1.monthlyBreakdown.professionalTax, 200, 'Karnataka PT must be ₹200/mo');
  assert.ok(offer1.monthlyBreakdown.netInHand > 30000, 'Monthly in-hand should be > ₹30,000');
  assert.ok(offer1.costOfLiving.estimatedMonthlyExpense > 0, 'Bengaluru onsite should include living expenses');
  assert.ok(offer1.costOfLiving.estimatedNetMonthlySavings > 0, 'Should compute net monthly savings');
  assert.strictEqual(offer1.disclaimer, SALARY_DISCLAIMER);

  // Scenario 2: Remote vs Bengaluru Comparison
  const comparison = compareOffers([
    {
      company: 'TechCorp Bengaluru',
      role: 'Junior Java Developer',
      ctcAnnual: 500000,
      location: 'Bengaluru',
      workMode: 'onsite',
      learningScore: 4
    },
    {
      company: 'RemoteFin India',
      role: 'Junior Full Stack Engineer',
      ctcAnnual: 450000,
      location: 'Remote',
      workMode: 'remote',
      learningScore: 3
    }
  ]);

  assert.strictEqual(comparison.totalCompared, 2);
  assert.ok(comparison.offers.length === 2);
  // Remote job has lower living expenses (~₹8,000 vs ~₹22,000), so ₹4.5L remote could yield comparable or higher savings
  assert.ok(comparison.offers[0].netMonthlySavings >= comparison.offers[1].netMonthlySavings, 'Offers should be sorted by net savings');

  // Scenario 3: Database persistence
  const saved = saveOfferComparisonRecord({
    offerName: 'Test Offer Bengaluru',
    company: 'TestCorp',
    role: 'Software Engineer',
    ctcAnnual: 600000,
    location: 'Bengaluru',
    workMode: 'hybrid'
  });

  assert.ok(saved.id > 0, 'Should save offer record to database');
  const allSaved = getSavedOfferComparisons();
  assert.ok(allSaved.some(o => o.offerName === 'Test Offer Bengaluru'), 'Saved offer must appear in list');

  // Cleanup test offer
  db.prepare('DELETE FROM salary_comparisons WHERE id = ?').run(saved.id);
});
