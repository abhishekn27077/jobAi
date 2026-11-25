/**
 * CareerOS Phase 11 — Centralized Job Source Registry
 * 
 * Authoritative registry defining supported job sources, their integration tiers,
 * capabilities, legal/technical boundaries, dynamic scan telemetry, and lawful external search generators.
 */

export const SOURCE_TIERS = {
  LIVE_FEED: 'live_feed',                     // Direct public JSON feeds / APIs (Ashby, Lever, SmartRecruiters, Greenhouse, Workable, Recruitee)
  LIVE_AGGREGATOR: 'live_aggregator',         // Programmatic job aggregators with open/partner endpoints (FreeHire)
  DIRECT_ATS: 'direct_ats',                   // Employer career pages / verified direct ATS URLs
  RESTRICTED_EXTERNAL: 'restricted_external', // Anti-bot protected / login-gated portals (Naukri, Indeed, LinkedIn, Apna, WorkIndia)
  META: 'meta'                                // Aggregated meta-source (All Sources)
};

export const SOURCE_STATUS = {
  ACTIVE: 'active',           // Live ingestion working & verified
  RESTRICTED: 'restricted',   // Anti-bot/login boundary respected; lawful external deep-links provided
  AVAILABLE: 'available',     // Configured and supported
  MANUAL: 'manual'            // User-assisted manual ingestion
};

export const INTEGRATION_LEVELS = {
  FULLY_INTEGRATED: 'fully_integrated',
  PARTIALLY_INTEGRATED: 'partially_integrated',
  EXTERNAL_ONLY: 'external_only'
};

// In-memory dynamic telemetry store (sourceId -> telemetry object)
const sourceTelemetryStore = new Map();

/**
 * Initializes telemetry for a source.
 */
function initTelemetry(sourceId) {
  if (!sourceTelemetryStore.has(sourceId)) {
    sourceTelemetryStore.set(sourceId, {
      lastSuccessfulScan: null,
      lastFailedScan: null,
      errorState: null,
      totalJobsDiscovered: 0,
      lastScanJobsCount: 0,
      consecutiveErrors: 0
    });
  }
  return sourceTelemetryStore.get(sourceId);
}

