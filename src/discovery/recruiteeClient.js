/**
 * CareerOS Phase 11 — Recruitee Public Job Board Client
 * 
 * Connects to Recruitee's open, official public candidate API:
 * https://{companyToken}.recruitee.com/api/offers/
 * 
 * Features:
 * - Public, unauthenticated JSON endpoint
 * - In-memory TTL caching (5 minutes)
 * - Rate limiting and concurrency controls
 * - Full job details (responsibilities, requirements, department, remote/hybrid status)
 * - Candidate profile skill extraction and experience bounds parsing
 */

import { normalizeCanonicalUrl, normalizeLocation } from './urlNormalizer.js';
import { extractBasicSkills } from './directAtsClient.js';

const recruiteeCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 150;

async function throttle() {
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(res => setTimeout(res, MIN_REQUEST_INTERVAL_MS - timeSinceLast));
  }
  lastRequestTime = Date.now();
}

/**
 * Fetches and normalizes all open job postings for a Recruitee company account.
 * 
 * @param {string} companyToken - Company identifier on Recruitee (e.g. 'bunq', 'transifex')
 * @param {object} options - Filtering, pagination, caching flags
 * @returns {Promise<Array>} Normalized job listings
 */
export async function fetchRecruiteeJobs(companyToken, {
  query = null,
  limit = 50,
  page = 1,
  timeoutMs = 10000,
  userAgent = 'CareerOS/2.0 (+https://github.com/abhishekn27077/jobAi)',
  bypassCache = false
} = {}) {
  if (!companyToken || typeof companyToken !== 'string') {
    throw new Error('Valid companyToken is required for Recruitee API');
  }

  const cleanToken = companyToken.trim().toLowerCase();
  const cacheKey = `recruitee:${cleanToken}:${query || 'all'}:${limit}:${page}`;

  if (!bypassCache && recruiteeCache.has(cacheKey)) {
    const cached = recruiteeCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
    recruiteeCache.delete(cacheKey);
  }

  await throttle();

  const url = `https://${encodeURIComponent(cleanToken)}.recruitee.com/api/offers/`;

  let resp;
  try {
    resp = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (netErr) {
    throw new Error(`Recruitee network failure for ${cleanToken}: ${netErr.message}`);
  }

  if (!resp.ok) {
    throw new Error(`Recruitee API error for ${cleanToken}: HTTP ${resp.status} ${resp.statusText}`);
  }

  let data;
  try {
    data = await resp.json();
  } catch (jsonErr) {
    throw new Error(`Recruitee malformed JSON response for ${cleanToken}: ${jsonErr.message}`);
  }

  const offers = data.offers || [];
  if (!Array.isArray(offers)) {
    return [];
  }

  // Filter by query if supplied
  let filtered = offers;
  if (query && typeof query === 'string') {
    const qLower = query.toLowerCase().trim();
    filtered = offers.filter(item => {
      const matchText = `${item.title || ''} ${item.department || ''} ${item.description || ''} ${item.city || ''} ${item.country || ''}`.toLowerCase();
      return matchText.includes(qLower);
    });
  }

  // Pagination
  const startIndex = (page - 1) * limit;
  const pagedOffers = filtered.slice(startIndex, startIndex + limit);

  const normalized = [];

  for (const item of pagedOffers) {
    const title = (item.title || '').trim();
    if (!title) continue;

    const companyName = item.company_name || cleanToken.charAt(0).toUpperCase() + cleanToken.slice(1);
    const city = item.city || item.location || 'Bengaluru';
    const country = item.country || 'India';
    const rawLoc = `${city}, ${country}`;
    const location = normalizeLocation(rawLoc);

    // Determine work mode
    let workMode = 'onsite';
    if (item.remote === true || rawLoc.toLowerCase().includes('remote')) {
      workMode = 'remote';
    } else if (item.hybrid === true || rawLoc.toLowerCase().includes('hybrid')) {
      workMode = 'hybrid';
    }

    // Determine employment type
    let employmentType = 'full_time';
    const empCode = (item.employment_type_code || '').toLowerCase();
    if (empCode.includes('intern') || title.toLowerCase().includes('intern')) {
      employmentType = 'internship';
    } else if (empCode.includes('contract') || empCode.includes('freelance')) {
      employmentType = 'contract';
    } else if (empCode.includes('part')) {
      employmentType = 'part_time';
    }

    const applyUrl = item.careers_apply_url || item.careers_url || `https://${cleanToken}.recruitee.com/o/${item.slug || item.id}`;
    const canonicalUrl = normalizeCanonicalUrl(applyUrl);

    // Combine HTML description and requirements into plain text
    const fullHtml = `${item.description || ''} ${item.requirements || ''}`;
    const plainDesc = fullHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || `${title} at ${companyName}. Department: ${item.department || 'Engineering'}`;

    // Experience detection
    let expMin = null;
    let expMax = null;
    const expMatch = plainDesc.match(/(\d+)\s*(?:-|to)\s*(\d+)\s*years?/i);
    if (expMatch) {
      expMin = parseInt(expMatch[1], 10);
      expMax = parseInt(expMatch[2], 10);
    }
    if (/fresher|intern|trainee|entry level|graduate/i.test(title) || (item.experience_code && item.experience_code.includes('entry'))) {
      expMin = 0;
      if (expMax === null || expMax > 2) expMax = 1;
    }

    normalized.push({
      externalSlug: `recruitee-${item.id || item.slug}`,
      source: 'recruitee',
      sourceConfidence: 1.0,
      title,
      company: companyName,
      location,
      url: applyUrl,
      canonicalUrl,
      description: plainDesc,
      salary: item.salary || null,
      postedAt: item.published_at || item.created_at || null,
      experienceMin: expMin,
      experienceMax: expMax,
      workMode,
      employmentType,
      skills: extractBasicSkills(`${title} ${item.department || ''} ${plainDesc}`, { title, department: item.department || '' })
    });
  }

  // Cache result
  recruiteeCache.set(cacheKey, { timestamp: Date.now(), data: normalized });

  return normalized;
}

/**
 * Clears the Recruitee in-memory cache.
 */
export function clearRecruiteeCache() {
  recruiteeCache.clear();
}
