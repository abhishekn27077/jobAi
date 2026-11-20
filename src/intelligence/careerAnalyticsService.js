import { getDatabase } from '../db/schema.js';

export const SMALL_SAMPLE_THRESHOLD = 10;
export const RESUME_VERSION_SAMPLE_THRESHOLD = 5;

/**
 * Computes comprehensive application funnel, conversion rates, and telemetry
 */
export function getApplicationAnalytics() {
  const db = getDatabase();

  const apps = db.prepare(`
    SELECT a.*, j.title as job_title, j.company as job_company, j.source as job_source_db, j.location as job_location
    FROM applications a
    LEFT JOIN jobs j ON a.job_id = j.id
    ORDER BY a.id DESC
  `).all();

  const totalApplications = apps.length;
  const hasSmallSampleWarning = totalApplications < SMALL_SAMPLE_THRESHOLD;
  const smallSampleWarning = hasSmallSampleWarning
    ? `Small sample size (N = ${totalApplications}). Metrics and conversion rates are preliminary and will gain statistical confidence as more applications are tracked.`
    : null;

  // Funnel count calculation
  const funnel = {
    interested: 0,
    preparing: 0,
    ready_for_review: 0,
    submitted: 0,
    responded: 0,
    assessment: 0,
    interview: 0,
    rejected: 0,
    offer: 0,
    withdrawn: 0
  };

  const responseLatencies = [];
  const sourceStats = {};
  const roleStats = {};
  const resumeVersionStats = {};

  for (const app of apps) {
    const status = app.status || 'preparing';
    if (funnel[status] !== undefined) {
      funnel[status]++;
    }

    // Has response
    const hasResponse = ['assessment', 'interview', 'rejected', 'offer'].includes(status) || Boolean(app.response_date);
    if (hasResponse) {
      funnel.responded++;
    }

    // Response latency in days
    if (app.applied_date && app.response_date) {
      try {
        const d1 = new Date(app.applied_date);
        const d2 = new Date(app.response_date);
        const diffDays = Math.max(0, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
        responseLatencies.push(diffDays);
      } catch {
        // ignore invalid date strings
      }
    }

    // Group by source
    const source = (app.job_source || app.job_source_db || app.portal_type || 'direct').toLowerCase();
    if (!sourceStats[source]) {
      sourceStats[source] = { source, applications: 0, responses: 0, interviews: 0, offers: 0, rejections: 0 };
    }
    sourceStats[source].applications++;
    if (hasResponse) sourceStats[source].responses++;
    if (['interview', 'offer'].includes(status)) sourceStats[source].interviews++;
    if (status === 'offer') sourceStats[source].offers++;
    if (status === 'rejected') sourceStats[source].rejections++;

    // Group by role category
    const titleLower = (app.job_title || '').toLowerCase();
    let roleCat = 'Full Stack / Other';
    if (titleLower.includes('java') || titleLower.includes('backend') || titleLower.includes('spring')) roleCat = 'Java / Backend';
    else if (titleLower.includes('react') || titleLower.includes('frontend') || titleLower.includes('ui')) roleCat = 'Frontend / React';
    else if (titleLower.includes('python') || titleLower.includes('data') || titleLower.includes('ai') || titleLower.includes('ml')) roleCat = 'AI / Python / Data';

    if (!roleStats[roleCat]) {
      roleStats[roleCat] = { roleCategory: roleCat, applications: 0, responses: 0, interviews: 0, offers: 0 };
    }
    roleStats[roleCat].applications++;
    if (hasResponse) roleStats[roleCat].responses++;
    if (['interview', 'offer'].includes(status)) roleStats[roleCat].interviews++;
    if (status === 'offer') roleStats[roleCat].offers++;

    // Group by resume version
    const rVer = app.resume_version || 'default_v1';
    if (!resumeVersionStats[rVer]) {
      resumeVersionStats[rVer] = { version: rVer, applications: 0, responses: 0, interviews: 0, offers: 0 };
    }
    resumeVersionStats[rVer].applications++;
    if (hasResponse) resumeVersionStats[rVer].responses++;
    if (['interview', 'offer'].includes(status)) resumeVersionStats[rVer].interviews++;
    if (status === 'offer') resumeVersionStats[rVer].offers++;
  }

  // Submitted total (submitted + downstream states)
  const totalSubmitted = (funnel.submitted + funnel.responded);
  const responseRate = totalSubmitted > 0 ? Number(((funnel.responded / totalSubmitted) * 100).toFixed(1)) : 0;
  const interviewConversionRate = totalSubmitted > 0 ? Number((((funnel.interview + funnel.offer) / totalSubmitted) * 100).toFixed(1)) : 0;
  const offerRate = totalSubmitted > 0 ? Number(((funnel.offer / totalSubmitted) * 100).toFixed(1)) : 0;

  const avgResponseDays = responseLatencies.length > 0
    ? Number((responseLatencies.reduce((a, b) => a + b, 0) / responseLatencies.length).toFixed(1))
    : null;

  // Process resume version stats with sample size qualification
  const formattedResumeVersions = Object.values(resumeVersionStats).map(rv => {
    const isSufficient = rv.applications >= RESUME_VERSION_SAMPLE_THRESHOLD;
    return {
      version: rv.version,
      applications: rv.applications,
      responses: rv.responses,
      interviews: rv.interviews,
      offers: rv.offers,
      responseRatePct: rv.applications > 0 ? Number(((rv.responses / rv.applications) * 100).toFixed(1)) : 0,
      isSufficientSample: isSufficient,
      note: isSufficient ? 'Valid sample' : `Low sample (N = ${rv.applications} < ${RESUME_VERSION_SAMPLE_THRESHOLD})`
    };
  });

  return {
    totalApplications,
    totalSubmitted,
    hasSmallSampleWarning,
    smallSampleWarning,
    metrics: {
      responseRatePct: responseRate,
      interviewConversionRatePct: interviewConversionRate,
      offerRatePct: offerRate,
      averageResponseDays: avgResponseDays
    },
    funnel,
    bySource: Object.values(sourceStats),
    byRoleCategory: Object.values(roleStats),
    byResumeVersion: formattedResumeVersions,
    timestamp: new Date().toISOString()
  };
}

/**
 * Analyzes rejection reasons, separating known explicit feedback from inferred possibilities
 */
export function getRejectionAnalysis() {
  const db = getDatabase();

  const rejectedApps = db.prepare(`
    SELECT a.*, j.title as job_title, j.company as job_company, j.required_skills, j.experience_min, j.experience_max, j.description
    FROM applications a
    LEFT JOIN jobs j ON a.job_id = j.id
    WHERE a.status = 'rejected' OR a.rejection_reason IS NOT NULL
  `).all();

  const knownRejections = [];
  const inferredPossibilities = [];
  const aggregatedGapCounts = {};

  for (const app of rejectedApps) {
    const isExplicit = app.rejection_reason_type === 'explicit_recruiter';

    if (isExplicit && app.rejection_reason) {
      knownRejections.push({
        applicationId: app.id,
        company: app.job_company || 'Unknown',
        role: app.job_title || 'Software Engineer',
        reasonText: app.rejection_reason,
        reasonType: 'explicit_recruiter',
        dateRecorded: app.response_date || app.updated_at
      });
    } else {
      // Analyze potential inferred factors
      const inferredReasons = [];
      const expMin = app.experience_min || 0;

      if (expMin > 2) {
        inferredReasons.push(`Seniority / Experience requirement: Job requested minimum ${expMin} years experience (Candidate has verified 0-1 years).`);
      }

      // Check required skills
      let reqSkills = [];
      try {
        reqSkills = app.required_skills ? JSON.parse(app.required_skills) : [];
      } catch {
        reqSkills = (app.required_skills || '').split(',').map(s => s.trim()).filter(Boolean);
      }

      const commonGaps = ['docker', 'kubernetes', 'aws', 'kafka', 'microservices', 'redis'];
      for (const gap of commonGaps) {
        if (reqSkills.some(s => s.toLowerCase().includes(gap)) || (app.description || '').toLowerCase().includes(gap)) {
          inferredReasons.push(`Potential skill gap: ${gap.toUpperCase()} requested in job description.`);
          aggregatedGapCounts[gap] = (aggregatedGapCounts[gap] || 0) + 1;
        }
      }

      if (inferredReasons.length === 0) {
        inferredReasons.push('General market competitiveness / high applicant volume for entry-level tech roles.');
      }

      inferredPossibilities.push({
        applicationId: app.id,
        company: app.job_company || 'Unknown',
        role: app.job_title || 'Software Engineer',
        inferredHypotheses: inferredReasons,
        reasonType: 'inferred_possibility',
        dateRecorded: app.response_date || app.updated_at
      });
    }
  }

  // Generate actionable recommendations
  const actionRecommendations = [];
  if (Object.keys(aggregatedGapCounts).length > 0) {
    const topGap = Object.entries(aggregatedGapCounts).sort((a, b) => b[1] - a[1])[0];
    actionRecommendations.push(`Targeted Learning: "${topGap[0].toUpperCase()}" appeared across ${topGap[1]} rejected positions. Complete the recommended mini-project in your roadmap.`);
  }
  actionRecommendations.push('Filter out job descriptions requesting 3+ years experience to maintain high conversion focus on entry-level / fresher roles.');
  actionRecommendations.push('Prioritize applications to verified direct ATS portals (Lever, Ashby, Greenhouse) where response rates are historically higher.');

  return {
    totalRejectionsAnalyzed: rejectedApps.length,
    knownRejectionsCount: knownRejections.length,
    inferredPossibilitiesCount: inferredPossibilities.length,
    knownRejections,
    inferredPossibilities,
    topRepeatedGaps: Object.entries(aggregatedGapCounts).map(([skill, count]) => ({ skill, count })),
    actionRecommendations,
    disclaimer: 'Strict Separation: Known reasons are confirmed from official recruiter messages. Inferred hypotheses are heuristic possibilities based on JD requirements and should never be assumed as confirmed facts.'
  };
}
