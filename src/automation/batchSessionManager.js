/**
 * CareerOS — Controlled Sequential Batch Application Preparation Assistant
 * Validates queues against duplicate applications, expiry, and eligibility;
 * prepares job-specific ATS PDFs and screening dossiers one by one;
 * pauses for human review and confirmation before advancing.
 */

import { getDatabase } from '../db/schema.js';
import { checkDuplicateApplication, updateApplicationStatus } from '../tracker/applicationTracker.js';
import { prepareApplication } from './applicationWorkflow.js';
import { evaluateJobFit } from '../matcher/scoringEngine.js';

const PAUSE_TRIGGER_REASONS = {
  PROTECTED_PORTAL: 'Portal is protected by login wall, CAPTCHA, or anti-bot verification. Open manually to submit.',
  INACCESSIBLE: 'Job URL could not be reached for pre-fill verification. Verify link manually.',
  NEEDS_USER_ANSWERS: 'Application has screening questions requiring your review or custom input.',
  UNSUPPORTED_FORM: 'Portal uses a custom/unsupported form. Download the generated ATS PDF and apply manually.'
};

/**
 * Validates candidate jobs for a batch preparation session, categorizing exclusions cleanly.
 */
export function validateBatchQueue({ mode = 'selected', jobIds = [] } = {}) {
  const db = getDatabase();
  let candidates = [];

  if (mode === 'selected' && Array.isArray(jobIds) && jobIds.length > 0) {
    const placeholders = jobIds.map(() => '?').join(',');
    candidates = db.prepare(`
      SELECT j.*, e.score, e.recommendation, e.fresher_eligible, e.summary_reason
      FROM jobs j
      LEFT JOIN job_evaluations e ON j.id = e.job_id
      WHERE j.id IN (${placeholders})
    `).all(...jobIds);
  } else {
    let whereClause = `WHERE j.status NOT IN ('dismissed', 'applied', 'interviewing', 'offer', 'rejected')`;
    if (mode === 'apply_first') {
      whereClause += ` AND e.recommendation = 'RECOMMENDED' AND e.fresher_eligible = 1 AND e.score >= 80`;
    } else if (mode === 'strong_matches') {
      whereClause += ` AND e.recommendation = 'RECOMMENDED' AND e.fresher_eligible = 1`;
    } else {
      whereClause += ` AND e.fresher_eligible = 1`;
    }
    candidates = db.prepare(`
      SELECT j.*, e.score, e.recommendation, e.fresher_eligible, e.summary_reason
      FROM jobs j
      LEFT JOIN job_evaluations e ON j.id = e.job_id
      ${whereClause}
      ORDER BY COALESCE(e.score, 0) DESC, j.id DESC
      LIMIT 25
    `).all();
  }

  const ready = [];
  const alreadyApplied = [];
  const duplicates = [];
  const expired = [];
  const ineligible = [];
  const needsAnswers = [];
  const inaccessible = [];

  const seenCanonical = new Set();

  for (const job of candidates) {
    // 1. Expired / closed check
    if (job.status === 'expired' || job.verification_status === 'expired' || job.recommendation === 'EXPIRED') {
      expired.push({ id: job.id, title: job.title, company: job.company, reason: 'Expired or closed' });
      continue;
    }

    // 2. Duplicate / Already Applied check
    const dup = checkDuplicateApplication(job);
    if (dup.state === 'ALREADY_APPLIED') {
      alreadyApplied.push({ id: job.id, title: job.title, company: job.company, reason: dup.reason });
      continue;
    }
    if (dup.state === 'APPLICATION_IN_PROGRESS' && mode !== 'selected') {
      duplicates.push({ id: job.id, title: job.title, company: job.company, reason: dup.reason });
      continue;
    }
    const canon = (job.canonical_url || job.url || '').toLowerCase();
    if (canon && seenCanonical.has(canon)) {
      duplicates.push({ id: job.id, title: job.title, company: job.company, reason: 'Duplicate URL in current selection' });
      continue;
    }
    if (canon) seenCanonical.add(canon);

    // 3. Eligibility check
    const evalFit = job.fresher_eligible !== undefined && job.fresher_eligible !== null
      ? { fresherEligible: job.fresher_eligible, summaryReason: job.summary_reason }
      : evaluateJobFit(job);
    if (evalFit.fresherEligible === 0) {
      ineligible.push({ id: job.id, title: job.title, company: job.company, reason: evalFit.summaryReason || 'Not fresher-eligible' });
      continue;
    }

    // 4. Portal accessibility flags (still queueable for manual preparation, but flagged)
    if (job.verification_status === 'inaccessible') {
      inaccessible.push({ id: job.id, title: job.title, company: job.company, reason: 'Portal link inaccessible' });
    } else if (job.verification_status === 'blocked') {
      needsAnswers.push({ id: job.id, title: job.title, company: job.company, reason: 'Protected portal — manual review required' });
    }

    ready.push({
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      source: job.source,
      score: Math.round(job.score || 0),
      url: job.url
    });
  }

  return {
    mode,
    totalScanned: candidates.length,
    ready,
    excluded: {
      alreadyApplied,
      duplicates,
      expired,
      ineligible
    },
    warnings: {
      needsAnswers,
      inaccessible
    }
  };
}

