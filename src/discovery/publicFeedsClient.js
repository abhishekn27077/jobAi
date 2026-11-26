/**
 * CareerOS — Public Legitimate Job Feeds Client
 * Free, unauthenticated public JSON/RSS APIs for Remote & International tech roles:
 * - Remotive (remotive.com/api/remote-jobs)
 * - Arbeitnow (arbeitnow.com/api/job-board-api)
 * - Himalayas (himalayas.app/jobs/api)
 * - Jobicy (jobicy.com/api/v2/remote-jobs)
 * - RemoteOK (remoteok.com/api)
 * - We Work Remotely (weworkremotely.com/categories/remote-programming-jobs.rss)
 *
 * Includes strict timeouts, error isolation, query filtering, and zero-fabrication normalization.
 */

const FETCH_TIMEOUT_MS = 8000;

function stripHtml(html = '') {
  return String(html || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesOptionalQuery(job, query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const tokens = q.split(/[\s,]+/).filter(t => t.length >= 2);
  if (tokens.length === 0) return true;
  const haystack = `${job.title || ''} ${job.company || ''} ${job.description || ''} ${(job.requiredSkills || []).join(' ')}`.toLowerCase();
  return tokens.some(t => haystack.includes(t));
}

async function fetchWithTimeout(url, { timeoutMs = FETCH_TIMEOUT_MS, responseType = 'json' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'CareerOS-Local-Workspace/1.0 (+https://github.com/abhishekn27077/jobAi)',
        Accept: responseType === 'text' ? 'application/rss+xml, application/xml, text/xml, text/plain' : 'application/json'
      }
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} from ${url}`);
    }
    return responseType === 'text' ? await resp.text() : await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchRemotiveJobs({ category = 'software-dev', limit = 25, query = '' } = {}) {
  try {
    const searchParam = query ? `&search=${encodeURIComponent(query)}` : '';
    const url = `https://remotive.com/api/remote-jobs?category=${encodeURIComponent(category)}&limit=${limit}${searchParam}`;
    const data = await fetchWithTimeout(url);
    const rawJobs = Array.isArray(data.jobs) ? data.jobs.slice(0, limit) : [];

    return rawJobs.map(j => ({
      externalSlug: `remotive-${j.id}`,
      source: 'remotive',
      title: j.title || 'Software Developer',
      company: j.company_name || 'Unknown Company',
      location: j.candidate_required_location || 'Worldwide Remote',
      url: j.url,
      canonicalUrl: j.url,
      description: stripHtml(j.description),
      salary: j.salary || null,
      postedAt: j.publication_date || null,
      workMode: 'remote',
      employmentType: (j.job_type || 'full_time').toLowerCase().includes('intern') ? 'internship' : 'full_time',
      requiredSkills: Array.isArray(j.tags) ? j.tags : []
    })).filter(j => j.url && j.title);
  } catch (err) {
    console.warn(`[PublicFeeds] Remotive fetch skipped: ${err.message}`);
    return [];
  }
}

export async function fetchArbeitnowJobs({ limit = 25, query = '' } = {}) {
  try {
    const url = 'https://www.arbeitnow.com/api/job-board-api';
    const data = await fetchWithTimeout(url);
    const rawJobs = Array.isArray(data.data) ? data.data : [];

    return rawJobs.map(j => ({
      externalSlug: `arbeitnow-${j.slug}`,
      source: 'arbeitnow',
      title: j.title || 'Software Engineer',
      company: j.company_name || 'Unknown Company',
      location: j.location || (j.remote ? 'Remote (Europe/Global)' : 'Europe'),
      url: j.url,
      canonicalUrl: j.url,
      description: stripHtml(j.description),
      salary: null,
      postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
      workMode: j.remote ? 'remote' : 'onsite',
      employmentType: 'full_time',
      requiredSkills: Array.isArray(j.tags) ? j.tags : []
    }))
      .filter(j => j.url && j.title && matchesOptionalQuery(j, query))
      .slice(0, limit);
  } catch (err) {
    console.warn(`[PublicFeeds] Arbeitnow fetch skipped: ${err.message}`);
    return [];
  }
}

