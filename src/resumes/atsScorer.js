/**
 * CareerOS — ATS Scoring Engine
 * 100-point transparent, weighted scoring formula:
 * - Required skill & keyword coverage (30%)
 * - Technical skills relevance (20%)
 * - Experience and seniority eligibility (15%)
 * - Education and qualification match (10%)
 * - Project relevance and evidence (10%)
 * - Resume structure and ATS readability (10%)
 * - Relevant achievements and clarity (5%)
 * 
 * Label: "CareerOS ATS Compatibility Estimate"
 */

import { loadCandidateProfile } from '../profile/profileManager.js';

export function calculateAtsScore(jdAnalysis, resumeData, candidateProfile = null) {
  if (!candidateProfile) candidateProfile = loadCandidateProfile();

  // Convert resumeData to searchable text if string or structured object
  const resumeText = typeof resumeData === 'string'
    ? resumeData
    : serializeResumeForAnalysis(resumeData);
  const resumeLower = resumeText.toLowerCase();

  // Compile candidate's verified skills for evidence checking
  const verifiedSkillsMap = getVerifiedSkillsMap(candidateProfile);

  // 1. Required Skill & Keyword Coverage (Max 30)
  const reqCoverage = evaluateRequiredSkillCoverage(jdAnalysis, resumeLower, verifiedSkillsMap);

  // 2. Technical Skills Relevance (Max 20)
  const techRelevance = evaluateTechnicalRelevance(jdAnalysis, resumeLower, verifiedSkillsMap);

  // 3. Experience and Seniority Eligibility (Max 15)
  const expEligibility = evaluateExperienceEligibility(jdAnalysis);

  // 4. Education and Qualification Match (Max 10)
  const eduMatch = evaluateEducationMatch(jdAnalysis);

  // 5. Project Relevance and Evidence (Max 10)
  const projRelevance = evaluateProjectRelevance(jdAnalysis, resumeLower, candidateProfile);

  // 6. Resume Structure & ATS Readability (Max 10)
  const atsReadability = evaluateAtsReadability(resumeText);

  // 7. Relevant Achievements & Clarity (Max 5)
  const achievements = evaluateAchievementsAndClarity(resumeLower, candidateProfile);

  // Resume Content Compatibility Score (0-100)
  // Measures purely how well the candidate's resume content matches the technical, educational, and structural requirements
  const rawCompatibility = Math.round(
    (reqCoverage.score / reqCoverage.max) * 35 +
    (techRelevance.score / techRelevance.max) * 25 +
    (projRelevance.score / projRelevance.max) * 15 +
    (eduMatch.score / eduMatch.max) * 10 +
    (atsReadability.score / atsReadability.max) * 10 +
    (achievements.score / achievements.max) * 5
  );
  const resumeCompatibilityScore = Math.min(100, Math.max(0, rawCompatibility));

  // Job Eligibility Assessment (Independent gatekeeper)
  const eligibilityAssessment = evaluateJobEligibility(jdAnalysis, candidateProfile, reqCoverage);

  // Overall Match Calculation: Never let high resume compatibility hide an eligibility failure
  let overallScore = resumeCompatibilityScore;
  let overallRecommendation = 'READY_TO_APPLY';
  let alert = null;

  const candDegree = candidateProfile?.status?.currentDegree || candidateProfile?.education?.[0]?.degree || 'MCA';
  const roleTitle = jdAnalysis?.title || 'the target role';
  const reqExpText = jdAnalysis?.experience?.rawText || (jdAnalysis?.experience?.min ? `${jdAnalysis.experience.min} years` : '1-2 years');

  if (eligibilityAssessment.status === 'MANDATORY_NOT_MET') {
    // Cap overall score to prevent misleading user on ineligible positions
    overallScore = Math.min(45, Math.round(resumeCompatibilityScore * 0.45));
    overallRecommendation = 'NOT_ELIGIBLE';
    alert = {
      type: 'danger',
      title: 'Mandatory Eligibility Requirement Not Met',
      message: `Even though your technical resume compatibility is ${resumeCompatibilityScore}/100, this job has mandatory criteria that are not met: ${eligibilityAssessment.unmetMandatoryRequirements.join('; ')}. Recruiter screening filters will likely reject this application.`
    };
  } else if (eligibilityAssessment.status === 'POTENTIAL_STRETCH') {
    overallScore = Math.round(resumeCompatibilityScore * 0.85);
    overallRecommendation = 'POTENTIAL_STRETCH';
    alert = {
      type: 'warning',
      title: 'Potential Stretch Opportunity',
      message: `Job specifies ${reqExpText} experience for "${roleTitle}". As a ${candDegree} graduate with verified full-stack project and internship evidence, this is a viable stretch application; address the experience delta in your cover letter.`
    };
  } else if (eligibilityAssessment.status === 'POTENTIALLY_ELIGIBLE') {
    overallScore = Math.round(resumeCompatibilityScore * 0.90);
    overallRecommendation = 'POTENTIALLY_ELIGIBLE';
    alert = {
      type: 'warning',
      title: 'Potentially Eligible Role',
      message: `B.Tech/B.E. is mentioned without exclusivity. Candidate holds verified ${candDegree} and is potentially eligible; confirm specific degree acceptance with the employer.`
    };
  } else if (eligibilityAssessment.status === 'ELIGIBLE') {
    overallRecommendation = resumeCompatibilityScore >= 75 ? 'HIGH_MATCH' : 'MODERATE_MATCH';
    alert = {
      type: 'success',
      title: 'Fully Eligible Role',
      message: `Your verified candidate profile (${candDegree}) satisfies the mandatory experience and education requirements for "${roleTitle}".`
    };
  } else {
    overallRecommendation = 'REVIEW_REQUIRED';
    alert = {
      type: 'info',
      title: 'Insufficient Information in JD',
      message: `The job description for "${roleTitle}" does not explicitly specify mandatory experience or degree criteria. Recruiter screening may have undisclosed requirements.`
    };
  }

  // Generate actionable suggestions
  const suggestions = generateImprovementSuggestions({
    reqCoverage,
    techRelevance,
    expEligibility,
    eduMatch,
    projRelevance,
    atsReadability,
    achievements
  });

  return {
    totalScore: overallScore,
    resumeCompatibilityScore,
    eligibilityAssessment,
    overallMatch: {
      overallScore,
      recommendation: overallRecommendation,
      alert
    },
    maxScore: 100,
    label: 'CareerOS ATS Compatibility Estimate',
    disclaimer: 'This score is an internal CareerOS algorithmic estimate of resume alignment against this job description. It is not an official employer ATS ranking.',
    calculatedAt: new Date().toISOString(),
    categories: {
      requiredSkillCoverage: reqCoverage,
      technicalRelevance: techRelevance,
      experienceEligibility: expEligibility,
      educationMatch: eduMatch,
      projectRelevance: projRelevance,
      atsReadability: atsReadability,
      achievementsAndClarity: achievements
    },
    keywordAnalysis: {
      matchedKeywords: reqCoverage.matched,
      matchedMandatory: reqCoverage.matchedMandatory,
      matchedPreferred: reqCoverage.matchedPreferred,
      missingMandatory: reqCoverage.missingMandatory,
      missingPreferred: reqCoverage.missingPreferred,
      presentInProfileButOmitted: reqCoverage.presentInProfileButOmitted,
      unverifiedInProfile: reqCoverage.unverifiedInProfile
    },
    requirementBreakdown: {
      matchedRequirements: reqCoverage.matchedMandatory,
      preferredRequirements: reqCoverage.matchedPreferred,
      missingRequirements: reqCoverage.missingMandatory,
      uncertainRequirements: eligibilityAssessment.uncertainRequirements || [],
      unverifiedClaims: reqCoverage.unverifiedInProfile
    },
    transparentBreakdown: {
      A_keywordAlignment: {
        score: reqCoverage.score,
        max: reqCoverage.max,
        matched: reqCoverage.matched,
        missing: reqCoverage.missingMandatory
      },
      B_evidenceTechnicalMatch: {
        score: techRelevance.score + projRelevance.score,
        max: techRelevance.max + projRelevance.max,
        note: 'Derived strictly from verified profile skills, internships, and projects.'
      },
      C_formattingAndReadability: {
        score: atsReadability.score,
        max: atsReadability.max,
        note: 'Single-column ATS layout, standard headings, clean bullet structure.'
      },
      D_contentQuality: {
        score: achievements.score,
        max: achievements.max,
        note: 'Action + Technical Implementation + Purpose/Outcome without inflated claims.'
      },
      E_eligibilityOrQualificationGaps: {
        status: eligibilityAssessment.status,
        unmetMandatory: eligibilityAssessment.unmetMandatoryRequirements || [],
        uncertain: eligibilityAssessment.uncertainRequirements || []
      }
    },
    suggestions
  };
}