/**
 * Creates and persists a new Batch Application Preparation Session in SQLite.
 */
export function createBatchSession({ name = null, mode = 'selected', jobIds = [] } = {}) {
  const db = getDatabase();
  const validation = validateBatchQueue({ mode, jobIds });

  if (validation.ready.length === 0) {
    throw new Error('No eligible, non-duplicate, active jobs available to queue for this batch session.');
  }

  const sessionName = name || `Batch Session (${mode.replace(/_/g, ' ')}) — ${new Date().toISOString().slice(0, 10)}`;

  const info = db.prepare(`
    INSERT INTO batch_sessions (name, status, selection_mode, total_count, current_index, summary_json)
    VALUES (?, 'idle', ?, ?, 0, ?)
  `).run(
    sessionName,
    mode,
    validation.ready.length,
    JSON.stringify({
      excluded: validation.excluded,
      warnings: validation.warnings
    })
  );

  const sessionId = info.lastInsertRowid;

  const insertItem = db.prepare(`
    INSERT INTO batch_session_items (session_id, job_id, priority_rank, status)
    VALUES (?, ?, ?, 'queued')
  `);

  validation.ready.forEach((job, idx) => {
    insertItem.run(sessionId, job.id, idx + 1);
  });

  return getBatchSession(sessionId);
}

export function getBatchSession(sessionId) {
  const db = getDatabase();
  const session = db.prepare('SELECT * FROM batch_sessions WHERE id = ?').get(sessionId);
  if (!session) return null;

  const items = db.prepare(`
    SELECT bsi.*, j.title, j.company, j.location, j.url, j.source, j.verification_status
    FROM batch_session_items bsi
    JOIN jobs j ON bsi.job_id = j.id
    WHERE bsi.session_id = ?
    ORDER BY bsi.priority_rank ASC
  `).all(sessionId);

  const counts = {
    total: items.length,
    queued: items.filter(i => i.status === 'queued').length,
    preparing: items.filter(i => i.status === 'preparing').length,
    awaitingReview: items.filter(i => i.status === 'awaiting_review').length,
    needsInfo: items.filter(i => i.status === 'needs_info').length,
    skipped: items.filter(i => i.status === 'skipped').length,
    applied: items.filter(i => i.status === 'applied').length,
    failed: items.filter(i => i.status === 'failed').length
  };

  const currentItem = items.find(i => ['preparing', 'awaiting_review', 'needs_info', 'queued'].includes(i.status)) || null;

  return {
    ...session,
    summary: session.summary_json ? JSON.parse(session.summary_json) : {},
    counts,
    currentItem,
    items
  };
}

export function getActiveBatchSession() {
  const db = getDatabase();
  const latest = db.prepare(`
    SELECT id FROM batch_sessions
    WHERE status IN ('idle', 'running', 'paused')
    ORDER BY id DESC LIMIT 1
  `).get();
  if (!latest) {
    const anyLatest = db.prepare('SELECT id FROM batch_sessions ORDER BY id DESC LIMIT 1').get();
    return anyLatest ? getBatchSession(anyLatest.id) : null;
  }
  return getBatchSession(latest.id);
}

/**
 * Prepares the next queued job in the session and pauses for human review & external submission.
 */