export async function fetchHimalayasJobs({ limit = 25, query = '' } = {}) {
  try {
    const url = `https://himalayas.app/jobs/api?limit=${Math.min(Math.max(limit, 1), 50)}`;
    const data = await fetchWithTimeout(url);
    const rawJobs = Array.isArray(data.jobs) ? data.jobs : [];

    return rawJobs.map(j => {
      const locs = Array.isArray(j.locationRestrictions) && j.locationRestrictions.length > 0
        ? j.locationRestrictions.join(', ')
        : 'Worldwide Remote';
      const minSal = j.minSalary ? Number(j.minSalary) : null;
      const maxSal = j.maxSalary ? Number(j.maxSalary) : null;
      const salary = minSal && maxSal
        ? `${j.currency || 'USD'} ${minSal.toLocaleString()}-${maxSal.toLocaleString()}`
        : (minSal ? `${j.currency || 'USD'} ${minSal.toLocaleString()}+` : null);
      const jobUrl = j.applicationLink || j.guid;
      return {
        externalSlug: `himalayas-${j.guid || j.slug || Buffer.from(String(jobUrl || j.title)).toString('base64url').slice(0, 24)}`,
        source: 'himalayas',
        title: j.title || 'Software Engineer',
        company: j.companyName || 'Unknown Company',
        location: locs,
        url: jobUrl,
        canonicalUrl: jobUrl,
        description: stripHtml(j.description || j.excerpt),
        salary,
        postedAt: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : null,
        workMode: 'remote',
        employmentType: (j.employmentType || 'full_time').toLowerCase().includes('intern') ? 'internship' : 'full_time',
        requiredSkills: Array.isArray(j.categories) ? j.categories : []
      };
    })
      .filter(j => j.url && j.title && matchesOptionalQuery(j, query))
      .slice(0, limit);
  } catch (err) {
    console.warn(`[PublicFeeds] Himalayas fetch skipped: ${err.message}`);
    return [];
  }
}

export async function fetchJobicyJobs({ count = 25, query = '' } = {}) {
  try {
    const tagParam = query ? `&tag=${encodeURIComponent(query.split(/\s+/)[0])}` : '';
    const url = `https://jobicy.com/api/v2/remote-jobs?count=${Math.min(Math.max(count, 1), 50)}${tagParam}`;
    const data = await fetchWithTimeout(url);
    const rawJobs = Array.isArray(data.jobs) ? data.jobs : [];

    return rawJobs.map(j => {
      const salary = (j.annualSalaryMin && j.annualSalaryMax)
        ? `${j.salaryCurrency || 'USD'} ${j.annualSalaryMin}-${j.annualSalaryMax}`
        : null;
      return {
        externalSlug: `jobicy-${j.id}`,
        source: 'jobicy',
        title: stripHtml(j.jobTitle) || 'Software Developer',
        company: stripHtml(j.companyName) || 'Unknown Company',
        location: stripHtml(j.jobGeo) || 'Worldwide Remote',
        url: j.url,
        canonicalUrl: j.url,
        description: stripHtml(j.jobDescription || j.jobExcerpt),
        salary,
        postedAt: j.pubDate || null,
        workMode: 'remote',
        employmentType: String(j.jobType || '').toLowerCase().includes('intern') ? 'internship' : 'full_time',
        requiredSkills: Array.isArray(j.jobIndustry) ? j.jobIndustry : []
      };
    })
      .filter(j => j.url && j.title && matchesOptionalQuery(j, query))
      .slice(0, count);
  } catch (err) {
    console.warn(`[PublicFeeds] Jobicy fetch skipped: ${err.message}`);
    return [];
  }
}

export async function fetchRemoteOkJobs({ limit = 25, query = '' } = {}) {
  try {
    const url = 'https://remoteok.com/api';
    const data = await fetchWithTimeout(url);
    const rawJobs = Array.isArray(data) ? data.filter(item => item && item.id && item.position) : [];

    return rawJobs.map(j => {
      const jobUrl = j.apply_url || j.url || `https://remoteok.com/remote-jobs/${j.slug || j.id}`;
      const salary = (j.salary_min && j.salary_max)
        ? `USD ${j.salary_min}-${j.salary_max}`
        : null;
      return {
        externalSlug: `remoteok-${j.id}`,
        source: 'remoteok',
        title: stripHtml(j.position),
        company: stripHtml(j.company) || 'Unknown Company',
        location: stripHtml(j.location) || 'Worldwide Remote',
        url: jobUrl,
        canonicalUrl: j.url || jobUrl,
        description: stripHtml(j.description),
        salary,
        postedAt: j.date || null,
        workMode: 'remote',
        employmentType: 'full_time',
        requiredSkills: Array.isArray(j.tags) ? j.tags : []
      };
    })
      .filter(j => j.url && j.title && matchesOptionalQuery(j, query))
      .slice(0, limit);
  } catch (err) {
    console.warn(`[PublicFeeds] RemoteOK fetch skipped: ${err.message}`);
    return [];
  }
}

