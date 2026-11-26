import test from 'node:test';
import assert from 'node:assert';
import { loadCandidateProfile, getAllCandidateSkills } from '../src/profile/profileManager.js';

test('Candidate Profile loads verified information accurately', () => {
  const profile = loadCandidateProfile();

  assert.strictEqual(profile.personal.fullName, 'Abhishek N');
  assert.ok(profile.personal.email && profile.personal.email.includes('@'), 'Email must be present and valid');
  assert.ok(profile.personal.phone && profile.personal.phone.length >= 8, 'Phone must be present and valid');
  assert.match(profile.personal.location, /Bangalore/i);

  // Education verification
  assert.strictEqual(profile.education.length, 2);
  assert.match(profile.education[0].institution, /AIMS Institutes/i);
  assert.match(profile.education[0].degree, /MCA/i);
  assert.match(profile.education[1].institution, /SSA Government First Grade College/i);

  // Experience verification
  const anudip = profile.experience.find(e => /Anudip/i.test(e.company));
  assert.ok(anudip, 'Anudip Foundation internship must be present');
  assert.match(anudip.role, /Java Full Stack/i);
  assert.ok((anudip.bullets || []).some(b => /Leave Management/i.test(b)), 'Leave Management must be present under Anudip internship');

  // Projects verification
  const projectNames = profile.projects.map(p => p.name);
  assert.ok(projectNames.some(n => /NearVia/i.test(n)), 'NearVia must be present');
  assert.ok(projectNames.some(n => /FinSight/i.test(n)), 'FinSight must be present');
  assert.ok(projectNames.some(n => /Smart Rover/i.test(n)), 'Smart Rover must be present');
  assert.ok(projectNames.some(n => /Aquaponics/i.test(n)), 'Aquaponics must be present');
  assert.ok(projectNames.some(n => /Drowsiness/i.test(n)), 'Drowsiness Detection must be present');

  // Skills
  const skills = getAllCandidateSkills();
  assert.ok(skills.includes('java'));
  assert.ok(skills.includes('spring boot'));
  assert.ok(skills.includes('react.js') || skills.includes('react'));
  assert.ok(skills.includes('mysql'));
  assert.ok(skills.includes('python'));
});
