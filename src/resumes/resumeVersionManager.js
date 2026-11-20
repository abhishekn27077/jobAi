/**
 * CareerOS — Resume Version Manager
 * Persists, versions, updates, approves, and manages tailored resume records in SQLite.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabase } from '../db/schema.js';
import { renderResumeHtml, renderResumeMarkdown } from './templates/templateEngine.js';
import { exportToPdf } from './exporters/pdfExporter.js';
import { exportToDocx } from './exporters/docxExporter.js';
import { auditDocumentTruthfulness } from './resumeGenerator.js';
import { loadCandidateProfile } from '../profile/profileManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.resolve(__dirname, '../../output');
const RESUMES_DIR = path.join(OUTPUT_DIR, 'resumes');

export async function saveResumeVersion({
  jobId,
  company,
  jobTitle,
  jdSnapshot,
  template = 'ats_professional',
  generationMode = 'deterministic',
  content,
  atsScore,
  atsBreakdown,
  missingKeywords = [],
  matchedKeywords = [],
  isApproved = 0
}) {
  const db = getDatabase();

  // Truthfulness Auditor Gate: Block saving if critical unsupported claims are present
  const profile = loadCandidateProfile();
  const audit = auditDocumentTruthfulness(content, profile);
  if (!audit.passed) {
    const errorMsg = `Truthfulness Auditor blocked save: ${audit.warnings.join(' | ')}`;
    const err = new Error(errorMsg);
    err.audit = audit;
    err.statusCode = 422;
    throw err;
  }

  // Find next version number for this job
  const existingMax = db.prepare('SELECT MAX(version_number) as max_v FROM resume_versions WHERE job_id = ?').get(jobId);
  const nextVersion = (existingMax && existingMax.max_v !== null) ? (existingMax.max_v + 1) : 1;

  if (!fs.existsSync(RESUMES_DIR)) {
    fs.mkdirSync(RESUMES_DIR, { recursive: true });
  }

  const safeCompany = (company || 'Company').replace(/[^a-zA-Z0-9]/g, '_');
  const baseFilename = `${jobId}_v${nextVersion}_${safeCompany}_Resume`;
  const pdfPath = path.join(RESUMES_DIR, `${baseFilename}.pdf`);
  const docxPath = path.join(RESUMES_DIR, `${baseFilename}.docx`);
  const mdPath = path.join(RESUMES_DIR, `${baseFilename}.md`);

  // Render markdown & HTML
  const markdown = renderResumeMarkdown(content);
  const html = renderResumeHtml(content, template);

  // Write markdown
  fs.writeFileSync(mdPath, markdown, 'utf-8');

  // Generate PDF and DOCX
  try {
    await exportToPdf(html, pdfPath);
  } catch (err) {
    console.warn('[Version Manager] Playwright PDF compile warning:', err.message);
  }

  try {
    await exportToDocx(content, docxPath);
  } catch (err) {
    console.warn('[Version Manager] DOCX export warning:', err.message);
  }

  const stmt = db.prepare(`
    INSERT INTO resume_versions (
      job_id, company, job_title, jd_snapshot, template, generation_mode,
      resume_content_json, resume_markdown, ats_score, ats_breakdown_json,
      missing_keywords_json, matched_keywords_json, version_number,
      is_approved, pdf_path, docx_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);

  const info = stmt.run(
    jobId,
    company,
    jobTitle,
    typeof jdSnapshot === 'string' ? jdSnapshot : JSON.stringify(jdSnapshot || {}),
    template,
    generationMode,
    typeof content === 'string' ? content : JSON.stringify(content),
    markdown,
    atsScore,
    typeof atsBreakdown === 'string' ? atsBreakdown : JSON.stringify(atsBreakdown || {}),
    JSON.stringify(missingKeywords),
    JSON.stringify(matchedKeywords),
    nextVersion,
    isApproved ? 1 : 0,
    fs.existsSync(pdfPath) ? pdfPath : null,
    fs.existsSync(docxPath) ? docxPath : null
  );

  const versionId = info.lastInsertRowid;

  // Audit log
  db.prepare(`
    INSERT INTO activity_audit_log (action, details)
    VALUES (?, ?)
  `).run(
    'RESUME_VERSION_SAVED',
    `Saved version ${nextVersion} (ID: ${versionId}) for Job #${jobId} (${jobTitle} @ ${company}) with ATS Score: ${atsScore}/100`
  );

  return getResumeVersionById(versionId);
}

export function getResumeVersionsForJob(jobId) {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM resume_versions
    WHERE job_id = ?
    ORDER BY version_number DESC
  `).all(jobId);

  return rows.map(formatVersionRow);
}

export function getResumeVersionById(id) {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM resume_versions WHERE id = ?').get(id);
  if (!row) return null;
  return formatVersionRow(row);
}

export async function approveResumeVersion(id) {
  const db = getDatabase();
  const version = getResumeVersionById(id);
  if (!version) throw new Error(`Resume version #${id} not found.`);

  // Truthfulness Auditor Gate: Block approval if critical unsupported claims are present
  const profile = loadCandidateProfile();
  const audit = auditDocumentTruthfulness(version.content, profile);
  if (!audit.passed) {
    const errorMsg = `Truthfulness Auditor blocked approval: ${audit.warnings.join(' | ')}`;
    const err = new Error(errorMsg);
    err.audit = audit;
    err.statusCode = 422;
    throw err;
  }

  // Reset all other versions for this job to unapproved
  db.prepare('UPDATE resume_versions SET is_approved = 0 WHERE job_id = ?').run(version.job_id);

  // Mark this version approved
  db.prepare(`
    UPDATE resume_versions
    SET is_approved = 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(id);

  // Update jobs table status
  db.prepare(`
    UPDATE jobs
    SET status = 'ready_to_apply', updated_at = datetime('now')
    WHERE id = ?
  `).run(version.job_id);

  // Link to applications table
  const existingApp = db.prepare('SELECT id FROM applications WHERE job_id = ?').get(version.job_id);
  if (existingApp) {
    db.prepare(`
      UPDATE applications
      SET resume_version = ?, user_approved = 1, notes = ?
      WHERE job_id = ?
    `).run(
      `v${version.version_number} (${version.template})`,
      `Approved ATS Score: ${version.ats_score}/100`,
      version.job_id
    );
  } else {
    db.prepare(`
      INSERT INTO applications (job_id, resume_version, user_approved, notes, created_at)
      VALUES (?, ?, 1, ?, datetime('now'))
    `).run(
      version.job_id,
      `v${version.version_number} (${version.template})`,
      `Approved ATS Score: ${version.ats_score}/100`
    );
  }

  // Audit log
  db.prepare(`
    INSERT INTO activity_audit_log (action, details)
    VALUES (?, ?)
  `).run(
    'RESUME_APPROVED',
    `Approved resume v${version.version_number} (ATS: ${version.ats_score}/100) for Job #${version.job_id} (${version.company})`
  );

  return getResumeVersionById(id);
}

export function deleteResumeVersion(id) {
  const db = getDatabase();
  const version = getResumeVersionById(id);
  if (!version) return { deleted: false, reason: 'Not found' };

  // Remove files if they exist
  if (version.pdf_path && fs.existsSync(version.pdf_path)) {
    try { fs.unlinkSync(version.pdf_path); } catch {}
  }
  if (version.docx_path && fs.existsSync(version.docx_path)) {
    try { fs.unlinkSync(version.docx_path); } catch {}
  }

  db.prepare('DELETE FROM resume_versions WHERE id = ?').run(id);

  // Audit log
  db.prepare(`
    INSERT INTO activity_audit_log (action, details)
    VALUES (?, ?)
  `).run(
    'RESUME_VERSION_DELETED',
    `Deleted resume version #${id} (v${version.version_number}) for Job #${version.job_id}`
  );

  return { deleted: true, id };
}

export async function duplicateResumeVersion(id) {
  const original = getResumeVersionById(id);
  if (!original) throw new Error(`Original version #${id} not found.`);

  return await saveResumeVersion({
    jobId: original.job_id,
    company: original.company,
    jobTitle: original.job_title,
    jdSnapshot: original.jd_snapshot,
    template: original.template,
    generationMode: `${original.generation_mode} (Duplicate)`,
    content: original.content,
    atsScore: original.ats_score,
    atsBreakdown: original.ats_breakdown,
    missingKeywords: original.missing_keywords || [],
    matchedKeywords: original.matched_keywords || [],
    isApproved: 0
  });
}

function formatVersionRow(row) {
  let content = {};
  let atsBreakdown = {};
  let missingKeywords = [];
  let matchedKeywords = [];

  try { content = JSON.parse(row.resume_content_json); } catch {}
  try { atsBreakdown = JSON.parse(row.ats_breakdown_json); } catch {}
  try { missingKeywords = JSON.parse(row.missing_keywords_json || '[]'); } catch {}
  try { matchedKeywords = JSON.parse(row.matched_keywords_json || '[]'); } catch {}

  return {
    ...row,
    content,
    ats_breakdown: atsBreakdown,
    missing_keywords: missingKeywords,
    matched_keywords: matchedKeywords
  };
}
