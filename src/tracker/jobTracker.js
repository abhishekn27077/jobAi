import { getDatabase } from '../db/schema.js';
import { evaluateJobFit } from '../matcher/scoringEngine.js';

export function saveOrUpdateJob(job) {
  const db = getDatabase();

  const existing = db.prepare('SELECT id, status FROM jobs WHERE external_slug = ?').get(job.externalSlug);

  let jobId;
  if (existing) {
    jobId = existing.id;
    db.prepare(`
      UPDATE jobs 
      SET title = ?, company = ?, location = ?, url = ?, description = ?, salary = ?, 
          experience_min = ?, experience_max = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      job.title,
      job.company,
      job.location,
      job.url,
      job.description,
      job.salary,
      job.experienceMin,
      job.experienceMax,
      jobId
    );
  } else {
    const result = db.prepare(`
      INSERT INTO jobs (
        external_slug, source, title, company, location, url, description, salary, 
        posted_at, experience_min, experience_max, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.externalSlug,
      job.source,
      job.title,
      job.company,
      job.location,
      job.url,
      job.description,
      job.salary,
      job.postedAt,
      job.experienceMin,
      job.experienceMax,
      'discovered'
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

  return { jobId, isNew: !existing, evaluation: evalResult };
}

export function getJobs({ status, recommendation, minScore = 0, limit = 50, offset = 0 } = {}) {
  const db = getDatabase();

  let query = `
    SELECT 
      j.id, j.external_slug, j.source, j.title, j.company, j.location, j.url, 
      j.salary, j.posted_at, j.experience_min, j.experience_max, j.status, j.created_at,
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

  query += ` ORDER BY e.score DESC, j.id DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params);

  return rows.map(r => ({
    ...r,
    skills_matched: r.skills_matched ? JSON.parse(r.skills_matched) : [],
    skills_missing: r.skills_missing ? JSON.parse(r.skills_missing) : []
  }));
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

export function getStats() {
  const db = getDatabase();

  const total = db.prepare('SELECT count(*) as count FROM jobs').get().count;
  const recommended = db.prepare("SELECT count(*) as count FROM job_evaluations WHERE recommendation = 'RECOMMENDED'").get().count;
  const consider = db.prepare("SELECT count(*) as count FROM job_evaluations WHERE recommendation = 'CONSIDER'").get().count;
  const rejected = db.prepare("SELECT count(*) as count FROM job_evaluations WHERE recommendation = 'REJECTED'").get().count;
  const saved = db.prepare("SELECT count(*) as count FROM jobs WHERE status = 'saved'").get().count;
  const applied = db.prepare("SELECT count(*) as count FROM jobs WHERE status = 'applied'").get().count;

  return {
    totalScanned: total,
    recommended,
    consider,
    rejected,
    saved,
    applied
  };
}
