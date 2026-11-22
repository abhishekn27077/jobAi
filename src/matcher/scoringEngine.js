import { getAllCandidateSkills, loadCandidateProfile } from '../profile/profileManager.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PREFS_PATH = path.resolve(__dirname, '../../config/preferences.json');

export function evaluateJobFit(job) {
  const profile = loadCandidateProfile();
  const preferences = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8'));

  const textToScan = `${job.title} ${job.company} ${job.location} ${job.description} ${(job.skills || []).join(' ')}`.toLowerCase();
  const titleLower = (job.title || '').toLowerCase();
  const locationLower = (job.location || '').toLowerCase();

  // 1. Seniority & Fresher Eligibility Check (Weight: 30)
  let seniorityScore = 20; // default baseline
  let fresherEligible = true;
  const seniorKeywords = preferences.filtering.strictExcludeKeywords || [];
  const fresherKeywords = preferences.filtering.positiveFresherKeywords || [];

  // Strict Senior / Lead check in title
  const hasSeniorTitle = seniorKeywords.some(kw => {
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    return regex.test(titleLower);
  });

  const hasFresherKeyword = fresherKeywords.some(kw => textToScan.includes(kw));

  // Check experience numbers
  const expMin = job.experienceMin !== undefined ? job.experienceMin : (job.experience_min !== undefined ? job.experience_min : null);
  const expMax = job.experienceMax !== undefined ? job.experienceMax : (job.experience_max !== undefined ? job.experience_max : null);

  if (hasSeniorTitle) {
    seniorityScore = 0;
    fresherEligible = false;
  } else if (expMin !== null && expMin > 2) {
    seniorityScore = 0;
    fresherEligible = false;
  } else if (expMax !== null && expMax > 3 && expMin !== null && expMin >= 3) {
    seniorityScore = 0;
    fresherEligible = false;
  } else if (hasFresherKeyword || (expMin !== null && expMin <= 1)) {
    seniorityScore = 30; // Maximum fresher fit
    fresherEligible = true;
  } else {
    // Tolerable 0-2 years range
    seniorityScore = 22;
    fresherEligible = true;
  }

  // 2. Skills Match (Weight: 30)
  const candidateSkills = getAllCandidateSkills();
  const matchedSkills = [];
  const missingSkills = [];

  const keyTechTerms = [
    { name: 'Java', pattern: /\bjava\b/i, weight: 6 },
    { name: 'Spring Boot', pattern: /\bspring(\s*boot)?\b/i, weight: 6 },
    { name: 'React', pattern: /\breact(\.js)?\b/i, weight: 5 },
    { name: 'MySQL', pattern: /\bmysql\b/i, weight: 4 },
    { name: 'PostgreSQL', pattern: /\bpostgres(ql)?\b/i, weight: 4 },
    { name: 'REST APIs', pattern: /\brest(ful)?(\s*api)?\b/i, weight: 4 },
    { name: 'JavaScript', pattern: /\bjavascript|es6\b/i, weight: 3 },
    { name: 'TypeScript', pattern: /\btypescript\b/i, weight: 3 },
    { name: 'Python', pattern: /\bpython\b/i, weight: 3 },
    { name: 'Hibernate/JPA', pattern: /\bhibernate|jpa\b/i, weight: 3 },
    { name: 'Node.js', pattern: /\bnode(\.js)?\b/i, weight: 2 },
    { name: 'MongoDB', pattern: /\bmongodb\b/i, weight: 2 },
    { name: 'OpenCV / AI', pattern: /\bopencv|computer\s*vision|machine\s*learning|ai\b/i, weight: 3 }
  ];

  let rawSkillScore = 0;
  let totalPossibleWeight = 0;

  for (const tech of keyTechTerms) {
    const presentInJob = tech.pattern.test(textToScan);
    if (presentInJob) {
      totalPossibleWeight += tech.weight;
      // Does candidate have it?
      const candidateHasIt = candidateSkills.some(cs => tech.pattern.test(cs));
      if (candidateHasIt) {
        matchedSkills.push(tech.name);
        rawSkillScore += tech.weight;
      } else {
        missingSkills.push(tech.name);
      }
    }
  }

  let skillsScore = 15; // default if minimal specific tech mentioned
  if (totalPossibleWeight > 0) {
    skillsScore = Math.round((rawSkillScore / totalPossibleWeight) * 30);
  } else if (/\bsoftware\s*(development|engineering|developer)\b/i.test(textToScan)) {
    skillsScore = 20;
    matchedSkills.push('General Software Engineering');
  }

  // 3. Location Fit (Weight: 20)
  let locationScore = 10;
  const isBangalore = /\b(bengaluru|bangalore|karnataka)\b/i.test(locationLower);
  const isRemote = /\b(remote|work\s*from\s*home|wfh)\b/i.test(locationLower) || /\b(remote|work\s*from\s*home)\b/i.test(textToScan);
  const isOtherIndiaHub = /\b(hyderabad|pune|chennai|delhi|noida|gurugram|mumbai|india)\b/i.test(locationLower);

  if (isBangalore) {
    locationScore = 20; // Top location
  } else if (isRemote) {
    locationScore = 18;
  } else if (isOtherIndiaHub) {
    locationScore = 14;
  } else if (locationLower.includes('india')) {
    locationScore = 12;
  } else {
    locationScore = 5;
  }

  // 4. Role Relevance (Weight: 20)
  let roleScore = 10;
  if (/\bjava\s*(full\s*stack|developer|software)\b/i.test(titleLower)) {
    roleScore = 20;
  } else if (/\b(spring\s*boot|backend\s*developer)\b/i.test(titleLower)) {
    roleScore = 19;
  } else if (/\b(software\s*engineer|graduate\s*engineer\s*trainee|get|trainee)\b/i.test(titleLower)) {
    roleScore = 18;
  } else if (/\b(full\s*stack|react\s*developer|web\s*developer)\b/i.test(titleLower)) {
    roleScore = 17;
  } else if (/\bpython(\s*developer)?\b/i.test(titleLower)) {
    roleScore = 16;
  } else if (/\b(ai\s*engineer|ml\s*engineer|junior\s*developer)\b/i.test(titleLower)) {
    roleScore = 15;
  }

  // Calculate composite score
  const compositeScore = Math.min(100, Math.round(seniorityScore + skillsScore + locationScore + roleScore));

  // Determine star rating (1 to 5)
  let rating = 1;
  if (compositeScore >= 80) rating = 5;
  else if (compositeScore >= 65) rating = 4;
  else if (compositeScore >= 50) rating = 3;
  else if (compositeScore >= 35) rating = 2;

  // Determine Recommendation
  let recommendation = 'REJECTED';
  if (!fresherEligible) {
    recommendation = 'REJECTED';
  } else if (compositeScore >= 65) {
    recommendation = 'RECOMMENDED';
  } else if (compositeScore >= 45) {
    recommendation = 'CONSIDER';
  } else {
    recommendation = 'REJECTED';
  }

  // Generate plain English explanation
  const reasons = [];
  if (!fresherEligible) {
    reasons.push(`Excluded: Senior/Experienced role (${job.experienceMin ? job.experienceMin + '+ yrs' : 'Senior title detected'}). Abhishek is an MCA 2026 Fresher.`);
  } else {
    if (hasFresherKeyword) reasons.push('Explicitly open to Freshers / Trainees / Entry-level.');
    if (isBangalore) reasons.push('Location is Bengaluru (Candidate top priority).');
    else if (isRemote) reasons.push('Location is Remote friendly.');
    else if (isOtherIndiaHub) reasons.push(`Location is in India (${job.location || 'India Tech Hub'}).`);

    if (matchedSkills.length > 0) {
      reasons.push(`Skills match Abhishek's verified profile: ${matchedSkills.join(', ')}.`);
    }
    if (missingSkills.length > 0) {
      reasons.push(`Unmatched requirements: ${missingSkills.join(', ')}.`);
    }
  }

  const summaryReason = reasons.join(' ');

  return {
    score: compositeScore,
    rating,
    recommendation,
    fresherEligible: fresherEligible ? 1 : 0,
    summaryReason,
    matchedSkills,
    missingSkills,
    breakdown: {
      seniorityScore,
      skillsScore,
      locationScore,
      roleScore
    }
  };
}

export function evaluateJobs(jobs) {
  return (jobs || []).map(j => evaluateJobFit(j));
}
