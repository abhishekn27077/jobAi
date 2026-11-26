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
      lastDurationMs: null,
      importStatus: 'idle',
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
    id: 'remotive',
    name: 'Remotive',
    slug: 'remotive',
    dbAliases: ['remotive'],
    tier: SOURCE_TIERS.LIVE_FEED,
    integrationType: SOURCE_TIERS.LIVE_FEED,
    integrationLevel: INTEGRATION_LEVELS.FULLY_INTEGRATED,
    status: SOURCE_STATUS.ACTIVE,
    statusLabel: 'Live Public API',
    badgeColor: '#6366f1',
    icon: '🌍',
    description: 'Public Remotive Remote Jobs API (remotive.com/api/remote-jobs) for remote software development roles.',
    supportsDirectIngestion: true,
    requiresAuth: false,
    supportedSearchCapabilities: ['title', 'keywords', 'skills', 'fresher'],
    supportedPagination: false,
    endpointPattern: 'https://remotive.com/api/remote-jobs',
    rateLimitInfo: 'Public JSON API (max 4 req/min recommended)',
    sourceUrl: 'https://remotive.com',
    externalSearchCapability: false,
    legalPolicy: 'Official public Remotive remote jobs API.'
  },
  {
    id: 'arbeitnow',
    name: 'Arbeitnow',
    slug: 'arbeitnow',
    dbAliases: ['arbeitnow'],
    tier: SOURCE_TIERS.LIVE_FEED,
    integrationType: SOURCE_TIERS.LIVE_FEED,
    integrationLevel: INTEGRATION_LEVELS.FULLY_INTEGRATED,
    status: SOURCE_STATUS.ACTIVE,
    statusLabel: 'Live Public API',
    badgeColor: '#0ea5e9',
    icon: '🇪🇺',
    description: 'Public Arbeitnow Job Board API (arbeitnow.com/api/job-board-api) for remote and international tech roles.',
    supportsDirectIngestion: true,
    requiresAuth: false,
    supportedSearchCapabilities: ['title', 'keywords', 'location', 'skills', 'workMode'],
    supportedPagination: true,
    endpointPattern: 'https://www.arbeitnow.com/api/job-board-api',
    rateLimitInfo: 'Public JSON API',
    sourceUrl: 'https://www.arbeitnow.com',
    externalSearchCapability: false,
    legalPolicy: 'Official public Arbeitnow job board API.'
  },
  {
    id: 'himalayas',
    name: 'Himalayas',
    slug: 'himalayas',
    dbAliases: ['himalayas'],
    tier: SOURCE_TIERS.LIVE_FEED,
    integrationType: SOURCE_TIERS.LIVE_FEED,
    integrationLevel: INTEGRATION_LEVELS.FULLY_INTEGRATED,
    status: SOURCE_STATUS.ACTIVE,
    statusLabel: 'Live Public API',
    badgeColor: '#14b8a6',
    icon: '🏔️',
    description: 'Public Himalayas Remote Jobs API (himalayas.app/jobs/api) with salary ranges and location restrictions.',
    supportsDirectIngestion: true,
    requiresAuth: false,
    supportedSearchCapabilities: ['title', 'keywords', 'location', 'skills', 'salary'],
    supportedPagination: true,
    endpointPattern: 'https://himalayas.app/jobs/api',
    rateLimitInfo: 'Public JSON API',
    sourceUrl: 'https://himalayas.app/jobs',
    externalSearchCapability: false,
    legalPolicy: 'Official public Himalayas jobs API.'
  },
  {
    id: 'jobicy',
    name: 'Jobicy',
    slug: 'jobicy',
    dbAliases: ['jobicy'],
    tier: SOURCE_TIERS.LIVE_FEED,
    integrationType: SOURCE_TIERS.LIVE_FEED,
    integrationLevel: INTEGRATION_LEVELS.FULLY_INTEGRATED,
    status: SOURCE_STATUS.ACTIVE,
    statusLabel: 'Live Public API',
    badgeColor: '#8b5cf6',
    icon: '💠',
    description: 'Public Jobicy Remote Jobs API (jobicy.com/api/v2/remote-jobs) for remote engineering roles.',
    supportsDirectIngestion: true,
    requiresAuth: false,
    supportedSearchCapabilities: ['title', 'keywords', 'location', 'salary'],
    supportedPagination: false,
    endpointPattern: 'https://jobicy.com/api/v2/remote-jobs',
    rateLimitInfo: 'Public JSON API (hourly cache)',
    sourceUrl: 'https://jobicy.com',
    externalSearchCapability: false,
    legalPolicy: 'Official public Jobicy v2 API.'
  },
  {
    id: 'remoteok',
    name: 'RemoteOK',
    slug: 'remoteok',
    dbAliases: ['remoteok'],
    tier: SOURCE_TIERS.LIVE_FEED,
    integrationType: SOURCE_TIERS.LIVE_FEED,
    integrationLevel: INTEGRATION_LEVELS.FULLY_INTEGRATED,
    status: SOURCE_STATUS.ACTIVE,
    statusLabel: 'Live Public API',
    badgeColor: '#ef4444',
    icon: '🛰️',
    description: 'Public RemoteOK JSON API (remoteok.com/api) for worldwide remote software roles.',
    supportsDirectIngestion: true,
    requiresAuth: false,
    supportedSearchCapabilities: ['title', 'keywords', 'skills', 'salary'],
    supportedPagination: false,
    endpointPattern: 'https://remoteok.com/api',
    rateLimitInfo: 'Public JSON feed (attribution link preserved)',
    sourceUrl: 'https://remoteok.com',
    externalSearchCapability: false,
    legalPolicy: 'Public RemoteOK API with direct link-back to original listings.'
  },
  {
    id: 'weworkremotely',
    name: 'We Work Remotely',
    slug: 'weworkremotely',
    dbAliases: ['weworkremotely', 'wwr'],
    tier: SOURCE_TIERS.LIVE_FEED,
    integrationType: SOURCE_TIERS.LIVE_FEED,
    integrationLevel: INTEGRATION_LEVELS.FULLY_INTEGRATED,
    status: SOURCE_STATUS.ACTIVE,
    statusLabel: 'Live RSS Feed',
    badgeColor: '#f97316',
    icon: '📡',
    description: 'Public We Work Remotely Programming RSS feed (weworkremotely.com/categories/remote-programming-jobs.rss).',
    supportsDirectIngestion: true,
    requiresAuth: false,
    supportedSearchCapabilities: ['title', 'keywords', 'location'],
    supportedPagination: false,
    endpointPattern: 'https://weworkremotely.com/categories/remote-programming-jobs.rss',
    rateLimitInfo: 'Public RSS feed',
    sourceUrl: 'https://weworkremotely.com',
    externalSearchCapability: false,
    legalPolicy: 'Official public We Work Remotely RSS feed.'
  },
  {
    id: 'foundit',
    name: 'Foundit (Monster India)',
    slug: 'foundit',
    dbAliases: ['foundit', 'monster'],
    tier: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationType: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationLevel: INTEGRATION_LEVELS.EXTERNAL_ONLY,
    status: SOURCE_STATUS.RESTRICTED,
    statusLabel: 'Restricted (Assisted Search)',
    badgeColor: '#6d28d9',
    icon: '🔎',
    description: 'Indian job portal with bot protection. CareerOS generates pre-filled search links and supports manual URL import.',
    supportsDirectIngestion: false,
    requiresAuth: false,
    antiBotProtected: true,
    supportedSearchCapabilities: ['keywords', 'location', 'experience'],
    supportedPagination: false,
    rateLimitInfo: 'Browser-driven search links',
    sourceUrl: 'https://www.foundit.in',
    externalSearchCapability: true,
    legalPolicy: 'Lawful external search launcher without automated scraping.',
    generateSearchUrl: (query = 'Java Developer', location = 'Bengaluru') => {
      const q = encodeURIComponent((query || 'Java Developer').trim());
      const loc = encodeURIComponent((location || 'Bengaluru').trim());
      return `https://www.foundit.in/srp/results?query=${q}&locations=${loc}`;
    }
  },
  {
    id: 'cutshort',
    name: 'Cutshort',
    slug: 'cutshort',
    dbAliases: ['cutshort'],
    tier: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationType: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationLevel: INTEGRATION_LEVELS.EXTERNAL_ONLY,
    status: SOURCE_STATUS.RESTRICTED,
    statusLabel: 'Restricted (Assisted Search)',
    badgeColor: '#4f46e5',
    icon: '✂️',
    description: 'Startup tech hiring platform in India. Login-gated; CareerOS provides assisted search links and direct URL import.',
    supportsDirectIngestion: false,
    requiresAuth: true,
    antiBotProtected: true,
    supportedSearchCapabilities: ['keywords', 'location'],
    supportedPagination: false,
    rateLimitInfo: 'Browser-driven search links',
    sourceUrl: 'https://cutshort.io',
    externalSearchCapability: true,
    legalPolicy: 'Assisted browser search links only.',
    generateSearchUrl: (query = 'Java Developer', location = 'Bengaluru') => {
      const slug = (query || 'java-developer').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const loc = (location || 'bangalore').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return `https://cutshort.io/jobs/${slug}-jobs-in-${loc}`;
    }
  },
  {
    id: 'hirist',
    name: 'Hirist',
    slug: 'hirist',
    dbAliases: ['hirist', 'hirist.tech'],
    tier: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationType: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationLevel: INTEGRATION_LEVELS.EXTERNAL_ONLY,
    status: SOURCE_STATUS.RESTRICTED,
    statusLabel: 'Restricted (Assisted Search)',
    badgeColor: '#0284c7',
    icon: '💻',
    description: 'Indian tech-focused job portal. Protected against scraping; CareerOS provides pre-filled search links and manual URL import.',
    supportsDirectIngestion: false,
    requiresAuth: true,
    antiBotProtected: true,
    supportedSearchCapabilities: ['keywords', 'location'],
    supportedPagination: false,
    rateLimitInfo: 'Browser-driven search links',
    sourceUrl: 'https://www.hirist.tech',
    externalSearchCapability: true,
    legalPolicy: 'Assisted browser search links only.',
    generateSearchUrl: (query = 'Java Developer') => {
      const q = encodeURIComponent((query || 'Java Developer').trim());
      return `https://www.hirist.tech/search/${q}`;
    }
  },
  {
    id: 'hn_hiring',
    name: 'HN Who is Hiring',
    slug: 'hn_hiring',
    dbAliases: ['hn_hiring', 'hackernews', 'hn'],
    tier: SOURCE_TIERS.LIVE_FEED,
    integrationType: SOURCE_TIERS.LIVE_FEED,
    integrationLevel: INTEGRATION_LEVELS.FULLY_INTEGRATED,
    status: SOURCE_STATUS.ACTIVE,
    statusLabel: 'Live Algolia API',
    badgeColor: '#ff6600',
    icon: '🟧',
    description: 'Monthly Hacker News "Ask HN: Who is hiring?" thread via public Algolia HN Search API.',
    supportsDirectIngestion: true,
    requiresAuth: false,
    supportedSearchCapabilities: ['title', 'keywords', 'location', 'workMode'],
    supportedPagination: false,
    endpointPattern: 'https://hn.algolia.com/api/v1/items/{id}',
    rateLimitInfo: 'Public Algolia HN API',
    sourceUrl: 'https://news.ycombinator.com',
    externalSearchCapability: false,
    legalPolicy: 'Official public Hacker News Algolia API.'
  },
  {
    id: 'hasjob',
    name: 'Hasjob (HasGeek)',
    slug: 'hasjob',
    dbAliases: ['hasjob', 'hasgeek'],
    tier: SOURCE_TIERS.LIVE_FEED,
    integrationType: SOURCE_TIERS.LIVE_FEED,
    integrationLevel: INTEGRATION_LEVELS.FULLY_INTEGRATED,
    status: SOURCE_STATUS.ACTIVE,
    statusLabel: 'Live Atom Feed',
    badgeColor: '#dc2626',
    icon: '🇮🇳',
    description: 'Indian developer & startup job board by HasGeek via public Atom RSS feed (hasjob.co/feed).',
    supportsDirectIngestion: true,
    requiresAuth: false,
    supportedSearchCapabilities: ['title', 'keywords', 'location', 'workMode'],
    supportedPagination: false,
    endpointPattern: 'https://hasjob.co/feed',
    rateLimitInfo: 'Public Atom feed',
    sourceUrl: 'https://hasjob.co',
    externalSearchCapability: false,
    legalPolicy: 'Official public Hasjob Atom feed.'
  },
  {
    id: 'unstop',
    name: 'Unstop',
    slug: 'unstop',
    dbAliases: ['unstop'],
    tier: SOURCE_TIERS.LIVE_FEED,
    integrationType: SOURCE_TIERS.LIVE_FEED,
    integrationLevel: INTEGRATION_LEVELS.FULLY_INTEGRATED,
    status: SOURCE_STATUS.ACTIVE,
    statusLabel: 'Live Public API',
    badgeColor: '#1d4ed8',
    icon: '🎓',
    description: 'Indian campus, fresher & early-career tech jobs via Unstop public opportunity search API.',
    supportsDirectIngestion: true,
    requiresAuth: false,
    supportedSearchCapabilities: ['title', 'keywords', 'location', 'fresher', 'salary'],
    supportedPagination: true,
    endpointPattern: 'https://unstop.com/api/public/opportunity/search-result?opportunity=jobs',
    rateLimitInfo: 'Public opportunity API',
    sourceUrl: 'https://unstop.com/jobs',
    externalSearchCapability: false,
    legalPolicy: 'Public Unstop opportunity search endpoint.'
  },
  {
    id: 'internshala',
    name: 'Internshala',
    slug: 'internshala',
    dbAliases: ['internshala'],
    tier: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationType: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationLevel: INTEGRATION_LEVELS.EXTERNAL_ONLY,
    status: SOURCE_STATUS.RESTRICTED,
    statusLabel: 'Assisted Search',
    badgeColor: '#008bdc',
    icon: '🎒',
    description: 'Indian fresher jobs & internships portal. Assisted search deep-links and manual URL import provided.',
    supportsDirectIngestion: false,
    requiresAuth: true,
    antiBotProtected: true,
    supportedSearchCapabilities: ['keywords', 'location', 'fresher'],
    supportedPagination: false,
    rateLimitInfo: 'Browser-driven search links',
    sourceUrl: 'https://internshala.com/jobs',
    externalSearchCapability: true,
    legalPolicy: 'Assisted search deep-links only.',
    generateSearchUrl: (query = 'Java Developer', location = 'Bangalore') => {
      const qSlug = (query || 'java').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const lSlug = (location || 'bangalore').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return `https://internshala.com/jobs/${qSlug}-jobs-in-${lSlug}/`;
    }
  },
  {
    id: 'wellfound',
    name: 'Wellfound (AngelList)',
    slug: 'wellfound',
    dbAliases: ['wellfound', 'angellist'],
    tier: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationType: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationLevel: INTEGRATION_LEVELS.EXTERNAL_ONLY,
    status: SOURCE_STATUS.RESTRICTED,
    statusLabel: 'Restricted (Turnstile)',
    badgeColor: '#ec4899',
    icon: '🚀',
    description: 'Startup jobs portal protected by Cloudflare Turnstile. Assisted search deep-links provided.',
    supportsDirectIngestion: false,
    requiresAuth: true,
    antiBotProtected: true,
    supportedSearchCapabilities: ['keywords', 'location'],
    supportedPagination: false,
    rateLimitInfo: 'Browser-driven search links',
    sourceUrl: 'https://wellfound.com/jobs',
    externalSearchCapability: true,
    legalPolicy: 'Assisted search deep-links only.',
    generateSearchUrl: (query = 'Java Developer', location = 'Bengaluru') => {
      const qSlug = (query || 'java-developer').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const lSlug = (location || 'bengaluru').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return `https://wellfound.com/role/l/${qSlug}/${lSlug}`;
    }
  },
  {
    id: 'freshersworld',
    name: 'Freshersworld',
    slug: 'freshersworld',
    dbAliases: ['freshersworld'],
    tier: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationType: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationLevel: INTEGRATION_LEVELS.EXTERNAL_ONLY,
    status: SOURCE_STATUS.RESTRICTED,
    statusLabel: 'Assisted Search',
    badgeColor: '#f59e0b',
    icon: '🌱',
    description: 'Indian fresher & graduate hiring portal. Assisted search deep-links provided.',
    supportsDirectIngestion: false,
    requiresAuth: false,
    antiBotProtected: true,
    supportedSearchCapabilities: ['keywords', 'location', 'fresher'],
    supportedPagination: false,
    rateLimitInfo: 'Browser-driven search links',
    sourceUrl: 'https://www.freshersworld.com',
    externalSearchCapability: true,
    legalPolicy: 'Assisted search deep-links only.',
    generateSearchUrl: (query = 'Java', location = 'Bangalore') => {
      const q = (query || 'java').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const loc = (location || 'bangalore').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return `https://www.freshersworld.com/jobs/jobsearch/${q}-jobs-in-${loc}`;
    }
  },
  {
    id: 'ncs',
    name: 'NCS (National Career Service)',
    slug: 'ncs',
    dbAliases: ['ncs', 'ncs.gov.in'],
    tier: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationType: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationLevel: INTEGRATION_LEVELS.EXTERNAL_ONLY,
    status: SOURCE_STATUS.RESTRICTED,
    statusLabel: 'Assisted Search',
    badgeColor: '#059669',
    icon: '🏛️',
    description: 'Government of India National Career Service portal (SPA). Assisted search link provided.',
    supportsDirectIngestion: false,
    requiresAuth: false,
    antiBotProtected: true,
    supportedSearchCapabilities: ['keywords', 'location'],
    supportedPagination: false,
    rateLimitInfo: 'Browser-driven search links',
    sourceUrl: 'https://www.ncs.gov.in',
    externalSearchCapability: true,
    legalPolicy: 'Official portal link only.',
    generateSearchUrl: () => 'https://www.ncs.gov.in/Pages/Search.aspx'
  },
  {
    id: 'yc_waas',
    name: 'YC Work at a Startup',
    slug: 'yc_waas',
    dbAliases: ['yc_waas', 'workatastartup', 'ycombinator'],
    tier: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationType: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationLevel: INTEGRATION_LEVELS.EXTERNAL_ONLY,
    status: SOURCE_STATUS.RESTRICTED,
    statusLabel: 'Assisted Search',
    badgeColor: '#f97316',
    icon: 'Y',
    description: 'Y Combinator startup jobs (requires YC account / blocks automated fetch). Assisted search link provided.',
    supportsDirectIngestion: false,
    requiresAuth: true,
    antiBotProtected: true,
    supportedSearchCapabilities: ['keywords', 'location'],
    supportedPagination: false,
    rateLimitInfo: 'Browser-driven search links',
    sourceUrl: 'https://www.workatastartup.com/jobs',
    externalSearchCapability: true,
    legalPolicy: 'Assisted search deep-links only.',
    generateSearchUrl: (query = 'Java') => `https://www.workatastartup.com/jobs?query=${encodeURIComponent(query)}`
  },
  {
    id: 'peerlist',
    name: 'Peerlist Jobs',
    slug: 'peerlist',
    dbAliases: ['peerlist'],
    tier: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationType: SOURCE_TIERS.RESTRICTED_EXTERNAL,
    integrationLevel: INTEGRATION_LEVELS.EXTERNAL_ONLY,
    status: SOURCE_STATUS.RESTRICTED,
    statusLabel: 'Restricted (Cloudflare)',
    badgeColor: '#16a34a',
    icon: '🟢',
    description: 'Tech community jobs board protected by Cloudflare. Assisted search link provided.',
    supportsDirectIngestion: false,
    requiresAuth: true,
    antiBotProtected: true,
    supportedSearchCapabilities: ['keywords'],
    supportedPagination: false,
    rateLimitInfo: 'Browser-driven search links',
    sourceUrl: 'https://peerlist.io/jobs',
    externalSearchCapability: true,
    legalPolicy: 'Assisted search deep-links only.',
    generateSearchUrl: () => 'https://peerlist.io/jobs'
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
export function recordSourceScanTelemetry(sourceId, { success = true, jobsFound = 0, newJobsAdded = 0, durationMs = null, importStatus = null, error = null, timestamp = new Date().toISOString() } = {}) {
  const normId = (sourceId || '').toLowerCase().trim();
  const tel = initTelemetry(normId);

  if (durationMs !== null && Number.isFinite(Number(durationMs))) {
    tel.lastDurationMs = Math.round(Number(durationMs));
  }

  if (success) {
    tel.lastSuccessfulScan = timestamp;
    tel.errorState = null;
    tel.consecutiveErrors = 0;
    tel.lastScanJobsCount = jobsFound;
    tel.totalJobsDiscovered += newJobsAdded;
    tel.importStatus = importStatus || 'ok';
  } else {
    tel.lastFailedScan = timestamp;
    tel.errorState = error ? String(error) : 'Scan error';
    tel.consecutiveErrors += 1;
    tel.importStatus = importStatus || 'error';
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
  if (clean.includes('hn_hiring') || clean.includes('ycombinator') || clean.includes('hackernews')) return SOURCES.find(s => s.id === 'hn_hiring');
  if (clean.includes('hasjob')) return SOURCES.find(s => s.id === 'hasjob');
  if (clean.includes('unstop')) return SOURCES.find(s => s.id === 'unstop');
  if (clean.includes('internshala')) return SOURCES.find(s => s.id === 'internshala');
  if (clean.includes('wellfound') || clean.includes('angel.co')) return SOURCES.find(s => s.id === 'wellfound');
  if (clean.includes('freshersworld')) return SOURCES.find(s => s.id === 'freshersworld');
  if (clean.includes('ncs.gov') || clean === 'ncs') return SOURCES.find(s => s.id === 'ncs');
  if (clean.includes('workatastartup') || clean === 'yc_waas') return SOURCES.find(s => s.id === 'yc_waas');
  if (clean.includes('peerlist')) return SOURCES.find(s => s.id === 'peerlist');
  if (clean.includes('remotive')) return SOURCES.find(s => s.id === 'remotive');
  if (clean.includes('arbeitnow')) return SOURCES.find(s => s.id === 'arbeitnow');
  if (clean.includes('himalayas')) return SOURCES.find(s => s.id === 'himalayas');
  if (clean.includes('jobicy')) return SOURCES.find(s => s.id === 'jobicy');
  if (clean.includes('remoteok')) return SOURCES.find(s => s.id === 'remoteok');
  if (clean.includes('weworkremotely') || clean === 'wwr') return SOURCES.find(s => s.id === 'weworkremotely');
  if (clean.includes('foundit') || clean.includes('monster')) return SOURCES.find(s => s.id === 'foundit');
  if (clean.includes('cutshort')) return SOURCES.find(s => s.id === 'cutshort');
  if (clean.includes('hirist')) return SOURCES.find(s => s.id === 'hirist');
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
      lastScanJobsCount: tel.lastScanJobsCount,
      lastDurationMs: tel.lastDurationMs ?? null,
      importStatus: tel.importStatus || (src.supportsDirectIngestion ? 'ready' : 'assisted_only')
    };
  });
}