export const SOURCES = [
  {
    id: 'all',
    name: 'All Sources',
    slug: 'all',
    tier: SOURCE_TIERS.META,
    integrationType: SOURCE_TIERS.META,
    integrationLevel: INTEGRATION_LEVELS.FULLY_INTEGRATED,
    status: SOURCE_STATUS.ACTIVE,
    statusLabel: 'Unified Feed',
    badgeColor: '#3b82f6',
    icon: '🌐',
    description: 'Aggregated, cross-source deduplicated feed combining all active corporate feeds and imported listings.',
    supportsDirectIngestion: true,
    requiresAuth: false,
    supportedSearchCapabilities: ['title', 'keywords', 'skills', 'location', 'company', 'fresher', 'workMode', 'salary'],
    supportedPagination: true,
    rateLimitInfo: 'Local database cache (unrestricted)',
    sourceUrl: 'http://127.0.0.1:3000/#jobs',
    externalSearchCapability: false,
    legalPolicy: 'Local-first, deduplicated cross-source view.'
  },
  {
    id: 'career_pages',
    name: 'Company Career Pages',
    slug: 'career_pages',
    dbAliases: ['direct', 'career_pages', 'career_page', 'company_careers', 'recruitee'],
    tier: SOURCE_TIERS.DIRECT_ATS,
    integrationType: SOURCE_TIERS.DIRECT_ATS,
    integrationLevel: INTEGRATION_LEVELS.FULLY_INTEGRATED,
    status: SOURCE_STATUS.ACTIVE,
    statusLabel: 'Direct ATS',
    badgeColor: '#10b981',
    icon: '🏢',
    description: 'Direct employer careers sites and verified corporate job pages including direct ATS platforms (Recruitee, etc.) with highest source confidence.',
    supportsDirectIngestion: true,
    requiresAuth: false,
    supportedSearchCapabilities: ['title', 'keywords', 'skills', 'location', 'company', 'fresher', 'workMode'],
    supportedPagination: true,
    rateLimitInfo: 'Direct verified employer links & public ATS candidate feeds',
    sourceUrl: 'http://127.0.0.1:3000/#jobs',
    externalSearchCapability: false,
    legalPolicy: 'Direct publicly posted corporate career postings and authorized employer candidate feeds.'
  },
  {
    id: 'greenhouse',
    name: 'Greenhouse',
    slug: 'greenhouse',
    dbAliases: ['greenhouse'],
    tier: SOURCE_TIERS.LIVE_FEED,
    integrationType: SOURCE_TIERS.LIVE_FEED,
    integrationLevel: INTEGRATION_LEVELS.FULLY_INTEGRATED,
    status: SOURCE_STATUS.ACTIVE,
    statusLabel: 'Live Board API',
    badgeColor: '#059669',
    icon: '🌿',
    description: 'Public Greenhouse Job Board API (boards-api.greenhouse.io) with structured JD content and verified application forms.',
    supportsDirectIngestion: true,
    requiresAuth: false,
    supportedSearchCapabilities: ['title', 'keywords', 'location', 'skills', 'fresher'],
    supportedPagination: false,
    endpointPattern: 'https://boards-api.greenhouse.io/v1/boards/{token}/jobs',
    rateLimitInfo: 'Public boards API, unauthenticated (nominal 100 req/min)',
    sourceUrl: 'https://boards-api.greenhouse.io',
    externalSearchCapability: false,
    legalPolicy: 'Official public board API provided by Greenhouse for public job listings.'
  },
  {
    id: 'lever',
    name: 'Lever',
    slug: 'lever',
    dbAliases: ['lever'],
    tier: SOURCE_TIERS.LIVE_FEED,
    integrationType: SOURCE_TIERS.LIVE_FEED,
    integrationLevel: INTEGRATION_LEVELS.FULLY_INTEGRATED,
    status: SOURCE_STATUS.ACTIVE,
    statusLabel: 'Live Postings API',
    badgeColor: '#2563eb',
    icon: '⚡',
    description: 'Public Lever Postings API (api.lever.co/v0/postings) with complete requirement text, location, and workplace types.',
    supportsDirectIngestion: true,
    requiresAuth: false,
    supportedSearchCapabilities: ['title', 'keywords', 'location', 'skills', 'fresher', 'workMode'],
    supportedPagination: true,
    endpointPattern: 'https://api.lever.co/v0/postings/{token}',
    rateLimitInfo: 'Public postings endpoint (nominal 10 req/sec)',
    sourceUrl: 'https://jobs.lever.co',
    externalSearchCapability: false,
    legalPolicy: 'Official public postings endpoint provided by Lever.'
  },
  {
    id: 'ashby',
    name: 'Ashby',
    slug: 'ashby',
    dbAliases: ['ashby', 'ashbyhq'],
    tier: SOURCE_TIERS.LIVE_FEED,
    integrationType: SOURCE_TIERS.LIVE_FEED,
    integrationLevel: INTEGRATION_LEVELS.FULLY_INTEGRATED,
    status: SOURCE_STATUS.ACTIVE,
    statusLabel: 'Live Ashby API',
    badgeColor: '#7c3aed',
    icon: '🚀',
    description: 'Public Ashby Job Board API (api.ashbyhq.com/posting-api/job-board) with structured remote/hybrid workplace types.',
    supportsDirectIngestion: true,
    requiresAuth: false,
    supportedSearchCapabilities: ['title', 'keywords', 'location', 'skills', 'fresher', 'workMode'],
    supportedPagination: false,
    endpointPattern: 'https://api.ashbyhq.com/posting-api/job-board/{token}',
    rateLimitInfo: 'Public posting API (nominal 60 req/min)',
    sourceUrl: 'https://jobs.ashbyhq.com',
    externalSearchCapability: false,
    legalPolicy: 'Official public board API provided by AshbyHQ.'
  },
  {
    id: 'smartrecruiters',
    name: 'SmartRecruiters',
    slug: 'smartrecruiters',
    dbAliases: ['smartrecruiters'],
    tier: SOURCE_TIERS.LIVE_FEED,
    integrationType: SOURCE_TIERS.LIVE_FEED,
    integrationLevel: INTEGRATION_LEVELS.FULLY_INTEGRATED,
    status: SOURCE_STATUS.ACTIVE,
    statusLabel: 'Live API',
    badgeColor: '#ea580c',
    icon: '🎯',
    description: 'Public SmartRecruiters Postings API (api.smartrecruiters.com/v1/companies/{token}/postings) for high-growth tech companies.',
    supportsDirectIngestion: true,
    requiresAuth: false,
    supportedSearchCapabilities: ['title', 'keywords', 'location', 'skills', 'experience', 'fresher'],
    supportedPagination: true,
    endpointPattern: 'https://api.smartrecruiters.com/v1/companies/{token}/postings',
    rateLimitInfo: 'Public candidate API (nominal 10 req/sec)',
    sourceUrl: 'https://jobs.smartrecruiters.com',
    externalSearchCapability: false,
    legalPolicy: 'Publicly exposed candidate API endpoints.'
  },
  {
    id: 'freehire',
    name: 'FreeHire',
    slug: 'freehire',
    dbAliases: ['freehire', 'instahyre'],
    tier: SOURCE_TIERS.LIVE_AGGREGATOR,
    integrationType: SOURCE_TIERS.LIVE_AGGREGATOR,
    integrationLevel: INTEGRATION_LEVELS.FULLY_INTEGRATED,
    status: SOURCE_STATUS.ACTIVE,
    statusLabel: 'Live Aggregator',
    badgeColor: '#0891b2',
    icon: '🔍',
    description: 'Programmatic aggregator querying active Indian tech job feeds with salary, skills, and freshness metadata.',
    supportsDirectIngestion: true,
    requiresAuth: false,
    supportedSearchCapabilities: ['title', 'keywords', 'location', 'skills', 'salary', 'fresher'],
    supportedPagination: true,
    rateLimitInfo: 'Public aggregator client (nominal 30 req/min)',
    sourceUrl: 'https://freehire.org',
    externalSearchCapability: false,
    legalPolicy: 'Public aggregator endpoints for discoverability.'
  },
  {
    id: 'workable',
    name: 'Workable',
    slug: 'workable',
    dbAliases: ['workable'],
    tier: SOURCE_TIERS.LIVE_FEED,
    integrationType: SOURCE_TIERS.LIVE_FEED,
    integrationLevel: INTEGRATION_LEVELS.FULLY_INTEGRATED,
    status: SOURCE_STATUS.ACTIVE,
    statusLabel: 'Public Board API',
    badgeColor: '#0d9488',
    icon: '💼',
    description: 'Public Workable API (apply.workable.com/api/v1/widget/accounts/{token} & api/v2 details) with structured requirements and department data.',
    supportsDirectIngestion: true,
    requiresAuth: false,
    supportedSearchCapabilities: ['title', 'keywords', 'location', 'skills', 'fresher', 'workMode'],
    supportedPagination: true,
    endpointPattern: 'https://apply.workable.com/api/v1/widget/accounts/{token}',
    rateLimitInfo: 'Public widget & details endpoint (150ms inter-request throttle)',
    sourceUrl: 'https://apply.workable.com',
    externalSearchCapability: false,
    legalPolicy: 'Official public careers widget provided by Workable.'
  },
  {
    id: 'naukri',
    name: 'Naukri',
    slug: 'naukri',
    dbAliases: ['naukri', 'naukri.com', 'infoedge'],
    tier: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationType: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationLevel: INTEGRATION_LEVELS.EXTERNAL_ONLY,
    status: SOURCE_STATUS.RESTRICTED,
    statusLabel: 'Restricted (Assisted Search)',
    badgeColor: '#f59e0b',
    icon: '🇮🇳',
    description: 'India\'s leading job portal. Enforces strict anti-bot protections, CAPTCHA challenges, and login walls. CareerOS provides lawful, pre-filled deep links and 1-click external search.',
    supportsDirectIngestion: false,
    requiresAuth: true,
    antiBotProtected: true,
    supportedSearchCapabilities: ['keywords', 'location', 'experience', 'fresher'],
    supportedPagination: false,
    rateLimitInfo: 'Browser-driven search links (zero API rate limits)',
    sourceUrl: 'https://www.naukri.com',
    externalSearchCapability: true,
    legalPolicy: 'Lawful external search launcher. Zero CAPTCHA bypass or unauthorized scraping to protect candidate accounts.',
    generateSearchUrl: (query = 'Java Developer', location = 'Bengaluru', options = {}) => {
      const q = encodeURIComponent((query || 'Java Developer').trim());
      const loc = encodeURIComponent((location || 'Bengaluru').trim());
      const exp = options.fresherOnly ? '&experience=0' : '';
      return `https://www.naukri.com/${q}-jobs-in-${loc}?k=${q}&l=${loc}${exp}`;
    }
  },
  {
    id: 'indeed',
    name: 'Indeed',
    slug: 'indeed',
    dbAliases: ['indeed', 'indeed.com', 'indeed_india'],
    tier: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationType: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationLevel: INTEGRATION_LEVELS.EXTERNAL_ONLY,
    status: SOURCE_STATUS.RESTRICTED,
    statusLabel: 'Restricted (Assisted Search)',
    badgeColor: '#003a9b',
    icon: '🌐',
    description: 'Global job aggregator with Cloudflare Turnstile protection. CareerOS provides pre-formatted entry-level search links with salary and location filters.',
    supportsDirectIngestion: false,
    requiresAuth: false,
    antiBotProtected: true,
    supportedSearchCapabilities: ['keywords', 'location', 'fresher'],
    supportedPagination: false,
    rateLimitInfo: 'Browser-driven search links',
    sourceUrl: 'https://in.indeed.com',
    externalSearchCapability: true,
    legalPolicy: 'Assisted search deep-linking without automated scraping.',
    generateSearchUrl: (query = 'Java Developer', location = 'Bengaluru', options = {}) => {
      const q = encodeURIComponent((query || 'Java Developer').trim());
      const loc = encodeURIComponent((location || 'Bengaluru, Karnataka').trim());
      const exp = options.fresherOnly ? '&explvl=entry_level' : '';
      return `https://in.indeed.com/jobs?q=${q}&l=${loc}${exp}`;
    }
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    slug: 'linkedin',
    dbAliases: ['linkedin', 'linkedin.com'],
    tier: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationType: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationLevel: INTEGRATION_LEVELS.EXTERNAL_ONLY,
    status: SOURCE_STATUS.RESTRICTED,
    statusLabel: 'Restricted (Assisted Search)',
    badgeColor: '#0a66c2',
    icon: '👔',
    description: 'Professional networking platform with strict authentication gates and scraping prohibitions. CareerOS crafts precise search query URLs with entry-level experience filters.',
    supportsDirectIngestion: false,
    requiresAuth: true,
    antiBotProtected: true,
    supportedSearchCapabilities: ['keywords', 'location', 'fresher', 'experience'],
    supportedPagination: false,
    rateLimitInfo: 'Browser-driven search links',
    sourceUrl: 'https://www.linkedin.com/jobs',
    externalSearchCapability: true,
    legalPolicy: 'Strict adherence to LinkedIn Terms of Service. Direct browser deep-links only.',
    generateSearchUrl: (query = 'Java Developer', location = 'Bengaluru', options = {}) => {
      const q = encodeURIComponent((query || 'Java Developer').trim());
      const loc = encodeURIComponent((location || 'Bengaluru, Karnataka, India').trim());
      const expParam = options.fresherOnly ? '&f_E=1%2C2' : '';
      return `https://www.linkedin.com/jobs/search/?keywords=${q}&location=${loc}${expParam}&sortBy=DD`;
    }
  },
  {
    id: 'apna',
    name: 'Apna',
    slug: 'apna',
    dbAliases: ['apna', 'apna.co'],
    tier: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationType: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationLevel: INTEGRATION_LEVELS.EXTERNAL_ONLY,
    status: SOURCE_STATUS.RESTRICTED,
    statusLabel: 'Restricted (Assisted Search)',
    badgeColor: '#16a34a',
    icon: '📱',
    description: 'Indian professional community for rising talent. App-first with mobile verification. CareerOS provides pre-filled role/city deep links.',
    supportsDirectIngestion: false,
    requiresAuth: true,
    antiBotProtected: true,
    supportedSearchCapabilities: ['keywords', 'location'],
    supportedPagination: false,
    rateLimitInfo: 'Browser-driven search links',
    sourceUrl: 'https://apna.co/jobs',
    externalSearchCapability: true,
    legalPolicy: 'Assisted browser search links matching candidate criteria.',
    generateSearchUrl: (query = 'Java Developer', location = 'Bengaluru') => {
      const q = encodeURIComponent((query || 'Java Developer').trim());
      const loc = encodeURIComponent((location || 'Bengaluru').trim());
      return `https://apna.co/jobs?search=${q}&location=${loc}`;
    }
  },
  {
    id: 'workindia',
    name: 'WorkIndia',
    slug: 'workindia',
    dbAliases: ['workindia', 'workindia.in'],
    tier: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationType: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationLevel: INTEGRATION_LEVELS.EXTERNAL_ONLY,
    status: SOURCE_STATUS.RESTRICTED,
    statusLabel: 'Restricted (Assisted Search)',
    badgeColor: '#dc2626',
    icon: '🇮🇳',
    description: 'Fast-hiring portal for entry-level tech and operational roles with mobile OTP verification. Pre-formatted search deep-links provided.',
    supportsDirectIngestion: false,
    requiresAuth: true,
    antiBotProtected: true,
    supportedSearchCapabilities: ['keywords', 'location'],
    supportedPagination: false,
    rateLimitInfo: 'Browser-driven search links',
    sourceUrl: 'https://www.workindia.in',
    externalSearchCapability: true,
    legalPolicy: 'Assisted web discovery via direct search parameter routing.',
    generateSearchUrl: (query = 'Java Developer', location = 'Bengaluru') => {
      const citySlug = (location || 'bengaluru').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const q = encodeURIComponent((query || 'Java Developer').trim());
      return `https://www.workindia.in/jobs-in-${citySlug}/?q=${q}`;
    }
  },
  {
    id: 'other',
    name: 'Other Sources',
    slug: 'other',
    dbAliases: ['other', 'custom', 'test', 'unknown'],
    tier: SOURCE_TIERS.DIRECT_ATS,
    integrationType: SOURCE_TIERS.DIRECT_ATS,
    integrationLevel: INTEGRATION_LEVELS.PARTIALLY_INTEGRATED,
    status: SOURCE_STATUS.ACTIVE,
    statusLabel: 'Direct / Custom',
    badgeColor: '#64748b',
    icon: '📁',
    description: 'Community contributions, manually imported listings, and unclassified corporate career sites.',
    supportsDirectIngestion: true,
    requiresAuth: false,
    supportedSearchCapabilities: ['title', 'keywords', 'location'],
    supportedPagination: false,
    rateLimitInfo: 'Custom local database entries',
    sourceUrl: 'http://127.0.0.1:3000/#jobs',
    externalSearchCapability: false,
    legalPolicy: 'User-directed manual additions and imports.'
  }
];

