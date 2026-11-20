/**
 * CareerOS — Job Data Validation & Completeness Engine
 * Validates integrity of job records before ingestion into SQLite vault,
 * normalizes work modes, employment types, source confidence, and data completeness.
 */

import { normalizeCanonicalUrl, normalizeLocation } from './urlNormalizer.js';

export function validateJobRecord(rawJob) {
  const errors = [];
  if (!rawJob || typeof rawJob !== 'object') {
    return { isValid: false, errors: ['Job record must be a valid object'], normalizedJob: null };
  }

  // 1. Validate Job Title
  const title = (rawJob.title || '').trim();
  if (!title) {
    errors.push('Missing job title');
  } else if (title.length < 3) {
    errors.push(`Job title "${title}" is too short (min 3 chars)`);
  }

  // 2. Validate Company
  const company = (rawJob.company || '').trim();
  if (!company || /^(unknown|undefined|null|n\/a)$/i.test(company)) {
    errors.push('Missing or invalid company name');
  }

  // 3. Validate URL
  const rawUrl = (rawJob.url || '').trim();
  const canonicalUrl = normalizeCanonicalUrl(rawUrl);
  if (!canonicalUrl) {
    errors.push(`Invalid or missing application URL: "${rawUrl}"`);
  }

  // 4. Validate Location
  const location = normalizeLocation(rawJob.location || 'Bengaluru, Karnataka, India');

  // 5. Validate Experience
  let expMin = null;
  let expMax = null;

  if (rawJob.experienceMin !== undefined && rawJob.experienceMin !== null) {
    const minVal = parseInt(rawJob.experienceMin, 10);
    if (!Number.isNaN(minVal) && minVal >= 0 && minVal <= 30) {
      expMin = minVal;
    } else {
      errors.push(`Invalid experienceMin: ${rawJob.experienceMin}`);
    }
  }

  if (rawJob.experienceMax !== undefined && rawJob.experienceMax !== null) {
    const maxVal = parseInt(rawJob.experienceMax, 10);
    if (!Number.isNaN(maxVal) && maxVal >= 0 && maxVal <= 30) {
      expMax = maxVal;
    } else {
      errors.push(`Invalid experienceMax: ${rawJob.experienceMax}`);
    }
  }

  if (expMin !== null && expMax !== null && expMin > expMax) {
    errors.push(`experienceMin (${expMin}) cannot exceed experienceMax (${expMax})`);
    // Safe auto-repair
    const temp = expMin;
    expMin = expMax;
    expMax = temp;
  }

  // 6. Validate Salary
  let salary = null;
  if (rawJob.salary !== undefined && rawJob.salary !== null) {
    const sStr = String(rawJob.salary).trim();
    if (sStr && !/^(undefined|null|none|n\/a)$/i.test(sStr)) {
      salary = sStr;
    }
  }

  // 7. Validate & Normalize Work Mode (remote | hybrid | onsite)
  let workMode = 'onsite';
  const rawWp = (rawJob.workMode || rawJob.workplaceType || '').toLowerCase();
  const locLower = location.toLowerCase();
  const descLower = (rawJob.description || '').toLowerCase();

  if (rawWp === 'remote' || locLower.includes('remote') || descLower.includes('work from anywhere') || descLower.includes('remote friendly')) {
    workMode = 'remote';
  } else if (rawWp === 'hybrid' || locLower.includes('hybrid') || descLower.includes('hybrid schedule')) {
    workMode = 'hybrid';
  }

  // 8. Validate & Normalize Employment Type (full_time | internship | contract | part_time)
  let employmentType = 'full_time';
  const rawEmp = (rawJob.employmentType || rawJob.commitment || '').toLowerCase();
  if (rawEmp.includes('intern') || /intern|trainee/i.test(title)) {
    employmentType = 'internship';
  } else if (rawEmp.includes('contract')) {
    employmentType = 'contract';
  } else if (rawEmp.includes('part')) {
    employmentType = 'part_time';
  }

  // 9. Source & Source Confidence
  const source = (rawJob.source || 'direct').toLowerCase();
  let sourceConfidence = 0.7;
  if (['lever', 'ashby', 'greenhouse', 'smartrecruiters', 'workday'].includes(source)) {
    sourceConfidence = 1.0; // Official direct corporate ATS
  } else if (['freehire', 'linkedin', 'naukri', 'indeed', 'cutshort'].includes(source)) {
    sourceConfidence = 0.85; // Curated aggregator / job board
  }

  // 10. Data Completeness Score (0.0 to 1.0)
  let completeness = 0.0;
  if (title && title.length >= 3) completeness += 0.2;
  if (company && company.length >= 2) completeness += 0.2;
  if (canonicalUrl) completeness += 0.2;
  if (location && location !== 'India') completeness += 0.1;
  else if (location) completeness += 0.05;
  if (rawJob.description && rawJob.description.trim().length >= 50) completeness += 0.1;
  if (rawJob.postedAt || rawJob.posted_at) completeness += 0.1;
  if ((rawJob.skills && rawJob.skills.length > 0) || expMin !== null) completeness += 0.1;

  const completenessScore = Math.min(1.0, Math.round(completeness * 100) / 100);

  // 11. Skills extraction
  const skills = Array.isArray(rawJob.skills) ? rawJob.skills : [];
  const requiredSkills = Array.isArray(rawJob.requiredSkills) ? rawJob.requiredSkills : skills;
  const preferredSkills = Array.isArray(rawJob.preferredSkills) ? rawJob.preferredSkills : [];

  const normalizedJob = {
    ...rawJob,
    title,
    company,
    url: canonicalUrl,
    canonicalUrl,
    location,
    experienceMin: expMin,
    experienceMax: expMax,
    salary,
    description: (rawJob.description || '').trim(),
    source,
    sourceConfidence,
    completenessScore,
    workMode,
    employmentType,
    skills,
    requiredSkills,
    preferredSkills,
    postedAt: rawJob.postedAt || rawJob.posted_at || new Date().toISOString()
  };

  return {
    isValid: errors.length === 0,
    errors,
    completenessScore,
    normalizedJob
  };
}
