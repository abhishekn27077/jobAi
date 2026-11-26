import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { getDatabase } from '../src/db/schema.js';
import { saveOrUpdateJob } from '../src/tracker/jobTracker.js';
import {
  createAgentTask,
  getAgentTask,
  listAgentTasks,
  pauseAgentTask,
  resumeAgentTask,
  cancelAgentTask,
  recoverStaleTasks,
  buildApplyWithAiContext
} from '../src/agent/agentTaskManager.js';
import {
  ALL_AGENT_TOOLS,
  executeAgentTool,
  verifyAgentBridgeAuth
} from '../src/agent/agentBridge.js';
import {
  saveRecruiterContact,
  researchHiringTeamForJob,
  createOutreachDraft,
  getOutreachDrafts,
  updateOutreachDraft
} from '../src/intelligence/recruiterDiscoveryService.js';
import {
  createApprovalRequest,
  listApprovalRequests,
  decideApprovalRequest
} from '../src/tracker/approvalCenter.js';
import {
  recordTimelineEvent,
  getUnifiedTimeline
} from '../src/tracker/timelineService.js';
import {
  getDriveIntegrationStatus,
  uploadDocumentToDrive
} from '../src/drive/googleDriveService.js';

function createSampleJob(suffix) {
  const res = saveOrUpdateJob({
    externalSlug: `phase15_test_${suffix}_${Date.now()}`,
    source: 'greenhouse',
    title: 'Junior Java Backend Developer',
    company: `Phase15Corp_${suffix}`,
    location: 'Bengaluru, Karnataka, India',
    url: `https://boards.greenhouse.io/phase15corp/jobs/${suffix}`,
    description: 'MCA / B.Tech fresher role using Java, Spring Boot, PostgreSQL and REST APIs.'
  });
  return res.jobId;
}

test('Phase 15: Agent Task creation, duplicate prevention, pause/resume/cancel & recovery', () => {
  const jobId = createSampleJob('tasks');

  const first = createAgentTask({ jobId, taskType: 'apply_with_ai' });
  assert.equal(first.created, true);
  assert.equal(first.duplicatePrevented, false);
  assert.equal(first.task.status, 'queued');

  // Duplicate prevention for same job + workflow
  const dup = createAgentTask({ jobId, taskType: 'apply_with_ai' });
  assert.equal(dup.created, false);
  assert.equal(dup.duplicatePrevented, true);
  assert.equal(dup.task.id, first.task.id);

  // Resume -> running, Pause -> paused, Resume -> running
  const resumed = resumeAgentTask(first.task.id, 'Starting execution');
  assert.equal(resumed.status, 'running');
  assert.ok(resumed.startedAt);

  // Crash recovery: running task transitions to agent_disconnected
  const recovered = recoverStaleTasks();
  assert.ok(recovered.some(t => t.id === first.task.id && t.status === 'agent_disconnected'));

  const disconnected = getAgentTask(first.task.id);
  assert.equal(disconnected.status, 'agent_disconnected');

  const resumedAgain = resumeAgentTask(first.task.id, 'Resumed after recovery');
  assert.equal(resumedAgain.status, 'running');

  const pausedManually = pauseAgentTask(first.task.id, 'Manual pause');
  assert.equal(pausedManually.status, 'paused');

  const cancelled = cancelAgentTask(first.task.id, 'No longer needed');
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(listAgentTasks({ jobId }).length >= 1);
});

test('Phase 15: Apply-with-AI context excludes OAuth tokens and secrets', () => {
  const jobId = createSampleJob('ctx');
  const ctx = buildApplyWithAiContext(jobId);
  assert.equal(ctx.job.id, jobId);
  assert.ok(ctx.candidateProfile.personal.fullName);
  assert.ok(Array.isArray(ctx.candidateProfile.verifiedSkills));
  assert.ok(ctx.applicationInstructions.includes('STOP before final submission'));
  const serialized = JSON.stringify(ctx);
  assert.equal(serialized.includes('refresh_token'), false);
  assert.equal(serialized.includes('access_token'), false);
});