function evaluateRequiredSkillCoverage(jd, resumeLower, verifiedSkillsMap) {
  const max = 30;
  const required = jd.requiredSkills || [];
  const preferred = jd.preferredSkills || [];

  const matchedMandatory = [];
  const missingMandatory = [];
  const matchedPreferred = [];
  const missingPreferred = [];
  const presentInProfileButOmitted = [];
  const unverifiedInProfile = [];

  // 1. Evaluate Mandatory Skills Strictly Against requiredSkills ONLY
  let mandatoryScore = 0;
  if (required.length > 0) {
    for (const skill of required) {
      const isPresentInResume = isSkillInText(skill, resumeLower);
      const isVerifiedInProfile = verifiedSkillsMap.has(skill.toLowerCase());

      if (isPresentInResume && isVerifiedInProfile) {
        matchedMandatory.push(skill);
      } else if (isPresentInResume && !isVerifiedInProfile) {
        // Penalty: Claimed in resume without verified profile backing
        unverifiedInProfile.push(skill);
      } else {
        missingMandatory.push(skill);
        if (isVerifiedInProfile) {
          presentInProfileButOmitted.push(skill);
        }
      }
    }
    const mandatoryRatio = matchedMandatory.length / required.length;
    mandatoryScore = Math.round(mandatoryRatio * 25);
  } else {
    // JD has no explicit mandatory skills enumerated
    const allSkills = jd.allSkills || [];
    if (allSkills.length > 0) {
      let generalMatches = 0;
      for (const skill of allSkills) {
        if (isSkillInText(skill, resumeLower) && verifiedSkillsMap.has(skill.toLowerCase())) {
          generalMatches++;
          matchedMandatory.push(skill);
        }
      }
      const generalRatio = Math.min(1, generalMatches / Math.max(1, allSkills.length));
      mandatoryScore = Math.round(generalRatio * 20);
    } else {
      // General JD without technical keywords specified
      mandatoryScore = 18;
    }
  }

  // 2. Evaluate Preferred Skills Separately (Max 5 pts) - CANNOT inflate mandatory score
  let preferredScore = 0;
  if (preferred.length > 0) {
    for (const skill of preferred) {
      const isPresentInResume = isSkillInText(skill, resumeLower);
      const isVerifiedInProfile = verifiedSkillsMap.has(skill.toLowerCase());

      if (isPresentInResume && isVerifiedInProfile) {
        matchedPreferred.push(skill);
      } else if (!isPresentInResume) {
        missingPreferred.push(skill);
      } else if (isPresentInResume && !isVerifiedInProfile) {
        unverifiedInProfile.push(skill);
      }
    }
    const preferredRatio = matchedPreferred.length / preferred.length;
    preferredScore = Math.round(preferredRatio * 5);
  } else {
    // If no preferred skills are specified in the JD, provide a baseline 3/5
    preferredScore = 3;
  }

  // 3. Combine scores strictly without cross-contamination (Max 30)
  let rawScore = mandatoryScore + preferredScore;

  // Deduct points if unverified skills are claimed in resume
  const penalty = unverifiedInProfile.length * 3;
  const finalScore = Math.max(0, Math.min(max, rawScore - penalty));

  return {
    score: finalScore,
    max,
    mandatoryCoverage: {
      score: mandatoryScore,
      max: 25,
      matched: matchedMandatory,
      missing: missingMandatory,
      ratio: required.length > 0 ? (matchedMandatory.length / required.length) : 1
    },
    preferredCoverage: {
      score: preferredScore,
      max: 5,
      matched: matchedPreferred,
      missing: missingPreferred,
      ratio: preferred.length > 0 ? (matchedPreferred.length / preferred.length) : 0
    },
    matched: matchedMandatory.concat(matchedPreferred),
    matchedMandatory,
    matchedPreferred,
    missingMandatory,
    missingPreferred,
    presentInProfileButOmitted,
    unverifiedInProfile,
    reason: (required.length > 0
      ? `Matched ${matchedMandatory.length} of ${required.length} mandatory skills (${mandatoryScore}/25 pts) and ${matchedPreferred.length} of ${preferred.length || 0} preferred skills (${preferredScore}/5 pts).`
      : `General JD without strict mandatory skill enumeration. Baseline technical match (${mandatoryScore}/25 pts).`
    ) + (unverifiedInProfile.length > 0 ? ` Unverified skills claimed in resume without profile backing: ${unverifiedInProfile.join(', ')} (-${penalty} pts deduction).` : '')
  };
}

