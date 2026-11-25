/**
 * CareerOS Phase 12 — Job Quality Intelligence & Smart Prioritization
 * 
 * Provides evidence-based quality assessment, low-quality listing detection,
 * 4-tier eligibility classification, 5-tier smart prioritization, and
 * transparent explainable recommendation breakdowns for Abhishek N's MCA profile.
 */

import { DEGREE_CLASSIFICATIONS } from './degreeClassifier.js';

export const ELIGIBILITY_TIERS = Object.freeze({
  ELIGIBLE: 'ELIGIBLE',
  LIKELY_ELIGIBLE: 'LIKELY_ELIGIBLE',
  UNCERTAIN: 'UNCERTAIN',
  NOT_ELIGIBLE: 'NOT_ELIGIBLE'
});

export const PRIORITY_TIERS = Object.freeze({
  PRIORITY_1: 'PRIORITY 1 — APPLY FIRST',
  PRIORITY_2: 'PRIORITY 2 — STRONG MATCH',
  PRIORITY_3: 'PRIORITY 3 — REVIEW',
  PRIORITY_4: 'PRIORITY 4 — LOW PRIORITY',
  DISQUALIFIED: 'DO NOT APPLY — DISQUALIFIED'
});

export const LOW_QUALITY_FLAGS = Object.freeze({
  EXPIRED: 'EXPIRED',
  CLOSED: 'CLOSED',
  TALENT_POOL: 'TALENT_POOL',
  EXCESSIVE_EXPERIENCE: 'EXCESSIVE_EXPERIENCE',
  UNPAID_INTERNSHIP: 'UNPAID_INTERNSHIP',
  UNCLEAR_EMPLOYER: 'UNCLEAR_EMPLOYER',
  MINIMAL_DESCRIPTION: 'MINIMAL_DESCRIPTION',
  GENERIC_ADVERTISEMENT: 'GENERIC_ADVERTISEMENT',
  STRICT_BTECH_EXCLUSION: 'STRICT_BTECH_EXCLUSION',
  DUPLICATE: 'DUPLICATE'
});

/**
 * Detects low-quality, expired, closed, generic talent-pool, or suspicious job listings.
 * 
 * @param {object} job - Job record
 * @returns {object} Quality assessment details
 */
