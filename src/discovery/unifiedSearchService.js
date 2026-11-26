/**
 * CareerOS Phase 10 — Unified Job Search Engine
 * 
 * Provides high-performance, multi-source search, cross-source deduplication,
 * 8-tier freshness classification, comprehensive multi-field filtering,
 * and accurate real-time summary metrics.
 */

import { getDatabase } from '../db/schema.js';
import { SOURCES, resolveSource, generateAssistedSearchLinks, generateGoogleSearchLinks } from './sourceRegistry.js';
import { normalizeCanonicalUrl, extractAtsJobId } from './urlNormalizer.js';
import { loadCandidateProfile } from '../profile/profileManager.js';
import { DEGREE_CLASSIFICATIONS } from '../matcher/degreeClassifier.js';
import { evaluateJobFit } from '../matcher/scoringEngine.js';
import { ELIGIBILITY_TIERS, PRIORITY_TIERS, LOW_QUALITY_FLAGS } from '../matcher/qualityDetector.js';

export const FRESHNESS_STATUSES = {
  VERIFIED_ACTIVE: 'verified_active',
  RECENTLY_POSTED: 'recently_posted',
  NEEDS_REVERIFICATION: 'needs_reverification',
  POSSIBLY_EXPIRED: 'possibly_expired',
  EXPIRED: 'expired',
  CLOSED: 'closed',
  VERIFICATION_FAILED: 'verification_failed',
  UNKNOWN: 'unknown'
};

/**
 * Computes deterministic freshness classification for a job record.
 */
export function classifyFreshness(job) {
  const vStatus = (job.verification_status || '').toLowerCase();
  const jStatus = (job.status || '').toLowerCase();
  const rec = (job.recommendation || '').toLowerCase();

  // 1. Explicit Expiry / Closed
  if (jStatus === 'expired' || vStatus === 'expired' || rec === 'expired') {
    return FRESHNESS_STATUSES.EXPIRED;
  }
  if (vStatus.includes('closed') || (job.verification_reason || '').toLowerCase().includes('closed')) {
    return FRESHNESS_STATUSES.CLOSED;
  }

  // 2. Inaccessible / Verification Failed
  if (vStatus === 'inaccessible' || (job.verification_reason || '').toLowerCase().includes('timeout')) {
    return FRESHNESS_STATUSES.VERIFICATION_FAILED;
  }

  // 3. Confirmed Active
  if (vStatus === 'verified_active') {
    return FRESHNESS_STATUSES.VERIFIED_ACTIVE;
  }

  // 4. Time calculations
  const now = Date.now();
  const postedMs = job.posted_at ? new Date(job.posted_at).getTime() : 0;
  const createdMs = job.created_at ? new Date(job.created_at).getTime() : 0;
  const bestDateMs = postedMs || createdMs || 0;

  if (bestDateMs > 0) {
    const ageDays = (now - bestDateMs) / (1000 * 60 * 60 * 24);
    if (ageDays <= 3) {
      return FRESHNESS_STATUSES.RECENTLY_POSTED;
    }
    if (ageDays > 45) {
      return FRESHNESS_STATUSES.POSSIBLY_EXPIRED;
    }
    if (ageDays > 14) {
      return FRESHNESS_STATUSES.NEEDS_REVERIFICATION;
    }
  }

  // 5. Default
  return FRESHNESS_STATUSES.UNKNOWN;
}

/**
 * Expands target search role terms into smart semantic variants
 * to discover relevant junior/fresher engineering roles without pulling unrelated jobs.
 */
export function expandSmartRoleTerms(term = '') {
  const t = (term || '').toLowerCase().trim();
  if (!t) return [];

  const clusters = [
    {
      trigger: /\b(java|core java|spring|spring boot)\b/i,
      variants: [
        'java', 'core java', 'spring boot', 'java developer', 'java software engineer',
        'backend java', 'java full stack', 'junior java', 'associate java', 'spring boot developer',
        'java trainee', 'trainee software engineer - java'
      ]
    },
    {
      trigger: /\b(backend|backend engineer|backend developer|api developer)\b/i,
      variants: [
        'backend', 'backend developer', 'backend engineer', 'api developer',
        'software engineer - backend', 'server side', 'node js', 'spring boot', 'rest apis'
      ]
    },
    {
      trigger: /\b(software engineer|software developer|sde|associate software engineer)\b/i,
      variants: [
        'software engineer', 'software developer', 'sde', 'sde 1', 'sde-1', 'sde i',
        'associate software engineer', 'trainee software engineer',
        'graduate engineer trainee', 'get', 'junior software engineer',
        'member of technical staff'
      ]
    },
    {
      trigger: /\b(full stack|fullstack|full-stack)\b/i,
      variants: [
        'full stack', 'fullstack', 'full-stack', 'java full stack',
        'react developer', 'mern', 'web developer'
      ]
    },
    {
      trigger: /\b(ai engineer|machine learning|ml engineer|ai developer)\b/i,
      variants: [
        'ai engineer', 'machine learning', 'ml engineer', 'junior ai',
        'ai intern', 'computer vision', 'opencv', 'generative ai'
      ]
    }
  ];

  const matchedVariants = new Set([t]);
  for (const cluster of clusters) {
    if (cluster.trigger.test(t)) {
      for (const v of cluster.variants) {
        matchedVariants.add(v);
      }
    }
  }

  return Array.from(matchedVariants);
}

