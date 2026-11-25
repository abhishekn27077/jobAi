import { normalizeCanonicalUrl, normalizeLocation } from './urlNormalizer.js';
export { fetchLeverJobs } from './leverClient.js';
export { fetchAshbyJobs } from './ashbyClient.js';
export { fetchWorkableJobs } from './workableClient.js';
export { fetchRecruiteeJobs } from './recruiteeClient.js';

export async function fetchSmartRecruitersJobs(companyToken, query = 'Java') {
  const cleanToken = companyToken.trim();
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(cleanToken)}/postings?q=${encodeURIComponent(query)}&limit=50`;

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'CareerOS/2.0 (+https://github.com/abhishekn27077/jobAi)',
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(15000)
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
      postedAt: p.releasedDate || null,
      experienceMin: p.experienceLevel ? (p.experienceLevel.id === 'entry_level' ? 0 : null) : null,
      experienceMax: null,
      workMode,
      employmentType,
      skills: extractBasicSkills(`${p.name || ''} ${p.department?.label || ''}`)
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
    signal: AbortSignal.timeout(15000)
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
      postedAt: p.updated_at || null,
      experienceMin: expMin,
      experienceMax: expMax,
      workMode,
      employmentType: /intern/i.test(p.title || '') ? 'internship' : 'full_time',
      skills: extractBasicSkills(`${p.title || ''} ${plainDesc}`)
    };
  });
}

export function extractBasicSkills(text, { title = '', department = '' } = {}) {
  if (!text || typeof text !== 'string') return [];
  const combined = `${title} ${department} ${text}`;
  const lower = combined.toLowerCase();

  // If role is explicitly non-technical with no technical context, do not extract technical skills
  const nonTechRegex = /\b(recruiter|talent acquisition|account executive|sales representative|hr generalist|hr manager|legal counsel|compliance officer|content writer|copywriter|community manager|office manager|executive assistant|customer service|customer support|barista|driver)\b/i;
  const isNonTech = nonTechRegex.test(title);

  const terms = [
    'Java', 'Spring Boot', 'Python', 'React', 'TypeScript', 'JavaScript',
    'Node.js', 'SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'AWS', 'Docker',
    'Kubernetes', 'REST APIs', 'Git', 'Microservices', 'FastAPI', 'Django'
  ];

  const matched = [];
  for (const term of terms) {
    // 1. Guard against negative requirements: "no python", "no java required", "without java"
    const negRegex = new RegExp(`\\b(no|not|never|without)\\s+(?:prior\\s+)?(?:knowledge\\s+of\\s+|experience\\s+in\\s+)?${term}\\b`, 'i');
    if (negRegex.test(combined)) {
      continue;
    }

    // 2. Guard for React (disambiguate English verb "react")
    if (term === 'React') {
      const isVerbReact = /\b(ability to react|react quickly|react promptly|react under|react to|will react|must react)\b/i.test(combined);
      const isTechReact = /\b(react\.?js|reactjs|react native|react framework|react library|react developer|react frontend)\b/i.test(combined) ||
                          (/\bReact\b/.test(combined) && !isVerbReact && (lower.includes('frontend') || lower.includes('javascript') || lower.includes('ui') || lower.includes('web') || lower.includes('developer') || lower.includes('engineer')));
      if (isTechReact && (!isNonTech || lower.includes('developer') || lower.includes('engineer'))) {
        matched.push('React');
      }
      continue;
    }

    // 3. Guard for Java (disambiguate Indonesian geography and coffee/cafes)
    if (term === 'Java') {
      const isGeoJava = /\b(java,?\s+indonesia|west java|east java|central java|island of java|java sea)\b/i.test(combined);
      const isCoffeeJava = /\b(coffee|barista|cafe|restaurant)\b/i.test(combined);
      if (isGeoJava || isCoffeeJava) {
        const isProgrammingJava = /\b(java\s+\d+|core java|java developer|java backend|java engineer|java\/spring|java ee|java se)\b/i.test(combined);
        if (!isProgrammingJava) continue;
      }
      if (isNonTech && !lower.includes('developer') && !lower.includes('engineer') && !lower.includes('programmer')) {
        continue;
      }
      if (/\bJava\b/.test(combined) || /\bjava\b/i.test(title)) {
        matched.push('Java');
      }
      continue;
    }

    // 4. Guard for Git (avoid non-tech context)
    if (term === 'Git') {
      const isTechGit = /\b(git\b|github|gitlab|version control)/i.test(combined) &&
                        (lower.includes('developer') || lower.includes('engineer') || lower.includes('commit') || lower.includes('branch') || lower.includes('code') || lower.includes('repository') || lower.includes('software'));
      if (isTechGit && !isNonTech) {
        matched.push('Git');
      }
      continue;
    }

    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(combined)) {
      if (isNonTech && !lower.includes('engineer') && !lower.includes('developer') && !lower.includes('programming')) {
        continue;
      }
      matched.push(term);
    }
  }

  return matched;
}