// Initialize telemetry for all sources at load time
for (const s of SOURCES) {
  initTelemetry(s.id);
}

/**
 * Records a scan result for a source, updating its live telemetry.
 * 
 * @param {string} sourceId 
 * @param {object} param1 
 */
export function recordSourceScanTelemetry(sourceId, { success = true, jobsFound = 0, newJobsAdded = 0, error = null, timestamp = new Date().toISOString() } = {}) {
  const normId = (sourceId || '').toLowerCase().trim();
  const tel = initTelemetry(normId);

  if (success) {
    tel.lastSuccessfulScan = timestamp;
    tel.errorState = null;
    tel.consecutiveErrors = 0;
    tel.lastScanJobsCount = jobsFound;
    tel.totalJobsDiscovered += newJobsAdded;
  } else {
    tel.lastFailedScan = timestamp;
    tel.errorState = error ? String(error) : 'Scan error';
    tel.consecutiveErrors += 1;
  }

  sourceTelemetryStore.set(normId, tel);
}

/**
 * Retrieves the current live telemetry for a given source.
 */
export function getSourceTelemetry(sourceId) {
  const normId = (sourceId || '').toLowerCase().trim();
  return sourceTelemetryStore.get(normId) || {
    lastSuccessfulScan: null,
    lastFailedScan: null,
    errorState: null,
    totalJobsDiscovered: 0,
    lastScanJobsCount: 0,
    consecutiveErrors: 0
  };
}