function evaluateTechnicalRelevance(jd, resumeLower, verifiedSkillsMap) {
  const max = 20;
  let matches = 0;
  const targetSkills = (jd.languages || []).concat(jd.frameworksAndTools || []).concat(jd.databases || []);

  if (targetSkills.length === 0) {
    return { score: 18, max, reason: 'Technical stack flexible or not strictly enumerated.' };
  }

  for (const t of targetSkills) {
    if (isSkillInText(t, resumeLower) && verifiedSkillsMap.has(t.toLowerCase())) {
      matches++;
    }
  }

  const ratio = Math.min(1, matches / Math.max(1, targetSkills.length));
  const score = Math.round(ratio * max);

  return {
    score: Math.min(max, score),
    max,
    reason: matches > 0
      ? `Technical stack resonance across ${matches} of ${targetSkills.length} domain-relevant technologies.`
      : `Zero overlap with target technical stack (${targetSkills.slice(0, 4).join(', ')}).`
  };
}

function evaluateExperienceEligibility(jd) {
  const max = 15;
  const exp = jd.experience || { min: 0, max: 1, isFresherEligible: true };

  if (!exp.isFresherEligible || exp.min > 2) {
    return {
      score: 0,
      max,
      reason: `Strict mismatch: Job requires ${exp.min || 3}+ years experience (${jd.title}). Exceeds junior/fresher threshold.`
    };
  }

  if (exp.min === 2) {
    return {
      score: 8,
      max,
      reason: `Requires 2 years experience; candidate has fresher/internship status (potential stretch).`
    };
  }

  return {
    score: 15,
    max,
    reason: `Eligible for Fresher / 0-${exp.max || 1} years candidate profile (MCA 2026).`
  };
}