/**
 * Intelligent Natural Language Query Parser
 * Interprets natural queries like "MCA Fresher Java Developer Bengaluru"
 * into structured search criteria (role, skills, location, experience, degree).
 */
export function parseNaturalLanguageQuery(queryString = '') {
  const query = (queryString || '').trim();
  if (!query) {
    return {
      rawQuery: '',
      hasCriteria: false,
      extractedRoles: [],
      extractedSkills: [],
      extractedLocations: [],
      isFresher: false,
      experienceMin: null,
      experienceMax: null,
      extractedDegrees: [],
      isRemote: false,
      residualTokens: []
    };
  }

  const lower = query.toLowerCase();

  // 1. Fresher / Level intent
  const isFresher = /\b(fresher|freshers|entry[\s-]?level|graduate|trainee|junior|associate|intern|internship|0-1|0-2)\b/i.test(lower);
  let expMin = null;
  let expMax = null;
  const expMatch = lower.match(/\b(\d+)\s*(?:-|to)\s*(\d+)\s*(?:years?|yrs?)\b/i);
  if (expMatch) {
    expMin = parseInt(expMatch[1], 10);
    expMax = parseInt(expMatch[2], 10);
  } else if (/\b(?:0-1|0 to 1)\b/i.test(lower)) {
    expMin = 0; expMax = 1;
  } else if (/\b(?:0-2|0 to 2)\b/i.test(lower)) {
    expMin = 0; expMax = 2;
  } else if (isFresher) {
    expMin = 0; expMax = 1;
  }

  // 2. Degree intent
  const extractedDegrees = [];
  if (/\b(mca)\b/i.test(lower)) extractedDegrees.push('mca');
  if (/\b(b\.?tech|b\.?e|engineering)\b/i.test(lower)) extractedDegrees.push('btech');
  if (/\b(bca)\b/i.test(lower)) extractedDegrees.push('bca');

  // 3. Location intent
  const extractedLocations = [];
  if (/\b(bengaluru|bangalore|blr|karnataka|whitefield|electronic city)\b/i.test(lower)) extractedLocations.push('bengaluru');
  if (/\b(remote|work from home|wfh)\b/i.test(lower)) extractedLocations.push('remote');
  if (/\b(hyderabad|hyd|telangana)\b/i.test(lower)) extractedLocations.push('hyderabad');
  if (/\b(pune|maharashtra)\b/i.test(lower)) extractedLocations.push('pune');
  if (/\b(chennai|tamil nadu)\b/i.test(lower)) extractedLocations.push('chennai');
  if (/\b(mumbai)\b/i.test(lower)) extractedLocations.push('mumbai');
  if (/\b(delhi|ncr|gurugram|gurgaon|noida)\b/i.test(lower)) extractedLocations.push('delhi');
  if (/\b(india)\b/i.test(lower) && extractedLocations.length === 0) extractedLocations.push('india');

  // 4. Role intent
  const extractedRoles = [];
  if (/\b(java developer|java engineer|java backend|java full stack|spring boot developer|spring developer)\b/i.test(lower)) {
    extractedRoles.push('java developer');
  }
  if (/\b(backend developer|backend engineer|backend)\b/i.test(lower)) {
    extractedRoles.push('backend developer');
  }
  if (/\b(full stack|fullstack|full-stack)\b/i.test(lower)) {
    extractedRoles.push('full stack developer');
  }
  if (/\b(software engineer|software developer|sde)\b/i.test(lower)) {
    extractedRoles.push('software engineer');
  }
  if (/\b(python developer|python engineer)\b/i.test(lower)) {
    extractedRoles.push('python developer');
  }
  if (/\b(ai engineer|machine learning|ml engineer|ai developer|computer vision)\b/i.test(lower)) {
    extractedRoles.push('ai engineer');
  }

  // 5. Skills intent
  const extractedSkills = [];
  const skillKeywords = [
    'java', 'spring boot', 'spring', 'hibernate', 'jpa', 'react', 'node', 'express',
    'python', 'sql', 'mysql', 'postgresql', 'postgis', 'rest apis', 'opencv', 'fastapi',
    'docker', 'aws', 'git', 'javascript', 'typescript'
  ];
  for (const sk of skillKeywords) {
    const rx = new RegExp(`\\b${sk.replace('+', '\\+')}\\b`, 'i');
    if (rx.test(lower)) {
      extractedSkills.push(sk);
    }
  }

  // Extract residual non-stopword tokens (e.g. company names like cisco, paypal)
  const stopWords = new Set([
    'mca', 'btech', 'bca', 'fresher', 'freshers', 'entry', 'level', 'graduate', 'trainee',
    'junior', 'associate', 'intern', 'internship', 'developer', 'engineer', 'software',
    'bengaluru', 'bangalore', 'remote', 'india', 'pune', 'hyderabad', 'chennai', 'mumbai',
    'in', 'at', 'for', 'with', 'and', 'jobs', 'roles', '0', '1', '2', 'years', 'yrs'
  ]);
  const residualTokens = lower
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length > 2 && !stopWords.has(w) && !skillKeywords.includes(w));

  return {
    rawQuery: query,
    hasCriteria: extractedRoles.length > 0 || extractedSkills.length > 0 || extractedLocations.length > 0 || isFresher || extractedDegrees.length > 0,
    extractedRoles,
    extractedSkills,
    extractedLocations,
    isFresher,
    experienceMin: expMin,
    experienceMax: expMax,
    extractedDegrees,
    isRemote: extractedLocations.includes('remote'),
    residualTokens
  };
}

