export async function fetchSmartRecruitersJobs(companyToken, query = 'Java') {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyToken)}/postings?q=${encodeURIComponent(query)}&limit=50`;

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'CareerOS/1.0 (+https://github.com/abhishekn27077)',
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
    const applyUrl = `https://jobs.smartrecruiters.com/${p.company ? p.company.identifier : companyToken}/${p.id}`;

    return {
      externalSlug: `smartrecruiters-${p.id}`,
      source: 'smartrecruiters',
      title: (p.name || '').trim(),
      company: p.company ? (p.company.name || companyToken) : companyToken,
      location: `${city}, India`,
      url: applyUrl,
      description: `${p.name} at ${companyToken}. Department: ${p.department ? p.department.label : 'Engineering'}. Location: ${city}`,
      salary: null,
      postedAt: p.releasedDate || null,
      experienceMin: p.experienceLevel ? (p.experienceLevel.id === 'entry_level' ? 0 : null) : null,
      experienceMax: null,
      skills: ['Java', 'Spring Boot', 'SQL']
    };
  });
}

export async function fetchGreenhouseJobs(boardToken) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'CareerOS/1.0 (+https://github.com/abhishekn27077)',
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!resp.ok) {
    throw new Error(`Greenhouse API error: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  const postings = data.jobs || [];

  return postings.map(p => ({
    externalSlug: `greenhouse-${p.id}`,
    source: 'greenhouse',
    title: (p.title || '').trim(),
    company: boardToken,
    location: p.location ? p.location.name : 'Bengaluru, India',
    url: p.absolute_url,
    description: (p.content || '').replace(/<[^>]+>/g, ' ').trim(),
    salary: null,
    postedAt: p.updated_at || null,
    experienceMin: null,
    experienceMax: null,
    skills: []
  }));
}
