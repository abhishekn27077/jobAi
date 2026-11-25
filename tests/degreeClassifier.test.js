import test from 'node:test';
import assert from 'node:assert';
import {
  classifyDegreeRequirement,
  DEGREE_CLASSIFICATIONS,
  ELIGIBILITY_STATUSES,
  isMcaConfirmedEligible,
  isMcaStrictlyIneligible
} from '../src/matcher/degreeClassifier.js';
import { extractJdRequirements } from '../src/resumes/jdAnalyzer.js';
import { generateStudioResume } from '../src/resumes/resumeStudioService.js';
import { loadCandidateProfile } from '../src/profile/profileManager.js';

test('Degree Classifier correctly identifies MCA_EXPLICIT requirements (eligible)', () => {
  const jd1 = 'Qualifications: B.Tech / B.E. / MCA in Computer Science or Information Technology with good coding fundamentals.';
  const res1 = classifyDegreeRequirement(jd1);
  assert.strictEqual(res1.classification, DEGREE_CLASSIFICATIONS.MCA_EXPLICIT);
  assert.strictEqual(res1.eligibilityStatus, ELIGIBILITY_STATUSES.ELIGIBLE);
  assert.strictEqual(res1.isConfirmedEligible, true);
  assert.strictEqual(res1.isStrictlyIneligible, false);
  assert.strictEqual(res1.confidence, 'high');
  assert.ok(isMcaConfirmedEligible(res1));

  const jd2 = 'We welcome Master of Computer Applications (MCA) graduates from 2024-2026 batches.';
  const res2 = classifyDegreeRequirement(jd2);
  assert.strictEqual(res2.classification, DEGREE_CLASSIFICATIONS.MCA_EXPLICIT);
  assert.strictEqual(res2.eligibilityStatus, ELIGIBILITY_STATUSES.ELIGIBLE);
  assert.strictEqual(res2.isConfirmedEligible, true);
});

test('Degree Classifier correctly identifies EQUIVALENT_ACCEPTED qualifications (eligible)', () => {
  const jd1 = 'Education: Bachelor\'s or Master\'s degree in Computer Science or equivalent practical experience.';
  const res1 = classifyDegreeRequirement(jd1);
  assert.strictEqual(res1.classification, DEGREE_CLASSIFICATIONS.EQUIVALENT_ACCEPTED);
  assert.strictEqual(res1.eligibilityStatus, ELIGIBILITY_STATUSES.ELIGIBLE);
  assert.strictEqual(res1.isConfirmedEligible, true);
  assert.strictEqual(res1.isStrictlyIneligible, false);
  assert.strictEqual(res1.confidence, 'high');
  assert.ok(isMcaConfirmedEligible(res1));

  const jd2 = 'Requires a degree in computer science or related technical discipline.';
  const res2 = classifyDegreeRequirement(jd2);
  assert.strictEqual(res2.classification, DEGREE_CLASSIFICATIONS.EQUIVALENT_ACCEPTED);
  assert.strictEqual(res2.eligibilityStatus, ELIGIBILITY_STATUSES.ELIGIBLE);
  assert.strictEqual(res2.isConfirmedEligible, true);
});

test('Degree Classifier flags BTECH_NON_EXCLUSIVE as potentially eligible, not automatically confirmed eligible', () => {
  const jd = 'Candidate should have a B.Tech or B.E. in CS/IT. Strong Java and Spring Boot knowledge required.';
  const res = classifyDegreeRequirement(jd);
  assert.strictEqual(res.classification, DEGREE_CLASSIFICATIONS.BTECH_NON_EXCLUSIVE);
  assert.strictEqual(res.eligibilityStatus, ELIGIBILITY_STATUSES.POTENTIALLY_ELIGIBLE);
  assert.strictEqual(res.isConfirmedEligible, false, 'Must not be automatically confirmed eligible without explicit MCA acceptance');
  assert.strictEqual(res.isStrictlyIneligible, false, 'Must not be marked ineligible when restriction is non-exclusive');
  assert.strictEqual(res.confidence, 'medium');
  assert.strictEqual(isMcaConfirmedEligible(res), false);
  assert.strictEqual(isMcaStrictlyIneligible(res), false);
});

test('Degree Classifier strictly flags BTECH_STRICT_RESTRICTION as ineligible and never describes MCA as non-engineering', () => {
  const jd1 = 'Eligibility: Only B.Tech/B.E. candidates are eligible. MCA and non-engineering graduates need not apply.';
  const res1 = classifyDegreeRequirement(jd1);
  assert.strictEqual(res1.classification, DEGREE_CLASSIFICATIONS.BTECH_STRICT_RESTRICTION);
  assert.strictEqual(res1.eligibilityStatus, ELIGIBILITY_STATUSES.INELIGIBLE);
  assert.strictEqual(res1.isConfirmedEligible, false);
  assert.strictEqual(res1.isStrictlyIneligible, true);
  assert.strictEqual(res1.confidence, 'high');
  assert.strictEqual(isMcaConfirmedEligible(res1), false);
  assert.strictEqual(isMcaStrictlyIneligible(res1), true);

  // Ethics rule: Must not describe MCA as a non-engineering qualification in system reasoning
  assert.ok(!res1.reason.includes('non-engineering qualification'), 'Must not describe MCA as a non-engineering qualification');
  assert.ok(res1.reason.includes('explicit B.Tech/B.E.-only restriction'));

  const jd2 = 'This campus recruitment drive is strictly B.Tech only.';
  const res2 = classifyDegreeRequirement(jd2);
  assert.strictEqual(res2.classification, DEGREE_CLASSIFICATIONS.BTECH_STRICT_RESTRICTION);
  assert.strictEqual(res2.eligibilityStatus, ELIGIBILITY_STATUSES.INELIGIBLE);
  assert.strictEqual(res2.isStrictlyIneligible, true);
});

