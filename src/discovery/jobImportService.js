/**
 * CareerOS Phase 17 — Multi-Job URL, Search Result & Batch Import Service
 *
 * Fixes single-job import limitations:
 * - LinkedIn search-results URLs -> extracts multiple public guest listings via jobs-guest API
 * - Single LinkedIn job URLs -> enriches real title, company, location, description via jobs-guest API
 * - Anti-bot search pages (Naukri/Indeed/Foundit/Cutshort/Hirist) -> honestly flagged as unsupported
 *   extraction (never saved as a fake single job record)
 * - Batch URLs (multi-line/comma-separated), JSON arrays, and CSV import with preview mode
 * - Strict deduplication and honest counters (discovered, imported, duplicates, invalidLinks, unsupportedExtraction)
 */

import { getDatabase } from '../db/schema.js';
import { resolveSource } from './sourceRegistry.js';
import { normalizeCanonicalUrl, extractAtsJobId } from './urlNormalizer.js';
import { saveOrUpdateJob } from '../tracker/jobTracker.js';
import { evaluateJobFit } from '../matcher/scoringEngine.js';

const FETCH_TIMEOUT_MS = 8000;

function decodeHtmlEntities(str = '') {
  return String(str || '')
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

async function fetchHtmlWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

export function isLinkedInSearchUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.hostname.includes('linkedin.com') &&
      (u.pathname.includes('/jobs/search') || u.pathname.includes('/jobs/collections'));
  } catch {
    return false;
  }
}

export function extractLinkedInJobId(urlStr) {
  try {
    const u = new URL(urlStr);
    const viewMatch = u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/i);
    if (viewMatch) return viewMatch[1];
    const currentId = u.searchParams.get('currentJobId');
    if (currentId && /^\d+$/.test(currentId)) return currentId;
  } catch {}
  return null;
}

export function isRestrictedSearchResultsUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (host.includes('naukri.com') && (path.includes('-jobs') || path.includes('/mnjuser/') || u.searchParams.has('k'))) {
      return !path.includes('job-listings-');
    }
    if (host.includes('indeed.') && path === '/jobs') {
      return true;
    }
    if (host.includes('foundit.in') && path.includes('/srp/')) {
      return true;
    }
    if (host.includes('cutshort.io') && path.startsWith('/jobs/') && !path.includes('/job/')) {
      return true;
    }
    if (host.includes('hirist.tech') && path.includes('/search/')) {
      return true;
    }
  } catch {}
  return false;
}

export function parseLinkedInGuestSearchHtml(html = '') {
  const cards = [];
  const liBlocks = String(html || '').match(/<li[\s\S]*?<\/li>/gi) || [];

  for (const block of liBlocks) {
    const urlMatch = block.match(/href="(https:\/\/[^"]*linkedin\.com\/jobs\/view\/[^"?]+[^"]*)"/i);
    const titleMatch = block.match(/<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i);
    const companyMatch = block.match(/<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>/i);
    const locMatch = block.match(/<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const timeMatch = block.match(/<time[^>]*datetime="([^"]+)"/i);

    if (!urlMatch || !titleMatch) continue;
    const rawUrl = decodeHtmlEntities(urlMatch[1]).split('?')[0];
    const jobId = extractLinkedInJobId(rawUrl);
    cards.push({
      externalSlug: jobId ? `linkedin-${jobId}` : undefined,
      title: decodeHtmlEntities(titleMatch[1]),
      company: companyMatch ? decodeHtmlEntities(companyMatch[1]) : 'External Employer',
      location: locMatch ? decodeHtmlEntities(locMatch[1]) : 'India',
      url: rawUrl,
      canonicalUrl: normalizeCanonicalUrl(rawUrl),
      postedAt: timeMatch ? timeMatch[1] : null,
      source: 'linkedin',
      sourceConfidence: 0.9,
      description: `Imported from LinkedIn public job listing (${rawUrl}).`
    });
  }
  return cards;
}

