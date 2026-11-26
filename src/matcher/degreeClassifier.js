/**
 * CareerOS — Conservative Degree Requirement Classifier (Phase 9.2)
 *
 * Classifies job description degree requirements into 5 conservative tiers:
 *  1. MCA_EXPLICIT — MCA explicitly accepted (confirmed eligible).
 *  2. EQUIVALENT_ACCEPTED — Equivalent qualifications explicitly accepted (confirmed eligible).
 *  3. BTECH_NON_EXCLUSIVE — B.Tech/B.E. mentioned without exclusivity (potentially eligible, not automatically confirmed eligible).
 *  4. BTECH_STRICT_RESTRICTION — Explicit B.Tech/B.E.-only restriction with no MCA/equivalent acceptance (ineligible).
 *  5. UNCLEAR — Unclear qualification requirements (unknown, not automatically eligible).
 *
 * STRICT SAFETY & ETHICS RULES:
 *  - Do not penalize an MCA candidate for an ambiguous requirement.
 *  - Do not describe MCA as a non-engineering qualification.
 *  - Do not award a high degree-match score without supporting evidence.
 *  - Never fabricate unverified candidate credentials (candidate holds verified MCA & BCA).
 */

export const DEGREE_CLASSIFICATIONS = Object.freeze({
  MCA_EXPLICIT: 'MCA_EXPLICIT',
  EQUIVALENT_ACCEPTED: 'EQUIVALENT_ACCEPTED',
  BTECH_NON_EXCLUSIVE: 'BTECH_NON_EXCLUSIVE',
  BTECH_STRICT_RESTRICTION: 'BTECH_STRICT_RESTRICTION',
  UNCLEAR: 'UNCLEAR'
});

export const ELIGIBILITY_STATUSES = Object.freeze({
  ELIGIBLE: 'ELIGIBLE',
  POTENTIALLY_ELIGIBLE: 'POTENTIALLY_ELIGIBLE',
  INELIGIBLE: 'INELIGIBLE',
  UNKNOWN: 'UNKNOWN'
});