export function detectListingQuality(job = {}) {
  const flags = [];
  const reasons = [];

  const title = (job.title || '').trim();
  const titleLower = title.toLowerCase();
  const desc = (job.description || '').trim();
  const descLower = desc.toLowerCase();
  const company = (job.company || '').trim();
  const compLower = company.toLowerCase();
  const status = (job.status || '').toLowerCase();
  const verifStatus = (job.verification_status || '').toLowerCase();
  const verifReason = (job.verification_reason || '').toLowerCase();

  // 1. Expired or Closed positions
  const isExpired = (
    status === 'expired' ||
    verifStatus === 'expired' ||
    verifReason.includes('expired') ||
    /\b(job expired|posting has expired|this job is no longer available)\b/i.test(descLower)
  );
  if (isExpired) {
    flags.push(LOW_QUALITY_FLAGS.EXPIRED);
    reasons.push('Position is verified expired or listing was removed.');
  }

  const isClosed = (
    verifStatus === 'closed' ||
    verifReason.includes('closed') ||
    /\b(this position has been closed|this position has been filled|no longer accepting applications)\b/i.test(descLower)
  );
  if (isClosed) {
    flags.push(LOW_QUALITY_FLAGS.CLOSED);
    reasons.push('Position is confirmed closed and not accepting applications.');
  }

  // 2. Duplicate Listings
  const isDuplicate = (
    job.is_duplicate === 1 ||
    job.is_duplicate === true ||
    Boolean(job.duplicate_of) ||
    status === 'duplicate'
  );
  if (isDuplicate) {
    flags.push(LOW_QUALITY_FLAGS.DUPLICATE);
    reasons.push('Position is identified as a duplicate listing across discovery sources.');
  }

  // 3. Generic Talent Pool / Ongoing Resume Harvester
  const talentPoolPatterns = [
    /\btalent\s*pool\b/i,
    /\bfuture\s*opportunities\b/i,
    /\bgeneral\s*application\b/i,
    /\bkeep\s*your\s*resume\s*on\s*file\b/i,
    /\bexpression\s*of\s*interest\b/i,
    /\btalent\s*community\b/i,
    /\bongoing\s*pipeline\b/i,
    /\bnot\s*an\s*immediate\s*opening\b/i,
    /\bfor\s*future\s*reference\b/i
  ];
  const isTalentPool = talentPoolPatterns.some(p => p.test(titleLower) || p.test(descLower));
  if (isTalentPool) {
    flags.push(LOW_QUALITY_FLAGS.TALENT_POOL);
    reasons.push('Generic talent-pool notice without an immediate active vacancy.');
  }

  // 3. Excessive Experience (Senior / Lead roles incorrectly matching junior searches)
  const seniorTitles = [
    /\bsenior\b/i, /\blead\b/i, /\bstaff\b/i, /\bprincipal\b/i,
    /\barchitect\b/i, /\bdirector\b/i, /\bhead\s*of\b/i, /\bmanager\b/i, /\bvp\b/i
  ];
  const hasSeniorTitle = seniorTitles.some(p => p.test(titleLower));
  
  const expMin = job.experienceMin !== undefined ? job.experienceMin : (job.experience_min !== undefined ? job.experience_min : null);
  const expMax = job.experienceMax !== undefined ? job.experienceMax : (job.experience_max !== undefined ? job.experience_max : null);

  const expMatch = descLower.match(/(\d+)\s*(?:-|to|\+)\s*(?:\d+)?\s*years?(?:\s*of)?\s*experience/i);
  let parsedDescExpMin = null;
  if (expMatch) {
    parsedDescExpMin = parseInt(expMatch[1], 10);
  }

  const effectiveExpMin = expMin !== null ? expMin : parsedDescExpMin;
  const isExcessiveExperience = hasSeniorTitle || (effectiveExpMin !== null && effectiveExpMin >= 3);

  if (isExcessiveExperience) {
    flags.push(LOW_QUALITY_FLAGS.EXCESSIVE_EXPERIENCE);
    if (hasSeniorTitle) {
      reasons.push(`Title (${title}) requires Senior / Lead seniority, unsuitable for freshers.`);
    } else {
      reasons.push(`Requires ${effectiveExpMin}+ years experience, exceeding candidate fresher threshold (0–2 yrs).`);
    }
  }

  // 4. Unpaid Internships
  const unpaidPatterns = [
    /\bunpaid\s*internship\b/i,
    /\bwithout\s*stipend\b/i,
    /\bno\s*stipend\b/i,
    /\bstipend\s*:\s*(?:unpaid|nil|none|0)\b/i
  ];
  if (unpaidPatterns.some(p => p.test(descLower))) {
    flags.push(LOW_QUALITY_FLAGS.UNPAID_INTERNSHIP);
    reasons.push('Listing indicates an unpaid internship.');
  }

  // 5. Unclear Employer Identity
  const suspiciousCompanyPatterns = [
    /^(confidential|anonymous|client of|reputed|leading mnc|top product company|hiring agency|third party)$/i,
    /\b(confidential client|undisclosed employer|stealth client)\b/i
  ];
  const isUnclearEmployer = !company || suspiciousCompanyPatterns.some(p => p.test(compLower));
  if (isUnclearEmployer) {
    flags.push(LOW_QUALITY_FLAGS.UNCLEAR_EMPLOYER);
    reasons.push('Employer identity is undisclosed or generic third-party agency.');
  }

  // 6. Minimal or Broken Job Description
  if (!desc || desc.length < 50) {
    flags.push(LOW_QUALITY_FLAGS.MINIMAL_DESCRIPTION);
    reasons.push('Job description is sparse or missing detailed responsibilities/skills.');
  }

  // Compute Listing Authenticity Tier
  let authenticityTier = 'VERIFIED_EMPLOYER';
  if (isUnclearEmployer) {
    authenticityTier = 'AGENCY_OR_ANONYMOUS';
  } else if (isTalentPool) {
    authenticityTier = 'TALENT_POOL';
  } else if (['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee'].includes((job.source || '').toLowerCase())) {
    authenticityTier = 'VERIFIED_DIRECT_ATS';
  } else {
    authenticityTier = 'STANDARD_EMPLOYER';
  }

  // Base Quality Score (0 to 10)
  let qualityScore = 10;
  if (isExpired || isClosed) qualityScore -= 10;
  if (isTalentPool) qualityScore -= 5;
  if (isExcessiveExperience) qualityScore -= 4;
  if (isUnclearEmployer) qualityScore -= 3;
  if (desc.length < 50) qualityScore -= 2;
  if (flags.includes(LOW_QUALITY_FLAGS.UNPAID_INTERNSHIP)) qualityScore -= 3;
  qualityScore = Math.max(0, qualityScore);

  return {
    isLowQuality: flags.length > 0 && (isExpired || isClosed || isTalentPool || isExcessiveExperience || isUnclearEmployer),
    flags,
    qualityScore,
    authenticityTier,
    reasons
  };
}

