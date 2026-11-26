/**
 * CareerOS — Secure Local-First Agent Bridge (Phase 15)
 * Exposes 16 narrowly scoped Read/Write operations for Google Antigravity.
 * Never exposes unrestricted SQLite, shell execution, OAuth tokens, or secrets.
 */

import crypto from 'node:crypto';
import { getDatabase } from '../db/schema.js';
import { loadCandidateProfile } from '../profile/profileManager.js';
import { getResumeVersionsForJob } from '../resumes/resumeVersionManager.js';
import { getApplicationByJobId, updateApplicationStatus } from '../tracker/applicationTracker.js';
import { exportTailoredDocumentsForJob } from '../resumes/resumeGenerator.js';
import {
  getAgentTask,
  listPendingTasks,
  buildApplyWithAiContext,
  appendTaskProgress,
  transitionTaskStatus,
  attachTaskArtifact,
  recordAgentHeartbeat,
  updateTaskBrowserAndStep,
  markTaskCompleted
} from './agentTaskManager.js';
import {
  saveRecruiterContact,
  getRecruiterContacts,
  createOutreachDraft
} from '../intelligence/recruiterDiscoveryService.js';
import { createApprovalRequest, listApprovalRequests } from '../tracker/approvalCenter.js';
import { recordTimelineEvent } from '../tracker/timelineService.js';
import { runCareerOsJobSweep } from '../discovery/discoveryService.js';

export const AGENT_READ_TOOLS = [
  'get_job',
  'get_candidate_profile',
  'get_application_history',
  'get_relevant_resume',
  'get_recruiter_history',
  'get_relevant_communication_history',
  'get_agent_task',
  'get_task_instructions',
  'list_pending_tasks',
  'get_approved_actions'
];

export const AGENT_WRITE_TOOLS = [
  'update_task_progress',
  'save_task_result',
  'save_recruiter_research',
  'save_contact',
  'save_outreach_draft',
  'save_generated_artifact',
  'request_user_approval',
  'record_manual_action_required',
  'generate_or_get_resume',
  'update_application_status',
  'record_browser_result',
  'append_timeline_event',
  'report_task_error',
  'run_job_sweep'
];

export const ALL_AGENT_TOOLS = [...AGENT_READ_TOOLS, ...AGENT_WRITE_TOOLS];

function requirePositiveInt(val, fieldName) {
  const num = Number(val);
  if (!Number.isInteger(num) || num <= 0) {
    throw new Error(`Invalid ${fieldName}: expected a positive integer.`);
  }
  return num;
}

function requireActiveTask(taskId) {
  const id = requirePositiveInt(taskId, 'taskId');
  const task = getAgentTask(id);
  if (!task) throw new Error(`Unauthorized or invalid taskId #${id}.`);
  if (task.status === 'cancelled') {
    throw new Error(`Task #${id} is cancelled and cannot be mutated.`);
  }
  return task;
}

function logBridgeAction(toolName, meta = {}) {
  try {
    const db = getDatabase();
    db.prepare('INSERT INTO activity_audit_log (action, details) VALUES (?, ?)')
      .run(`AGENT_BRIDGE:${toolName}`, JSON.stringify(meta));
  } catch {
    // Non-blocking audit log
  }
}

/**
 * Validates optional bearer token if CAREEROS_AGENT_TOKEN is configured.
 */
export function verifyAgentBridgeAuth(headers = {}) {
  const expected = process.env.CAREEROS_AGENT_TOKEN;
  if (!expected) return { authorized: true, mode: 'localhost_unconfigured_token' };

  const authHeader = headers.authorization || headers.Authorization || '';
  const customHeader = headers['x-careeros-agent-token'] || headers['X-CareerOS-Agent-Token'] || '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : String(customHeader).trim();

  if (!provided || provided.length !== expected.length) {
    return { authorized: false, error: 'Unauthorized: Missing or invalid CareerOS Agent Bridge token.' };
  }
  const match = crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  return match
    ? { authorized: true, mode: 'bearer_token' }
    : { authorized: false, error: 'Unauthorized: Invalid CareerOS Agent Bridge token.' };
}