/**
 * Executes unified multi-criteria search across the database vault.
 */
/**
 * Classifies a job's geographic region and India-candidate eligibility honestly.
 * Never assumes "worldwide remote" automatically permits applicants in India.
 */
export function classifyLocationRegion(job) {
  const loc = `${job.location || ''}`.toLowerCase();
  const desc = `${job.description || ''}`.toLowerCase();
  const workMode = `${job.work_mode || ''}`.toLowerCase();
  const combined = `${loc} ${desc}`;

  const isIndiaLoc = /\b(india|bengaluru|bangalore|hyderabad|pune|chennai|mumbai|delhi|ncr|noida|gurugram|gurgaon|kolkata|ahmedabad|karnataka|maharashtra|telangana|tamil nadu)\b/i.test(loc);
  const isRemote = workMode === 'remote' || /\b(remote|work from home|wfh|distributed|anywhere)\b/i.test(loc);

  let country = 'Unknown';
  if (isIndiaLoc) country = 'India';
  else if (/\b(united states|usa|u\.s\.|san francisco|new york|austin|seattle|california|texas)\b/i.test(loc)) country = 'United States';
  else if (/\b(dubai|uae|abu dhabi|united arab emirates)\b/i.test(loc)) country = 'UAE';
  else if (/\b(united kingdom|uk|london|manchester)\b/i.test(loc)) country = 'United Kingdom';
  else if (/\b(germany|berlin|munich|netherlands|amsterdam|europe|eu|france|paris|ireland|dublin)\b/i.test(loc)) country = 'Europe';
  else if (/\b(singapore)\b/i.test(loc)) country = 'Singapore';
  else if (/\b(canada|toronto|vancouver)\b/i.test(loc)) country = 'Canada';
  else if (/\b(australia|sydney|melbourne)\b/i.test(loc)) country = 'Australia';
  else if (/\b(global|worldwide|anywhere)\b/i.test(loc)) country = 'Worldwide';

  let locationRegion = 'india';
  if (isIndiaLoc && isRemote) {
    locationRegion = 'remote_india';
  } else if (isIndiaLoc) {
    locationRegion = 'india';
  } else if (isRemote && (country === 'Worldwide' || /\b(worldwide|global|anywhere)\b/i.test(combined))) {
    locationRegion = 'worldwide_remote';
  } else if (country !== 'India' && country !== 'Unknown') {
    locationRegion = 'international';
  } else if (isRemote) {
    locationRegion = 'worldwide_remote';
  }

  // Country eligibility & visa/sponsorship/relocation extraction
  let countryEligibility = 'unknown';
  const mentionsIndiaEligible = /\b(india|remote[\s-]+india|apac|global remote)\b/i.test(combined) && !/\b(us only|u\.s\. only|must reside in the us|united states only|eu only|uk only)\b/i.test(combined);
  const mentionsRestricted = /\b(us only|u\.s\. only|us citizen|green card|must reside in (?:the )?(?:us|usa|uk|eu|europe|canada)|right to work in (?:the )?(?:uk|eu)|authorized to work in the u\.s\.|no visa sponsorship)\b/i.test(combined);
  const sponsorship = /\b(visa sponsorship|sponsor visa|h1b|relocation assistance|visa support)\b/i.test(combined)
    ? (/\bno visa sponsorship|without sponsorship\b/i.test(combined) ? 'Not Sponsored' : 'Mentioned')
    : 'Unknown';
  const relocation = /\b(relocation|relocate)\b/i.test(combined) ? 'Mentioned' : 'Unknown';

  if (isIndiaLoc) {
    countryEligibility = 'india_eligible';
  } else if (mentionsRestricted) {
    countryEligibility = 'restricted_other_country';
  } else if (sponsorship === 'Mentioned') {
    countryEligibility = 'sponsorship_possible';
  } else if (locationRegion === 'worldwide_remote' && mentionsIndiaEligible) {
    countryEligibility = 'unknown'; // Worldwide remote without explicit India entity confirmation stays cautious
  }

  return {
    country,
    locationRegion,
    countryEligibility,
    sponsorship,
    relocation
  };
}