/**
 * Evaluates candidate degree & fresher eligibility into 4 definitive tiers:
 * ELIGIBLE | LIKELY_ELIGIBLE | UNCERTAIN | NOT_ELIGIBLE
 */
export function classifyJobEligibility(job = {}, degreeEval = {}) {
  const desc = (job.description || '').toLowerCase();
  const title = (job.title || '').toLowerCase();

  // 1. Strict Restrictions (Highest Precedence)
  if (degreeEval.isStrictlyIneligible) {
    return {
      tier: ELIGIBILITY_TIERS.NOT_ELIGIBLE,
      reason: `Strict Educational Restriction: Role specifies B.Tech/B.E.-only restriction with no MCA acceptance (${degreeEval.reason}).`,
      isConfirmedEligible: false
    };
  }

  // 2. Senior / High Experience Check
  const expMin = job.experienceMin !== undefined ? job.experienceMin : (job.experience_min !== undefined ? job.experience_min : null);
  if (expMin !== null && expMin > 2) {
    return {
      tier: ELIGIBILITY_TIERS.NOT_ELIGIBLE,
      reason: `Experience Disqualification: Role requires ${expMin}+ years experience. Candidate is a 2026 fresher (0-2 years eligible).`,
      isConfirmedEligible: false
    };
  }

  const seniorRegex = /\b(senior|lead|staff|principal|architect|director|head of)\b/i;
  if (seniorRegex.test(title)) {
    return {
      tier: ELIGIBILITY_TIERS.NOT_ELIGIBLE,
      reason: `Seniority Disqualification: Title "${job.title}" is explicitly a senior or lead position.`,
      isConfirmedEligible: false
    };
  }

  // 3. Explicit MCA Acceptance
  if (degreeEval.classification === DEGREE_CLASSIFICATIONS.MCA_EXPLICIT) {
    return {
      tier: ELIGIBILITY_TIERS.ELIGIBLE,
      reason: 'Education Confirmed: MCA (Master of Computer Applications) is explicitly listed and welcomed.',
      isConfirmedEligible: true
    };
  }

  // 4. Equivalent Degree Accepted
  if (degreeEval.classification === DEGREE_CLASSIFICATIONS.EQUIVALENT_ACCEPTED) {
    return {
      tier: ELIGIBILITY_TIERS.ELIGIBLE,
      reason: 'Education Confirmed: Equivalent CS/IT degrees accepted. Candidate\'s verified MCA matches requirements.',
      isConfirmedEligible: true
    };
  }

  // 5. Positive Fresher / Trainee mentions with non-exclusive degree
  const fresherExplicit = /\b(fresher|2026\s*batch|2026\s*passout|graduate\s*trainee|trainee\s*software|associate\s*software\s*engineer|entry\s*level)\b/i.test(desc) ||
                          /\b(fresher|trainee|entry\s*level|intern)\b/i.test(title);

  if (degreeEval.classification === DEGREE_CLASSIFICATIONS.BTECH_NON_EXCLUSIVE) {
    return {
      tier: ELIGIBILITY_TIERS.LIKELY_ELIGIBLE,
      reason: 'Likely Eligible: B.Tech/B.E. mentioned non-exclusively. Tech startups and IT employers routinely consider MCA candidates.',
      isConfirmedEligible: false
    };
  }

  // 6. Generic or Unstated degree requirements
  if (fresherExplicit) {
    return {
      tier: ELIGIBILITY_TIERS.LIKELY_ELIGIBLE,
      reason: 'Likely Eligible: Role is explicitly entry-level / fresher friendly with general technical degree requirement.',
      isConfirmedEligible: false
    };
  }

  return {
    tier: ELIGIBILITY_TIERS.UNCERTAIN,
    reason: 'Uncertain: Degree criteria not stated in listing. Recommend review before preparing application.',
    isConfirmedEligible: false
  };
}