export const AGENT_TOOL_DEFINITIONS = [
  { name: 'get_job', description: 'Read job details & evaluation for a jobId.', inputSchema: { type: 'object', properties: { jobId: { type: 'integer' } }, required: ['jobId'] } },
  { name: 'get_candidate_profile', description: 'Read verified candidate profile (no secrets/tokens).', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_application_history', description: 'Read application status & checklist for a jobId.', inputSchema: { type: 'object', properties: { jobId: { type: 'integer' } }, required: ['jobId'] } },
  { name: 'get_relevant_resume', description: 'Read tailored resume versions for a jobId.', inputSchema: { type: 'object', properties: { jobId: { type: 'integer' } }, required: ['jobId'] } },
  { name: 'get_recruiter_history', description: 'Read stored recruiter contacts for a jobId or company.', inputSchema: { type: 'object', properties: { jobId: { type: 'integer' }, company: { type: 'string' } } } },
  { name: 'get_relevant_communication_history', description: 'Read email communication metadata/summaries for a jobId (no OAuth tokens).', inputSchema: { type: 'object', properties: { jobId: { type: 'integer' } }, required: ['jobId'] } },
  { name: 'get_agent_task', description: 'Read agent task status, progress events, and artifacts.', inputSchema: { type: 'object', properties: { taskId: { type: 'integer' } }, required: ['taskId'] } },
  { name: 'get_task_instructions', description: 'Read task instructions and minimum grounded Apply-with-AI context.', inputSchema: { type: 'object', properties: { taskId: { type: 'integer' } }, required: ['taskId'] } },
  { name: 'update_task_progress', description: 'Append progress event and optionally update task status.', inputSchema: { type: 'object', properties: { taskId: { type: 'integer' }, message: { type: 'string' }, status: { type: 'string' }, agentSessionRef: { type: 'string' } }, required: ['taskId', 'message'] } },
  { name: 'save_task_result', description: 'Save final task result summary and mark completed or awaiting_approval.', inputSchema: { type: 'object', properties: { taskId: { type: 'integer' }, resultSummary: { type: 'string' }, status: { type: 'string' } }, required: ['taskId', 'resultSummary'] } },
  { name: 'save_recruiter_research', description: 'Save company research overview/notes with evidence status.', inputSchema: { type: 'object', properties: { taskId: { type: 'integer' }, companyName: { type: 'string' }, overview: { type: 'string' }, careerPageUrl: { type: 'string' }, notes: { type: 'string' } }, required: ['taskId', 'companyName'] } },
  { name: 'save_contact', description: 'Save verified/publicly-listed hiring contact (no fabricated emails).', inputSchema: { type: 'object', properties: { taskId: { type: 'integer' }, jobId: { type: 'integer' }, company: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' }, email: { type: 'string' }, verificationStatus: { type: 'string' }, discoverySource: { type: 'string' }, sourceUrl: { type: 'string' }, profileUrl: { type: 'string' }, evidenceNotes: { type: 'string' } }, required: ['taskId', 'company'] } },
  { name: 'save_outreach_draft', description: 'Save editable outreach draft (email/LinkedIn/follow-up) without sending.', inputSchema: { type: 'object', properties: { taskId: { type: 'integer' }, jobId: { type: 'integer' }, contactId: { type: 'integer' }, channel: { type: 'string' }, recipientName: { type: 'string' }, recipientEmail: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['taskId', 'channel', 'body'] } },
  { name: 'save_generated_artifact', description: 'Attach generated artifact reference (PDF/DOCX/notes) to task.', inputSchema: { type: 'object', properties: { taskId: { type: 'integer' }, type: { type: 'string' }, path: { type: 'string' }, label: { type: 'string' } }, required: ['taskId', 'type', 'path'] } },
  { name: 'request_user_approval', description: 'Create an explicit Approval Center request (stops before submit/send).', inputSchema: { type: 'object', properties: { taskId: { type: 'integer' }, actionType: { type: 'string' }, recipientOrDestination: { type: 'string' }, subjectOrTitle: { type: 'string' }, exactContent: { type: 'string' }, attachedDocuments: { type: 'array' }, riskWarning: { type: 'string' } }, required: ['taskId', 'actionType', 'subjectOrTitle'] } },
  { name: 'record_manual_action_required', description: 'Flag CAPTCHA/OTP/auth wall or manual portal step without bypassing.', inputSchema: { type: 'object', properties: { taskId: { type: 'integer' }, reason: { type: 'string' } }, required: ['taskId', 'reason'] } },
  { name: 'list_pending_tasks', description: 'Retrieve pending/queued/recoverable agent tasks.', inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } } },
  { name: 'get_approved_actions', description: 'Read user-approved actions for a taskId or jobId.', inputSchema: { type: 'object', properties: { taskId: { type: 'integer' }, jobId: { type: 'integer' } } } },
  { name: 'generate_or_get_resume', description: 'Retrieve existing tailored resume for job or generate one from verified profile.', inputSchema: { type: 'object', properties: { taskId: { type: 'integer' }, jobId: { type: 'integer' } }, required: ['taskId'] } },
  { name: 'update_application_status', description: 'Update application prep status (blocks submitted without user confirmation).', inputSchema: { type: 'object', properties: { taskId: { type: 'integer' }, status: { type: 'string' }, notes: { type: 'string' } }, required: ['taskId', 'status'] } },
  { name: 'record_browser_result', description: 'Record browser session status, filled/unfilled fields, and verification.', inputSchema: { type: 'object', properties: { taskId: { type: 'integer' }, browserStatus: { type: 'string' }, summary: { type: 'string' }, verification: { type: 'array' } }, required: ['taskId', 'browserStatus', 'summary'] } },
  { name: 'append_timeline_event', description: 'Append a job-linked activity event to the unified timeline.', inputSchema: { type: 'object', properties: { taskId: { type: 'integer' }, eventType: { type: 'string' }, title: { type: 'string' }, details: { type: 'string' } }, required: ['taskId', 'eventType', 'title'] } },
  { name: 'report_task_error', description: 'Report an error on a task without losing prior artifacts.', inputSchema: { type: 'object', properties: { taskId: { type: 'integer' }, errorDetails: { type: 'string' }, status: { type: 'string' } }, required: ['taskId', 'errorDetails'] } },
  { name: 'run_job_sweep', description: 'Execute CAREEROS JOB SWEEP across configured live sources and return run summary.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, maxPerQuery: { type: 'integer' } } } }
];

/**
 * Executes a narrowly scoped Agent Bridge tool with strict validation.
 */
export function executeAgentTool(toolName, args = {}) {
  if (!ALL_AGENT_TOOLS.includes(toolName)) {
    throw new Error(`Unauthorized tool "${toolName}". Only scoped CareerOS bridge tools are permitted.`);
  }

  recordAgentHeartbeat(toolName);
  const db = getDatabase();
  logBridgeAction(toolName, { jobId: args?.jobId || null, taskId: args?.taskId || null });

  switch (toolName) {
    // --- READ TOOLS ---
    case 'get_job': {
      const jobId = requirePositiveInt(args.jobId, 'jobId');
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
      if (!job) throw new Error(`Job #${jobId} not found.`);
      const evaluation = db.prepare('SELECT * FROM job_evaluations WHERE job_id = ?').get(jobId);
      return { job, evaluation };
    }

    case 'get_candidate_profile': {
      const profile = loadCandidateProfile();
      return {
        personal: profile.personal,
        education: profile.education,
        skills: profile.skills,
        projects: profile.projects,
        experience: profile.experience,
        certifications: profile.certifications
      };
    }

    case 'get_application_history': {
      const jobId = requirePositiveInt(args.jobId, 'jobId');
      return { jobId, application: getApplicationByJobId(jobId) };
    }

    case 'get_relevant_resume': {
      const jobId = requirePositiveInt(args.jobId, 'jobId');
      return { jobId, versions: getResumeVersionsForJob(jobId) };
    }

    case 'get_recruiter_history': {
      return {
        contacts: getRecruiterContacts({
          jobId: args.jobId ? requirePositiveInt(args.jobId, 'jobId') : null,
          company: args.company || null
        })
      };
    }

    case 'get_relevant_communication_history': {
      const jobId = requirePositiveInt(args.jobId, 'jobId');
      const rows = db.prepare(`
        SELECT id, job_id, thread_id, sender, recipient, subject, direction, category, urgency, received_at, approval_status
        FROM communications
        WHERE job_id = ?
        ORDER BY id DESC LIMIT 20
      `).all(jobId);
      return { jobId, communications: rows };
    }

    case 'get_agent_task': {
      const taskId = requirePositiveInt(args.taskId, 'taskId');
      const task = getAgentTask(taskId);
      if (!task) throw new Error(`Agent task #${taskId} not found.`);
      return { task };
    }

    case 'get_task_instructions': {
      const taskId = requirePositiveInt(args.taskId, 'taskId');
      const task = getAgentTask(taskId);
      if (!task) throw new Error(`Agent task #${taskId} not found.`);
      const context = buildApplyWithAiContext(task.jobId);
      return { taskId: task.id, taskUid: task.taskUid, instructions: task.instructions, context };
    }

    // --- WRITE TOOLS ---
    case 'update_task_progress': {
      const task = requireActiveTask(args.taskId);
      if (!args.message) throw new Error('message is required.');
      return {
        task: appendTaskProgress(task.id, {
          message: args.message,
          status: args.status || null,
          agentSessionRef: args.agentSessionRef || null
        })
      };
    }

    case 'save_task_result': {
      const task = requireActiveTask(args.taskId);
      if (!args.resultSummary) throw new Error('resultSummary is required.');
      if (args.status === 'awaiting_approval') {
        return {
          task: transitionTaskStatus(task.id, 'awaiting_approval', {
            reason: 'Agent saved task result for approval',
            resultSummary: String(args.resultSummary)
          })
        };
      }
      return {
        task: markTaskCompleted(task.id, String(args.resultSummary))
      };
    }

    case 'save_recruiter_research': {
      const task = requireActiveTask(args.taskId);
      if (!args.companyName) throw new Error('companyName is required.');
      db.prepare(`
        INSERT INTO company_research (company_name, overview, career_page_url, interview_experience_notes, verified_status)
        VALUES (?, ?, ?, ?, 'public_source')
        ON CONFLICT(company_name) DO UPDATE SET
          overview = COALESCE(excluded.overview, company_research.overview),
          career_page_url = COALESCE(excluded.career_page_url, company_research.career_page_url),
          interview_experience_notes = COALESCE(excluded.interview_experience_notes, company_research.interview_experience_notes),
          updated_at = datetime('now')
      `).run(args.companyName.trim(), args.overview || null, args.careerPageUrl || null, args.notes || null);
      return { saved: true, taskId: task.id, companyName: args.companyName.trim() };
    }

    case 'save_contact': {
      const task = requireActiveTask(args.taskId);
      const contact = saveRecruiterContact({
        jobId: args.jobId || task.jobId,
        company: args.company || task.company,
        name: args.name || '',
        role: args.role || 'Recruiter / Talent Acquisition',
        email: args.email || null,
        verificationStatus: args.verificationStatus || null,
        discoverySource: args.discoverySource || 'Agent Public Research',
        sourceUrl: args.sourceUrl || '',
        profileUrl: args.profileUrl || '',
        evidenceNotes: args.evidenceNotes || ''
      });
      recordTimelineEvent({
        jobId: task.jobId,
        contactId: contact.id,
        taskId: task.id,
        eventType: 'recruiter_identified',
        title: `Hiring contact identified: ${contact.name} (${contact.role})`,
        details: contact.discovery_source || ''
      });
      return { contact };
    }

    case 'save_outreach_draft': {
      const task = requireActiveTask(args.taskId);
      const res = createOutreachDraft({
        jobId: args.jobId || task.jobId,
        contactId: args.contactId || null,
        taskId: task.id,
        channel: args.channel || 'email',
        recipientName: args.recipientName || 'Hiring Team',
        recipientEmail: args.recipientEmail || '',
        subject: args.subject || '',
        body: args.body || ''
      });
      if (res.created) {
        recordTimelineEvent({
          jobId: task.jobId,
          contactId: args.contactId || null,
          taskId: task.id,
          eventType: 'outreach_draft_created',
          title: `Outreach draft created (${res.draft.channel})`,
          details: res.draft.subject || res.draft.recipient_name || ''
        });
      }
      return res;
    }

    case 'save_generated_artifact': {
      const task = requireActiveTask(args.taskId);
      if (!args.type || !args.path) throw new Error('type and path are required.');
      return {
        task: attachTaskArtifact(task.id, {
          type: String(args.type),
          path: String(args.path),
          label: args.label ? String(args.label) : String(args.type)
        })
      };
    }

    case 'request_user_approval': {
      const task = requireActiveTask(args.taskId);
      const approval = createApprovalRequest({
        actionType: args.actionType || 'application_final_review',
        jobId: task.jobId,
        taskId: task.id,
        contactId: args.contactId || null,
        draftId: args.draftId || null,
        recipientOrDestination: args.recipientOrDestination || task.canonicalUrl || '',
        subjectOrTitle: args.subjectOrTitle || `${task.title} @ ${task.company}`,
        exactContent: args.exactContent || '',
        attachedDocuments: Array.isArray(args.attachedDocuments) ? args.attachedDocuments : [],
        riskWarning: args.riskWarning || 'Explicit human confirmation required before final submission or external send.'
      });
      return { approval };
    }

    case 'record_manual_action_required': {
      const task = requireActiveTask(args.taskId);
      if (!args.reason) throw new Error('reason is required.');
      return {
        task: transitionTaskStatus(task.id, 'needs_manual_action', {
          reason: `Manual action required: ${args.reason}`,
          manualAction: String(args.reason)
        })
      };
    }

    case 'list_pending_tasks': {
      const limit = args.limit ? requirePositiveInt(args.limit, 'limit') : 50;
      return { tasks: listPendingTasks(limit) };
    }

    case 'get_approved_actions': {
      const taskId = args.taskId ? requirePositiveInt(args.taskId, 'taskId') : null;
      const jobId = args.jobId ? requirePositiveInt(args.jobId, 'jobId') : null;
      const all = listApprovalRequests({ status: 'approved', jobId });
      const filtered = taskId ? all.filter(a => a.taskId === taskId) : all;
      return { approvals: filtered };
    }

    case 'generate_or_get_resume': {
      const task = requireActiveTask(args.taskId);
      const targetJobId = args.jobId ? requirePositiveInt(args.jobId, 'jobId') : task.jobId;
      const existing = getResumeVersionsForJob(targetJobId);
      if (existing.length > 0 && existing[0].pdf_path) {
        return { reused: true, version: existing[0] };
      }
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(targetJobId);
      if (!job) throw new Error(`Job #${targetJobId} not found.`);
      // Return deterministic resume export promise/result
      return exportTailoredDocumentsForJob(job).then(docs => {
        attachTaskArtifact(task.id, { type: 'resume_pdf', path: docs.resumePdfPath, label: 'Tailored ATS Resume PDF' });
        updateTaskBrowserAndStep(task.id, { currentStep: 'resume_ready' });
        return { reused: false, docs };
      });
    }

    case 'update_application_status': {
      const task = requireActiveTask(args.taskId);
      if (!args.status) throw new Error('status is required.');
      if (args.status === 'submitted') {
        throw new Error('Approval Gate Violation: Agent cannot mark an application submitted without explicit user confirmation.');
      }
      const updated = updateApplicationStatus(task.jobId, args.status, {
        userConfirmed: false,
        notes: args.notes || `Updated by Antigravity task #${task.id}`
      });
      updateTaskBrowserAndStep(task.id, { currentStep: `application_${args.status}` });
      return { application: updated };
    }

    case 'record_browser_result': {
      const task = requireActiveTask(args.taskId);
      if (!args.browserStatus || !args.summary) throw new Error('browserStatus and summary are required.');
      const updated = updateTaskBrowserAndStep(task.id, {
        browserStatus: String(args.browserStatus),
        currentStep: 'browser_prefill_recorded'
      });
      appendTaskProgress(task.id, {
        message: `[Browser: ${args.browserStatus}] ${args.summary}`
      });
      recordTimelineEvent({
        jobId: task.jobId,
        taskId: task.id,
        eventType: 'application_prepared',
        title: `Browser workflow: ${args.browserStatus}`,
        details: String(args.summary)
      });
      return { task: updated };
    }

    case 'append_timeline_event': {
      const task = requireActiveTask(args.taskId);
      if (!args.eventType || !args.title) throw new Error('eventType and title are required.');
      const event = recordTimelineEvent({
        jobId: task.jobId,
        taskId: task.id,
        eventType: String(args.eventType),
        title: String(args.title),
        details: args.details ? String(args.details) : ''
      });
      return { event };
    }

    case 'report_task_error': {
      const task = requireActiveTask(args.taskId);
      if (!args.errorDetails) throw new Error('errorDetails is required.');
      const targetStatus = args.status === 'browser_connection_required' ? 'browser_connection_required' : 'failed';
      return {
        task: transitionTaskStatus(task.id, targetStatus, {
          reason: `Error reported: ${args.errorDetails}`,
          errorDetails: String(args.errorDetails)
        })
      };
    }

    case 'run_job_sweep': {
      return runCareerOsJobSweep({
        customQuery: args.query || null,
        maxPerQuery: args.maxPerQuery ? requirePositiveInt(args.maxPerQuery, 'maxPerQuery') : 20
      });
    }

    default:
      throw new Error(`Unhandled tool: ${toolName}`);
  }
}