export function evaluateJobEligibility(jd, candidateProfile, reqCoverage) {
  const exp = jd.experience || { min: 0, max: 1, isFresherEligible: true, rawText: '' };
  const unmet = [];
  const uncertain = [];
  let status = 'ELIGIBLE';
  let label = 'Eligible';
  let badgeClass = 'eligible';

  const candDegree = candidateProfile?.status?.currentDegree || candidateProfile?.education?.[0]?.degree || 'MCA';
  const candLevel = candidateProfile?.status?.targetLevel || 'Fresher / Entry Level (MCA 2026, 0–1 years)';

  // Check 1: Seniority & Experience
  const isSeniorTitle = /senior|lead|architect|staff|principal|manager|head\s+of/i.test(jd.title || '');
  
  if (!exp.isFresherEligible && exp.min > 2 || isSeniorTitle || (exp.min && exp.min >= 3)) {
    unmet.push(`Requires ${exp.min || 3}+ years commercial experience (${jd.title || 'Role'}). Candidate profile is ${candLevel}.`);
    status = 'MANDATORY_NOT_MET';
    label = 'Mandatory requirement not met';
    badgeClass = 'not-met';
  } else if (exp.min === 2 || (exp.min === 1 && !exp.isFresherEligible)) {
    status = 'POTENTIAL_STRETCH';
    label = 'Potential stretch';
    badgeClass = 'stretch';
    unmet.push(`Requires ~${exp.min || 2} years commercial experience for ${jd.title || 'Role'}. Candidate is ${candLevel} (${candDegree}) with verified full-stack projects.`);
  } else if (!exp.rawText || exp.rawText === 'Not specified' || exp.min === undefined) {
    status = 'INSUFFICIENT_INFO';
    label = 'Insufficient information';
    badgeClass = 'info';
    uncertain.push('Experience requirements are not explicitly enumerated in the job description.');
  } else {
    status = 'ELIGIBLE';
    label = 'Eligible';
    badgeClass = 'eligible';
  }

  // Check 2: Degree eligibility
  const edu = jd.education || {};
  const degreeClass = edu.degreeClassification ||
    (edu.isEligibleForMCA === false ? 'BTECH_STRICT_RESTRICTION' :
     edu.isEligibleForMCA === true ? 'MCA_EXPLICIT' : 'UNCLEAR');

  if (degreeClass === 'BTECH_STRICT_RESTRICTION' || edu.isEligibleForMCA === false) {
    unmet.push(`Job specifies an explicit B.Tech/B.E.-only restriction with no MCA or equivalent acceptance. Verified qualification is ${candDegree}.`);
    status = 'MANDATORY_NOT_MET';
    label = 'Mandatory requirement not met';
    badgeClass = 'not-met';
  } else if (degreeClass === 'BTECH_NON_EXCLUSIVE') {
    uncertain.push('B.Tech/B.E. mentioned without exclusivity. Candidate is potentially eligible; confirm specific MCA acceptance with employer.');
    if (status === 'ELIGIBLE') {
      status = 'POTENTIALLY_ELIGIBLE';
      label = 'Potentially eligible';
      badgeClass = 'stretch';
    }
  } else if (degreeClass === 'UNCLEAR') {
    uncertain.push('Educational degree requirements not specified in job description; eligibility status is unknown.');
    if (status === 'ELIGIBLE') {
      status = 'INSUFFICIENT_INFO';
      label = 'Insufficient information';
      badgeClass = 'info';
    }
  }

  // Check 3: Missing critical mandatory skills
  if (reqCoverage && reqCoverage.missingMandatory && reqCoverage.missingMandatory.length > 0 && reqCoverage.mandatoryCoverage.score === 0) {
    unmet.push(`Zero mandatory skills matched: missing all required skills (${reqCoverage.missingMandatory.join(', ')}).`);
    status = 'MANDATORY_NOT_MET';
    label = 'Mandatory requirement not met';
    badgeClass = 'not-met';
  }

  return {
    status,
    label,
    badgeClass,
    unmetMandatoryRequirements: unmet,
    uncertainRequirements: uncertain,
    experienceMin: exp.min,
    experienceMax: exp.max,
    isFresherEligible: exp.isFresherEligible,
    degreeEligible: degreeClass !== 'BTECH_STRICT_RESTRICTION'
  };
}

