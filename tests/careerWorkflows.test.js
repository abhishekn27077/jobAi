import test from 'node:test';
import assert from 'node:assert';
import { classifyRecruiterEmail, generateRecruiterDraftReply } from '../src/email/gmailService.js';
import { generateReferralMessage } from '../src/networking/referralAssistant.js';
import { generateInterviewDossier } from '../src/interview/prepService.js';

test('Email classifier categorizes interview invitations and rejections correctly', () => {
  const invite = classifyRecruiterEmail('Invitation to Technical Interview at TechCorp', 'We would like to schedule a coding assessment.');
  assert.strictEqual(invite.type, 'INTERVIEW_INVITATION');
  assert.strictEqual(invite.urgency, 'HIGH');

  const rejection = classifyRecruiterEmail('Status of your application', 'Unfortunately we are not moving forward with your candidacy at this time.');
  assert.strictEqual(rejection.type, 'REJECTION');
  assert.strictEqual(rejection.urgency, 'LOW');
});

test('Recruiter reply generator includes safety notice and verified profile details', () => {
  const job = { id: 10, title: 'Junior Java Developer', company: 'TrueID' };
  const draft = generateRecruiterDraftReply({ job, emailType: 'INTERVIEW_INVITATION' });

  assert.ok(draft.body.includes('Abhishek N'));
  assert.ok(draft.body.includes('TrueID'));
  assert.ok(draft.body.includes('NearVia'));
  assert.ok(draft.safetyNotice.includes('DRAFT ONLY'));
});

test('Referral assistant generates targeted messages for alumni and recruiters', () => {
  const job = { id: 20, title: 'Spring Boot Developer', company: 'Mphasis', url: 'https://mphasis.com/job/123' };

  const alumniMsg = generateReferralMessage(job, 'alumni', 'Rahul');
  assert.ok(alumniMsg.message.includes('AIMS Institutes'));
  assert.ok(alumniMsg.message.includes('Best AI Innovation medal'));
  assert.ok(alumniMsg.message.includes('Mphasis'));

  const recruiterMsg = generateReferralMessage(job, 'recruiter', 'Priya');
  assert.ok(recruiterMsg.message.includes('Spring Boot Developer'));
  assert.ok(recruiterMsg.message.includes('Anudip Foundation'));
});

test('Interview Dossier generator creates technical, project, and STAR questions', () => {
  const job = { id: 30, title: 'Java Full Stack Developer', company: 'NTT DATA' };
  const dossier = generateInterviewDossier(job);

  assert.strictEqual(dossier.company, 'NTT DATA');
  assert.ok(dossier.technicalTopics.some(t => t.topic.includes('Core Java')));
  assert.ok(dossier.technicalTopics.some(t => t.topic.includes('Spring Boot')));

  const nearviaDeepDive = dossier.projectDeepDives.find(p => p.projectName.includes('NearVia'));
  assert.ok(nearviaDeepDive, 'NearVia project deep dive must be present');
  assert.ok(nearviaDeepDive.likelyQuestions.some(q => q.q.includes('PostGIS') || q.q.includes('radius')));

  assert.ok(dossier.behavioralQuestions.length >= 2);
  assert.ok(dossier.behavioralQuestions[0].starFramework.situation);
});
