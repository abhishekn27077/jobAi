import test from 'node:test';
import assert from 'node:assert';
import { evaluateJobFit } from '../src/matcher/scoringEngine.js';

test('Scoring Engine recommends matching fresher Java role in Bengaluru', () => {
  const job = {
    title: 'Junior Java Developer (Fresher)',
    company: 'Tech Solutions India',
    location: 'Bengaluru, Karnataka',
    description: 'Looking for a Fresher / Entry Level Java Developer. Must have knowledge of Java, Spring Boot, MySQL and REST APIs. React knowledge is a plus.',
    skills: ['Java', 'Spring Boot', 'MySQL', 'REST'],
    experienceMin: 0,
    experienceMax: 1
  };

  const evalResult = evaluateJobFit(job);
  assert.strictEqual(evalResult.fresherEligible, 1);
  assert.strictEqual(evalResult.recommendation, 'RECOMMENDED');
  assert.ok(evalResult.score >= 70, `Score should be >= 70, got ${evalResult.score}`);
  assert.ok(evalResult.matchedSkills.includes('Java'));
  assert.ok(evalResult.matchedSkills.includes('Spring Boot'));
});

test('Scoring Engine strictly rejects Senior Java role requiring 6+ years', () => {
  const seniorJob = {
    title: 'Senior Java Backend Architect',
    company: 'Enterprise Corp',
    location: 'Bengaluru',
    description: 'Require 6-10 years experience in Java microservices and distributed systems.',
    skills: ['Java', 'Spring Boot', 'Kafka'],
    experienceMin: 6,
    experienceMax: 10
  };

  const evalResult = evaluateJobFit(seniorJob);
  assert.strictEqual(evalResult.fresherEligible, 0);
  assert.strictEqual(evalResult.recommendation, 'REJECTED');
  assert.match(evalResult.summaryReason, /Excluded: Senior\/Experienced/i);
});