/**
 * Calculates 5-tier smart prioritization for a job listing.
 * 
 * PRIORITY 1 — APPLY FIRST
 * PRIORITY 2 — STRONG MATCH
 * PRIORITY 3 — REVIEW
 * PRIORITY 4 — LOW PRIORITY
 * DO NOT APPLY — DISQUALIFIED
 */
export function calculateJobPriority(job = {}, evalResult = {}, qualityResult = {}) {
  const reasons = [];
  const flags = qualityResult.flags || [];
  const score = evalResult.score !== undefined ? evalResult.score : 0;
  const eligTier = evalResult.jobEligibility || ELIGIBILITY_TIERS.UNCERTAIN;
  const isExpired = flags.includes(LOW_QUALITY_FLAGS.EXPIRED) || flags.includes(LOW_QUALITY_FLAGS.CLOSED) || (job.status === 'expired');
  const isApplied = (job.application_status && job.application_status !== 'none') || (job.status === 'applied');
  const isDisqualifiedDegree = eligTier === ELIGIBILITY_TIERS.NOT_ELIGIBLE;
  const isExcessiveExp = flags.includes(LOW_QUALITY_FLAGS.EXCESSIVE_EXPERIENCE);
  const isTalentPool = flags.includes(LOW_QUALITY_FLAGS.TALENT_POOL);

  // 1. DISQUALIFIED (Strict Safety Gate)
  const isDuplicate = flags.includes(LOW_QUALITY_FLAGS.DUPLICATE) || job.is_duplicate === 1 || Boolean(job.duplicate_of);
  if (isDuplicate) {
    reasons.push('Position is identified as a duplicate listing across sources.');
    return {
      tier: PRIORITY_TIERS.DISQUALIFIED,
      tierCode: 'DISQUALIFIED',
      priorityRank: 5,
      badgeColor: '#ef4444',
      badgeIcon: '🚫',
      reasons
    };
  }

  if (isExpired) {
    reasons.push('Position is expired or closed. Active applications are prohibited.');
    return {
      tier: PRIORITY_TIERS.DISQUALIFIED,
      tierCode: 'DISQUALIFIED',
      priorityRank: 5,
      badgeColor: '#ef4444',
      badgeIcon: '🚫',
      reasons
    };
  }

  if (isDisqualifiedDegree) {
    reasons.push('Disqualified due to explicit B.Tech exclusivity or non-eligible degree restrictions.');
    return {
      tier: PRIORITY_TIERS.DISQUALIFIED,
      tierCode: 'DISQUALIFIED',
      priorityRank: 5,
      badgeColor: '#ef4444',
      badgeIcon: '🚫',
      reasons
    };
  }

  if (isExcessiveExp) {
    reasons.push('Disqualified due to excessive seniority/experience requirements (3+ yrs or Senior/Lead).');
    return {
      tier: PRIORITY_TIERS.DISQUALIFIED,
      tierCode: 'DISQUALIFIED',
      priorityRank: 5,
      badgeColor: '#ef4444',
      badgeIcon: '🚫',
      reasons
    };
  }

  if (isTalentPool) {
    reasons.push('Disqualified: Generic talent pool without an active requisition.');
    return {
      tier: PRIORITY_TIERS.DISQUALIFIED,
      tierCode: 'DISQUALIFIED',
      priorityRank: 5,
      badgeColor: '#ef4444',
      badgeIcon: '🚫',
      reasons
    };
  }

  // 2. PRIORITY 1 — APPLY FIRST
  // Criteria: Score >= 75, Confirmed or Likely Eligible, Fresh/Active, Top Location, Direct ATS / High Quality, Not already applied
  const isTopLocation = evalResult.breakdown?.locationScore >= 18;
  const isDirectOrHighConfidence = (job.source_confidence || 1.0) >= 0.85;
  const isHighSkillsMatch = evalResult.breakdown?.skillsScore >= 20;

  if (
    score >= 75 &&
    (eligTier === ELIGIBILITY_TIERS.ELIGIBLE || eligTier === ELIGIBILITY_TIERS.LIKELY_ELIGIBLE) &&
    isTopLocation &&
    isHighSkillsMatch &&
    !isApplied &&
    qualityResult.qualityScore >= 8
  ) {
    reasons.push('Outstanding match: Strong alignment with Core Java / Spring Boot stack.');
    reasons.push(eligTier === ELIGIBILITY_TIERS.ELIGIBLE ? 'Verified MCA eligibility confirmed.' : 'Likely MCA acceptance with entry-level scope.');
    reasons.push('Top location fit (Bengaluru or Remote).');
    reasons.push('Direct verified hiring vacancy with high quality score.');

    return {
      tier: PRIORITY_TIERS.PRIORITY_1,
      tierCode: 'P1',
      priorityRank: 1,
      badgeColor: '#10b981',
      badgeIcon: '⚡',
      reasons
    };
  }

  // 3. PRIORITY 2 — STRONG MATCH
  // Criteria: Score >= 65, Eligible or Likely Eligible, not expired
  if (
    score >= 65 &&
    (eligTier === ELIGIBILITY_TIERS.ELIGIBLE || eligTier === ELIGIBILITY_TIERS.LIKELY_ELIGIBLE) &&
    qualityResult.qualityScore >= 6
  ) {
    reasons.push('Strong match: Viable skill resonance with candidate technical background.');
    reasons.push(eligTier === ELIGIBILITY_TIERS.ELIGIBLE ? 'Education confirmed eligible.' : 'Degree requirements compatible.');
    if (isApplied) {
      reasons.push('Note: Application already drafted or submitted in tracking pipeline.');
    }

    return {
      tier: PRIORITY_TIERS.PRIORITY_2,
      tierCode: 'P2',
      priorityRank: 2,
      badgeColor: '#3b82f6',
      badgeIcon: '⭐',
      reasons
    };
  }

  // 4. PRIORITY 3 — REVIEW
  // Criteria: Score 45-64, or Uncertain Eligibility, or minor concerns
  if (score >= 45 || eligTier === ELIGIBILITY_TIERS.UNCERTAIN || qualityResult.qualityScore < 6) {
    if (eligTier === ELIGIBILITY_TIERS.UNCERTAIN) {
      reasons.push('Review required: Degree qualification criteria are ambiguous in JD.');
    }
    if (evalResult.breakdown?.skillsScore < 15) {
      reasons.push('Review required: Partial skills overlap; check mandatory vs preferred requirements.');
    }
    if (qualityResult.flags.includes(LOW_QUALITY_FLAGS.UNCLEAR_EMPLOYER)) {
      reasons.push('Review required: Employer identity is generic or undisclosed.');
    }
    if (reasons.length === 0) {
      reasons.push('Moderate overall fit; manual review recommended before tailoring resume.');
    }

    return {
      tier: PRIORITY_TIERS.PRIORITY_3,
      tierCode: 'P3',
      priorityRank: 3,
      badgeColor: '#f59e0b',
      badgeIcon: '👁',
      reasons
    };
  }

  // 5. PRIORITY 4 — LOW PRIORITY
  // Criteria: Low score (< 45), low technical relevance
  reasons.push('Low technical overlap with verified Java/Spring Boot stack.');
  if (evalResult.breakdown?.locationScore <= 10) {
    reasons.push('Location is outside primary preferred Indian tech corridors.');
  }

  return {
    tier: PRIORITY_TIERS.PRIORITY_4,
    tierCode: 'P4',
    priorityRank: 4,
    badgeColor: '#64748b',
    badgeIcon: '⏳',
    reasons
  };
}

