/**
 * CareerOS — Canonical URL Normalizer & Job Deduplication Engine
 * Cleans tracking parameters, normalizes hostnames, and generates deduplication keys.
 */

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'ref',
  'source',
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'gh_src',
  'trk',
  'trkinfo',
  '_gl',
  '_ga',
  'mc_cid',
  'mc_eid',
  'spjobid',
  'spuserid',
  'sessionid',
  'session_id',
  'trackingid',
  'tracking_id',
  'token',
  'sub_id'
]);

/**
 * Normalizes an arbitrary job URL into a canonical format.
 * Strips tracking parameters, normalizes casing and trailing slashes.
 */
export function normalizeCanonicalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);

    // Only allow http and https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }

    // Lowercase protocol and hostname
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();

    // Remove default ports
    if ((parsed.protocol === 'http:' && parsed.port === '80') ||
        (parsed.protocol === 'https:' && parsed.port === '443')) {
      parsed.port = '';
    }

    // Strip tracking query parameters
    const cleanParams = new URLSearchParams();
    for (const [key, value] of parsed.searchParams.entries()) {
      if (!TRACKING_PARAMS.has(key.toLowerCase())) {
        cleanParams.append(key, value);
      }
    }
    cleanParams.sort();

    parsed.search = cleanParams.toString() ? `?${cleanParams.toString()}` : '';

    // Remove hash/fragment
    parsed.hash = '';

    // Normalize trailing slash in pathname (preserve root '/')
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    return parsed.toString();
  } catch {
    // If URL parsing fails, return sanitized trimmed string without trailing slash
    return trimmed.replace(/\/+$/, '');
  }
}

/**
 * Normalizes company names for deduplication comparisons.
 * Removes corporate legal structures and symbols.
 */
export function normalizeCompanyName(company) {
  if (!company || typeof company !== 'string') return '';
  return company
    .toLowerCase()
    .replace(/\b(private\s+limited|pvt\.?\s*ltd\.?|limited|ltd\.?|inc\.?|llc|technologies|solutions|services|corp|corporation)\b/gi, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes job title for deduplication comparisons.
 */
export function normalizeJobTitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BENGALURU_KEYWORDS = [
  'bengaluru', 'bangalore', 'karnataka', 'whitefield', 'bellandur',
  'electronic city', 'koramangala', 'indiranagar', 'hsr layout', 'hebbal',
  'manyata', 'marathahalli', 'sarjapur', 'kadubeesanahalli', 'domlur'
];

/**
 * Normalizes location, standardizing Bengaluru/Bangalore and other Indian tech hubs.
 */
export function normalizeLocation(loc) {
  if (!loc || typeof loc !== 'string') return 'India';
  const lower = loc.toLowerCase();

  // Check for Bengaluru / Bangalore tech corridors
  const isBengaluru = BENGALURU_KEYWORDS.some(kw => lower.includes(kw));
  if (isBengaluru) {
    if (lower.includes('remote') || lower.includes('hybrid')) {
      return lower.includes('hybrid') ? 'Bengaluru, Karnataka, India (Hybrid)' : 'Bengaluru, Karnataka, India (Remote)';
    }
    return 'Bengaluru, Karnataka, India';
  }

  if (lower.includes('remote') || lower.includes('work from anywhere') || lower.includes('wfh')) {
    if (lower.includes('india')) return 'Remote (India)';
    return 'Remote';
  }

  if (lower.includes('hyderabad') || lower.includes('telangana') || lower.includes('hitec city') || lower.includes('gachibowli')) {
    return 'Hyderabad, Telangana, India';
  }
  if (lower.includes('pune') || lower.includes('hinjewadi') || lower.includes('magarpatta')) {
    return 'Pune, Maharashtra, India';
  }
  if (lower.includes('chennai') || lower.includes('tamil nadu') || lower.includes('omr')) {
    return 'Chennai, Tamil Nadu, India';
  }
  if (lower.includes('mumbai') || lower.includes('navi mumbai') || lower.includes('thane')) {
    return 'Mumbai, Maharashtra, India';
  }
  if (lower.includes('noida') || lower.includes('gurgaon') || lower.includes('gurugram') || lower.includes('delhi') || lower.includes('ncr')) {
    return 'Delhi NCR, India';
  }
  if (lower.includes('kolkata') || lower.includes('west bengal')) {
    return 'Kolkata, West Bengal, India';
  }
  if (lower.includes('ahmedabad') || lower.includes('gujarat')) {
    return 'Ahmedabad, Gujarat, India';
  }

  return loc.trim();
}

/**
 * Returns true if location is in Bengaluru or Karnataka.
 */
export function isBengaluruLocation(loc) {
  if (!loc || typeof loc !== 'string') return false;
  const lower = loc.toLowerCase();
  return BENGALURU_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Returns true if location is anywhere in India or Remote.
 */
export function isIndiaOrRemote(loc) {
  if (!loc || typeof loc !== 'string') return true;
  const lower = loc.toLowerCase();
  if (lower.includes('remote') || lower.includes('anywhere')) return true;
  if (lower.includes('india') || lower.includes('karnataka') || lower.includes('telangana') || lower.includes('maharashtra') || lower.includes('tamil nadu')) return true;
  return BENGALURU_KEYWORDS.some(kw => lower.includes(kw)) ||
    /\b(hyderabad|pune|chennai|delhi|noida|gurgaon|gurugram|mumbai|kolkata|ahmedabad|kochi|thiruvananthapuram)\b/i.test(lower);
}

/**
 * Generates a fuzzy deduplication signature across company, title, and location.
 */
export function generateJobDedupSignature(job) {
  const normCompany = normalizeCompanyName(job.company);
  const normTitle = normalizeJobTitle(job.title);
  const normLoc = normalizeLocation(job.location);
  const primaryCity = normLoc.split(',')[0].trim().toLowerCase();

  return `${normCompany}::${normTitle}::${primaryCity}`;
}
