import test from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase } from '../src/db/schema.js';
import {
  extractPublicEmailsFromText,
  inferEmailEvidenceLabel,
  discoverRecruitersForJob,
  saveRecruiterContact,
  createOutreachDraft,
  updateContactOutreachStatus
} from '../src/intelligence/recruiterDiscoveryService.js';
import { runCareerOsDailyWorkflow } from '../src/scheduler/careerosDaily.js';

test('Phase 20: extractPublicEmailsFromText extracts valid recruiting emails and filters junk', () => {
  const text = `
    Apply at careers@acmeindia.in or hr@acmeindia.in.
    Do not reply to noreply@acmeindia.in or support@example.com.
  `;
  const found = extractPublicEmailsFromText(text);
  const emails = found.map(f => f.email);
  assert.ok(emails.includes('careers@acmeindia.in'));
  assert.ok(emails.includes('hr@acmeindia.in'));
  assert.ok(!emails.includes('noreply@acmeindia.in'));
  assert.ok(!emails.includes('support@example.com'));
  assert.equal(found[0].isRecruiting, true);
});

test('Phase 20: inferEmailEvidenceLabel never marks unverified or pattern emails as Verified', () => {
  assert.equal(inferEmailEvidenceLabel('Verified', 'a@co.com'), 'Verified');
  assert.equal(inferEmailEvidenceLabel('Publicly Listed', 'jobs@co.com'), 'Publicly sourced');
  assert.equal(inferEmailEvidenceLabel('Estimated', 'first.last@co.com'), 'Likely pattern');
  assert.equal(inferEmailEvidenceLabel('Unverified', 'hr@co.com'), 'Unverified');
  assert.equal(inferEmailEvidenceLabel('Unavailable', null), 'Not found');
});

test('Phase 20: discoverRecruitersForJob extracts JD emails, caps at 3, and deduplicates drafts', () => {
  const db = getDatabase();
  const res = db.prepare(`
    INSERT INTO jobs (external_slug, source, title, company, location, url, description, status)
    VALUES (?, 'direct', 'Junior Java Developer', 'Phase20TestCorp', 'Bengaluru', 'https://phase20test.example/jobs/1', 'Send resume to talent@phase20testcorp.in for Java Spring Boot role.', 'discovered')
  `).run(`phase20-test-${Date.now()}`);
  const jobId = Number(res.lastInsertRowid);

  const discovery = discoverRecruitersForJob(jobId);
  assert.ok(discovery.contacts.length >= 1);
  const contact = discovery.contacts.find(c => c.email === 'talent@phase20testcorp.in');
  assert.ok(contact);
  assert.equal(contact.verification_status, 'Publicly Listed');
  assert.equal(contact.email_evidence, 'Publicly sourced');
  assert.ok(discovery.searchLinks.some(l => l.url.includes('linkedin.com')));

  // Duplicate contact with same email should return existing contact
  const dup = saveRecruiterContact({
    jobId,
    company: 'Phase20TestCorp',
    name: 'Another Name',
    email: 'talent@phase20testcorp.in',
    verificationStatus: 'Publicly Listed'
  });
  assert.equal(dup.id, contact.id);

  // LinkedIn and Email drafts with duplicate guard
  const d1 = createOutreachDraft({ jobId, contactId: contact.id, channel: 'linkedin_message', recipientName: 'Asha' });
  assert.equal(d1.created, true);
  assert.ok(d1.draft.body.includes('Phase20TestCorp'));
  assert.equal(d1.draft.manualSendRequired, true);

  const d1Dup = createOutreachDraft({ jobId, contactId: contact.id, channel: 'linkedin_message', recipientName: 'Asha' });
  assert.equal(d1Dup.created, false);
  assert.equal(d1Dup.duplicatePrevented, true);

  // Status update records last_contact_date when Sent with approval
  const updated = updateContactOutreachStatus(contact.id, 'Sent', { userApproved: true, notes: 'Sent manually' });
  assert.equal(updated.outreach_status, 'Sent');
  assert.ok(updated.last_contact_date);
});

test('Phase 20: runCareerOsDailyWorkflow executes cleanly with $0 cost and DB integrity', async () => {
  const report = await runCareerOsDailyWorkflow({
    skipSweep: true,
    fetchPublicDomain: false,
    contactLimit: 3
  });
  assert.equal(report.costIncurred, '$0');
  assert.equal(report.database.integrityOk, true);
  assert.ok(report.contactResearch.jobsEvaluated <= 3);
});
