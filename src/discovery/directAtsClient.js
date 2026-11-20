import { normalizeCanonicalUrl, normalizeLocation } from './urlNormalizer.js';
export { fetchLeverJobs } from './leverClient.js';
export { fetchAshbyJobs } from './ashbyClient.js';

export async function fetchSmartRecruitersJobs(companyToken, query = 'Java') {
  const cleanToken = companyToken.trim();
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(cleanToken)}/postings?q=${encodeURIComponent(query)}&limit=50`;

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'CareerOS/2.0 (+https://github.com/abhishekn27077/jobAi)',
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!resp.ok) {
    throw new Error(`SmartRecruiters API error: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  const postings = data.content || [];

  return postings.map(p => {
    const city = p.location ? (p.location.city || p.location.region || 'India') : 'India';
    const applyUrl = `https://jobs.smartrecruiters.com/${p.company ? p.company.identifier : cleanToken}/${p.id}`;
    const canonicalUrl = normalizeCanonicalUrl(applyUrl);

    let workMode = 'onsite';
    if (p.location && p.location.remote) workMode = 'remote';
    else if (city.toLowerCase().includes('remote')) workMode = 'remote';

    let employmentType = 'full_time';
    if (p.typeOfEmployment && p.typeOfEmployment.label) {
      const typeStr = p.typeOfEmployment.label.toLowerCase();
      if (typeStr.includes('intern')) employmentType = 'internship';
      else if (typeStr.includes('contract')) employmentType = 'contract';
      else if (typeStr.includes('part')) employmentType = 'part_time';
    }

    return {
      externalSlug: `smartrecruiters-${p.id}`,
      source: 'smartrecruiters',
      sourceConfidence: 1.0,
      title: (p.name || '').trim(),
      company: p.company ? (p.company.name || cleanToken) : cleanToken,
      location: normalizeLocation(`${city}, India`),
      url: applyUrl,
      canonicalUrl,
      description: `${p.name} at ${cleanToken}. Department: ${p.department ? p.department.label : 'Engineering'}. Location: ${city}`,
      salary: null,
      postedAt: p.releasedDate || new Date().toISOString(),
      experienceMin: p.experienceLevel ? (p.experienceLevel.id === 'entry_level' ? 0 : null) : null,
      experienceMax: null,
      workMode,
      employmentType,
      skills: ['Java', 'Spring Boot', 'SQL']
    };
  });
}

export async function fetchGreenhouseJobs(boardToken) {
  const cleanToken = boardToken.trim().toLowerCase();
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(cleanToken)}/jobs?content=true`;

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'CareerOS/2.0 (+https://github.com/abhishekn27077/jobAi)',
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!resp.ok) {
    throw new Error(`Greenhouse API error: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  const postings = data.jobs || [];

  return postings.map(p => {
    const rawLoc = p.location ? p.location.name : 'Bengaluru, India';
    const locLower = (rawLoc || '').toLowerCase();
    let workMode = 'onsite';
    if (locLower.includes('remote')) workMode = 'remote';
    else if (locLower.includes('hybrid')) workMode = 'hybrid';

    const plainDesc = (p.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const applyUrl = p.absolute_url;
    const canonicalUrl = normalizeCanonicalUrl(applyUrl);

    // Fresher / experience extraction
    let expMin = null;
    let expMax = null;
    const expMatch = plainDesc.match(/(\d+)\s*(?:-|to)\s*(\d+)\s*years?/i);
    if (expMatch) {
      expMin = parseInt(expMatch[1], 10);
      expMax = parseInt(expMatch[2], 10);
    }
    if (/fresher|intern|trainee|entry level/i.test(p.title || '')) {
      expMin = 0;
      if (expMax === null) expMax = 1;
    }

    return {
      externalSlug: `greenhouse-${p.id}`,
      source: 'greenhouse',
      sourceConfidence: 1.0,
      title: (p.title || '').trim(),
      company: cleanToken.charAt(0).toUpperCase() + cleanToken.slice(1),
      location: normalizeLocation(rawLoc),
      url: applyUrl,
      canonicalUrl,
      description: plainDesc,
      salary: null,
      postedAt: p.updated_at || new Date().toISOString(),
      experienceMin: expMin,
      experienceMax: expMax,
      workMode,
      employmentType: /intern/i.test(p.title || '') ? 'internship' : 'full_time',
      skills: []
    };
  });
}
