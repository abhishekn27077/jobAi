import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'career_vault.db');

export function getDatabase() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new DatabaseSync(DB_PATH);
  initSchema(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_slug TEXT UNIQUE,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT,
      url TEXT NOT NULL,
      canonical_url TEXT,
      description TEXT,
      salary TEXT,
      posted_at TEXT,
      experience_min INTEGER,
      experience_max INTEGER,
      status TEXT DEFAULT 'discovered',
      last_verified_at TEXT,
      verification_status TEXT DEFAULT 'unverified',
      verification_reason TEXT,
      work_mode TEXT DEFAULT 'onsite',
      employment_type TEXT DEFAULT 'full_time',
      required_skills TEXT,
      preferred_skills TEXT,
      source_confidence REAL DEFAULT 1.0,
      completeness_score REAL DEFAULT 1.0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS job_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL UNIQUE,
      score REAL NOT NULL,
      rating INTEGER NOT NULL,
      recommendation TEXT NOT NULL,
      fresher_eligible INTEGER NOT NULL,
      summary_reason TEXT NOT NULL,
      skills_matched TEXT,
      skills_missing TEXT,
      seniority_score REAL,
      skills_score REAL,
      location_score REAL,
      role_score REAL,
      evaluated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      target_name TEXT,
      query TEXT,
      jobs_found INTEGER DEFAULT 0,
      new_jobs_added INTEGER DEFAULT 0,
      jobs_updated INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      status TEXT DEFAULT 'success',
      error_message TEXT,
      scanned_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL UNIQUE,
      portal_type TEXT,
      resume_version TEXT,
      cover_letter_path TEXT,
      applied_date TEXT,
      user_approved INTEGER DEFAULT 0,
      confirmation_number TEXT,
      notes TEXT,
      status TEXT DEFAULT 'preparing',
      job_url TEXT,
      job_source TEXT,
      checklist_json TEXT,
      screening_answers_json TEXT,
      status_history_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS communications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      message_id TEXT UNIQUE,
      thread_id TEXT,
      sender TEXT,
      recipient TEXT,
      subject TEXT,
      body TEXT,
      direction TEXT,
      category TEXT,
      urgency TEXT DEFAULT 'LOW',
      extracted_data_json TEXT,
      confidence TEXT DEFAULT 'high',
      requires_manual_review INTEGER DEFAULT 0,
      received_at TEXT,
      approval_status TEXT DEFAULT 'pending_approval',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      communication_id INTEGER,
      external_event_id TEXT UNIQUE,
      title TEXT NOT NULL,
      company TEXT,
      role TEXT,
      recruiter_name TEXT,
      recruiter_email TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      timezone TEXT DEFAULT 'Asia/Kolkata',
      meeting_link TEXT,
      location TEXT,
      description TEXT,
      status TEXT DEFAULT 'proposed',
      conflict_detected INTEGER DEFAULT 0,
      conflict_details TEXT,
      user_approved INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (communication_id) REFERENCES communications(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS follow_up_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      application_id INTEGER,
      communication_id INTEGER,
      reminder_type TEXT NOT NULL,
      title TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'medium',
      notes TEXT,
      suggested_action TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
      FOREIGN KEY (communication_id) REFERENCES communications(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS email_sync_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      synced_at TEXT DEFAULT (datetime('now')),
      messages_found INTEGER DEFAULT 0,
      messages_imported INTEGER DEFAULT 0,
      messages_skipped_duplicate INTEGER DEFAULT 0,
      interviews_detected INTEGER DEFAULT 0,
      assessments_detected INTEGER DEFAULT 0,
      status TEXT DEFAULT 'success',
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      round_name TEXT,
      scheduled_at TEXT,
      confirmed_by_user INTEGER DEFAULT 0,
      meeting_link TEXT,
      status TEXT DEFAULT 'scheduled',
      prep_notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS resume_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      company TEXT NOT NULL,
      job_title TEXT NOT NULL,
      jd_snapshot TEXT,
      template TEXT DEFAULT 'ats_professional',
      generation_mode TEXT DEFAULT 'deterministic',
      resume_content_json TEXT NOT NULL,
      resume_markdown TEXT NOT NULL,
      ats_score REAL NOT NULL,
      ats_breakdown_json TEXT NOT NULL,
      missing_keywords_json TEXT,
      matched_keywords_json TEXT,
      version_number INTEGER NOT NULL DEFAULT 1,
      is_approved INTEGER DEFAULT 0,
      pdf_path TEXT,
      docx_path TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS skill_roadmap (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_name TEXT NOT NULL UNIQUE,
      category TEXT DEFAULT 'general',
      status TEXT DEFAULT 'missing',
      priority TEXT DEFAULT 'medium',
      market_frequency INTEGER DEFAULT 0,
      is_mandatory_demand INTEGER DEFAULT 0,
      target_completion_date TEXT,
      verified_evidence TEXT,
      learning_resources_json TEXT,
      recommended_project_idea TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS interview_stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      context_source TEXT NOT NULL,
      situation TEXT NOT NULL,
      task TEXT NOT NULL,
      action TEXT NOT NULL,
      result TEXT NOT NULL,
      technologies TEXT,
      applicable_questions_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mock_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      interview_type TEXT DEFAULT 'technical',
      target_role TEXT,
      target_company TEXT,
      total_questions INTEGER DEFAULT 0,
      completed_questions INTEGER DEFAULT 0,
      overall_score REAL DEFAULT 0.0,
      feedback_summary TEXT,
      qa_log_json TEXT,
      status TEXT DEFAULT 'completed',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS salary_comparisons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      offer_name TEXT NOT NULL,
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      location TEXT,
      work_mode TEXT DEFAULT 'onsite',
      ctc_annual REAL NOT NULL,
      fixed_base_annual REAL NOT NULL,
      variable_annual REAL DEFAULT 0,
      joining_bonus REAL DEFAULT 0,
      tax_regime TEXT DEFAULT 'new_2024',
      monthly_in_hand_est REAL NOT NULL,
      annual_in_hand_est REAL NOT NULL,
      monthly_deductions_json TEXT,
      cost_of_living_est REAL DEFAULT 0,
      net_monthly_savings_est REAL NOT NULL,
      learning_score INTEGER DEFAULT 3,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS company_research (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL UNIQUE,
      overview TEXT,
      products_services TEXT,
      tech_stack_json TEXT,
      interview_experience_notes TEXT,
      career_page_url TEXT,
      recruiter_info_json TEXT,
      verified_status TEXT DEFAULT 'unverified',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS automation_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      is_enabled INTEGER DEFAULT 1,
      interval_minutes INTEGER NOT NULL,
      last_run_at TEXT,
      next_run_at TEXT,
      last_status TEXT DEFAULT 'idle',
      last_error TEXT,
      consecutive_failures INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS automation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_key TEXT NOT NULL,
      task_name TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      status TEXT NOT NULL,
      items_processed INTEGER DEFAULT 0,
      summary TEXT,
      error_message TEXT,
      retry_attempt INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
    CREATE INDEX IF NOT EXISTS idx_eval_score ON job_evaluations(score);
    CREATE INDEX IF NOT EXISTS idx_eval_recommendation ON job_evaluations(recommendation);
    CREATE INDEX IF NOT EXISTS idx_resume_versions_job ON resume_versions(job_id);
    CREATE INDEX IF NOT EXISTS idx_resume_versions_version ON resume_versions(job_id, version_number);
    CREATE INDEX IF NOT EXISTS idx_skill_roadmap_status ON skill_roadmap(status);
    CREATE INDEX IF NOT EXISTS idx_skill_roadmap_priority ON skill_roadmap(priority);
    CREATE INDEX IF NOT EXISTS idx_mock_interviews_job ON mock_interviews(job_id);
    CREATE INDEX IF NOT EXISTS idx_stories_category ON interview_stories(category);
    CREATE INDEX IF NOT EXISTS idx_salary_comp ON salary_comparisons(company);
    CREATE INDEX IF NOT EXISTS idx_auto_runs_key ON automation_runs(task_key);
    CREATE INDEX IF NOT EXISTS idx_auto_runs_started ON automation_runs(started_at);
  `);

  // Safe migration for existing databases
  const migrations = [
    'ALTER TABLE jobs ADD COLUMN canonical_url TEXT',
    'ALTER TABLE jobs ADD COLUMN last_verified_at TEXT',
    "ALTER TABLE jobs ADD COLUMN verification_status TEXT DEFAULT 'unverified'",
    'ALTER TABLE jobs ADD COLUMN verification_reason TEXT',
    "ALTER TABLE jobs ADD COLUMN work_mode TEXT DEFAULT 'onsite'",
    "ALTER TABLE jobs ADD COLUMN employment_type TEXT DEFAULT 'full_time'",
    'ALTER TABLE jobs ADD COLUMN required_skills TEXT',
    'ALTER TABLE jobs ADD COLUMN preferred_skills TEXT',
    'ALTER TABLE jobs ADD COLUMN source_confidence REAL DEFAULT 1.0',
    'ALTER TABLE jobs ADD COLUMN completeness_score REAL DEFAULT 1.0',
    "ALTER TABLE applications ADD COLUMN status TEXT DEFAULT 'preparing'",
    "ALTER TABLE applications ADD COLUMN job_url TEXT",
    "ALTER TABLE applications ADD COLUMN job_source TEXT",
    "ALTER TABLE applications ADD COLUMN checklist_json TEXT",
    "ALTER TABLE applications ADD COLUMN screening_answers_json TEXT",
    "ALTER TABLE applications ADD COLUMN status_history_json TEXT",
    "ALTER TABLE applications ADD COLUMN rejection_reason TEXT",
    "ALTER TABLE applications ADD COLUMN rejection_reason_type TEXT DEFAULT 'unknown'",
    "ALTER TABLE applications ADD COLUMN response_date TEXT",
    "ALTER TABLE applications ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))",
    "ALTER TABLE communications ADD COLUMN message_id TEXT",
    "ALTER TABLE communications ADD COLUMN thread_id TEXT",
    "ALTER TABLE communications ADD COLUMN category TEXT",
    "ALTER TABLE communications ADD COLUMN urgency TEXT DEFAULT 'LOW'",
    "ALTER TABLE communications ADD COLUMN extracted_data_json TEXT",
    "ALTER TABLE communications ADD COLUMN confidence TEXT DEFAULT 'high'",
    "ALTER TABLE communications ADD COLUMN requires_manual_review INTEGER DEFAULT 0",
    "ALTER TABLE communications ADD COLUMN received_at TEXT",
    "ALTER TABLE communications ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))"
  ];
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists or already migrated
    }
  }

  // Create indexes on migrated and scan_history columns
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_jobs_canonical ON jobs(canonical_url);
      CREATE INDEX IF NOT EXISTS idx_jobs_verification ON jobs(verification_status);
      CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);
      CREATE INDEX IF NOT EXISTS idx_jobs_work_mode ON jobs(work_mode);
      CREATE INDEX IF NOT EXISTS idx_scan_history_source ON scan_history(source);
      CREATE INDEX IF NOT EXISTS idx_scan_history_scanned ON scan_history(scanned_at);
      CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
      CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id);
      CREATE INDEX IF NOT EXISTS idx_communications_msg_id ON communications(message_id);
      CREATE INDEX IF NOT EXISTS idx_communications_category ON communications(category);
      CREATE INDEX IF NOT EXISTS idx_cal_start ON calendar_events(start_time);
      CREATE INDEX IF NOT EXISTS idx_cal_job ON calendar_events(job_id);
      CREATE INDEX IF NOT EXISTS idx_cal_status ON calendar_events(status);
      CREATE INDEX IF NOT EXISTS idx_reminders_due ON follow_up_reminders(due_date);
      CREATE INDEX IF NOT EXISTS idx_reminders_status ON follow_up_reminders(status);
      CREATE INDEX IF NOT EXISTS idx_reminders_job ON follow_up_reminders(job_id);
    `);
  } catch {
    // Safe fallback
  }
}