export function classifyDegreeRequirement(text = '') {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return {
      classification: DEGREE_CLASSIFICATIONS.UNCLEAR,
      eligibilityStatus: ELIGIBILITY_STATUSES.UNKNOWN,
      isConfirmedEligible: false,
      isStrictlyIneligible: false,
      confidence: 'low',
      reason: 'Educational degree requirements are unstated in the job description. Eligibility is unknown, but candidate is not penalized.',
      detectedKeywords: []
    };
  }

  const normalized = text.toLowerCase();
  const detectedKeywords = [];

  // 1. Explicit Prohibition against MCA / BCA (Highest precedence strict restriction)
  const strictMcaExclusion =
    normalized.match(/\b(?:mca|bca)\b[^\n.!?]{0,60}\b(?:need\s+not\s+apply|not\s+eligible|ineligible|not\s+accepted|excluded)\b/i) ||
    normalized.match(/\b(?:no|not|without|excluding|except)\s+(?:mca|bca)\b/i);
  if (strictMcaExclusion) {
    detectedKeywords.push(strictMcaExclusion[0]);
    return {
      classification: DEGREE_CLASSIFICATIONS.BTECH_STRICT_RESTRICTION,
      eligibilityStatus: ELIGIBILITY_STATUSES.INELIGIBLE,
      isConfirmedEligible: false,
      isStrictlyIneligible: true,
      confidence: 'high',
      reason: `Job description specifies an explicit B.Tech/B.E.-only restriction with no MCA or equivalent acceptance ("${strictMcaExclusion[0]}").`,
      detectedKeywords
    };
  }

  // 2. Check if MCA is positively accepted
  const mcaPattern = /\bmca\b|\bmaster\s*of\s*computer\s*applications\b/i;
  const hasMcaPositive = mcaPattern.test(normalized);

  // 3. Check for equivalent qualifications acceptance
  const equivPatterns = [
    /\bor\s+equivalent\b/i,
    /\bequivalent\s+(?:degree|qualification|practical\s+experience|experience)\b/i,
    /\brelated\s+(?:technical\s+)?(?:field|discipline|degree|area)\b/i,
    /\bdegree\s+in\s+computer\s+science\s+or\s+related\b/i,
    /\bany\s+(?:graduate|degree|cs\/it\s+degree)\b/i,
    /\bmaster'?s?\s+(?:degree\s+)?in\s+(?:computer\s+science|it|information\s+technology)\b/i
  ];
  let foundEquiv = false;
  for (const pat of equivPatterns) {
    const match = normalized.match(pat);
    if (match) {
      detectedKeywords.push(match[0]);
      foundEquiv = true;
    }
  }

  // 4. Strict B.Tech/B.E. Only Exclusivity Check (Strict B.Tech/B.E. with NO MCA or equivalent acceptance)
  const strictBTechPatterns = [
    /\bonly\s+(?:b\.?e\.?|b\.?tech|bachelor\s+of\s+(?:engineering|technology))\b/i,
    /\b(?:b\.?e\.?|b\.?tech|bachelor\s+of\s+(?:engineering|technology))\s+(?:graduates?\s+)?only\b/i,
    /\bstrictly\s+(?:b\.?e\.?|b\.?tech|bachelor\s+of\s+(?:engineering|technology))\b/i,
    /\bexclusive(?:ly)?\s+for\s+(?:b\.?e\.?|b\.?tech)\b/i
  ];

  let strictBTechMatch = null;
  for (const pat of strictBTechPatterns) {
    const m = normalized.match(pat);
    if (m) {
      strictBTechMatch = m[0];
      break;
    }
  }

  // If strictly B.Tech/B.E. only, with NO positive MCA and NO equivalent acceptance:
  if (strictBTechMatch && !hasMcaPositive && !foundEquiv) {
    detectedKeywords.push(strictBTechMatch);
    return {
      classification: DEGREE_CLASSIFICATIONS.BTECH_STRICT_RESTRICTION,
      eligibilityStatus: ELIGIBILITY_STATUSES.INELIGIBLE,
      isConfirmedEligible: false,
      isStrictlyIneligible: true,
      confidence: 'high',
      reason: `Job description specifies an explicit B.Tech/B.E.-only restriction ("${strictBTechMatch}") with no MCA or equivalent acceptance.`,
      detectedKeywords
    };
  }

  // 5. Explicit MCA Acceptance
  if (hasMcaPositive) {
    const match = normalized.match(mcaPattern);
    detectedKeywords.push(match[0]);
    return {
      classification: DEGREE_CLASSIFICATIONS.MCA_EXPLICIT,
      eligibilityStatus: ELIGIBILITY_STATUSES.ELIGIBLE,
      isConfirmedEligible: true,
      isStrictlyIneligible: false,
      confidence: 'high',
      reason: 'MCA (Master of Computer Applications) is explicitly listed and accepted as an eligible qualification.',
      detectedKeywords
    };
  }

  // 6. Equivalent Qualifications Explicitly Accepted
  if (foundEquiv) {
    return {
      classification: DEGREE_CLASSIFICATIONS.EQUIVALENT_ACCEPTED,
      eligibilityStatus: ELIGIBILITY_STATUSES.ELIGIBLE,
      isConfirmedEligible: true,
      isStrictlyIneligible: false,
      confidence: 'high',
      reason: 'Job description explicitly accepts equivalent or related CS/IT qualifications. Candidate\'s verified MCA satisfies this requirement.',
      detectedKeywords
    };
  }

  // 7. B.Tech / B.E. Mentioned Without Exclusivity
  const btechGeneralPattern = /\bb\.?e\.?\b|\bb\.?tech\b|\bbachelor\s*of\s*engineering\b|\bbachelor\s*of\s*technology\b/i;
  const btechMatch = normalized.match(btechGeneralPattern);
  if (btechMatch) {
    detectedKeywords.push(btechMatch[0]);
    return {
      classification: DEGREE_CLASSIFICATIONS.BTECH_NON_EXCLUSIVE,
      eligibilityStatus: ELIGIBILITY_STATUSES.POTENTIALLY_ELIGIBLE,
      isConfirmedEligible: false,
      isStrictlyIneligible: false,
      confidence: 'medium',
      reason: 'B.Tech/B.E. mentioned without exclusivity. Candidate is potentially eligible, but specific MCA acceptance is not automatically confirmed.',
      detectedKeywords
    };
  }

  // 8. Unclear / Unstated Requirement
  return {
    classification: DEGREE_CLASSIFICATIONS.UNCLEAR,
    eligibilityStatus: ELIGIBILITY_STATUSES.UNKNOWN,
    isConfirmedEligible: false,
    isStrictlyIneligible: false,
    confidence: 'low',
    reason: 'Qualification requirements are unclear or unstated in the job description. Eligibility is unknown, but candidate is not penalized.',
    detectedKeywords: []
  };
}

/**
 * Returns true only if the degree requirement confirms MCA acceptance.
 */
export function isMcaConfirmedEligible(classificationResult) {
  if (!classificationResult) return false;
  if (typeof classificationResult === 'string') {
    return classificationResult === DEGREE_CLASSIFICATIONS.MCA_EXPLICIT ||
           classificationResult === DEGREE_CLASSIFICATIONS.EQUIVALENT_ACCEPTED;
  }
  return classificationResult.isConfirmedEligible === true ||
         classificationResult.eligibilityStatus === ELIGIBILITY_STATUSES.ELIGIBLE;
}

/**
 * Returns true if the degree requirement strictly excludes MCA candidates.
 */
export function isMcaStrictlyIneligible(classificationResult) {
  if (!classificationResult) return false;
  if (typeof classificationResult === 'string') {
    return classificationResult === DEGREE_CLASSIFICATIONS.BTECH_STRICT_RESTRICTION;
  }
  return classificationResult.isStrictlyIneligible === true ||
         classificationResult.eligibilityStatus === ELIGIBILITY_STATUSES.INELIGIBLE;
}

/**
 * Legacy alias for backwards compatibility
 */
export function isMcaEligible(classificationResult) {
  return isMcaConfirmedEligible(classificationResult);
}