test('Phase 15: Agent Bridge security, 24 scoped tools, invalid taskId & auth token', () => {
  assert.equal(ALL_AGENT_TOOLS.length, 24);

  // Unauthorized tool rejected
  assert.throws(() => executeAgentTool('drop_database', {}), /Unauthorized tool/);

  // Invalid taskId rejected
  assert.throws(() => executeAgentTool('get_agent_task', { taskId: -5 }), /Invalid taskId/);
  assert.throws(() => executeAgentTool('update_task_progress', { taskId: 9999999, message: 'x' }), /Unauthorized or invalid taskId/);

  // Cancelled task cannot be mutated
  const jobId = createSampleJob('bridge');
  const { task } = createAgentTask({ jobId });
  cancelAgentTask(task.id, 'Cancelled for test');
  assert.throws(() => executeAgentTool('update_task_progress', { taskId: task.id, message: 'Should fail' }), /cancelled/);

  // Optional bearer token check
  const prev = process.env.CAREEROS_AGENT_TOKEN;
  try {
    process.env.CAREEROS_AGENT_TOKEN = 'secret_phase15_token';
    assert.equal(verifyAgentBridgeAuth({}).authorized, false);
    assert.equal(verifyAgentBridgeAuth({ authorization: 'Bearer wrong' }).authorized, false);
    assert.equal(verifyAgentBridgeAuth({ authorization: 'Bearer secret_phase15_token' }).authorized, true);
  } finally {
    if (prev === undefined) delete process.env.CAREEROS_AGENT_TOKEN;
    else process.env.CAREEROS_AGENT_TOKEN = prev;
  }
});

test('Phase 15: MCP stdio server responds to initialize and tools/list', () => {
  const input = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  ].join('\n') + '\n';

  const res = spawnSync(process.execPath, ['src/agent/mcpServer.js'], {
    input,
    encoding: 'utf8',
    timeout: 10000
  });
  assert.equal(res.status, 0);
  const lines = res.stdout.trim().split(/\r?\n/).map(l => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].result.serverInfo.name, 'careeros-agent-bridge');
  assert.equal(lines[1].result.tools.length, 24);
});

test('Phase 15: Recruiter research, outreach drafts, duplicate guard, Approval Center & Timeline', () => {
  const jobId = createSampleJob('outreach');
  const { task } = createAgentTask({ jobId });

  const contact = saveRecruiterContact({
    jobId,
    company: 'Phase15Corp_outreach',
    name: 'Ananya Rao',
    role: 'Technical Recruiter',
    email: 'ananya@phase15corp.example',
    verificationStatus: 'Publicly Listed',
    discoverySource: 'Official Company Careers Page',
    sourceUrl: 'https://phase15corp.example/careers',
    profileUrl: 'https://www.linkedin.com/in/ananya-rao-example',
    evidenceNotes: 'Listed on official engineering careers page.'
  });
  assert.equal(contact.verification_status, 'Publicly Listed');

  const team = researchHiringTeamForJob(jobId);
  assert.ok(team.topContacts.length >= 1 && team.topContacts.length <= 3);
  assert.ok(team.manualLinkedInLinks.length === 3);

  // Outreach draft + duplicate prevention + LinkedIn manual send flag
  const liDraft = createOutreachDraft({
    jobId,
    contactId: contact.id,
    taskId: task.id,
    channel: 'linkedin_message',
    recipientName: contact.name
  });
  assert.equal(liDraft.created, true);
  assert.equal(liDraft.draft.manualSendRequired, true);

  const liDup = createOutreachDraft({
    jobId,
    contactId: contact.id,
    taskId: task.id,
    channel: 'linkedin_message',
    recipientName: contact.name
  });
  assert.equal(liDup.created, false);
  assert.equal(liDup.duplicatePrevented, true);

  const updated = updateOutreachDraft(liDraft.draft.id, { body: 'Edited personalized message' });
  assert.equal(updated.body, 'Edited personalized message');
  assert.ok(getOutreachDrafts({ jobId }).length >= 1);

  // Approval Center: requires explicit userConfirmed=true
  const approval = createApprovalRequest({
    actionType: 'email_send',
    jobId,
    taskId: task.id,
    contactId: contact.id,
    draftId: liDraft.draft.id,
    recipientOrDestination: 'ananya@phase15corp.example',
    subjectOrTitle: 'Application Follow-up',
    exactContent: 'Edited personalized message'
  });
  assert.equal(approval.status, 'pending');
  assert.ok(listApprovalRequests({ status: 'pending', jobId }).length >= 1);

  assert.throws(
    () => decideApprovalRequest(approval.id, { decision: 'approved', userConfirmed: false }),
    /Approval Gate Violation/
  );

  const decided = decideApprovalRequest(approval.id, {
    decision: 'approved',
    editedContent: 'Final confirmed text',
    userConfirmed: true
  });
  assert.equal(decided.status, 'approved');
  assert.equal(decided.exactContent, 'Final confirmed text');

  // Timeline unification
  recordTimelineEvent({
    jobId,
    taskId: task.id,
    contactId: contact.id,
    eventType: 'recruiter_identified',
    title: 'Recruiter identified'
  });
  const timeline = getUnifiedTimeline(jobId);
  assert.ok(timeline.events.some(e => e.eventType === 'agent_task_created'));
  assert.ok(timeline.events.some(e => e.eventType === 'recruiter_identified'));
});