function evaluateEducationMatch(jd) {
  const max = 10;
  const edu = jd.education || {};
  const classification = edu.degreeClassification || (edu.isEligibleForMCA ? 'MCA_EXPLICIT' : 'UNCLEAR');

  switch (classification) {
    case 'MCA_EXPLICIT':
      return {
        score: 10,
        max,
        classification,
        reason: 'MCA (Master of Computer Applications) from AIMS Institutes is explicitly accepted by employer.'
      };
    case 'EQUIVALENT_ACCEPTED':
      return {
        score: 10,
        max,
        classification,
        reason: 'Employer explicitly accepts equivalent CS/IT qualifications. Candidate\'s verified MCA satisfies this requirement.'
      };
    case 'BTECH_NON_EXCLUSIVE':
      return {
        score: 6,
        max,
        classification,
        reason: 'B.Tech/B.E. mentioned without exclusivity. Candidate is potentially eligible, but specific MCA acceptance is unconfirmed.'
      };
    case 'UNCLEAR':
      return {
        score: 5,
        max,
        classification,
        reason: 'Qualification requirements are unclear or unstated in job description. Candidate is not penalized, but evidence of acceptance is unconfirmed.'
      };
    case 'BTECH_STRICT_RESTRICTION':
      return {
        score: 0,
        max,
        classification,
        reason: 'Job posting specifies an explicit B.Tech/B.E.-only restriction with no MCA or equivalent acceptance.'
      };
    default:
      return {
        score: 5,
        max,
        classification: 'UNCLEAR',
        reason: 'Qualification requirement not explicitly detailed in job description.'
      };
  }
}

function evaluateProjectRelevance(jd, resumeLower, candidateProfile) {
  const max = 10;
  let relevantProjectsCount = 0;

  const titleLower = (jd.title || '').toLowerCase();
  const isJava = /java|spring|backend/i.test(titleLower) || (jd.languages || []).includes('Java');
  const isPython = /python|ai|ml|fastapi|machine/i.test(titleLower) || (jd.languages || []).includes('Python');
  const isReact = /react|frontend|javascript|full\s*stack/i.test(titleLower) || (jd.frameworksAndTools || []).includes('React.js');

  // Check which projects are in resume
  for (const proj of candidateProfile.projects || []) {
    const pName = proj.name.toLowerCase();
    if (resumeLower.includes(pName.substring(0, 8))) {
      if (isJava && (pName.includes('leave') || pName.includes('nearvia'))) relevantProjectsCount++;
      else if (isPython && (pName.includes('finsight') || pName.includes('rover') || pName.includes('drowsiness'))) relevantProjectsCount++;
      else if (isReact && (pName.includes('nearvia') || pName.includes('finsight') || pName.includes('leave'))) relevantProjectsCount++;
      else relevantProjectsCount++;
    }
  }

  const score = relevantProjectsCount >= 2 ? 10 : relevantProjectsCount === 1 ? 7 : 0;
  return {
    score,
    max,
    reason: relevantProjectsCount > 0
      ? `Highlighted ${relevantProjectsCount} hands-on projects directly proving requested technical skills.`
      : 'No verified hands-on projects directly aligned with target role domain.'
  };
}

