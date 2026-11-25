import { getDatabase } from '../db/schema.js';

export const VALID_INTERVIEW_STAGES = [
  'applied',
  'recruiter_screening',
  'hr_interview',
  'technical_interview',
  'coding_assessment',
  'assignment',
  'technical_round_2',
  'managerial_round',
  'final_interview',
  'offer',
  'rejected',
  'withdrawn'
];

export const STAGE_DISPLAY_NAMES = {
  applied: 'Applied',
  recruiter_screening: 'Recruiter Screening',
  hr_interview: 'HR Interview',
  technical_interview: 'Technical Round 1',
  coding_assessment: 'Coding Assessment',
  assignment: 'Take-home Assignment',
  technical_round_2: 'Technical Round 2',
  managerial_round: 'Managerial Round',
  final_interview: 'Final Interview',
  offer: 'Job Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn'
};

/**
 * Schedule a new interview round with duplicate prevention and user confirmation
 */
export function scheduleInterview(jobId, interviewData = {}) {
  const db = getDatabase();

  const job = db.prepare('SELECT id, title, company FROM jobs WHERE id = ?').get(jobId);
  if (!job) {
    throw new Error(`Job not found with id: ${jobId}`);
  }

  const {
    roundName = 'Recruiter Screening',
    stage = 'recruiter_screening',
    scheduledAt = new Date().toISOString(),
    interviewMode = 'video',
    interviewerInfo = '',
    meetingLink = '',
    timezone = 'Asia/Kolkata',
    prepStatus = 'pending',
    prepNotes = '',
    confirmedByUser = 0
  } = interviewData;

  if (!VALID_INTERVIEW_STAGES.includes(stage)) {
    throw new Error(`Invalid interview stage: ${stage}. Must be one of: ${VALID_INTERVIEW_STAGES.join(', ')}`);
  }

  // Prevent duplicate interview scheduled at the exact same time for the same job
  const existingDuplicate = db.prepare(`
    SELECT id, round_name, scheduled_at FROM interviews
    WHERE job_id = ? AND scheduled_at = ? AND outcome != 'rescheduled' AND outcome != 'cancelled'
  `).get(jobId, scheduledAt);

  if (existingDuplicate) {
    return {
      success: false,
      duplicateDetected: true,
      existingId: existingDuplicate.id,
      message: `An interview round (${existingDuplicate.round_name}) is already scheduled for this role at ${scheduledAt}.`
    };
  }

  const res = db.prepare(`
    INSERT INTO interviews (
      job_id, round_name, stage, scheduled_at, confirmed_by_user,
      meeting_link, interview_mode, interviewer_info, prep_status,
      prep_notes, outcome, timezone, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'), datetime('now'))
  `).run(
    jobId,
    roundName,
    stage,
    scheduledAt,
    confirmedByUser ? 1 : 0,
    meetingLink || '',
    interviewMode || 'video',
    typeof interviewerInfo === 'object' ? JSON.stringify(interviewerInfo) : (interviewerInfo || ''),
    prepStatus || 'pending',
    prepNotes || '',
    timezone || 'Asia/Kolkata'
  );

  const interviewId = Number(res.lastInsertRowid);

  // Sync to calendar_events if confirmed by user
  try {
    const endAt = new Date(new Date(scheduledAt).getTime() + 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO calendar_events (
        job_id, title, company, role, start_time, end_time,
        timezone, meeting_link, status, user_approved, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      jobId,
      `${roundName} - ${job.company}`,
      job.company,
      job.title,
      scheduledAt,
      endAt,
      timezone || 'Asia/Kolkata',
      meetingLink || '',
      confirmedByUser ? 'confirmed' : 'proposed',
      confirmedByUser ? 1 : 0
    );
  } catch (err) {
    // Non-blocking calendar event creation
  }

  // Also update application status if an application exists
  try {
    db.prepare(`
      UPDATE applications
      SET status = 'interviewing', updated_at = datetime('now')
      WHERE job_id = ?
    `).run(jobId);
  } catch (err) {}

  db.prepare(`
    INSERT INTO activity_audit_log (action, details)
    VALUES (?, ?)
  `).run(
    'INTERVIEW_SCHEDULED',
    `Scheduled ${roundName} (${stage}) for Job #${jobId} (${job.company} - ${job.title}) at ${scheduledAt}`
  );

  return {
    success: true,
    interviewId,
    jobId,
    company: job.company,
    role: job.title,
    roundName,
    stage,
    scheduledAt,
    confirmedByUser: Boolean(confirmedByUser),
    timezone
  };
}

/**
 * Update an interview's stage, outcome, and notes
 */
export function updateInterviewStage(interviewId, newStage, details = {}) {
  const db = getDatabase();

  const interview = db.prepare('SELECT * FROM interviews WHERE id = ?').get(interviewId);
  if (!interview) {
    throw new Error(`Interview not found with id: ${interviewId}`);
  }

  if (newStage && !VALID_INTERVIEW_STAGES.includes(newStage)) {
    throw new Error(`Invalid stage: ${newStage}. Must be one of: ${VALID_INTERVIEW_STAGES.join(', ')}`);
  }

  const {
    outcome = interview.outcome || 'pending',
    nextAction = interview.next_action || '',
    followUpDate = interview.follow_up_date || null,
    prepStatus = interview.prep_status || 'pending',
    prepNotes = details.prepNotes !== undefined ? details.prepNotes : interview.prep_notes,
    confirmedByUser = details.confirmedByUser !== undefined ? (details.confirmedByUser ? 1 : 0) : interview.confirmed_by_user
  } = details;

  db.prepare(`
    UPDATE interviews
    SET stage = COALESCE(?, stage),
        outcome = ?,
        next_action = ?,
        follow_up_date = ?,
        prep_status = ?,
        prep_notes = ?,
        confirmed_by_user = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    newStage || null,
    outcome,
    nextAction,
    followUpDate,
    prepStatus,
    prepNotes,
    confirmedByUser,
    interviewId
  );

  db.prepare(`
    INSERT INTO activity_audit_log (action, details)
    VALUES (?, ?)
  `).run(
    'INTERVIEW_STAGE_UPDATED',
    `Updated Interview #${interviewId} stage to '${newStage || interview.stage}' with outcome '${outcome}'`
  );

  return db.prepare('SELECT * FROM interviews WHERE id = ?').get(interviewId);
}

/**
 * Get all interview rounds for a specific job
 */
export function getInterviewsForJob(jobId) {
  const db = getDatabase();
  return db.prepare(`
    SELECT i.*, j.title as job_title, j.company, j.location, j.url as job_url
    FROM interviews i
    JOIN jobs j ON i.job_id = j.id
    WHERE i.job_id = ?
    ORDER BY i.scheduled_at DESC, i.id DESC
  `).all(jobId);
}

/**
 * Get upcoming interviews across all jobs
 */
export function getUpcomingInterviews(limit = 10) {
  const db = getDatabase();
  return db.prepare(`
    SELECT i.*, j.title as job_title, j.company, j.location, j.url as job_url,
           j.salary, j.work_mode
    FROM interviews i
    JOIN jobs j ON i.job_id = j.id
    WHERE (i.outcome = 'pending' OR i.scheduled_at >= datetime('now'))
      AND i.outcome != 'cancelled'
    ORDER BY i.scheduled_at ASC
    LIMIT ?
  `).all(limit);
}

/**
 * Get aggregated interview pipeline analytics
 */
export function getPipelineAnalytics() {
  const db = getDatabase();

  const totalInterviewsRow = db.prepare('SELECT COUNT(*) as count FROM interviews').get();
  const totalInterviews = totalInterviewsRow ? totalInterviewsRow.count : 0;

  const stageBreakdown = {};
  for (const st of VALID_INTERVIEW_STAGES) {
    stageBreakdown[st] = 0;
  }

  const rows = db.prepare(`
    SELECT stage, COUNT(*) as count
    FROM interviews
    GROUP BY stage
  `).all();

  for (const r of rows) {
    if (stageBreakdown[r.stage] !== undefined) {
      stageBreakdown[r.stage] = r.count;
    }
  }

  const outcomeRows = db.prepare(`
    SELECT outcome, COUNT(*) as count
    FROM interviews
    GROUP BY outcome
  `).all();

  const outcomeBreakdown = { pending: 0, passed: 0, failed: 0, rescheduled: 0 };
  for (const r of outcomeRows) {
    if (outcomeBreakdown[r.outcome] !== undefined) {
      outcomeBreakdown[r.outcome] = r.count;
    }
  }

  const screeningCount = stageBreakdown.recruiter_screening + stageBreakdown.hr_interview;
  const techCount = stageBreakdown.technical_interview + stageBreakdown.coding_assessment + stageBreakdown.technical_round_2;
  const offerCount = stageBreakdown.offer;

  return {
    totalInterviews,
    stageBreakdown,
    outcomeBreakdown,
    conversionRates: {
      screeningToTechRate: screeningCount > 0 ? Number(((techCount / screeningCount) * 100).toFixed(1)) : null,
      techToOfferRate: techCount > 0 ? Number(((offerCount / techCount) * 100).toFixed(1)) : null
    },
    sampleSizeHonestyNotice: totalInterviews < 10
      ? `Small sample size (N=${totalInterviews} < 10) — conversion rates reflect individual progress rather than statistical population benchmarks.`
      : null
  };
}