export async function prepareNextBatchItem(sessionId) {
  const db = getDatabase();
  const session = getBatchSession(sessionId);
  if (!session) throw new Error(`Batch session #${sessionId} not found.`);
  if (session.status === 'stopped' || session.status === 'completed') {
    return session;
  }

  // If an item is already awaiting review or needs info, do not skip past it
  const pendingReview = session.items.find(i => i.status === 'awaiting_review' || i.status === 'needs_info');
  if (pendingReview) {
    db.prepare(`UPDATE batch_sessions SET status = 'paused', updated_at = datetime('now') WHERE id = ?`).run(sessionId);
    return getBatchSession(sessionId);
  }

  const nextItem = session.items.find(i => i.status === 'queued');
  if (!nextItem) {
    db.prepare(`UPDATE batch_sessions SET status = 'completed', updated_at = datetime('now') WHERE id = ?`).run(sessionId);
    return getBatchSession(sessionId);
  }

  db.prepare(`UPDATE batch_sessions SET status = 'running', updated_at = datetime('now') WHERE id = ?`).run(sessionId);
  db.prepare(`UPDATE batch_session_items SET status = 'preparing', updated_at = datetime('now') WHERE id = ?`).run(nextItem.id);

  try {
    // Re-check duplicate before preparing
    const dup = checkDuplicateApplication(nextItem.job_id);
    if (dup.state === 'ALREADY_APPLIED') {
      db.prepare(`
        UPDATE batch_session_items
        SET status = 'skipped', pause_reason = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(`Already applied: ${dup.reason}`, nextItem.id);
      return prepareNextBatchItem(sessionId);
    }

    const prep = await prepareApplication(nextItem.job_id);
    const resumeTag = prep.resumeVersion ? `v${prep.resumeVersion.versionNumber || prep.resumeVersion.version_number || 1}` : 'v1';

    let itemStatus = 'awaiting_review';
    let pauseReason = 'Application package ready. Review tailored ATS PDF, open the official portal, apply manually, and confirm submission.';

    if (prep.isExpired) {
      db.prepare(`
        UPDATE batch_session_items
        SET status = 'skipped', pause_reason = 'Job expired or closed during verification.', updated_at = datetime('now')
        WHERE id = ?
      `).run(nextItem.id);
      return prepareNextBatchItem(sessionId);
    }

    if (prep.freshness?.verificationStatus === 'blocked') {
      itemStatus = 'needs_info';
      pauseReason = PAUSE_TRIGGER_REASONS.PROTECTED_PORTAL;
    } else if (prep.freshness?.verificationStatus === 'inaccessible') {
      itemStatus = 'needs_info';
      pauseReason = PAUSE_TRIGGER_REASONS.INACCESSIBLE;
    } else if (prep.readiness && prep.readiness.ready === false) {
      itemStatus = 'needs_info';
      pauseReason = PAUSE_TRIGGER_REASONS.NEEDS_USER_ANSWERS;
    }

    db.prepare(`
      UPDATE batch_session_items
      SET status = ?, pause_reason = ?, resume_version = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(itemStatus, pauseReason, resumeTag, nextItem.id);

    // Always pause after preparing an item so user retains control over final submission
    db.prepare(`UPDATE batch_sessions SET status = 'paused', updated_at = datetime('now') WHERE id = ?`).run(sessionId);
    return getBatchSession(sessionId);
  } catch (err) {
    db.prepare(`
      UPDATE batch_session_items
      SET status = 'failed', pause_reason = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(err.message, nextItem.id);
    db.prepare(`UPDATE batch_sessions SET status = 'paused', updated_at = datetime('now') WHERE id = ?`).run(sessionId);
    return getBatchSession(sessionId);
  }
}

/**
 * Executes user control actions on a Batch Application Preparation Session.
 */
export async function controlBatchSession(sessionId, action, payload = {}) {
  const db = getDatabase();
  const session = getBatchSession(sessionId);
  if (!session) throw new Error(`Batch session #${sessionId} not found.`);

  const activeItem = session.currentItem;

  switch (action) {
    case 'start':
    case 'resume':
      return prepareNextBatchItem(sessionId);

    case 'pause':
      db.prepare(`UPDATE batch_sessions SET status = 'paused', updated_at = datetime('now') WHERE id = ?`).run(sessionId);
      return getBatchSession(sessionId);

    case 'stop':
      db.prepare(`UPDATE batch_sessions SET status = 'stopped', updated_at = datetime('now') WHERE id = ?`).run(sessionId);
      return getBatchSession(sessionId);

    case 'skip':
      if (activeItem) {
        db.prepare(`
          UPDATE batch_session_items
          SET status = 'skipped', pause_reason = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(payload.reason || 'Skipped by user', activeItem.id);
      }
      return prepareNextBatchItem(sessionId);

    case 'retry':
      if (activeItem && ['failed', 'needs_info'].includes(activeItem.status)) {
        db.prepare(`
          UPDATE batch_session_items
          SET status = 'queued', pause_reason = NULL, updated_at = datetime('now')
          WHERE id = ?
        `).run(activeItem.id);
      }
      return prepareNextBatchItem(sessionId);

    case 'confirm_applied':
      if (!activeItem) {
        throw new Error('No active queued job to confirm.');
      }
      updateApplicationStatus(activeItem.job_id, 'submitted', {
        userConfirmed: true,
        confirmationNumber: payload.confirmationNumber || null,
        notes: payload.notes || `Submitted during Batch Session #${sessionId}`
      });
      db.prepare(`
        UPDATE batch_session_items
        SET status = 'applied', pause_reason = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).run(activeItem.id);

      // Advance to next item if user requests auto-advance, else prepare next
      return prepareNextBatchItem(sessionId);

    default:
      throw new Error(`Unsupported batch session action: ${action}`);
  }
}
