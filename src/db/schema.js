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
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_slug TEXT UNIQUE,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT,
      url TEXT NOT NULL,
      description TEXT,
      salary TEXT,
      posted_at TEXT,
      experience_min INTEGER,
      experience_max INTEGER,
      status TEXT DEFAULT 'discovered',
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
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS communications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      sender TEXT,
      recipient TEXT,
      subject TEXT,
      body TEXT,
      direction TEXT,
      approval_status TEXT DEFAULT 'pending_approval',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
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

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
    CREATE INDEX IF NOT EXISTS idx_eval_score ON job_evaluations(score);
    CREATE INDEX IF NOT EXISTS idx_eval_recommendation ON job_evaluations(recommendation);
    CREATE INDEX IF NOT EXISTS idx_resume_versions_job ON resume_versions(job_id);
    CREATE INDEX IF NOT EXISTS idx_resume_versions_version ON resume_versions(job_id, version_number);
  `);
}
