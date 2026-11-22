import { getDatabase } from '../db/schema.js';
import { evaluateJobFit } from '../matcher/scoringEngine.js';
import { validateJobRecord } from '../discovery/jobValidator.js';
import { normalizeCanonicalUrl, normalizeCompanyName, normalizeJobTitle } from '../discovery/urlNormalizer.js';

export function saveOrUpdateJob(rawJob) {
  const db = getDatabase();

  const validation = validateJobRecord(rawJob);
  if (!validation.isValid) {
    return {
      success: false,
      isNew: false,
      isValid: false,
      jobId: null,
      errors: validation.errors,
      error: `Validation failed: ${validation.errors.join(', ')}`,
      validation,
      evaluation: null
    };
  }

  const job = validation.normalizedJob || rawJob;
  const canonicalUrl = normalizeCanonicalUrl(job.url || '');

  // Deduplication Strategy:
  // 1. Match on external_slug
  // 2. Match on canonical_url
  // 3. Match on exact company + title + primary city
  let existing = null;
  if (job.externalSlug) {
    existing = db.prepare('SELECT id, status, posted_at, source, source_confidence, completeness_score FROM jobs WHERE external_slug = ?').get(job.externalSlug);
  }

  if (!existing && canonicalUrl) {
    existing = db.prepare('SELECT id, status, posted_at, source, source_confidence, completeness_score FROM jobs WHERE canonical_url = ? OR url = ?').get(canonicalUrl, canonicalUrl);
  }

  if (!existing && job.company && job.title) {
    const city = (job.location || '').split(',')[0].trim().toLowerCase();
    existing = db.prepare(`
      SELECT id, status, posted_at, source, source_confidence, completeness_score FROM jobs 
      WHERE LOWER(TRIM(company)) = LOWER(TRIM(?)) 
        AND LOWER(TRIM(title)) = LOWER(TRIM(?))
        AND (LOWER(location) LIKE ? OR location IS NULL OR location = '')
      LIMIT 1
    `).get(job.company, job.title, `%${city}%`);
  }

  const reqSkillsJson = JSON.stringify(job.requiredSkills || job.skills || []);
  const prefSkillsJson = JSON.stringify(job.preferredSkills || []);
  const sourceConf = job.sourceConfidence !== undefined ? job.sourceConfidence : 1.0;
  const compScore = job.completenessScore !== undefined ? job.completenessScore : 1.0;

  let jobId;
  if (existing) {
    jobId = existing.id;
    const bestSourceConf = Math.max(existing.source_confidence || 0.7, sourceConf);
    const bestCompScore = Math.max(existing.completeness_score || 0.0, compScore);

    db.prepare(`
      UPDATE jobs 
      SET title = ?, company = ?, location = ?, url = ?, canonical_url = ?, description = ?, 
          salary = COALESCE(?, salary), 
          experience_min = COALESCE(?, experience_min), 
          experience_max = COALESCE(?, experience_max), 
          posted_at = COALESCE(posted_at, ?),
          source = CASE WHEN ? >= COALESCE(source_confidence, 0.7) THEN ? ELSE source END,
          work_mode = CASE WHEN ? != 'onsite' THEN ? ELSE COALESCE(work_mode, ?) END,
          employment_type = COALESCE(?, employment_type),
          required_skills = COALESCE(?, required_skills),
          preferred_skills = COALESCE(?, preferred_skills),
          source_confidence = ?,
          completeness_score = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      job.title,
      job.company,
      job.location,
      job.url,
      canonicalUrl || job.url,
      job.description,
      job.salary,
      job.experienceMin,
      job.experienceMax,
      job.postedAt || existing.posted_at,
      sourceConf,
      job.source || existing.source || 'direct',
      job.workMode || 'onsite',
      job.workMode || 'onsite',
      job.workMode || 'onsite',
      job.employmentType || 'full_time',
      reqSkillsJson,
      prefSkillsJson,
      bestSourceConf,
      bestCompScore,
      jobId
    );
  } else {
    const result = db.prepare(`
      INSERT INTO jobs (
        external_slug, source, title, company, location, url, canonical_url, description, salary, 
        posted_at, experience_min, experience_max, status, verification_status,
        work_mode, employment_type, required_skills, preferred_skills, source_confidence, completeness_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.externalSlug || `gen-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      job.source || 'direct',
      job.title,
      job.company,
      job.location,
      job.url,
      canonicalUrl || job.url,
      job.description,
      job.salary,
      job.postedAt || null,
      job.experienceMin,
      job.experienceMax,
      'discovered',
      'unverified',
      job.workMode || 'onsite',
      job.employmentType || 'full_time',
      reqSkillsJson,
      prefSkillsJson,
      sourceConf,
      compScore
    );
    jobId = Number(result.lastInsertRowid);
  }

  // Always compute or update evaluation
  const evalResult = evaluateJobFit(job);
  db.prepare(`
    INSERT INTO job_evaluations (
      job_id, score, rating, recommendation, fresher_eligible, summary_reason,
      skills_matched, skills_missing, seniority_score, skills_score, location_score, role_score, evaluated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(job_id) DO UPDATE SET
      score = excluded.score,
      rating = excluded.rating,
      recommendation = excluded.recommendation,
      fresher_eligible = excluded.fresher_eligible,
      summary_reason = excluded.summary_reason,
      skills_matched = excluded.skills_matched,
      skills_missing = excluded.skills_missing,
      seniority_score = excluded.seniority_score,
      skills_score = excluded.skills_score,
      location_score = excluded.location_score,
      role_score = excluded.role_score,
      evaluated_at = datetime('now')
  `).run(
    jobId,
    evalResult.score,
    evalResult.rating,
    evalResult.recommendation,
    evalResult.fresherEligible,
    evalResult.summaryReason,
    JSON.stringify(evalResult.matchedSkills),
    JSON.stringify(evalResult.missingSkills),
    evalResult.breakdown.seniorityScore,
    evalResult.breakdown.skillsScore,
    evalResult.breakdown.locationScore,
    evalResult.breakdown.roleScore
  );

  return { success: true, isValid: true, jobId, isNew: !existing, evaluation: evalResult, validation };
}

export function getJobs({ status, recommendation, minScore = 0, source, location, workMode, verificationStatus, limit = 50, offset = 0 } = {}) {
  const db = getDatabase();

  let query = `
    SELECT 
      j.id, j.external_slug, j.source, j.title, j.company, j.location, j.url, j.canonical_url,
      j.salary, j.posted_at, j.experience_min, j.experience_max, j.status, 
      j.last_verified_at, j.verification_status, j.verification_reason,
      j.work_mode, j.employment_type, j.source_confidence, j.completeness_score,
      j.required_skills, j.preferred_skills, j.created_at,
      e.score, e.rating, e.recommendation, e.fresher_eligible, e.summary_reason,
      e.skills_matched, e.skills_missing, e.seniority_score, e.skills_score, e.location_score, e.role_score
    FROM jobs j
    LEFT JOIN job_evaluations e ON j.id = e.job_id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    query += ` AND j.status = ?`;
    params.push(status);
  }

  if (recommendation) {
    query += ` AND e.recommendation = ?`;
    params.push(recommendation);
  }

  if (minScore > 0) {
    query += ` AND e.score >= ?`;
    params.push(minScore);
  }

  if (source && source !== 'all') {
    query += ` AND LOWER(j.source) = LOWER(?)`;
    params.push(source);
  }

  if (workMode && workMode !== 'all') {
    query += ` AND LOWER(j.work_mode) = LOWER(?)`;
    params.push(workMode);
  }

  if (verificationStatus && verificationStatus !== 'all') {
    query += ` AND LOWER(j.verification_status) = LOWER(?)`;
    params.push(verificationStatus);
  }

  if (location && location !== 'all') {
    const locLower = location.toLowerCase();
    if (locLower === 'bengaluru' || locLower === 'bangalore') {
      query += ` AND (LOWER(j.location) LIKE '%bengaluru%' OR LOWER(j.location) LIKE '%bangalore%' OR LOWER(j.location) LIKE '%karnataka%')`;
    } else if (locLower === 'remote') {
      query += ` AND (LOWER(j.location) LIKE '%remote%' OR LOWER(j.work_mode) = 'remote')`;
    } else {
      query += ` AND LOWER(j.location) LIKE ?`;
      params.push(`%${locLower}%`);
    }
  }

  query += ` ORDER BY e.score DESC, j.id DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params);

  return rows.map(r => ({
    ...r,
    skills_matched: r.skills_matched ? JSON.parse(r.skills_matched) : [],
    skills_missing: r.skills_missing ? JSON.parse(r.skills_missing) : [],
    required_skills: r.required_skills ? JSON.parse(r.required_skills) : [],
    preferred_skills: r.preferred_skills ? JSON.parse(r.preferred_skills) : []
  }));
}

export function getJobById(id) {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!row) return null;
  return {
    ...row,
    skills: row.skills ? JSON.parse(row.skills) : [],
    required_skills: row.required_skills ? JSON.parse(row.required_skills) : [],
    preferred_skills: row.preferred_skills ? JSON.parse(row.preferred_skills) : []
  };
}

export function updateJobStatus(jobId, newStatus) {
  const validStatuses = ['discovered', 'saved', 'evaluating', 'ready_to_apply', 'applied', 'interviewing', 'offer', 'rejected', 'dismissed'];
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}`);
  }

  const db = getDatabase();
  db.prepare(`UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(newStatus, jobId);
  db.prepare(`INSERT INTO activity_audit_log (action, details) VALUES (?, ?)`).run(
    'STATUS_CHANGE',
    `Job ID ${jobId} status changed to ${newStatus}`
  );
  return { success: true, jobId, newStatus };
}

export function recordScanHistory({ source, targetName = null, query = null, jobsFound = 0, newJobsAdded = 0, jobsUpdated = 0, durationMs = 0, status = 'success', errorMessage = null } = {}) {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO scan_history (
      source, target_name, query, jobs_found, new_jobs_added, jobs_updated, duration_ms, status, error_message, scanned_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(source, targetName, query, jobsFound, newJobsAdded, jobsUpdated, durationMs, status, errorMessage);
}

export function getScanHistory(limit = 20) {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM scan_history 
    ORDER BY id DESC 
    LIMIT ?
  `).all(limit);
}

export function getStats() {
  const db = getDatabase();

  const total = db.prepare('SELECT count(*) as count FROM jobs').get().count;
  const recommended = db.prepare("SELECT count(*) as count FROM job_evaluations WHERE recommendation = 'RECOMMENDED'").get().count;
  const consider = db.prepare("SELECT count(*) as count FROM job_evaluations WHERE recommendation = 'CONSIDER'").get().count;
  const rejected = db.prepare("SELECT count(*) as count FROM job_evaluations WHERE recommendation = 'REJECTED'").get().count;
  const saved = db.prepare("SELECT count(*) as count FROM jobs WHERE status = 'saved'").get().count;
  const applied = db.prepare("SELECT count(*) as count FROM jobs WHERE status = 'applied'").get().count;

  // Breakdown by sources
  const bySource = db.prepare(`
    SELECT source, count(*) as count 
    FROM jobs 
    GROUP BY source 
    ORDER BY count DESC
  `).all();

  return {
    totalScanned: total,
    recommended,
    consider,
    rejected,
    saved,
    applied,
    bySource
  };
}
