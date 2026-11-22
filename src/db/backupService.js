import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from './schema.js';
import { loadCandidateProfile } from '../profile/profileManager.js';
import { getApplicationAnalytics } from '../intelligence/careerAnalyticsService.js';
import { getSkillRoadmap } from '../intelligence/skillGapService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'career_vault.db');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

/**
 * Creates a safe, timestamped backup of career_vault.db with integrity validation
 */
export function backupDatabase({ targetDir = BACKUPS_DIR, targetFilename = null, overwrite = false } = {}) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Database file not found at ${DB_PATH}`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = targetFilename || `career_vault_backup_${timestamp}.db`;
  const destPath = path.join(targetDir, filename);

  if (fs.existsSync(destPath) && !overwrite) {
    throw new Error(`Backup file already exists: ${destPath}. Set overwrite: true to replace.`);
  }

  // Copy database file synchronously
  fs.copyFileSync(DB_PATH, destPath);

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
  if (fs.existsSync(DB_PATH)) {
    const safetyCopyPath = path.join(BACKUPS_DIR, `pre_restore_safety_${Date.now()}.db`);
    try {
      if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
      fs.copyFileSync(DB_PATH, safetyCopyPath);
    } catch (e) {
      console.warn(`[Backup Notice] Could not create pre-restore safety copy: ${e.message}`);
    }
  }

  // Overwrite database file
  fs.copyFileSync(resolvedPath, DB_PATH);

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
