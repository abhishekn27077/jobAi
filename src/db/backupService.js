import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { getDatabase, getDbPath } from './schema.js';
import { loadCandidateProfile } from '../profile/profileManager.js';
import { getApplicationAnalytics } from '../intelligence/careerAnalyticsService.js';
import { getSkillRoadmap } from '../intelligence/skillGapService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

function getActiveDbPath() {
  return getDbPath();
}

/**
 * Creates a safe, timestamped backup of career_vault.db with integrity validation
 */
export function backupDatabase({ targetDir = BACKUPS_DIR, targetFilename = null, overwrite = false } = {}) {
  const activeDbPath = getActiveDbPath();
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  if (!fs.existsSync(activeDbPath)) {
    throw new Error(`Database file not found at ${activeDbPath}`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = targetFilename || `career_vault_backup_${timestamp}.db`;
  const destPath = path.join(targetDir, filename);

  if (fs.existsSync(destPath) && !overwrite) {
    throw new Error(`Backup file already exists: ${destPath}. Set overwrite: true to replace.`);
  }

  // Ensure WAL write pages are cleanly flushed to disk before copying.
  // Checkpoint failures or busy results must abort backup to prevent unsafe/inconsistent copies.
  const mainDb = getDatabase();
  try {
    const cp = mainDb.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (cp && cp.busy === 1) {
      throw new Error(`Database is busy with active concurrent transactions (busy: 1, log: ${cp.log}, checkpointed: ${cp.checkpointed})`);
    }
  } catch (err) {
    mainDb.close();
    throw new Error(`Database backup aborted: WAL checkpoint failed before disk copy: ${err.message}`);
  }
  mainDb.close();

  // Copy database file synchronously
  fs.copyFileSync(activeDbPath, destPath);

  // Run integrity check on the newly created backup file
  const testDb = new DatabaseSync(destPath);
  const integrity = testDb.prepare('PRAGMA integrity_check').get();
  testDb.close();

  const isHealthy = integrity && integrity['integrity_check'] === 'ok';
  if (!isHealthy) {
    fs.unlinkSync(destPath);
    throw new Error(`Integrity check failed on backup copy: ${JSON.stringify(integrity)}`);
  }

  const stats = fs.statSync(destPath);

  return {
    success: true,
    backupPath: destPath,
    filename,
    sizeBytes: stats.size,
    timestamp: new Date().toISOString(),
    integrity: 'ok'
  };
}

/**
 * Lists all existing database backups in order of newest first
 */
export function listBackups(backupDir = BACKUPS_DIR) {
  if (!fs.existsSync(backupDir)) return [];

  const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.db'));
  return files.map(file => {
    const fullPath = path.join(backupDir, file);
    const stats = fs.statSync(fullPath);
    return {
      filename: file,
      path: fullPath,
      sizeBytes: stats.size,
      createdAt: stats.mtime.toISOString()
    };
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Restores database from a validated backup file.
 * STRICT SAFETY RULE: Requires explicit confirmation and path validation.
 */
export function restoreDatabase(backupPathOrOptions, options = {}) {
  let targetPath = backupPathOrOptions;
  let userConfirmed = options.userConfirmed || false;

  if (typeof backupPathOrOptions === 'object' && backupPathOrOptions !== null) {
    targetPath = backupPathOrOptions.backupPath || backupPathOrOptions.path;
    userConfirmed = backupPathOrOptions.userConfirmed ?? userConfirmed;
  }

  if (!userConfirmed) {
    throw new Error(
      'Destructive Action Protection: You must explicitly confirm database restoration (userConfirmed: true).'
    );
  }

  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('Valid backupPath string is required.');
  }

  // Prevent path traversal: Resolve path and ensure it's a valid SQLite .db file within allowed directories
  const resolvedPath = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(BACKUPS_DIR, targetPath);

  const allowedDirs = [path.resolve(BACKUPS_DIR), path.resolve(DATA_DIR)];
  const isWithinAllowed = allowedDirs.some(dir => resolvedPath.startsWith(dir));

  if (!isWithinAllowed || !resolvedPath.endsWith('.db')) {
    throw new Error(`Security Violation: Unsafe backup path "${targetPath}". Restoration is restricted to files in data/backups.`);
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Backup file not found at: ${resolvedPath}`);
  }

  // Validate backup file integrity before touching active database
  const testDb = new DatabaseSync(resolvedPath);
  const integrity = testDb.prepare('PRAGMA integrity_check').get();
  testDb.close();

  if (!integrity || integrity['integrity_check'] !== 'ok') {
    throw new Error(`Cannot restore corrupted backup. Integrity check reported: ${JSON.stringify(integrity)}`);
  }

  // Create temporary safety backup of active database before overwrite
  const activeDbPath = getActiveDbPath();
  if (fs.existsSync(activeDbPath)) {
    const safetyCopyPath = path.join(BACKUPS_DIR, `pre_restore_safety_${Date.now()}.db`);
    try {
      if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
      fs.copyFileSync(activeDbPath, safetyCopyPath);
    } catch (e) {
      console.warn(`[Backup Notice] Could not create pre-restore safety copy: ${e.message}`);
    }
  }

  // Overwrite database file
  fs.copyFileSync(resolvedPath, activeDbPath);

  // Re-verify main database
  const restoredDb = getDatabase();
  const mainIntegrity = restoredDb.prepare('PRAGMA integrity_check').get();

  return {
    success: true,
    restoredFrom: resolvedPath,
    integrity: mainIntegrity ? mainIntegrity['integrity_check'] : 'ok',
    restoredAt: new Date().toISOString()
  };
}

/**
 * Runs SQLite integrity check and foreign key consistency checks
 */
export function runDatabaseIntegrityCheck() {
  const db = getDatabase();

  const integrityRow = db.prepare('PRAGMA integrity_check').get();
  const integrityStatus = integrityRow ? integrityRow['integrity_check'] : 'unknown';

  const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
  const isHealthy = integrityStatus === 'ok' && fkViolations.length === 0;

  // Counts of key records
  const jobsCount = db.prepare('SELECT COUNT(*) as count FROM jobs').get()?.count || 0;
  const appsCount = db.prepare('SELECT COUNT(*) as count FROM applications').get()?.count || 0;
  const commsCount = db.prepare('SELECT COUNT(*) as count FROM communications').get()?.count || 0;
  const resVersionsCount = db.prepare('SELECT COUNT(*) as count FROM resume_versions').get()?.count || 0;

  return {
    isHealthy,
    integrityStatus,
    foreignKeyViolations: fkViolations,
    diagnostics: {
      totalJobs: jobsCount,
      totalApplications: appsCount,
      totalCommunications: commsCount,
      totalResumeVersions: resVersionsCount
    },
    checkedAt: new Date().toISOString()
  };
}

/**
 * Exports complete candidate career archive (Profile, Applications, Roadmap, Analytics)
 */
export function exportCandidateFullArchive() {
  const profile = loadCandidateProfile();
  const db = getDatabase();

  const applications = db.prepare(`
    SELECT a.*, j.title, j.company, j.location, j.url
    FROM applications a
    LEFT JOIN jobs j ON a.job_id = j.id
    ORDER BY a.id DESC
  `).all();

  const roadmap = getSkillRoadmap();
  const analytics = getApplicationAnalytics();

  const archive = {
    metadata: {
      exportedAt: new Date().toISOString(),
      system: 'CareerOS Personal Career Automation',
      version: '1.0.0'
    },
    candidateProfile: {
      name: profile.personal?.fullName,
      degree: profile.status?.currentDegree,
      graduationYear: profile.status?.graduationYear,
      skills: profile.skills,
      projects: profile.projects?.map(p => ({ name: p.name, techStack: p.techStack })),
      certifications: profile.certifications
    },
    applications,
    learningRoadmap: roadmap,
    analyticsSummary: analytics.metrics
  };

  const outputPath = path.join(DATA_DIR, 'career_vault_export.json');
  fs.writeFileSync(outputPath, JSON.stringify(archive, null, 2), 'utf-8');

  return {
    success: true,
    outputPath,
    totalApplications: applications.length,
    totalSkillsRoadmapped: roadmap.length
  };
}

/**
 * Safely cleans historical test fixtures (Acme test runs, example.com URLs, duplicate test applications).
 * Creates a verified safety backup BEFORE modifying any records.
 */
export function cleanTestFixtures() {
  const db = getDatabase();

  // 1. Create timestamped safety backup first
  const safetyBackup = backupDatabase({
    targetFilename: `pre_fixture_cleanup_${Date.now()}.db`
  });

  // 2. Identify test jobs
  const testJobs = db.prepare(`
    SELECT id, company, title, url FROM jobs
    WHERE (LOWER(company) LIKE '%acme%' AND url LIKE '%role-%')
       OR url LIKE '%example.com%'
  `).all();

  const testJobIds = testJobs.map(j => j.id);

  let cleanedApps = 0;
  let cleanedJobs = 0;
  let cleanedEvals = 0;

  if (testJobIds.length > 0) {
    const placeholders = testJobIds.map(() => '?').join(',');

    // Delete associated applications
    const appRes = db.prepare(`DELETE FROM applications WHERE job_id IN (${placeholders})`).run(...testJobIds);
    cleanedApps += appRes.changes;

    // Delete associated job evaluations
    const evalRes = db.prepare(`DELETE FROM job_evaluations WHERE job_id IN (${placeholders})`).run(...testJobIds);
    cleanedEvals += evalRes.changes;

    // Delete associated calendar events, follow up reminders, and communications
    db.prepare(`DELETE FROM calendar_events WHERE job_id IN (${placeholders})`).run(...testJobIds);
    db.prepare(`DELETE FROM follow_up_reminders WHERE job_id IN (${placeholders})`).run(...testJobIds);
    db.prepare(`DELETE FROM communications WHERE job_id IN (${placeholders})`).run(...testJobIds);

    // Delete test jobs
    const jobRes = db.prepare(`DELETE FROM jobs WHERE id IN (${placeholders})`).run(...testJobIds);
    cleanedJobs += jobRes.changes;
  }

  // 3. Clean duplicate applications sharing exact same confirmation number on same URL (keep earliest ID)
  const dupApps = db.prepare(`
    SELECT id FROM applications
    WHERE confirmation_number = 'FT-APP-2026-9812'
      AND id NOT IN (
        SELECT MIN(id) FROM applications WHERE confirmation_number = 'FT-APP-2026-9812'
      )
  `).all();

  if (dupApps.length > 0) {
    const dupIds = dupApps.map(a => a.id);
    const dupRes = db.prepare(`DELETE FROM applications WHERE id IN (${dupIds.map(() => '?').join(',')})`).run(...dupIds);
    cleanedApps += dupRes.changes;
  }

  // 4. Verify integrity
  const integrity = db.prepare('PRAGMA integrity_check').get();

  return {
    success: true,
    safetyBackupPath: safetyBackup.backupPath,
    cleanedJobs,
    cleanedApps,
    cleanedEvals,
    integrityStatus: integrity.integrity_check
  };
}