export function executeUnifiedSearch(criteria = {}) {
  const db = getDatabase();

  const {
    q = '',
    title = '',
    keywords = [],
    skills = [],
    company = '',
    location = 'all', // string or array
    excludedKeywords = [],
    fresherOnly = false,
    experience = 'any', // 'fresher' | '0-1' | '0-2' | '1-3' | 'any'
    datePosted = 'all', // '24h' | '3d' | '7d' | '15d' | '30d' | 'all'
    workMode = 'all', // 'remote' | 'hybrid' | 'onsite' | 'all'
    employmentType = 'all', // 'full_time' | 'internship' | 'contract' | 'all'
    salary = 'any', // 'any' | 'with_salary'
    degree = 'all', // 'all' | 'mca' | 'btech' | 'eligible_only'
    source = 'all', // source slug or id from sourceRegistry
    minScore = 0,
    eligibility = 'all', // 'all' | 'eligible' | 'review' | 'ineligible'
    priority = 'all', // 'all' | 'p1' | 'p2' | 'p3' | 'p4' | 'disqualified'
    status = 'all', // 'all' | 'discovered' | 'saved' | 'ready_to_apply' | 'applied'
    excludeExpired = true,
    excludeApplied = false,
    excludeSaved = false,
    excludeDismissed = true,
    excludeDuplicates = true,
    excludeNonMatching = false,
    locationRegion = 'all', // 'all' | 'india' | 'remote_india' | 'worldwide_remote' | 'international'
    sort = 'relevance', // 'relevance' | 'newest' | 'match_score'
    limit = 500,
    offset = 0
  } = criteria;

  // Retrieve raw candidate listings with evaluation join
  const rawRows = db.prepare(`
    SELECT 
      j.id, j.external_slug, j.source, j.title, j.company, j.location, j.url, j.canonical_url,
      j.description, j.salary, j.posted_at, j.experience_min, j.experience_max, j.status,
      j.last_verified_at, j.verification_status, j.verification_reason, j.work_mode,
      j.employment_type, j.required_skills, j.preferred_skills, j.source_confidence,
      j.completeness_score, j.created_at, j.updated_at,
      e.score, e.rating, e.recommendation, e.fresher_eligible, e.summary_reason,
      e.skills_matched, e.skills_missing, e.seniority_score, e.skills_score,
      e.location_score, e.role_score,
      a.id as application_id, a.status as application_status, a.applied_date
    FROM jobs j
    LEFT JOIN job_evaluations e ON j.id = e.job_id
    LEFT JOIN applications a ON j.id = a.job_id
    ORDER BY j.id DESC
  `).all();

  // Normalize search parameters (supports multi-query via comma/semicolon separation)
  const subQueries = (q || '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
  const parsedSubQueries = subQueries.length > 1
    ? subQueries.map(sq => ({
      raw: sq,
      parsedNl: parseNaturalLanguageQuery(sq),
      tokens: sq.toLowerCase().split(/\s+/).filter(Boolean)
    }))
    : null;
  const parsedNl = parseNaturalLanguageQuery(q);
  const generalQueryTokens = (q || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  const titleFilter = (title || '').toLowerCase().trim();
  const companyFilter = (company || '').toLowerCase().trim();

  const skillFilters = (Array.isArray(skills) ? skills : (skills ? [skills] : []))
    .map(s => String(s).toLowerCase().trim())
    .filter(Boolean);

  const keywordFilters = (Array.isArray(keywords) ? keywords : (keywords ? [keywords] : []))
    .map(k => String(k).toLowerCase().trim())
    .filter(Boolean);

  const excludeFilterTokens = (Array.isArray(excludedKeywords)
    ? excludedKeywords
    : String(excludedKeywords).split(/[,;|\s]+/))
    .map(k => String(k).toLowerCase().trim())
    .filter(Boolean);

  const locationsList = (Array.isArray(location) ? location : [location])
    .map(l => String(l).toLowerCase().trim())
    .filter(Boolean);

  const now = Date.now();

  let expiredExcludedCount = 0;
  const filteredRaw = [];

  // 1. Initial Filtering Pass
  for (const row of rawRows) {
    // Parse JSON skills
    let matchedSkillsList = [];
    let missingSkillsList = [];
    try {
      matchedSkillsList = typeof row.skills_matched === 'string' ? JSON.parse(row.skills_matched) : (row.skills_matched || []);
      missingSkillsList = typeof row.skills_missing === 'string' ? JSON.parse(row.skills_missing) : (row.skills_missing || []);
    } catch {
      matchedSkillsList = [];
      missingSkillsList = [];
    }

    // Phase 12: Evidence-Based Job Quality & Dynamic Prioritization Evaluation
    const fit = evaluateJobFit({
      ...row,
      skills_matched: matchedSkillsList,
      skills_missing: missingSkillsList
    });

    const isExpired = (
      row.status === 'expired' ||
      row.verification_status === 'expired' ||
      row.recommendation === 'EXPIRED' ||
      classifyFreshness(row) === FRESHNESS_STATUSES.EXPIRED
    );

    const geoInfo = classifyLocationRegion(row);

    const job = {
      ...row,
      ...geoInfo,
      score: row.score !== null && row.score !== undefined ? row.score : fit.score,
      rating: row.rating !== null && row.rating !== undefined ? row.rating : fit.rating,
      recommendation: row.recommendation || fit.recommendation,
      fresher_eligible: row.fresher_eligible !== null && row.fresher_eligible !== undefined ? row.fresher_eligible : fit.fresherEligible,
      summary_reason: row.summary_reason || fit.summaryReason,
      skills_matched: matchedSkillsList.length > 0 ? matchedSkillsList : fit.matchedSkills,
      skills_missing: missingSkillsList.length > 0 ? missingSkillsList : fit.missingSkills,
      freshnessStatus: classifyFreshness(row),
      // Phase 12 Quality & Prioritization Fields
      jobEligibility: fit.jobEligibility,
      jobEligibilityReason: fit.jobEligibilityReason,
      isConfirmedEligible: fit.isConfirmedEligible,
      priorityTier: fit.priorityTier,
      priorityCode: fit.priorityCode,
      priorityRank: fit.priorityRank,
      priorityBadgeColor: fit.priorityBadgeColor,
      priorityBadgeIcon: fit.priorityBadgeIcon,
      priorityReasons: fit.priorityReasons,
      qualityScore: fit.qualityScore,
      authenticityTier: fit.authenticityTier,
      qualityFlags: fit.qualityFlags,
      whyMatches: fit.whyMatches,
      concerns: fit.concerns,
      evidenceBreakdown: fit.evidenceBreakdown,
      jobQualityScore: fit.jobQualityScore,
      alreadySubmitted: Boolean(
        row.status === 'applied' ||
        ['submitted', 'applied', 'user_submitted', 'interview', 'offer'].includes((row.application_status || '').toLowerCase())
      )
    };

    if (isExpired) {
      job.priorityCode = 'DISQUALIFIED';
      job.priorityTier = PRIORITY_TIERS.DISQUALIFIED;
      job.priorityRank = 5;
    }

    // Exclude expired jobs if requested
    if (excludeExpired && isExpired) {
      expiredExcludedCount++;
      continue;
    }

    // Exclude applied jobs
    if (excludeApplied && job.alreadySubmitted) {
      continue;
    }

    // Exclude saved jobs
    if (excludeSaved && job.status === 'saved') {
      continue;
    }

    // Exclude dismissed jobs
    if (excludeDismissed && job.status === 'dismissed') {
      continue;
    }

    // Exclude non-matching / disqualified jobs when requested
    if (excludeNonMatching && (
      job.priorityCode === 'DISQUALIFIED' ||
      job.recommendation === 'REJECTED' ||
      (job.score || 0) < 35
    )) {
      continue;
    }

    // Location Region filter (India / Remote India / Worldwide Remote / International)
    if (locationRegion && locationRegion !== 'all' && job.locationRegion !== locationRegion) {
      continue;
    }

    // Status filter
    if (status !== 'all' && job.status !== status) {
      continue;
    }

    // Priority filter (Phase 12)
    if (priority !== 'all') {
      const pNeedle = priority.toLowerCase().trim();
      const jPriority = (job.priorityCode || '').toLowerCase();
      if (pNeedle === 'p1' && jPriority !== 'p1') continue;
      if (pNeedle === 'p2' && jPriority !== 'p2') continue;
      if (pNeedle === 'p3' && jPriority !== 'p3') continue;
      if (pNeedle === 'p4' && jPriority !== 'p4') continue;
      if (pNeedle === 'disqualified' && jPriority !== 'disqualified') continue;
    }

    // Source filter
    if (source !== 'all') {
      const sourceDef = resolveSource(source);
      const jobSourceDef = resolveSource(job.source);
      if (sourceDef.id !== jobSourceDef.id) {
        continue;
      }
    }

    // Work mode filter
    if (workMode !== 'all') {
      const jWp = (job.work_mode || 'onsite').toLowerCase();
      if (jWp !== workMode.toLowerCase()) {
        continue;
      }
    }

    // Employment type filter
    if (employmentType !== 'all') {
      const jEmp = (job.employment_type || 'full_time').toLowerCase();
      if (jEmp !== employmentType.toLowerCase()) {
        continue;
      }
    }

    // Salary filter
    if (salary === 'with_salary' && (!job.salary || job.salary === 'null' || job.salary === '')) {
      continue;
    }

    // Min Score
    if (minScore > 0 && (job.score || 0) < minScore) {
      continue;
    }

    // Eligibility filter
    if (eligibility === 'eligible' && job.fresher_eligible !== 1) {
      continue;
    } else if (eligibility === 'review' && (job.score < 45 || job.score >= 65 || job.fresher_eligible !== 1)) {
      continue;
    } else if (eligibility === 'ineligible' && job.fresher_eligible === 1) {
      continue;
    }

    // Experience filter
    const expMin = job.experience_min !== null && job.experience_min !== undefined ? Number(job.experience_min) : null;
    const expMax = job.experience_max !== null && job.experience_max !== undefined ? Number(job.experience_max) : null;

    if (fresherOnly || experience === 'fresher') {
      if (job.fresher_eligible !== 1) continue;
      if (expMin !== null && expMin > 1) continue;
    } else if (experience === '0-1') {
      if (expMin !== null && expMin > 1) continue;
    } else if (experience === '0-2') {
      if (expMin !== null && expMin > 2) continue;
    } else if (experience === '1-3') {
      if (expMin !== null && (expMin < 1 || expMin > 3)) continue;
    }

    // Date Posted filter
    if (datePosted !== 'all') {
      const postDateMs = job.posted_at ? new Date(job.posted_at).getTime() : (job.created_at ? new Date(job.created_at).getTime() : 0);
      if (postDateMs > 0) {
        const diffHours = (now - postDateMs) / (1000 * 60 * 60);
        if (datePosted === '24h' && diffHours > 24) continue;
        if (datePosted === '3d' && diffHours > 72) continue;
        if (datePosted === '7d' && diffHours > 168) continue;
        if (datePosted === '15d' && diffHours > 360) continue;
        if (datePosted === '30d' && diffHours > 720) continue;
      }
    }

    // Degree requirement filter
    if (degree !== 'all') {
      const summaryText = (job.summary_reason || '').toLowerCase();
      if (degree === 'mca') {
        const mcaAcceptable = summaryText.includes('mca') || !summaryText.includes('strictly requires b.tech');
        if (!mcaAcceptable) continue;
      } else if (degree === 'btech') {
        if (!summaryText.includes('b.tech') && !summaryText.includes('engineering')) continue;
      } else if (degree === 'eligible_only') {
        if (summaryText.includes('strictly requires b.tech') || job.fresher_eligible !== 1) continue;
      }
    }

    // Company filter
    if (companyFilter) {
      const jComp = (job.company || '').toLowerCase();
      if (!jComp.includes(companyFilter)) continue;
    }

    // Title filter with smart semantic expansion (Phase 12)
    if (titleFilter) {
      const jTitle = (job.title || '').toLowerCase();
      const variants = expandSmartRoleTerms(titleFilter);
      const matchesTitle = variants.some(v => jTitle.includes(v));
      if (!matchesTitle) continue;
    }

    // Location filter (handles multi-location array)
    if (locationsList.length > 0 && !locationsList.includes('all')) {
      const jLoc = (job.location || '').toLowerCase();
      const jWp = (job.work_mode || '').toLowerCase();

      const matchesAnyLocation = locationsList.some(locNeedle => {
        if (locNeedle === 'bengaluru' || locNeedle === 'bangalore') {
          return jLoc.includes('bengaluru') || jLoc.includes('bangalore') || jLoc.includes('karnataka') || jLoc.includes('blr') || jLoc.includes('whitefield') || jLoc.includes('electronic city');
        }
        if (locNeedle === 'remote') {
          return jLoc.includes('remote') || jWp === 'remote';
        }
        return jLoc.includes(locNeedle);
      });

      if (!matchesAnyLocation) continue;
    }

    // Excluded keywords filter (title & description)
    if (excludeFilterTokens.length > 0) {
      const scanCorpus = `${job.title || ''} ${job.description || ''} ${job.summary_reason || ''}`.toLowerCase();
      const hasExcluded = excludeFilterTokens.some(token => {
        const rx = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i');
        return rx.test(scanCorpus);
      });
      if (hasExcluded) continue;
    }

    // Skills filter
    if (skillFilters.length > 0) {
      const combinedSkills = [
        ...(job.skills_matched || []),
        ...(job.skills_missing || []),
        job.description || '',
        job.title || ''
      ].join(' ').toLowerCase();

      const matchesAllSkills = skillFilters.every(sNeedle => combinedSkills.includes(sNeedle));
      if (!matchesAllSkills) continue;
    }

    // Keywords filter
    if (keywordFilters.length > 0) {
      const scanCorpus = `${job.title || ''} ${job.company || ''} ${job.description || ''} ${job.location || ''}`.toLowerCase();
      const matchesAllKeywords = keywordFilters.every(kNeedle => scanCorpus.includes(kNeedle));
      if (!matchesAllKeywords) continue;
    }

    // Natural Language Query Intelligence & Multi-Query Matching
    const matchesSingleQuery = (sqParsedNl, sqTokens) => {
      const fullText = [
        job.title || '',
        job.company || '',
        job.location || '',
        job.description || '',
        job.summary_reason || '',
        job.work_mode || '',
        job.source || '',
        job.fresher_eligible ? 'fresher entry-level trainee 2026 entry level graduate' : '',
        ...(job.skills_matched || []),
        ...(job.skills_missing || [])
      ].join(' ').toLowerCase();

      if (sqParsedNl.hasCriteria) {
        if (sqParsedNl.isFresher && job.fresher_eligible !== 1 && expMin !== null && expMin > 1) {
          return false;
        }
        if (sqParsedNl.extractedDegrees.includes('mca')) {
          const summaryText = (job.summary_reason || '').toLowerCase();
          if (summaryText.includes('strictly requires b.tech') && !summaryText.includes('mca')) {
            return false;
          }
        }
        if (sqParsedNl.extractedLocations.length > 0 && !locationsList.length) {
          const jLoc = (job.location || '').toLowerCase();
          const jWp = (job.work_mode || '').toLowerCase();
          const locMatch = sqParsedNl.extractedLocations.some(l => {
            if (l === 'bengaluru') return jLoc.includes('bengaluru') || jLoc.includes('bangalore') || jLoc.includes('karnataka') || jLoc.includes('blr') || jWp === 'remote';
            if (l === 'remote') return jLoc.includes('remote') || jWp === 'remote';
            return jLoc.includes(l);
          });
          if (!locMatch) return false;
        }
        if (sqParsedNl.extractedRoles.length > 0 || sqParsedNl.extractedSkills.length > 0) {
          const roleMatch = sqParsedNl.extractedRoles.some(r => {
            const variants = expandSmartRoleTerms(r);
            return variants.some(v => fullText.includes(v));
          });
          const skillMatch = sqParsedNl.extractedSkills.some(s => fullText.includes(s));
          if (!roleMatch && !skillMatch) return false;
        }
        if (sqParsedNl.residualTokens && sqParsedNl.residualTokens.length > 0) {
          const residualMatch = sqParsedNl.residualTokens.every(tok => fullText.includes(tok));
          if (!residualMatch) return false;
        }
        return true;
      } else if (sqTokens.length > 0) {
        return sqTokens.every(token => fullText.includes(token));
      }
      return true;
    };

    if (parsedSubQueries) {
      const anyMatched = parsedSubQueries.some(sq => matchesSingleQuery(sq.parsedNl, sq.tokens));
      if (!anyMatched) continue;
    } else if (parsedNl.hasCriteria || generalQueryTokens.length > 0) {
      if (!matchesSingleQuery(parsedNl, generalQueryTokens)) continue;
    }

    filteredRaw.push(job);
  }

  // 2. Accurate Search Summary Metrics Generation (from filteredRaw)
  const totalSourceResults = filteredRaw.length;

  // Calculate source distribution for tabs
  const sourceCounts = {};
  for (const src of SOURCES) {
    sourceCounts[src.id] = 0;
  }
  for (const j of filteredRaw) {
    const sDef = resolveSource(j.source);
    sourceCounts[sDef.id] = (sourceCounts[sDef.id] || 0) + 1;
    sourceCounts.all = (sourceCounts.all || 0) + 1;
  }

  // 3. Cross-Source Deduplication Pass
  const dedupEntries = [];
  const duplicateRemovedList = [];

  for (const job of filteredRaw) {
    const canonical = normalizeCanonicalUrl(job.url || job.canonical_url || '');
    const city = (job.location || '').split(',')[0].trim().toLowerCase();
    const titleNorm = (job.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const compNorm = (job.company || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

    let matchedGroup = null;

    // 1. Check exact canonical URL match
    if (canonical && !canonical.includes('javascript') && canonical.length > 15) {
      for (const entry of dedupEntries) {
        const entryCanonical = normalizeCanonicalUrl(entry.primaryJob.url || entry.primaryJob.canonical_url || '');
        if (entryCanonical === canonical) {
          matchedGroup = entry;
          break;
        }
      }
    }

    // 2. Check company + title + location match
    if (!matchedGroup && compNorm && titleNorm) {
      for (const entry of dedupEntries) {
        const eComp = (entry.primaryJob.company || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const eTitle = (entry.primaryJob.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const eCity = (entry.primaryJob.location || '').split(',')[0].trim().toLowerCase();

        if (eComp === compNorm && eTitle === titleNorm && (eCity === city || !city || !eCity)) {
          const entrySource = resolveSource(entry.primaryJob.source).id;
          const currentSource = resolveSource(job.source).id;

          // If from the SAME source, check if they are separate openings
          if (entrySource === currentSource) {
            const entryUrl = (entry.primaryJob.url || '').trim();
            const currentUrl = (job.url || '').trim();
            if (entryUrl !== currentUrl) {
              // Same source with different URLs -> separate distinct requisitions
              continue;
            }
          }

          // If both have ATS IDs from the same ATS portal type and they differ, they are separate requisitions
          const entryAtsId = extractAtsJobId(entry.primaryJob.url || '');
          const curAtsId = extractAtsJobId(job.url || '');
          if (curAtsId && entryAtsId) {
            const curPortal = curAtsId.split('-')[0];
            const entryPortal = entryAtsId.split('-')[0];
            const curRawId = curAtsId.slice(curPortal.length + 1);
            const entryRawId = entryAtsId.slice(entryPortal.length + 1);

            if (curPortal === entryPortal && curAtsId !== entryAtsId) {
              // Same ATS portal (e.g. Lever) with distinct requisition IDs -> separate openings
              continue;
            } else if (curRawId && entryRawId && curRawId !== entryRawId && curPortal !== 'ats' && entryPortal !== 'ats') {
              // Distinct explicit ATS IDs on different verified portals
              continue;
            }
          }

          matchedGroup = entry;
          break;
        }
      }
    }

    if (!matchedGroup) {
      dedupEntries.push({
        primaryJob: {
          ...job,
          alternateSources: []
        },
        allListings: [job]
      });
    } else {
      matchedGroup.allListings.push(job);

      // Primary election criteria: prefer higher source_confidence, then higher score, then newer date
      const curPrimary = matchedGroup.primaryJob;
      const curConf = curPrimary.source_confidence || 0.7;
      const newConf = job.source_confidence || 0.7;

      const altRecord = {
        id: job.id,
        source: job.source,
        sourceName: resolveSource(job.source).name,
        url: job.url,
        externalSlug: job.external_slug,
        postedAt: job.posted_at
      };

      if (newConf > curConf || (newConf === curConf && (job.score || 0) > (curPrimary.score || 0))) {
        // Promote new job to primary, push old to alternate
        const oldAlt = {
          id: curPrimary.id,
          source: curPrimary.source,
          sourceName: resolveSource(curPrimary.source).name,
          url: curPrimary.url,
          externalSlug: curPrimary.external_slug,
          postedAt: curPrimary.posted_at
        };
        curPrimary.alternateSources.push(oldAlt);
        job.alternateSources = [...curPrimary.alternateSources];
        matchedGroup.primaryJob = job;
      } else {
        curPrimary.alternateSources.push(altRecord);
      }
      duplicateRemovedList.push(job);
    }
  }

  // Final deduplicated list or raw list based on criteria
  const finalResults = excludeDuplicates
    ? dedupEntries.map(e => e.primaryJob)
    : filteredRaw;

  const uniqueResults = finalResults.length;
  const duplicateResultsRemoved = totalSourceResults - uniqueResults;

  // Compute metric breakdowns on finalResults
  let freshResultsCount = 0;
  let strongMatchesCount = 0;
  let eligibleRolesCount = 0;
  let reviewRequiredCount = 0;

  // Phase 12 Quality & Prioritization Metrics
  const priorityCounts = { p1: 0, p2: 0, p3: 0, p4: 0, disqualified: 0 };
  const eligibilityCounts = { eligible: 0, likely_eligible: 0, uncertain: 0, not_eligible: 0 };
  const qualityFlagsCounts = {
    expired: 0,
    closed: 0,
    talent_pool: 0,
    excessive_experience: 0,
    unclear_employer: 0,
    unpaid_internship: 0,
    duplicate: 0
  };

  for (const j of finalResults) {
    if (j.freshnessStatus === FRESHNESS_STATUSES.VERIFIED_ACTIVE || j.freshnessStatus === FRESHNESS_STATUSES.RECENTLY_POSTED) {
      freshResultsCount++;
    }
    if ((j.score || 0) >= 90) {
      strongMatchesCount++;
    }
    if (j.fresher_eligible === 1) {
      eligibleRolesCount++;
    }
    if ((j.score || 0) >= 45 && (j.score || 0) < 65) {
      reviewRequiredCount++;
    }

    // Tally Priority
    const pCode = (j.priorityCode || 'P3').toLowerCase();
    if (priorityCounts[pCode] !== undefined) {
      priorityCounts[pCode]++;
    }

    // Tally Eligibility
    const eTier = (j.jobEligibility || 'UNCERTAIN').toLowerCase();
    if (eligibilityCounts[eTier] !== undefined) {
      eligibilityCounts[eTier]++;
    }

    // Tally Flags
    for (const flag of (j.qualityFlags || [])) {
      const fKey = flag.toLowerCase();
      if (qualityFlagsCounts[fKey] !== undefined) {
        qualityFlagsCounts[fKey]++;
      }
    }
  }

  // 4. Query Relevance & Sorting Pass
  if (parsedNl.hasCriteria) {
    for (const j of finalResults) {
      let qRelevance = 0;
      const jTitle = (j.title || '').toLowerCase();
      const jLoc = (j.location || '').toLowerCase();
      // Title role match
      if (parsedNl.extractedRoles.some(r => jTitle.includes(r))) qRelevance += 25;
      // Skills matched count
      const matchedSkillHits = (parsedNl.extractedSkills || []).filter(s => (j.skills_matched || []).some(m => String(m).toLowerCase().includes(s)));
      qRelevance += matchedSkillHits.length * 10;
      // Fresher bonus
      if (parsedNl.isFresher && j.fresher_eligible === 1) qRelevance += 15;
      // Location bonus
      if (parsedNl.extractedLocations.some(l => jLoc.includes(l))) qRelevance += 15;
      j.queryRelevance = qRelevance;
    }
  }

  if (sort === 'newest') {
    finalResults.sort((a, b) => {
      const dateA = a.posted_at ? new Date(a.posted_at).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0);
      const dateB = b.posted_at ? new Date(b.posted_at).getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0);
      return dateB - dateA;
    });
  } else if (sort === 'match_score') {
    finalResults.sort((a, b) => (b.score || 0) - (a.score || 0));
  } else {
    // Relevance sort: query relevance + composite score + recency + source confidence
    finalResults.sort((a, b) => {
      if (parsedNl.hasCriteria) {
        const qDiff = (b.queryRelevance || 0) - (a.queryRelevance || 0);
        if (Math.abs(qDiff) > 5) return qDiff;
      }
      const scoreDiff = (b.score || 0) - (a.score || 0);
      if (Math.abs(scoreDiff) > 5) return scoreDiff;
      const confDiff = (b.source_confidence || 0.7) - (a.source_confidence || 0.7);
      if (confDiff !== 0) return confDiff > 0 ? 1 : -1;
      const dateA = a.posted_at ? new Date(a.posted_at).getTime() : 0;
      const dateB = b.posted_at ? new Date(b.posted_at).getTime() : 0;
      return dateB - dateA;
    });
  }

  // 5. Pagination
  const paginatedResults = finalResults.slice(offset, offset + limit);

  // Generate external assisted links for restricted portals
  const primarySearchTerm = q || title || 'Java Developer';
  const primaryLocation = Array.isArray(location) ? location[0] : (location !== 'all' ? location : 'Bengaluru');
  const assistedLinks = generateAssistedSearchLinks(primarySearchTerm, primaryLocation, { fresherOnly });
  const googleSearchLinks = generateGoogleSearchLinks(primarySearchTerm, primaryLocation, { fresherOnly });

  return {
    results: paginatedResults,
    pagination: {
      total: finalResults.length,
      limit,
      offset,
      hasMore: offset + limit < finalResults.length
    },
    googleSearchLinks,
    summary: {
      totalSourceResults,
      uniqueResults,
      duplicateResultsRemoved,
      freshResults: freshResultsCount,
      strongMatches: strongMatchesCount,
      eligibleRoles: eligibleRolesCount,
      reviewRequired: reviewRequiredCount,
      expiredExcluded: expiredExcludedCount,
      sourceCounts,
      priorityCounts,
      eligibilityCounts,
      qualityFlagsCounts
    },
    sourcesStatus: SOURCES.map(s => ({
      id: s.id,
      name: s.name,
      tier: s.tier,
      status: s.status,
      statusLabel: s.statusLabel,
      badgeColor: s.badgeColor,
      icon: s.icon,
      count: sourceCounts[s.id] || 0,
      description: s.description,
      supportsDirectIngestion: s.supportsDirectIngestion,
      legalPolicy: s.legalPolicy
    })),
    assistedLinks,
    queryDetails: {
      q,
      title,
      company,
      location,
      skills: skillFilters,
      keywords: keywordFilters,
      excludedKeywords: excludeFilterTokens,
      fresherOnly,
      experience,
      datePosted,
      workMode,
      employmentType,
      salary,
      degree,
      source,
      minScore,
      priority,
      sort
    }
  };
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