test('Phase 15: Google Drive integration remains optional & blocks temporary files', async () => {
  const status = getDriveIntegrationStatus();
  assert.equal(status.optional, true);
  assert.equal(status.requiredScope, 'https://www.googleapis.com/auth/drive.file');

  const tmpFile = path.join(os.tmpdir(), `temp_test_${Date.now()}.pdf`);
  fs.writeFileSync(tmpFile, '%PDF-1.4\n');
  try {
    await assert.rejects(
      () => uploadDocumentToDrive({ localPath: tmpFile, docType: 'resume' }),
      /Temporary files cannot be uploaded/
    );
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('Phase 15: Chrome profile config auto-detects Work profile and validates URLs', async () => {
  const {
    listLocalChromeProfiles,
    getChromeProfileConfig,
    openUrlInChromeProfile
  } = await import('../src/automation/chromeProfileConfig.js');

  const cfg = getChromeProfileConfig();
  assert.ok(cfg.profileDirectory);
  const profiles = listLocalChromeProfiles(cfg.userDataDir);
  if (profiles.length > 0) {
    const work = profiles.find(p => p.isWorkProfile);
    if (work) assert.equal(work.directory, 'Profile 21');
  }
  assert.throws(() => openUrlInChromeProfile('file:///etc/passwd', cfg), /Only HTTP\/HTTPS/);
});

test('Phase 16: Retry, premature completion guard, approval invalidation & Chrome CDP probe', async () => {
  const {
    retryAgentTask,
    markTaskCompleted,
    getAgentBridgeStatus
  } = await import('../src/agent/agentTaskManager.js');
  const { validateApprovalForExecution } = await import('../src/tracker/approvalCenter.js');
  const { getChromeConnectionStatus } = await import('../src/automation/chromeProfileConfig.js');

  const jobId = createSampleJob('phase16');
  const { task } = createAgentTask({ jobId });

  // Cannot mark completed without progress/artifacts
  assert.throws(() => markTaskCompleted(task.id, 'Attempted completion'), /no progress steps or artifacts/);

  // Report error -> failed -> retry -> queued
  const errored = await executeAgentTool('report_task_error', {
    taskId: task.id,
    errorDetails: 'Portal timeout'
  });
  assert.equal(errored.task.status, 'failed');

  const retried = retryAgentTask(task.id, 'Retrying after timeout');
  assert.equal(retried.status, 'queued');

  // Record browser result + block submitted via bridge
  await executeAgentTool('record_browser_result', {
    taskId: task.id,
    browserStatus: 'cdp_attached',
    summary: 'Pre-filled name, email, resume'
  });
  assert.throws(
    () => executeAgentTool('update_application_status', { taskId: task.id, status: 'submitted' }),
    /Approval Gate Violation/
  );

  // Heartbeat reflects connected after tool execution
  assert.equal(getAgentBridgeStatus().connected, true);

  // Approval invalidation when recipient changes
  const approval = createApprovalRequest({
    actionType: 'email_send',
    jobId,
    taskId: task.id,
    recipientOrDestination: 'hr@example.com',
    subjectOrTitle: 'Follow up',
    exactContent: 'Hello'
  });
  decideApprovalRequest(approval.id, { decision: 'approved', userConfirmed: true });
  assert.equal(validateApprovalForExecution(approval.id, { recipientOrDestination: 'hr@example.com' }).valid, true);
  assert.equal(validateApprovalForExecution(approval.id, { recipientOrDestination: 'other@example.com' }).valid, false);

  // Chrome connection status probe
  const chromeStatus = await getChromeConnectionStatus();
  assert.equal(chromeStatus.profileDirectory, 'Profile 21');
  assert.equal(typeof chromeStatus.cdpConnected, 'boolean');
});