/**
 * Phase 17 — Unified Source Health Report
 */
export function getSourceHealthReport() {
  const now = Date.now();
  return getAllSources()
    .filter(s => s.id !== 'all')
    .map(s => {
      let dataFreshness = 'never_scanned';
      if (s.lastSuccessfulScan) {
        const ageHrs = (now - new Date(s.lastSuccessfulScan).getTime()) / (1000 * 60 * 60);
        dataFreshness = ageHrs <= 6 ? 'fresh' : (ageHrs <= 24 ? 'recent' : 'stale');
      } else if (!s.supportsDirectIngestion) {
        dataFreshness = 'external_gateway';
      }
      return {
        id: s.id,
        sourceName: s.name,
        integrationType: s.integrationType,
        enabled: s.status !== 'disabled',
        supportsDirectIngestion: Boolean(s.supportsDirectIngestion),
        lastSuccessfulSearch: s.lastSuccessfulScan,
        lastError: s.errorState,
        jobsRetrieved: s.lastScanJobsCount || 0,
        totalJobsDiscovered: s.totalJobsDiscovered || 0,
        searchDurationMs: s.lastDurationMs,
        dataFreshness,
        importStatus: s.supportsDirectIngestion ? (s.importStatus || 'ready') : 'assisted_only'
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