/**
 * Resolves a raw source string from database or external scraper to an official source definition.
 */
export function resolveSource(rawSource) {
  if (!rawSource || typeof rawSource !== 'string') {
    return SOURCES.find(s => s.id === 'other');
  }

  const clean = rawSource.trim().toLowerCase();

  for (const src of SOURCES) {
    if (src.id === clean || src.slug === clean) return src;
    if (src.dbAliases && src.dbAliases.includes(clean)) return src;
  }

  // Check substring matches
  if (clean.includes('greenhouse')) return SOURCES.find(s => s.id === 'greenhouse');
  if (clean.includes('lever')) return SOURCES.find(s => s.id === 'lever');
  if (clean.includes('ashby')) return SOURCES.find(s => s.id === 'ashby');
  if (clean.includes('smartrecruiter')) return SOURCES.find(s => s.id === 'smartrecruiters');
  if (clean.includes('freehire') || clean.includes('instahyre')) return SOURCES.find(s => s.id === 'freehire');
  if (clean.includes('workable')) return SOURCES.find(s => s.id === 'workable');
  if (clean.includes('recruitee')) return SOURCES.find(s => s.id === 'career_pages');
  if (clean.includes('naukri')) return SOURCES.find(s => s.id === 'naukri');
  if (clean.includes('indeed')) return SOURCES.find(s => s.id === 'indeed');
  if (clean.includes('linkedin')) return SOURCES.find(s => s.id === 'linkedin');
  if (clean.includes('apna')) return SOURCES.find(s => s.id === 'apna');
  if (clean.includes('workindia')) return SOURCES.find(s => s.id === 'workindia');
  if (clean.includes('career') || clean.includes('direct')) return SOURCES.find(s => s.id === 'career_pages');

  return SOURCES.find(s => s.id === 'other');
}