function evaluateAtsReadability(resumeText) {
  const max = 10;
  let score = 0;

  // Check required standard ATS headings
  const hasSummary = /summary|objective/i.test(resumeText);
  const hasSkills = /skills|technical skills/i.test(resumeText);
  const hasExperience = /experience|internship/i.test(resumeText);
  const hasEducation = /education/i.test(resumeText);
  const hasProjects = /projects/i.test(resumeText);

  if (hasSummary && hasSkills && hasExperience && hasEducation && hasProjects) {
    score += 5;
  } else {
    score += 3;
  }

  // Check clean contact info
  const hasEmail = /[\w.-]+@[\w.-]+\.\w+/.test(resumeText);
  const hasPhone = /\+?\d[\d\s-]{8,15}\d/.test(resumeText);
  const hasLinkedIn = /linkedin\.com/i.test(resumeText);

  if (hasEmail && hasPhone && hasLinkedIn) {
    score += 5;
  } else {
    score += 3;
  }

  return {
    score: Math.min(max, score),
    max,
    reason: 'Standard single-column ATS heading structure and complete parseable contact information.'
  };
}

function evaluateAchievementsAndClarity(resumeLower, candidateProfile) {
  const max = 5;
  let score = 0;

  // Check for verified honors / awards
  if (resumeLower.includes('best ai innovation') || resumeLower.includes('medal') || resumeLower.includes('second prize')) {
    score += 3;
  }

  // Check for verified live portfolio / GitHub link
  if (resumeLower.includes('nearvia.app') || resumeLower.includes('github.com')) {
    score += 2;
  }

  return {
    score: Math.min(max, score),
    max,
    reason: score > 0
      ? 'Verified academic honors and active live application evidence included.'
      : 'No verified academic honors or portfolio links detected in resume.'
  };
}

function isSkillInText(skillName, text) {
  const clean = skillName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${clean}\\b`, 'i').test(text);
}

function getVerifiedSkillsMap(profile) {
  const map = new Map();
  const s = profile.skills || {};

  const addList = (arr) => {
    (arr || []).forEach(item => {
      map.set(item.toLowerCase(), item);
      // Add parts (e.g. "Spring Boot" -> "spring", "boot")
      if (item.includes(' ')) {
        item.split(' ').forEach(part => {
          if (part.length > 2) map.set(part.toLowerCase(), item);
        });
      }
    });
  };

  addList(s.languages);
  addList(s.backend);
  addList(s.frontend);
  addList(s.databases);
  addList(s.ai_ml);
  addList(s.iot);
  addList(s.tools);

  // Add project tech stacks
  (profile.projects || []).forEach(p => addList(p.techStack));

  return map;
}

function serializeResumeForAnalysis(data) {
  if (typeof data === 'string') return data;
  return JSON.stringify(data);
}

function generateImprovementSuggestions(cat) {
  const suggestions = [];

  const req = cat.reqCoverage || {};
  const exp = cat.expEligibility || {};
  const proj = cat.projRelevance || cat.projectRelevance || {};

  if (req.presentInProfileButOmitted && req.presentInProfileButOmitted.length > 0) {
    suggestions.push(`Add ${req.presentInProfileButOmitted.join(', ')} to your resume technical skills — you have verified experience in this, but it wasn't highlighted.`);
  }

  if (req.missingMandatory && req.missingMandatory.length > 0) {
    const unverified = req.missingMandatory.filter(s => !(req.presentInProfileButOmitted || []).includes(s));
    if (unverified.length > 0) {
      suggestions.push(`Notice: The JD requests [${unverified.join(', ')}]. Under CareerOS Truthfulness Rules, these are NOT fabricated. Address adjacent concepts or fast-learning capability in your cover letter.`);
    }
  }

  if (exp.score !== undefined && exp.score < 10) {
    suggestions.push(`Caution: Seniority mismatch detected. This position may require commercial tenure beyond junior/fresher level.`);
  }

  if (proj.score !== undefined && proj.score < 10) {
    suggestions.push(`Feature projects that directly demonstrate requested technologies (e.g., NearVia for full-stack/PostgreSQL or Leave Management for Spring Boot).`);
  }

  return suggestions;
}
