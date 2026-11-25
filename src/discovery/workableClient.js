/**
 * CareerOS Phase 11 — Workable Public Job Board Client
 * 
 * Connects to Workable's verified public discovery endpoints:
 * 1. Widget Postings: https://apply.workable.com/api/v1/widget/accounts/{companyToken}
 * 2. Full Job Details: https://apply.workable.com/api/v2/accounts/{companyToken}/jobs/{shortcode}
 * 
 * Features:
 * - Rate limiting (max concurrent requests, inter-request throttle)
 * - In-memory TTL caching (avoids redundant network hits)
 * - Deep detail enrichment (requirements, responsibilities, benefits)
 * - Safe error handling (graceful fallback on detail failures or timeouts)
 * - Strict location & canonical URL normalization
 */

import { normalizeCanonicalUrl, normalizeLocation } from './urlNormalizer.js';
import { extractBasicSkills } from './directAtsClient.js';

// In-memory cache: key -> { timestamp, data }
const workableCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Rate limit state
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 150; // Throttle to prevent 429

async function throttle() {
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(res => setTimeout(res, MIN_REQUEST_INTERVAL_MS - timeSinceLast));
  }
  lastRequestTime = Date.now();
}

/**
 * Fetches and normalizes all open job postings for a Workable company account.
 * 
 * @param {string} companyToken - Company identifier on Workable (e.g. 'mercari-india', 'velsera')
 * @param {object} options - Query filters, pagination, enrichment flags
 * @returns {Promise<Array>} Normalized job listings
 */
export async function fetchWorkableJobs(companyToken, {
  query = null,
  limit = 50,
  page = 1,
  enrichDetails = false,
  timeoutMs = 10000,
  userAgent = 'CareerOS/2.0 (+https://github.com/abhishekn27077/jobAi)',
  bypassCache = false
} = {}) {
  if (!companyToken || typeof companyToken !== 'string') {
    throw new Error('Valid companyToken is required for Workable API');
  }

  const cleanToken = companyToken.trim().toLowerCase();
  const cacheKey = `workable:${cleanToken}:${query || 'all'}:${enrichDetails}:${limit}:${page}`;

  if (!bypassCache && workableCache.has(cacheKey)) {
    const cached = workableCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
    workableCache.delete(cacheKey);
  }

  await throttle();

  const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(cleanToken)}`;

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
    throw new Error(`Workable network failure for ${cleanToken}: ${netErr.message}`);
  }

  if (!resp.ok) {
    throw new Error(`Workable API error for ${cleanToken}: HTTP ${resp.status} ${resp.statusText}`);
  }

  let data;
  try {
    data = await resp.json();
  } catch (jsonErr) {
    throw new Error(`Workable malformed JSON response for ${cleanToken}: ${jsonErr.message}`);
  }

  const postings = data.jobs || [];
  const companyName = data.name || cleanToken.charAt(0).toUpperCase() + cleanToken.slice(1);

  if (!Array.isArray(postings)) {
    return [];
  }

  // Filter by query if provided
  let filtered = postings;
  if (query && typeof query === 'string') {
    const qLower = query.toLowerCase().trim();
    filtered = postings.filter(item => {
      const matchText = `${item.title || ''} ${item.department || ''} ${item.description || ''} ${item.city || ''}`.toLowerCase();
      return matchText.includes(qLower);
    });
  }

  // Support pagination
  const startIndex = (page - 1) * limit;
  const pagedItems = filtered.slice(startIndex, startIndex + limit);

  const normalized = [];

  for (const item of pagedItems) {
    const title = (item.title || '').trim();
    if (!title) continue;

    const shortcode = item.shortcode || item.id || Math.random().toString(36).substring(2, 9);

    // Optional detail enrichment from api/v2
    let enrichedDesc = item.description || '';
    let enrichedReqs = '';
    let enrichedBenefits = '';

    if (enrichDetails && shortcode) {
      try {
        await throttle();
        const detailUrl = `https://apply.workable.com/api/v2/accounts/${encodeURIComponent(cleanToken)}/jobs/${encodeURIComponent(shortcode)}`;
        const dResp = await fetch(detailUrl, {
          headers: { 'User-Agent': userAgent, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(Math.min(timeoutMs, 5000))
        });
        if (dResp.ok) {
          const detailData = await dResp.json();
          if (detailData.description) enrichedDesc = detailData.description;
          if (detailData.requirements) enrichedReqs = detailData.requirements;
          if (detailData.benefits) enrichedBenefits = detailData.benefits;
        }
      } catch {
        // Fallback to widget-level data on detail failure
      }
    }

    // Determine location
    const city = item.city || (item.locations?.[0]?.city) || 'India';
    const state = item.state || (item.locations?.[0]?.region) || '';
    const country = item.country || (item.locations?.[0]?.country) || 'India';
    const rawLoc = state ? `${city}, ${state}, ${country}` : `${city}, ${country}`;
    const location = normalizeLocation(rawLoc);

    // Determine work mode
    let workMode = 'onsite';
    const wpType = (item.workplace_type || (item.telecommuting ? 'remote' : '')).toLowerCase();
    const locLower = rawLoc.toLowerCase();

    if (wpType.includes('remote') || locLower.includes('remote') || item.telecommuting) {
      workMode = 'remote';
    } else if (wpType.includes('hybrid') || locLower.includes('hybrid')) {
      workMode = 'hybrid';
    }

    // Determine employment type
    let employmentType = 'full_time';
    const empTypeStr = (item.employment_type || '').toLowerCase();
    if (empTypeStr.includes('intern')) {
      employmentType = 'internship';
    } else if (empTypeStr.includes('contract')) {
      employmentType = 'contract';
    } else if (empTypeStr.includes('part')) {
      employmentType = 'part_time';
    }

    // Direct apply and listing URLs
    const applyUrl = item.application_url || item.shortlink || item.url || `https://apply.workable.com/${cleanToken}/j/${shortcode}/`;
    const canonicalUrl = normalizeCanonicalUrl(applyUrl);

    // Combine HTML description with plain formatting
    const rawCombinedText = `${title} at ${companyName}. Department: ${item.department || 'Engineering'}. Location: ${city}. ${enrichedDesc} ${enrichedReqs}`;
    const plainDesc = rawCombinedText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    // Experience detection
    let expMin = null;
    let expMax = null;
    const expMatch = plainDesc.match(/(\d+)\s*(?:-|to)\s*(\d+)\s*years?/i);
    if (expMatch) {
      expMin = parseInt(expMatch[1], 10);
      expMax = parseInt(expMatch[2], 10);
    }
    if (/fresher|intern|trainee|entry level|graduate/i.test(title)) {
      expMin = 0;
      if (expMax === null || expMax > 2) expMax = 1;
    }

    normalized.push({
      externalSlug: `workable-${shortcode}`,
      source: 'workable',
      sourceConfidence: 1.0,
      title,
      company: companyName,
      location,
      url: applyUrl,
      canonicalUrl,
      description: plainDesc,
      salary: item.salary || null,
      postedAt: item.published_on || item.created_at || null,
      experienceMin: expMin,
      experienceMax: expMax,
      workMode,
      employmentType,
      skills: extractBasicSkills(`${title} ${item.department || ''} ${plainDesc}`, { title, department: item.department || '' })
    });
  }

  // Cache results
  workableCache.set(cacheKey, { timestamp: Date.now(), data: normalized });

  return normalized;
}

/**
 * Clears the Workable in-memory cache.
 */
export function clearWorkableCache() {
  workableCache.clear();
}