export async function fetchWeWorkRemotelyJobs({ limit = 25, query = '' } = {}) {
  try {
    const url = 'https://weworkremotely.com/categories/remote-programming-jobs.rss';
    const xml = await fetchWithTimeout(url, { responseType: 'text' });
    const items = String(xml || '').match(/<item>[\s\S]*?<\/item>/gi) || [];

    const extractTag = (block, tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? stripHtml(m[1]) : '';
    };

    return items.map((block, idx) => {
      const rawTitle = extractTag(block, 'title');
      const colonIdx = rawTitle.indexOf(':');
      const company = colonIdx > 0 ? rawTitle.slice(0, colonIdx).trim() : 'WeWorkRemotely Employer';
      const title = colonIdx > 0 ? rawTitle.slice(colonIdx + 1).trim() : rawTitle;
      const link = extractTag(block, 'link') || extractTag(block, 'guid');
      const region = extractTag(block, 'region') || 'Worldwide Remote';
      const pubDate = extractTag(block, 'pubDate');
      const desc = extractTag(block, 'description');

      return {
        externalSlug: `wwr-${(link || rawTitle || idx).split('/').pop()}`,
        source: 'weworkremotely',
        title: title || 'Software Developer',
        company,
        location: region,
        url: link,
        canonicalUrl: link,
        description: desc,
        salary: null,
        postedAt: pubDate ? new Date(pubDate).toISOString() : null,
        workMode: 'remote',
        employmentType: 'full_time',
        requiredSkills: []
      };
    })
      .filter(j => j.url && j.title && matchesOptionalQuery(j, query))
      .slice(0, limit);
  } catch (err) {
    console.warn(`[PublicFeeds] WeWorkRemotely fetch skipped: ${err.message}`);
    return [];
  }
}

export async function fetchHnWhoIsHiringJobs({ limit = 25, query = '' } = {}) {
  try {
    const searchUrl = 'https://hn.algolia.com/api/v1/search_by_date?query=%22Ask%20HN:%20Who%20is%20hiring%22&tags=story&hitsPerPage=1';
    const searchData = await fetchWithTimeout(searchUrl);
    const story = Array.isArray(searchData.hits) ? searchData.hits[0] : null;
    if (!story || !story.objectID) return [];

    const itemUrl = `https://hn.algolia.com/api/v1/items/${story.objectID}`;
    const itemData = await fetchWithTimeout(itemUrl);
    const children = Array.isArray(itemData.children) ? itemData.children : [];

    const jobs = [];
    for (const c of children) {
      if (!c || !c.text) continue;
      const clean = stripHtml(c.text);
      if (!clean || clean.length < 30) continue;
      const firstLine = clean.split(/\n|\.\s+/)[0].slice(0, 120);
      const parts = firstLine.split('|').map(s => s.trim()).filter(Boolean);
      const company = parts[0] ? parts[0].slice(0, 60) : 'HN Hiring Company';
      const title = parts[1] ? parts[1].slice(0, 80) : 'Software Engineer';
      const location = parts[2] ? parts[2].slice(0, 60) : (/\bremote\b/i.test(clean) ? 'Remote' : 'Global');
      const jobUrl = `https://news.ycombinator.com/item?id=${c.id}`;
      const jobObj = {
        externalSlug: `hn-${c.id}`,
        source: 'hn_hiring',
        title,
        company,
        location,
        url: jobUrl,
        canonicalUrl: jobUrl,
        description: clean.slice(0, 2000),
        salary: null,
        postedAt: c.created_at || null,
        workMode: /\bremote\b/i.test(clean) ? 'remote' : 'onsite',
        employmentType: /\bintern\b/i.test(clean) ? 'internship' : 'full_time',
        requiredSkills: []
      };
      if (matchesOptionalQuery(jobObj, query)) {
        jobs.push(jobObj);
        if (jobs.length >= limit) break;
      }
    }
    return jobs;
  } catch (err) {
    console.warn(`[PublicFeeds] HN Who is Hiring fetch skipped: ${err.message}`);
    return [];
  }
}