export function parseLinkedInGuestJobHtml(html = '', fallbackUrl = '') {
  const titleMatch = html.match(/<h[12][^>]*class="[^"]*top-card-layout__title[^"]*"[^>]*>([\s\S]*?)<\/h[12]>/i) ||
    html.match(/<title>([^<|]+)/i);
  const companyMatch = html.match(/<a[^>]*class="[^"]*topcard__org-name-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
    html.match(/<span[^>]*class="[^"]*topcard__flavor[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  const locMatch = html.match(/<span[^>]*class="[^"]*topcard__flavor--bullet[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  const descMatch = html.match(/<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

  const title = titleMatch ? decodeHtmlEntities(titleMatch[1]) : '';
  if (!title) return null;

  const jobId = extractLinkedInJobId(fallbackUrl);
  return {
    externalSlug: jobId ? `linkedin-${jobId}` : undefined,
    title,
    company: companyMatch ? decodeHtmlEntities(companyMatch[1]) : 'External Employer',
    location: locMatch ? decodeHtmlEntities(locMatch[1]) : 'India',
    url: fallbackUrl,
    canonicalUrl: normalizeCanonicalUrl(fallbackUrl),
    source: 'linkedin',
    sourceConfidence: 0.92,
    description: descMatch ? decodeHtmlEntities(descMatch[1]) : `Imported from LinkedIn (${fallbackUrl}).`
  };
}

export function parseCsvJobs(csvText = '') {
  const lines = String(csvText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const parseRow = (line) => {
    const cols = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        cols.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    return cols;
  };

  const headers = parseRow(lines[0]).map(h => h.toLowerCase());
  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] || '';
    });
    if (obj.url || obj.title) {
      items.push(obj);
    }
  }
  return items;
}

function checkExistingJobInDb(job) {
  const db = getDatabase();
  const canon = normalizeCanonicalUrl(job.canonicalUrl || job.url);
  const atsId = extractAtsJobId(job.url || canon);

  if (canon) {
    const byUrl = db.prepare('SELECT id, status FROM jobs WHERE canonical_url = ? OR url = ?').get(canon, canon);
    if (byUrl) return byUrl;
  }
  if (atsId && job.company) {
    const bySlug = db.prepare('SELECT id, status FROM jobs WHERE external_slug = ? AND LOWER(company) = LOWER(?)').get(atsId, job.company);
    if (bySlug) return bySlug;
  }
  if (job.title && job.company && job.company !== 'External Employer') {
    const byTitle = db.prepare('SELECT id, status FROM jobs WHERE LOWER(title) = LOWER(?) AND LOWER(company) = LOWER(?)').get(job.title, job.company);
    if (byTitle) return byTitle;
  }
  return null;
}