/**
 * Returns all official sources combined with dynamic telemetry.
 */
export function getAllSources() {
  return SOURCES.map(src => {
    const tel = getSourceTelemetry(src.id);
    return {
      ...src,
      lastSuccessfulScan: tel.lastSuccessfulScan,
      lastFailedScan: tel.lastFailedScan,
      errorState: tel.errorState,
      consecutiveErrors: tel.consecutiveErrors,
      totalJobsDiscovered: tel.totalJobsDiscovered,
      lastScanJobsCount: tel.lastScanJobsCount
    };
  });
}

/**
 * Generates Google-based search queries and direct operator links for Lever, Greenhouse, and Ashby.
 */
export function generateGoogleSearchLinks(query = 'Java Developer', location = 'Bengaluru', options = {}) {
  const links = [];
  const cleanQ = (query || 'Java Developer').trim();
  const cleanLoc = (location || 'Bengaluru').trim();
  const fresherSuffix = options.fresherOnly ? ' Fresher' : '';

  // Google Jobs Direct Discovery Link
  links.push({
    sourceId: 'google_jobs',
    sourceName: 'Google Jobs Search',
    badgeColor: '#4285f4',
    icon: '🔍',
    queryUsed: `${cleanQ}${fresherSuffix} ${cleanLoc} jobs`,
    url: `https://www.google.com/search?q=${encodeURIComponent(`${cleanQ}${fresherSuffix} ${cleanLoc} jobs`)}&ibp=htl;jobs`,
    legalNotice: 'Lawful public search aggregation opening in your default browser.'
  });

  // Google Site Searches targeting direct ATS platforms
  links.push({
    sourceId: 'google_lever',
    sourceName: 'Lever ATS via Google',
    badgeColor: '#0ea5e9',
    icon: '⚡',
    queryUsed: `site:jobs.lever.co ${cleanQ} ${cleanLoc}`,
    url: `https://www.google.com/search?q=${encodeURIComponent(`site:jobs.lever.co ${cleanQ} ${cleanLoc}`)}`,
    legalNotice: 'Lawful public web query targeting Lever ATS openings.'
  });

  links.push({
    sourceId: 'google_greenhouse',
    sourceName: 'Greenhouse ATS via Google',
    badgeColor: '#10b981',
    icon: '🌿',
    queryUsed: `site:boards.greenhouse.io ${cleanQ} India`,
    url: `https://www.google.com/search?q=${encodeURIComponent(`site:boards.greenhouse.io ${cleanQ} India`)}`,
    legalNotice: 'Lawful public web query targeting Greenhouse ATS openings.'
  });

  links.push({
    sourceId: 'google_ashby',
    sourceName: 'Ashby ATS via Google',
    badgeColor: '#8b5cf6',
    icon: '🚀',
    queryUsed: `site:jobs.ashbyhq.com ${cleanQ} ${cleanLoc}`,
    url: `https://www.google.com/search?q=${encodeURIComponent(`site:jobs.ashbyhq.com ${cleanQ} ${cleanLoc}`)}`,
    legalNotice: 'Lawful public web query targeting Ashby ATS openings.'
  });

  return links;
}

/**
 * Generates lawful external search links for all restricted sources based on search criteria.
 */
export function generateAssistedSearchLinks(query = 'Java Developer', location = 'Bengaluru', options = {}) {
  const links = [];
  const cleanQ = (query || 'Java Developer').trim();
  const cleanLoc = (location || 'Bengaluru').trim();

  // If explicitly requested, include Google operators alongside portal links
  if (options.includeGoogle) {
    links.push(...generateGoogleSearchLinks(cleanQ, cleanLoc, options));
  }

  for (const src of SOURCES) {
    if (typeof src.generateSearchUrl === 'function') {
      links.push({
        sourceId: src.id,
        sourceName: src.name,
        badgeColor: src.badgeColor,
        icon: src.icon,
        url: src.generateSearchUrl(cleanQ, cleanLoc, options),
        legalNotice: src.legalPolicy
      });
    }
  }
  return links;
}
