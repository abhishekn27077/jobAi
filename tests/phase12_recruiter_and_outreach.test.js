import test, { describe } from 'node:test';
import assert from 'node:assert';
import { getDatabase } from '../src/db/schema.js';
import {
  discoverRecruitersForJob,
  saveRecruiterContact,
  getRecruiterContacts,
  prepareContactOutreach,
  updateContactOutreachStatus,
  OPTIONAL_ENRICHMENT_PROVIDERS
} from '../src/intelligence/recruiterDiscoveryService.js';

describe('Phase 12 — Recruiter Hub Contact Discovery & Outreach Approval Gate', () => {
  test('1. Optional enrichment providers (Hunter, Apollo, Snov.io, Monid) are disabled by default with zero paid usage', () => {
    assert.strictEqual(OPTIONAL_ENRICHMENT_PROVIDERS.length, 4);
    for (const p of OPTIONAL_ENRICHMENT_PROVIDERS) {
      assert.strictEqual(p.enabledByDefault, false, `${p.name} must be disabled by default`);
    }
  });

  test('2. Controlled discovery returns lawful public search links and never guesses emails as Verified', () => {
    const db = getDatabase();
    const job = db.prepare('SELECT id, company FROM jobs LIMIT 1').get();
    assert.ok(job, 'Requires a job record in DB');

    const result = discoverRecruitersForJob(job.id);
    assert.ok(Array.isArray(result.searchLinks) && result.searchLinks.length >= 3, 'Must return public discovery links');
    assert.ok(result.optionalProviders.every(p => p.enabledByDefault === false));
  });

  test('3. Saving a contact without email defaults to Unavailable and cannot be marked Verified', () => {
    const saved = saveRecruiterContact({
      company: 'TestRecruiterCo',
      name: 'Hiring Team',
      role: 'Talent Acquisition',
      email: null,
      verificationStatus: 'Verified'
    });
    assert.strictEqual(saved.verification_status, 'Unavailable', 'Missing email must downgrade Verified to Unavailable');

    const db = getDatabase();
    db.prepare('DELETE FROM recruiter_contacts WHERE id = ?').run(saved.id);
  });

  test('4. Outreach Composer generates grounded draft and enforces Human Approval Gate before Approved/Sent', () => {
    const saved = saveRecruiterContact({
      company: 'OutreachTestCo',
      name: 'Priya Sharma',
      role: 'Technical Recruiter',
      email: 'priya@outreachtestco.example',
      verificationStatus: 'Probable'
    });

    const { contact, draft } = prepareContactOutreach(saved.id, { draftType: 'application_follow_up' });
    assert.strictEqual(contact.outreach_status, 'Draft');
    assert.ok(draft.subject.includes('Abhishek N'), 'Draft must reference verified candidate name');
    assert.ok(draft.body.includes('NearVia'), 'Draft must reference verified project');

    assert.throws(() => {
      updateContactOutreachStatus(saved.id, 'Approved', { userApproved: false });
    }, /Approval Gate Violation/, 'Must block approving outreach without userApproved: true');

    const approved = updateContactOutreachStatus(saved.id, 'Approved', { userApproved: true });
    assert.strictEqual(approved.outreach_status, 'Approved');

    const fetched = getRecruiterContacts({ company: 'OutreachTestCo' });
    assert.ok(fetched.some(c => c.id === saved.id));

    const db = getDatabase();
    db.prepare('DELETE FROM recruiter_contacts WHERE id = ?').run(saved.id);
  });
});