/**
 * Generates transparent, grounded "Why this matches" and "Potential concerns" lists.
 */
export function generateExplainableMatch(job = {}, evalResult = {}, qualityResult = {}) {
  const whyMatches = [];
  const concerns = [];

  // 1. Why it matches
  if (evalResult.matchedSkills && evalResult.matchedSkills.length > 0) {
    whyMatches.push(`Matched Skills: ${evalResult.matchedSkills.join(', ')} directly align with candidate verified stack.`);
  }

  if (evalResult.jobEligibility === ELIGIBILITY_TIERS.ELIGIBLE) {
    whyMatches.push('Degree Compatibility: MCA qualification explicitly accepted.');
  } else if (evalResult.jobEligibility === ELIGIBILITY_TIERS.LIKELY_ELIGIBLE) {
    whyMatches.push('Degree Compatibility: General CS/IT degree requirement is suitable for MCA freshers.');
  }

  const expMin = job.experienceMin !== undefined ? job.experienceMin : (job.experience_min !== undefined ? job.experience_min : null);
  if (expMin === 0 || (job.title && /fresher|trainee|intern|junior/i.test(job.title))) {
    whyMatches.push('Experience Match: Explicitly targeted at freshers / 0–1 year candidates.');
  } else if (expMin !== null && expMin <= 2) {
    whyMatches.push('Experience Match: 0–2 years requirement fits entry-level candidate readiness.');
  }

  const locLower = (job.location || '').toLowerCase();
  if (locLower.includes('bengaluru') || locLower.includes('bangalore') || locLower.includes('karnataka')) {
    whyMatches.push('Location Match: Bengaluru tech hub (Candidate primary preference).');
  } else if (locLower.includes('remote') || (job.work_mode === 'remote')) {
    whyMatches.push('Location Match: Remote opportunity suitable from Bengaluru.');
  }

  if (evalResult.matchedSkills && evalResult.matchedSkills.some(s => ['Java', 'Spring Boot'].includes(s))) {
    whyMatches.push('Project Alignment: Verified MCA projects (Employee Leave Management System & Spatial Query Engine) demonstrate hands-on Java/Spring Boot capabilities.');
  }

  // 2. Potential concerns
  if (evalResult.missingSkills && evalResult.missingSkills.length > 0) {
    concerns.push(`Unmatched Requirements: ${evalResult.missingSkills.join(', ')} not in candidate primary profile.`);
  }

  if (evalResult.jobEligibility === ELIGIBILITY_TIERS.UNCERTAIN) {
    concerns.push('Ambiguous Education: Job description does not specify graduation degree requirements.');
  } else if (evalResult.jobEligibility === ELIGIBILITY_TIERS.NOT_ELIGIBLE) {
    concerns.push('Degree Disqualification: Strict B.Tech/B.E.-only policy excludes MCA candidates.');
  }

  for (const r of qualityResult.reasons || []) {
    if (!concerns.includes(r)) {
      concerns.push(r);
    }
  }

  if (job.freshnessStatus === 'possibly_expired' || job.freshnessStatus === 'needs_reverification') {
    concerns.push('Posting Age: Discovered over 14 days ago; re-verification recommended.');
  }

  return {
    whyMatches: whyMatches.length > 0 ? whyMatches : ['General software engineering role alignment.'],
    concerns: concerns.length > 0 ? concerns : ['No significant quality concerns detected for this listing.']
  };
}