test('Degree Classifier treats unclear qualification requirements as unknown without penalizing candidate', () => {
  const jdEmpty = '';
  const resEmpty = classifyDegreeRequirement(jdEmpty);
  assert.strictEqual(resEmpty.classification, DEGREE_CLASSIFICATIONS.UNCLEAR);
  assert.strictEqual(resEmpty.eligibilityStatus, ELIGIBILITY_STATUSES.UNKNOWN);
  assert.strictEqual(resEmpty.isConfirmedEligible, false, 'Must not be automatically confirmed eligible when unclear');
  assert.strictEqual(resEmpty.isStrictlyIneligible, false, 'Must not be penalized as ineligible');

  const jdAmbiguous = 'Looking for passionate Junior Java Developers with strong REST API and problem solving abilities.';
  const resAmbiguous = classifyDegreeRequirement(jdAmbiguous);
  assert.strictEqual(resAmbiguous.classification, DEGREE_CLASSIFICATIONS.UNCLEAR);
  assert.strictEqual(resAmbiguous.eligibilityStatus, ELIGIBILITY_STATUSES.UNKNOWN);
  assert.strictEqual(resAmbiguous.isConfirmedEligible, false);
  assert.strictEqual(resAmbiguous.isStrictlyIneligible, false);
});

test('ATS Scorer awards calibrated degree match scores without unsupported score inflation', () => {
  // 1. MCA Explicit -> 10/10
  const mcaAnalysis = extractJdRequirements({
    title: 'Java Developer',
    company: 'TechCorp',
    description: 'Requires MCA or B.Tech with Java and Spring Boot.'
  });
  const mcaResult = generateStudioResume({ title: 'Java Developer', company: 'TechCorp' }, { jdAnalysis: mcaAnalysis });
  return mcaResult.then(res => {
    const ats = res.atsScore;
    assert.strictEqual(ats.categories.educationMatch.score, 10, 'Explicit MCA must receive full 10/10');
    assert.strictEqual(ats.eligibilityAssessment.status, 'ELIGIBLE');

    // 2. B.Tech Non-Exclusive -> 6/10 (cautious, not inflated)
    const btechAnalysis = extractJdRequirements({
      title: 'Java Developer',
      company: 'TechCorp',
      description: 'Requires B.Tech/B.E. in Computer Science with Java skills.'
    });
    return generateStudioResume({ title: 'Java Developer', company: 'TechCorp' }, { jdAnalysis: btechAnalysis });
  }).then(res => {
    const ats = res.atsScore;
    assert.strictEqual(ats.categories.educationMatch.score, 6, 'Non-exclusive B.Tech must receive cautious 6/10 without score inflation');
    assert.strictEqual(ats.eligibilityAssessment.status, 'POTENTIALLY_ELIGIBLE');
    assert.strictEqual(ats.overallMatch.recommendation, 'POTENTIALLY_ELIGIBLE');

    // 3. Unclear requirement -> 5/10 (neutral baseline, not penalized, not inflated)
    const unclearAnalysis = extractJdRequirements({
      title: 'Java Developer',
      company: 'TechCorp',
      description: 'Join our team as a Java developer with good teamwork and problem solving.'
    });
    return generateStudioResume({ title: 'Java Developer', company: 'TechCorp' }, { jdAnalysis: unclearAnalysis });
  }).then(res => {
    const ats = res.atsScore;
    assert.strictEqual(ats.categories.educationMatch.score, 5, 'Unclear degree must receive neutral 5/10 baseline');
    assert.strictEqual(ats.eligibilityAssessment.status, 'INSUFFICIENT_INFO');

    // 4. B.Tech Strict Restriction -> 0/10
    const strictAnalysis = extractJdRequirements({
      title: 'Java Developer',
      company: 'TechCorp',
      description: 'Campus hiring strictly B.Tech only. MCA not eligible.'
    });
    return generateStudioResume({ title: 'Java Developer', company: 'TechCorp' }, { jdAnalysis: strictAnalysis });
  }).then(res => {
    const ats = res.atsScore;
    assert.strictEqual(ats.categories.educationMatch.score, 0, 'Strict B.Tech restriction must receive 0/10');
    assert.strictEqual(ats.eligibilityAssessment.status, 'MANDATORY_NOT_MET');
    assert.strictEqual(ats.overallMatch.recommendation, 'NOT_ELIGIBLE');
  });
});

test('Candidate profile is strictly grounded in verified MCA and BCA degrees without fabrication', () => {
  const profile = loadCandidateProfile();
  const degrees = profile.education.map(e => e.degree);

  // Must only contain verified degrees
  assert.ok(degrees.some(d => d.includes('MCA')), 'Must have verified MCA');
  assert.ok(degrees.some(d => d.includes('BCA')), 'Must have verified BCA');
  assert.ok(!degrees.some(d => /B\.?Tech|B\.?E\./i.test(d)), 'Must NEVER fabricate B.Tech/B.E.');
});
