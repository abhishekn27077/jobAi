/**
 * CareerOS — Explicit Approval Center (Phase 15)
 * Enforces per-action user approval for final application review,
 * outbound emails, resume attachment verification, and sensitive external actions.
 * Never grants blanket approval for future actions.
 */

import crypto from 'node:crypto';
import { getDatabase } from '../db/schema.js';
import { updateApplicationStatus } from './applicationTracker.js';
import { recordTimelineEvent } from './timelineService.js';

export function computeApprovalContextHash({
  actionType,
  jobId = null,
  recipientOrDestination = '',
  subjectOrTitle = '',
  exactContent = '',
  attachedDocuments = []
}) {
  const payload = JSON.stringify({
    actionType,
    jobId: jobId || null,
    recipientOrDestination: String(recipientOrDestination || ''),
    subjectOrTitle: String(subjectOrTitle || ''),
    exactContent: String(exactContent || ''),
    attachedDocuments: Array.isArray(attachedDocuments) ? attachedDocuments : []
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export const APPROVAL_ACTION_TYPES = [
  'application_final_review',
  'email_send',
  'resume_attachment',
  'sensitive_external_action'
];

function formatApprovalRow(row) {
  if (!row) return null;
  let attachedDocuments = [];
  try {
    attachedDocuments = row.attached_documents_json ? JSON.parse(row.attached_documents_json) : [];
  } catch {
    attachedDocuments = [];
  }
  return {
    id: row.id,
    actionType: row.action_type,
    jobId: row.job_id,
    taskId: row.task_id,
    contactId: row.contact_id,
    draftId: row.draft_id,
    recipientOrDestination: row.recipient_or_destination,
    subjectOrTitle: row.subject_or_title,
    exactContent: row.exact_content,
    attachedDocuments,
    riskWarning: row.risk_warning,
    status: row.status,
    contextHash: row.context_hash || null,
    expiresAt: row.expires_at || null,
    decisionNote: row.decision_note,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createApprovalRequest({
  actionType,
  jobId = null,
  taskId = null,
  contactId = null,
  draftId = null,
  recipientOrDestination = '',
  subjectOrTitle = '',
  exactContent = '',
  attachedDocuments = [],
  riskWarning = 'Explicit human confirmation required before external execution.'
}) {
  if (!APPROVAL_ACTION_TYPES.includes(actionType)) {
    throw new Error(`Invalid approval actionType: ${actionType}`);
  }
  const db = getDatabase();

  // Prevent duplicate pending approval for the exact same task + actionType + draftId
  const existing = db.prepare(`
    SELECT * FROM approval_requests
    WHERE status = 'pending'
      AND action_type = ?
      AND (job_id IS ? OR (job_id IS NULL AND ? IS NULL))
      AND (task_id IS ? OR (task_id IS NULL AND ? IS NULL))
      AND (draft_id IS ? OR (draft_id IS NULL AND ? IS NULL))
    LIMIT 1
  `).get(actionType, jobId, jobId, taskId, taskId, draftId, draftId);

  if (existing) {
    return formatApprovalRow(existing);
  }

  const contextHash = computeApprovalContextHash({
    actionType,
    jobId,
    recipientOrDestination,
    subjectOrTitle,
    exactContent,
    attachedDocuments
  });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const res = db.prepare(`
    INSERT INTO approval_requests (
      action_type, job_id, task_id, contact_id, draft_id,
      recipient_or_destination, subject_or_title, exact_content,
      attached_documents_json, risk_warning, status, context_hash, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    actionType,
    jobId,
    taskId,
    contactId,
    draftId,
    recipientOrDestination,
    subjectOrTitle,
    exactContent,
    JSON.stringify(attachedDocuments || []),
    riskWarning,
    contextHash,
    expiresAt
  );

  if (taskId) {
    db.prepare(`
      UPDATE agent_tasks
      SET status = 'awaiting_approval', approval_required = 1, updated_at = datetime('now')
      WHERE id = ? AND status NOT IN ('completed', 'cancelled', 'failed')
    `).run(taskId);
  }

  db.prepare(`INSERT INTO activity_audit_log (action, details) VALUES (?, ?)`)
    .run('APPROVAL_REQUESTED', JSON.stringify({ approvalId: res.lastInsertRowid, actionType, jobId, taskId }));

  return formatApprovalRow(db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(res.lastInsertRowid));
}

export function listApprovalRequests({ status = null, jobId = null } = {}) {
  const db = getDatabase();
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (jobId) {
    clauses.push('job_id = ?');
    params.push(jobId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM approval_requests ${where} ORDER BY id DESC`).all(...params);
  return rows.map(formatApprovalRow);
}

export function decideApprovalRequest(approvalId, { decision, editedContent = null, decisionNote = '', userConfirmed = false } = {}) {
  if (!['approved', 'rejected'].includes(decision)) {
    throw new Error('Decision must be "approved" or "rejected".');
  }
  if (decision === 'approved' && userConfirmed !== true) {
    throw new Error('Approval Gate Violation: Explicit userConfirmed=true is required to approve.');
  }

  const db = getDatabase();
  const req = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(approvalId);
  if (!req) throw new Error(`Approval request #${approvalId} not found.`);
  if (req.status !== 'pending') {
    throw new Error(`Approval request #${approvalId} is already ${req.status}.`);
  }

  const finalContent = editedContent !== null && editedContent !== undefined ? String(editedContent) : req.exact_content;
  const now = new Date().toISOString();
  const updatedHash = computeApprovalContextHash({
    actionType: req.action_type,
    jobId: req.job_id,
    recipientOrDestination: req.recipient_or_destination,
    subjectOrTitle: req.subject_or_title,
    exactContent: finalContent,
    attachedDocuments: JSON.parse(req.attached_documents_json || '[]')
  });

  db.prepare(`
    UPDATE approval_requests
    SET status = ?, exact_content = ?, context_hash = ?, decision_note = ?, decided_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(decision, finalContent, updatedHash, decisionNote, now, approvalId);

  if (req.draft_id) {
    db.prepare(`
      UPDATE outreach_drafts
      SET status = ?, body = ?, approved_at = CASE WHEN ? = 'approved' THEN ? ELSE approved_at END, updated_at = datetime('now')
      WHERE id = ?
    `).run(decision === 'approved' ? 'approved' : 'rejected', finalContent, decision, now, req.draft_id);
  }

  if (req.task_id) {
    const nextTaskStatus = decision === 'approved' ? 'completed' : 'paused';
    db.prepare(`
      UPDATE agent_tasks
      SET status = ?, approval_required = 0, updated_at = datetime('now'),
          completed_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE completed_at END
      WHERE id = ? AND status NOT IN ('cancelled', 'failed')
    `).run(nextTaskStatus, nextTaskStatus, req.task_id);
  }

  if (decision === 'approved' && req.action_type === 'application_final_review' && req.job_id) {
    try {
      const app = db.prepare('SELECT id FROM applications WHERE job_id = ?').get(req.job_id);
      if (app) {
        updateApplicationStatus(req.job_id, 'submitted', {
          userConfirmed: true,
          notes: decisionNote || 'Confirmed via Approval Center'
        });
      }
      recordTimelineEvent({
        jobId: req.job_id,
        applicationId: app?.id || null,
        taskId: req.task_id,
        eventType: 'application_submitted',
        title: 'Application manually submitted and confirmed',
        details: decisionNote || 'Confirmed in Approval Center'
      });
    } catch {
      // Keep approval decision persisted even if application row wasn't created yet
    }
  }

  db.prepare(`INSERT INTO activity_audit_log (action, details) VALUES (?, ?)`)
    .run(`APPROVAL_${decision.toUpperCase()}`, JSON.stringify({ approvalId, actionType: req.action_type, jobId: req.job_id }));

  return formatApprovalRow(db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(approvalId));
}

/**
 * Verifies an approval is still valid, un-expired, and matches the exact current context.
 * Automatically invalidates stale approvals if job, recipient, or content changed.
 */
export function validateApprovalForExecution(approvalId, currentContext = {}) {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(approvalId);
  if (!row) return { valid: false, reason: 'Approval request not found.' };
  if (row.status !== 'approved') return { valid: false, reason: `Approval status is "${row.status}", not "approved".` };

  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(`UPDATE approval_requests SET status = 'expired', updated_at = datetime('now') WHERE id = ?`).run(approvalId);
    return { valid: false, reason: 'Approval has expired; fresh user approval is required.' };
  }

  if (row.context_hash) {
    const expectedHash = computeApprovalContextHash({
      actionType: row.action_type,
      jobId: currentContext.jobId ?? row.job_id,
      recipientOrDestination: currentContext.recipientOrDestination ?? row.recipient_or_destination,
      subjectOrTitle: currentContext.subjectOrTitle ?? row.subject_or_title,
      exactContent: currentContext.exactContent ?? row.exact_content,
      attachedDocuments: currentContext.attachedDocuments ?? JSON.parse(row.attached_documents_json || '[]')
    });
    if (expectedHash !== row.context_hash && row.exact_content === (currentContext.exactContent ?? row.exact_content)) {
      db.prepare(`UPDATE approval_requests SET status = 'invalidated', updated_at = datetime('now') WHERE id = ?`).run(approvalId);
      return { valid: false, reason: 'Approval invalidated because job/recipient/document details changed.' };
    }
    if (currentContext.recipientOrDestination && currentContext.recipientOrDestination !== row.recipient_or_destination) {
      db.prepare(`UPDATE approval_requests SET status = 'invalidated', updated_at = datetime('now') WHERE id = ?`).run(approvalId);
      return { valid: false, reason: 'Approval invalidated because recipient changed.' };
    }
  }

  return { valid: true, approval: formatApprovalRow(row) };
}
