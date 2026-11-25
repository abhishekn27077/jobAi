import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase } from '../src/db/schema.js';
import {
  scheduleInterview,
  updateInterviewStage,
  getInterviewsForJob,
  getUpcomingInterviews,
  getPipelineAnalytics,
  VALID_INTERVIEW_STAGES
} from '../src/interview/pipelineService.js';
import {
  seedQuestionBank,
  getQuestions,
  getQuestionById,
  updateQuestionStatus,
  addQuestion,
  getQuestionBankStats
} from '../src/interview/questionBankService.js';
import { calculateInterviewReadiness } from '../src/interview/readinessScorer.js';
import { generateFollowUpDraft, FOLLOW_UP_TYPES } from '../src/interview/followUpService.js';
import { generateInterviewDossier } from '../src/interview/prepService.js';

describe('Phase 14: Interview Intelligence & Pipeline Preparation', () => {
  let db;
  let testJobId;

  before(() => {
    db = getDatabase();
  });

  beforeEach(() => {
    // Insert a test job
    const run = db.prepare(`
      INSERT INTO jobs (
        source, title, company, location, url, description, experience_min, experience_max, required_skills
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'greenhouse',
      'Junior Java Backend Engineer',
      'Test FinTech Innovations',
      'Bengaluru, Karnataka, India',
      'https://boards.greenhouse.io/testfintech/jobs/998877',
      'Looking for a Junior Java Engineer with Core Java, Spring Boot, REST APIs, and SQL. Freshers and MCA graduates welcome.',
      0,
      1,
      JSON.stringify(['Java', 'Spring Boot', 'REST APIs', 'SQL'])
    );
    testJobId = Number(run.lastInsertRowid);
  });

  test('1. Pipeline Service: supports all 12 customizable interview stages', () => {
    assert.equal(VALID_INTERVIEW_STAGES.length, 12);
    const expectedStages = [
      'applied', 'recruiter_screening', 'hr_interview', 'technical_interview',
      'coding_assessment', 'assignment', 'technical_round_2', 'managerial_round',
      'final_interview', 'offer', 'rejected', 'withdrawn'
    ];
    for (const st of expectedStages) {
      assert.ok(VALID_INTERVIEW_STAGES.includes(st), `Stage ${st} must be supported`);
    }
  });

  test('2. Pipeline Service: schedule interview with confirmation gate & duplicate prevention', () => {
    const schedTime = '2026-12-01T10:00:00.000Z';
    const result = scheduleInterview(testJobId, {
      roundName: 'Technical Round 1',
      stage: 'technical_interview',
      scheduledAt: schedTime,
      interviewMode: 'video',
      meetingLink: 'https://meet.google.com/abc-defg-hij',
      confirmedByUser: 1
    });

    assert.equal(result.success, true);
    assert.ok(result.interviewId > 0);
    assert.equal(result.stage, 'technical_interview');
    assert.equal(result.confirmedByUser, true);

    // Duplicate check: attempt scheduling exact same time for same job
    const duplicate = scheduleInterview(testJobId, {
      roundName: 'Technical Round 1 Duplicate',
      stage: 'technical_interview',
      scheduledAt: schedTime
    });

    assert.equal(duplicate.success, false);
    assert.equal(duplicate.duplicateDetected, true);
  });

  test('3. Pipeline Service: update stage, outcome, and notes across transitions', () => {
    const sched = scheduleInterview(testJobId, {
      roundName: 'Initial Screening',
      stage: 'recruiter_screening'
    });

    const updated = updateInterviewStage(sched.interviewId, 'technical_interview', {
      outcome: 'passed',
      nextAction: 'Prepare for live coding round',
      prepNotes: 'Recruiter confirmed focus on Core Java and Collections'
    });

    assert.equal(updated.stage, 'technical_interview');
    assert.equal(updated.outcome, 'passed');
    assert.equal(updated.prep_notes, 'Recruiter confirmed focus on Core Java and Collections');
    assert.equal(updated.next_action, 'Prepare for live coding round');
  });

  test('4. Pipeline Service: pipeline analytics & small sample honesty notice', () => {
    const analytics = getPipelineAnalytics();
    assert.ok(analytics.totalInterviews >= 1);
    assert.ok(analytics.stageBreakdown);
    assert.ok(analytics.outcomeBreakdown);

    if (analytics.totalInterviews < 10) {
      assert.ok(analytics.sampleSizeHonestyNotice.includes('Small sample size'));
    }
  });

  test('5. Question Bank: seeding and category coverage', () => {
    const seed = seedQuestionBank();
    assert.ok(seed.count >= 10);

    const stats = getQuestionBankStats();
    assert.ok(stats.totalQuestions >= 10);
    assert.ok(stats.categories.length >= 5);

    // Verify Java, Spring Boot, React, SQL, Project Deep Dives categories exist
    const catNames = stats.categories.map(c => c.category);
    assert.ok(catNames.includes('Java'));
    assert.ok(catNames.includes('Spring Boot'));
    assert.ok(catNames.includes('SQL & Databases'));
    assert.ok(catNames.includes('Project Deep Dives'));
  });

  test('6. Question Bank: filtering, search, and revision count increments', () => {
    const javaQs = getQuestions({ category: 'Java' });
    assert.ok(javaQs.questions.length > 0);
    assert.ok(javaQs.questions.some(q => q.question.includes('HashMap')));

    // Test text search
    const searchRes = getQuestions({ search: 'HashMap' });
    assert.ok(searchRes.questions.length >= 1);

    // Test updating status and user notes
    const qId = javaQs.questions[0].id;
    const initialRev = javaQs.questions[0].revision_count || 0;

    const updated = updateQuestionStatus(qId, {
      isSaved: true,
      reviewedStatus: 'reviewed',
      userNotes: 'Reviewed HashMap treeify threshold (8) and Red-Black tree conversion.'
    });

    assert.equal(updated.is_saved, 1);
    assert.equal(updated.reviewed_status, 'reviewed');
    assert.equal(updated.revision_count, initialRev + 1);
  });

  test('7. Interview Readiness Scorer: calculates multi-factor score and tier', () => {
    const readiness = calculateInterviewReadiness(testJobId);
    assert.ok(readiness.score >= 0 && readiness.score <= 100);
    assert.ok(['HIGHLY READY', 'ADEQUATELY PREPARED', 'NEEDS PREPARATION'].includes(readiness.tier));
    assert.equal(readiness.factorBreakdown.length, 6);

    // Factor names verification
    const factorTitles = readiness.factorBreakdown.map(f => f.factor);
    assert.ok(factorTitles.includes('Job Requirements & Skills Coverage'));
    assert.ok(factorTitles.includes('Project Deep Dive Readiness'));
    assert.ok(factorTitles.includes('Core Technical Topics Preparation'));
  });

  test('8. Follow-up Intelligence: contextual drafts and human approval gate', () => {
    const sched = scheduleInterview(testJobId, {
      roundName: 'Technical Round 1',
      stage: 'technical_interview'
    });

    for (const ftype of FOLLOW_UP_TYPES) {
      const draft = generateFollowUpDraft(sched.interviewId, ftype);
      assert.equal(draft.type, ftype);
      assert.equal(draft.status, 'DRAFT_PENDING_USER_APPROVAL');
      assert.equal(draft.requiresUserApproval, true);
      assert.equal(draft.autoSent, false);
      assert.ok(draft.subject.length > 5);
      assert.ok(draft.body.includes('Abhishek'));
      assert.ok(draft.safetyNotice.includes('strict human-in-the-loop policy'));
    }
  });

  test('9. Interview Prep Dossier: grounded strictly in verified candidate facts', () => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(testJobId);
    const dossier = generateInterviewDossier(job);

    assert.ok(dossier.technicalTopics.length >= 3);
    assert.ok(dossier.projectDeepDives.length >= 2);
    assert.ok(dossier.questionsToAskInterviewer.length >= 3);

    // Check project names
    const projNames = dossier.projectDeepDives.map(p => p.projectName);
    assert.ok(projNames.some(p => p.includes('NearVia')));
    assert.ok(projNames.some(p => p.includes('Leave Management')));

    // Check that NearVia mentions PostGIS or concurrency
    const nearVia = dossier.projectDeepDives.find(p => p.projectName.includes('NearVia'));
    assert.ok(nearVia.elevatorPitch.includes('NearVia'));
    assert.ok(nearVia.likelyQuestions.some(q => q.modelAnswer.includes('PostGIS') || q.modelAnswer.includes('locking')));
  });
});