/**
 * Calculates a transparent, multi-factor evidence-based quality score breakdown (0–100).
 * 
 * Factor                     | Max | Candidate Fit
 * ---------------------------|-----|--------------------
 * Skills match               | 30  | Java, Spring Boot, React, SQL
 * Degree eligibility         | 15  | MCA degree compatibility
 * Experience eligibility     | 15  | 2026 fresher / entry-level
 * Location & Remote          | 10  | Bengaluru / India Remote
 * Freshness                  | 10  | Active & recent vacancy
 * Role & description quality | 10  | Completeness & clarity
 * Source confidence          | 10  | Direct ATS / verified portal
 */
export function calculateEvidenceBreakdown(job = {}, evalResult = {}, qualityResult = {}, degreeEval = {}) {
  const flags = qualityResult.flags || [];
  const isExpired = flags.includes(LOW_QUALITY_FLAGS.EXPIRED) || flags.includes(LOW_QUALITY_FLAGS.CLOSED) || (job.status === 'expired');
  const isStrictExcl = degreeEval.isStrictlyIneligible || flags.includes(LOW_QUALITY_FLAGS.STRICT_BTECH_EXCLUSION);
  const isDuplicate = flags.includes(LOW_QUALITY_FLAGS.DUPLICATE);
  const isExcessiveExp = flags.includes(LOW_QUALITY_FLAGS.EXCESSIVE_EXPERIENCE);

  // 1. Skills match (0 to 30)
  const skillsScore = Math.min(30, Math.max(0, evalResult.breakdown?.skillsScore ?? 0));

  // 2. Degree eligibility (0 to 15)
  let degreeScore = 8;
  if (isStrictExcl) {
    degreeScore = 0;
  } else if (degreeEval.classification === DEGREE_CLASSIFICATIONS.MCA_EXPLICIT) {
    degreeScore = 15;
  } else if (degreeEval.classification === DEGREE_CLASSIFICATIONS.EQUIVALENT_ACCEPTED) {
    degreeScore = 14;
  } else if (degreeEval.classification === DEGREE_CLASSIFICATIONS.BTECH_NON_EXCLUSIVE) {
    degreeScore = 10;
  }

  // 3. Experience eligibility (0 to 15)
  let expScore = 10;
  if (isExcessiveExp) {
    expScore = 0;
  } else if (evalResult.breakdown?.seniorityScore === 30) {
    expScore = 15;
  } else if (evalResult.breakdown?.seniorityScore === 20) {
    expScore = 12;
  } else {
    expScore = 0;
  }

  // 4. Location & Remote (0 to 10)
  const rawLoc = evalResult.breakdown?.locationScore ?? 0; // 0 to 20
  const locScore = Math.min(10, Math.round(rawLoc / 2));

  // 5. Freshness (0 to 10)
  let freshnessScore = 7;
  if (isExpired) {
    freshnessScore = 0;
  } else if (job.freshnessStatus === 'verified_active') {
    freshnessScore = 10;
  } else if (job.freshnessStatus === 'recently_posted') {
    freshnessScore = 9;
  } else if (job.freshnessStatus === 'needs_reverification') {
    freshnessScore = 6;
  } else if (job.freshnessStatus === 'possibly_expired') {
    freshnessScore = 3;
  }

  // 6. Role & description quality (0 to 10)
  const roleQualityScore = Math.min(10, Math.max(0, qualityResult.qualityScore ?? 7));

  // 7. Source confidence (0 to 10)
  const directSources = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee'];
  let sourceConfidenceScore = 7;
  const sourceName = (job.source || '').toLowerCase();
  if (directSources.includes(sourceName) || (job.source_confidence || 0) >= 0.95) {
    sourceConfidenceScore = 10;
  } else if (sourceName === 'freehire' || (job.source_confidence || 0) >= 0.8) {
    sourceConfidenceScore = 8;
  } else if (flags.includes(LOW_QUALITY_FLAGS.UNCLEAR_EMPLOYER)) {
    sourceConfidenceScore = 3;
  }

  let totalScore = skillsScore + degreeScore + expScore + locScore + freshnessScore + roleQualityScore + sourceConfidenceScore;
  totalScore = Math.min(100, Math.max(0, Math.round(totalScore)));

  // Strict disqualification overrides
  if (isExpired || isStrictExcl || isDuplicate || isExcessiveExp) {
    totalScore = 0;
  }

  return {
    factors: {
      skillsMatch: { score: skillsScore, max: 30, label: 'Skills Match', weight: '30%' },
      degreeEligibility: { score: degreeScore, max: 15, label: 'Degree Eligibility', weight: '15%' },
      experienceEligibility: { score: expScore, max: 15, label: 'Experience Level', weight: '15%' },
      locationFit: { score: locScore, max: 10, label: 'Location & Remote', weight: '10%' },
      freshness: { score: freshnessScore, max: 10, label: 'Freshness & Activity', weight: '10%' },
      roleQuality: { score: roleQualityScore, max: 10, label: 'Role & Description Quality', weight: '10%' },
      sourceConfidence: { score: sourceConfidenceScore, max: 10, label: 'Source Confidence', weight: '10%' }
    },
    totalScore
  };
}