async function resolveSingleUrl(rawUrl, defaults = {}, fetchRemote = true) {
  const url = String(rawUrl || '').trim();
  const sourceDef = resolveSource(defaults.source || url);

  // 1. LinkedIn Search Results URL -> extract multiple public guest listings
  if (isLinkedInSearchUrl(url)) {
    const u = new URL(url);
    const keywords = u.searchParams.get('keywords') || '';
    const location = u.searchParams.get('location') || '';
    const fE = u.searchParams.get('f_E') || '';
    const fTpr = u.searchParams.get('f_TPR') || '';
    const currentJobId = extractLinkedInJobId(url);

    if (!fetchRemote) {
      return {
        jobs: [],
        unsupported: [{
          url,
          source: 'linkedin',
          reason: 'LinkedIn search URL requires live guest fetch; disabled in offline mode.'
        }]
      };
    }

    const guestParams = new URLSearchParams();
    if (keywords) guestParams.set('keywords', keywords);
    if (location) guestParams.set('location', location);
    if (fE) guestParams.set('f_E', fE);
    if (fTpr) guestParams.set('f_TPR', fTpr);
    guestParams.set('start', '0');

    const extracted = [];
    try {
      const guestUrl = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${guestParams.toString()}`;
      const html = await fetchHtmlWithTimeout(guestUrl);
      extracted.push(...parseLinkedInGuestSearchHtml(html));
    } catch {
      // Fall through to currentJobId check or unsupported message
    }

    if (currentJobId && !extracted.some(j => j.url.includes(currentJobId))) {
      try {
        const jobHtml = await fetchHtmlWithTimeout(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${currentJobId}`);
        const single = parseLinkedInGuestJobHtml(jobHtml, `https://www.linkedin.com/jobs/view/${currentJobId}/`);
        if (single) extracted.unshift(single);
      } catch {}
    }

    if (extracted.length === 0) {
      return {
        jobs: [],
        unsupported: [{
          url,
          source: 'linkedin',
          reason: 'LinkedIn guest search returned no extractable listings (rate-limited or auth-gated). Paste individual /jobs/view/ URLs or JSON/CSV.'
        }]
      };
    }

    return { jobs: extracted, unsupported: [] };
  }

  // 2. Restricted portal search-results URLs (Naukri, Indeed, Foundit, Cutshort, Hirist)
  if (isRestrictedSearchResultsUrl(url)) {
    return {
      jobs: [],
      unsupported: [{
        url,
        source: sourceDef.id,
        reason: `${sourceDef.name} enforces anti-bot protection on search-results pages. Paste individual job URLs, or import JSON/CSV from your browser.`
      }]
    };
  }

  // 3. Single LinkedIn job URL -> enrich via guest endpoint if title/company not supplied
  const liJobId = extractLinkedInJobId(url);
  if (liJobId && fetchRemote && (!defaults.title || defaults.title === 'Imported Job Opportunity')) {
    try {
      const canonicalLiUrl = `https://www.linkedin.com/jobs/view/${liJobId}/`;
      const jobHtml = await fetchHtmlWithTimeout(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${liJobId}`);
      const parsed = parseLinkedInGuestJobHtml(jobHtml, canonicalLiUrl);
      if (parsed) {
        return { jobs: [parsed], unsupported: [] };
      }
    } catch {
      // Fallback to direct URL import below
    }
  }

  // 4. Standard single job URL
  return {
    jobs: [{
      title: (defaults.title || 'Imported Job Opportunity').trim(),
      company: (defaults.company || 'External Employer').trim(),
      location: (defaults.location || 'Bengaluru, India').trim(),
      url,
      canonicalUrl: normalizeCanonicalUrl(url),
      source: sourceDef.id,
      sourceConfidence: sourceDef.tier === 'direct_ats' ? 1.0 : 0.85,
      description: defaults.description || `Imported listing from ${sourceDef.name}: ${url}`,
      status: 'discovered'
    }],
    unsupported: []
  };
}

/**
 * Main unified import entry point supporting:
 * - Single URL or search URL
 * - Batch URLs (urlsText / urls[])
 * - JSON / CSV / structured items[]
 * - Preview mode (no DB writes)
 */
export async function importJobsFromInput(payload = {}) {
  const {
    url,
    urls,
    urlsText,
    jdText,
    items,
    jsonText,
    csvText,
    preview = false,
    fetchRemote = true,
    title,
    company,
    location,
    source,
    description
  } = payload || {};

  const candidateUrls = [];
  if (url) candidateUrls.push(String(url).trim());
  if (Array.isArray(urls)) candidateUrls.push(...urls.map(u => String(u).trim()));
  if (typeof urlsText === 'string' && urlsText.trim()) {
    const split = urlsText.split(/[\r\n,;\s]+/).map(s => s.trim()).filter(Boolean);
    candidateUrls.push(...split);
  }

  const structuredItems = [];
  if (Array.isArray(items)) structuredItems.push(...items);
  if (typeof jdText === 'string' && jdText.trim() && candidateUrls.length === 0) {
    const cleanJd = jdText.trim();
    const firstLine = cleanJd.split(/\r?\n/)[0].slice(0, 90).trim();
    structuredItems.push({
      title: title || firstLine || 'Pasted Job Opportunity',
      company: company || 'External Employer',
      location: location || 'Bengaluru, India',
      url: '',
      source: source || 'other',
      description: cleanJd
    });
  }
  if (typeof jsonText === 'string' && jsonText.trim()) {
    const parsedJson = JSON.parse(jsonText);
    if (Array.isArray(parsedJson)) structuredItems.push(...parsedJson);
    else if (parsedJson && typeof parsedJson === 'object') structuredItems.push(parsedJson);
  }
  if (typeof csvText === 'string' && csvText.trim()) {
    structuredItems.push(...parseCsvJobs(csvText));
  }

  const invalidLinks = [];
  const unsupportedExtraction = [];
  const resolvedJobs = [];
  const sourceBreakdown = {};

  const bumpSource = (srcId) => {
    const key = srcId || 'other';
    sourceBreakdown[key] = (sourceBreakdown[key] || 0) + 1;
  };

  // Deduplicate input URLs before resolving
  const uniqueUrls = Array.from(new Set(candidateUrls));
  for (const rawUrl of uniqueUrls) {
    if (!/^https?:\/\/.+/i.test(rawUrl)) {
      invalidLinks.push({ url: rawUrl, reason: 'Invalid HTTP/HTTPS URL' });
      continue;
    }
    const res = await resolveSingleUrl(rawUrl, { title, company, location, source, description }, fetchRemote);
    for (const u of res.unsupported) {
      unsupportedExtraction.push(u);
    }
    for (const j of res.jobs) {
      resolvedJobs.push(j);
    }
  }

  for (const item of structuredItems) {
    const itemUrl = String(item.url || '').trim();
    if (itemUrl && !/^https?:\/\/.+/i.test(itemUrl)) {
      invalidLinks.push({ url: itemUrl, reason: 'Invalid HTTP/HTTPS URL in structured item' });
      continue;
    }
    const sourceDef = resolveSource(item.source || itemUrl || 'other');
    resolvedJobs.push({
      title: String(item.title || 'Imported Job Opportunity').trim(),
      company: String(item.company || 'External Employer').trim(),
      location: String(item.location || 'Bengaluru, India').trim(),
      url: itemUrl,
      canonicalUrl: itemUrl ? normalizeCanonicalUrl(itemUrl) : '',
      source: sourceDef.id,
      sourceConfidence: sourceDef.tier === 'direct_ats' ? 1.0 : 0.85,
      description: item.description || (itemUrl ? `Imported listing from ${sourceDef.name}: ${itemUrl}` : ''),
      postedAt: item.postedAt || null,
      workMode: item.workMode || null,
      status: 'discovered'
    });
  }

  let imported = 0;
  let duplicates = 0;
  const resultItems = [];

  for (const job of resolvedJobs) {
    bumpSource(job.source);
    const hasDescription = Boolean(job.description && job.description.length >= 40 && !job.description.startsWith('Imported listing from'));
    const dataQuality = hasDescription && job.company !== 'External Employer' ? 'complete' : (job.url ? 'partial_metadata' : 'text_only');
    const applyUrl = job.applyUrl || job.url || '';

    if (preview) {
      const existing = checkExistingJobInDb(job);
      const fit = evaluateJobFit(job);
      if (existing) {
        duplicates++;
        resultItems.push({
          ...job,
          applyUrl,
          hasDescription,
          dataQuality,
          matchScore: fit.score,
          duplicateStatus: 'duplicate',
          action: 'duplicate',
          existingJobId: existing.id
        });
      } else {
        imported++;
        resultItems.push({
          ...job,
          applyUrl,
          hasDescription,
          dataQuality,
          matchScore: fit.score,
          duplicateStatus: 'new',
          action: 'preview_ready'
        });
      }
    } else {
      const saveRes = saveOrUpdateJob(job);
      if (saveRes.isNew) {
        imported++;
        resultItems.push({
          ...job,
          applyUrl,
          hasDescription,
          dataQuality,
          matchScore: saveRes.evaluation?.score ?? null,
          duplicateStatus: 'new',
          jobId: saveRes.jobId,
          action: 'imported',
          evaluation: saveRes.evaluation
        });
      } else {
        duplicates++;
        resultItems.push({
          ...job,
          applyUrl,
          hasDescription,
          dataQuality,
          matchScore: saveRes.evaluation?.score ?? null,
          duplicateStatus: 'duplicate',
          jobId: saveRes.jobId,
          action: 'duplicate',
          evaluation: saveRes.evaluation
        });
      }
    }
  }

  return {
    success: true,
    preview: Boolean(preview),
    discovered: resolvedJobs.length,
    imported,
    duplicates,
    invalidLinks,
    unsupportedExtraction,
    sourceBreakdown,
    items: resultItems
  };
}
