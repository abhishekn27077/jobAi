const BASE_URL = process.env.FREEHIRE_BASE_URL || 'https://freehire.me/api/v1';

export async function searchFreehireJobs({ query, countries = ['in'], limit = 20, offset = 0 }) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (countries && countries.length > 0) {
    for (const c of countries) {
      params.append('countries', c);
    }
  }
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  const url = `${BASE_URL}/agent/jobs/search?${params.toString()}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Career-Agent/1.0 (+https://github.com/abhishekn27077)',
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(`FreeHire API error: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const jobs = payload.data || [];
  const meta = payload.meta || {};

  return {
    total: meta.total || jobs.length,
    jobs: jobs.map(normalizeFreehireJob)
  };
}

function normalizeFreehireJob(job) {
  let cleanDesc = job.description || '';
  // Convert HTML markup to clean text for scoring while keeping key terms
  cleanDesc = cleanDesc.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

  let expMin = null;
  let expMax = null;
  if (job.enrichment && typeof job.enrichment.experience_years_min === 'number') {
    expMin = job.enrichment.experience_years_min;
  }

  // Fallback regex to parse years of experience if not explicitly enriched
  const expMatch = cleanDesc.match(/(\d+)(?:\s*-\s*|\s*to\s*)(\d+)\s*(?:years?|yrs?)/i) || 
                   cleanDesc.match(/(\d+)\+?\s*(?:years?|yrs?)\s*(?:of\s*)?experience/i);
  if (expMatch) {
    if (expMatch[2]) {
      expMin = parseInt(expMatch[1], 10);
      expMax = parseInt(expMatch[2], 10);
    } else {
      const num = parseInt(expMatch[1], 10);
      if (expMin === null) expMin = num;
    }
  }

  return {
    externalSlug: job.public_slug || job.slug || `${job.company || 'unknown'}-${job.id || Date.now()}`,
    source: 'freehire',
    title: (job.title || '').trim(),
    company: (job.company || 'Unknown Company').trim(),
    location: (job.location || '').trim(),
    url: job.url || `https://freehire.me/jobs/${job.public_slug}`,
    description: cleanDesc,
    salary: job.salary ? String(job.salary) : null,
    postedAt: job.posted_at || job.created_at || null,
    experienceMin: expMin,
    experienceMax: expMax,
    skills: Array.isArray(job.skills) ? job.skills : [],
    raw: job
  };
}