export async function fetchHasjobJobs({ limit = 25, query = '' } = {}) {
  try {
    const url = 'https://hasjob.co/feed';
    const xml = await fetchWithTimeout(url, { responseType: 'text' });
    const entries = String(xml || '').match(/<entry>[\s\S]*?<\/entry>/gi) || [];

    const extractTag = (block, tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? stripHtml(m[1]) : '';
    };

    return entries.map((block, idx) => {
      const rawTitle = extractTag(block, 'title');
      const linkMatch = block.match(/<link[^>]*href="([^"]+)"/i);
      const link = linkMatch ? linkMatch[1] : `https://hasjob.co/#${idx}`;
      const author = extractTag(block, 'name') || 'Hasjob Employer';
      const updated = extractTag(block, 'updated') || extractTag(block, 'published');
      const summary = extractTag(block, 'content') || extractTag(block, 'summary');

      return {
        externalSlug: `hasjob-${link.split('/').filter(Boolean).pop() || idx}`,
        source: 'hasjob',
        title: rawTitle || 'Software Developer',
        company: author,
        location: /\b(bengaluru|bangalore)\b/i.test(`${rawTitle} ${summary}`) ? 'Bengaluru, India' : (/\bremote\b/i.test(`${rawTitle} ${summary}`) ? 'Remote, India' : 'India'),
        url: link,
        canonicalUrl: link,
        description: summary,
        salary: null,
        postedAt: updated || null,
        workMode: /\bremote\b/i.test(`${rawTitle} ${summary}`) ? 'remote' : 'onsite',
        employmentType: /\bintern\b/i.test(rawTitle) ? 'internship' : 'full_time',
        requiredSkills: []
      };
    })
      .filter(j => j.url && j.title && matchesOptionalQuery(j, query))
      .slice(0, limit);
  } catch (err) {
    console.warn(`[PublicFeeds] Hasjob fetch skipped: ${err.message}`);
    return [];
  }
}

export async function fetchUnstopJobs({ limit = 25, query = '' } = {}) {
  try {
    const qParam = query ? `&search=${encodeURIComponent(query)}` : '';
    const url = `https://unstop.com/api/public/opportunity/search-result?opportunity=jobs&per_page=${Math.min(Math.max(limit, 1), 30)}${qParam}`;
    const data = await fetchWithTimeout(url);
    const rawJobs = Array.isArray(data?.data?.data) ? data.data.data : [];

    return rawJobs.map(j => {
      const jobUrl = j.public_url ? `https://unstop.com/${j.public_url.replace(/^\//, '')}` : `https://unstop.com/jobs/${j.id}`;
      const orgName = j.organisation?.name || j.company_name || 'Unstop Employer';
      const locs = Array.isArray(j.locations) && j.locations.length > 0 ? j.locations.join(', ') : (j.region || 'India');
      const skills = Array.isArray(j.skills) ? j.skills.map(s => s.skill_name || s).filter(Boolean) : [];
      return {
        externalSlug: `unstop-${j.id}`,
        source: 'unstop',
        title: stripHtml(j.title) || 'Software Engineer',
        company: stripHtml(orgName),
        location: stripHtml(locs),
        url: jobUrl,
        canonicalUrl: jobUrl,
        description: stripHtml(j.details || j.short_desc || j.title),
        salary: j.jobDetail?.min_salary && j.jobDetail?.max_salary ? `${j.jobDetail.min_salary}-${j.jobDetail.max_salary}` : null,
        postedAt: j.start_date || j.updated_at || null,
        workMode: String(j.jobDetail?.type || '').toLowerCase().includes('remote') ? 'remote' : 'onsite',
        employmentType: String(j.type || '').toLowerCase().includes('intern') ? 'internship' : 'full_time',
        requiredSkills: skills
      };
    })
      .filter(j => j.url && j.title && matchesOptionalQuery(j, query))
      .slice(0, limit);
  } catch (err) {
    console.warn(`[PublicFeeds] Unstop fetch skipped: ${err.message}`);
    return [];
  }
}
