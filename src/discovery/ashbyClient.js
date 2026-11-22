/**
 * CareerOS — Ashby Public Job Board Client
 * Connects to Ashby's public, unauthenticated posting API:
 * https://api.ashbyhq.com/posting-api/job-board/{companyToken}
 * 
 * Extracts full job details, work mode, employment type, location, and requirements.
 */

import { normalizeCanonicalUrl, normalizeLocation } from './urlNormalizer.js';

export async function fetchAshbyJobs(companyToken, { query = null, timeoutMs = 10000, userAgent = 'CareerOS/2.0 (+https://github.com/abhishekn27077/jobAi)' } = {}) {
  if (!companyToken || typeof companyToken !== 'string') {
    throw new Error('Valid companyToken is required for Ashby API');
  }

  const cleanToken = companyToken.trim().toLowerCase();
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(cleanToken)}`;

  const resp = await fetch(url, {
    headers: {
      'User-Agent': userAgent,
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!resp.ok) {
    throw new Error(`Ashby API error for ${cleanToken}: HTTP ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  const postings = data.jobs || [];
  if (!Array.isArray(postings)) {
    return [];
  }

  const normalized = [];

  for (const item of postings) {
    const title = (item.title || '').trim();
    if (!title) continue;

    // Plain description
    const plainDesc = item.descriptionPlain || (item.descriptionHtml || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    // Optional query filtering
    if (query && typeof query === 'string') {
      const qLower = query.toLowerCase();
      const matchText = `${title} ${plainDesc} ${item.department || ''} ${item.team || ''}`.toLowerCase();
      if (!matchText.includes(qLower)) continue;
    }

    // Determine location
    const rawLoc = item.location || (item.address && item.address.postalAddress && item.address.postalAddress.addressLocality) || 'Remote';
    const location = normalizeLocation(rawLoc);

    // Determine work mode: remote | hybrid | onsite
    let workMode = 'onsite';
    const wpType = (item.workplaceType || '').toLowerCase();
    const isRemote = Boolean(item.isRemote);
    const locLower = (rawLoc || '').toLowerCase();

    if (isRemote || wpType === 'remote' || locLower.includes('remote') || plainDesc.toLowerCase().includes('remote-first')) {
      workMode = 'remote';
    } else if (wpType === 'hybrid' || locLower.includes('hybrid')) {
      workMode = 'hybrid';
    }

    // Determine employment type
    let employmentType = 'full_time';
    const empTypeStr = (item.employmentType || '').toLowerCase();
    if (empTypeStr.includes('intern')) {
      employmentType = 'internship';
    } else if (empTypeStr.includes('contract')) {
      employmentType = 'contract';
    } else if (empTypeStr.includes('parttime') || empTypeStr.includes('part-time')) {
      employmentType = 'part_time';
    }

    // Application URL
    const applyUrl = item.applyUrl || item.jobUrl || `https://jobs.ashbyhq.com/${cleanToken}/${item.id}`;
    const canonicalUrl = normalizeCanonicalUrl(applyUrl);

    // Extract experience range if present
    let experienceMin = null;
    let experienceMax = null;
    const expMatch = plainDesc.match(/(\d+)\s*(?:-|to)\s*(\d+)\s*years?/i) ||
                     plainDesc.match(/(\d+)\+\s*years?/i);
    if (expMatch) {
      if (expMatch[2]) {
        experienceMin = parseInt(expMatch[1], 10);
        experienceMax = parseInt(expMatch[2], 10);
      } else {
        experienceMin = parseInt(expMatch[1], 10);
      }
    }

    // Detect fresher keywords
    if (/fresher|intern|trainee|entry level|graduate/i.test(title)) {
      experienceMin = 0;
      if (experienceMax === null) experienceMax = 1;
    }

    // Extract skills keywords from text
    const skills = extractBasicSkills(`${title} ${plainDesc}`);

    // Salary extraction if compensation is present
    let salary = null;
    if (item.compensation && item.compensation.compensationTierSummary) {
      salary = item.compensation.compensationTierSummary;
    }

    const jobRecord = {
      externalSlug: `ashby-${cleanToken}-${item.id}`,
      source: 'ashby',
      sourceConfidence: 1.0,
      title,
      company: companyToken.charAt(0).toUpperCase() + companyToken.slice(1),
      location,
      url: applyUrl,
      canonicalUrl,
      description: plainDesc,
      salary,
      postedAt: item.publishedAt || null,
      experienceMin,
      experienceMax,
      workMode,
      employmentType,
      skills,
      department: item.department || item.team || null
    };

    normalized.push(jobRecord);
  }

  return normalized;
}

function extractBasicSkills(text) {
  const terms = [
    'Java', 'Spring Boot', 'Python', 'React', 'TypeScript', 'JavaScript',
    'Node.js', 'SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'AWS', 'Docker',
    'Kubernetes', 'REST APIs', 'Git', 'Microservices', 'GraphQL', 'Next.js'
  ];
  const matched = [];
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(text)) {
      matched.push(term);
    }
  }
  return matched;
}
