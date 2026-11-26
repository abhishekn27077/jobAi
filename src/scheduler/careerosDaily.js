/**
 * CareerOS Phase 20 — Daily Integrated Job Discovery, Contact Research & Outreach Drafting
 * Runs a controlled, $0-cost local-first workflow. Never auto-applies or auto-sends outreach.
 */

import { getDatabase } from '../db/schema.js';
import { runCareerOsJobSweep } from '../discovery/discoveryService.js';
import {
  discoverContactsForJobAsync,
  createOutreachDraft
} from '../intelligence/recruiterDiscoveryService.js';
import { runDatabaseIntegrityCheck } from '../db/backupService.js';

async function checkChromeCdpAvailability() {
  try {
    const resp = await fetch('http://127.0.0.1:9222/json/version', {
      signal: AbortSignal.timeout(1500)
    });
    if (!resp.ok) return { available: false, reason: `HTTP ${resp.status}` };
    const info = await resp.json();
    return { available: true, browser: info.Browser || 'Chrome CDP' };
  } catch (err) {
    return { available: false, reason: err.message || 'CDP port 9222 not running' };
  }
}

export async function runCareerOsDailyWorkflow({
  skipSweep = false,
  fetchPublicDomain = true,
  contactLimit = 15,
  maxPerQuery = 20,
  queries = [
    'Java Developer',
    'Junior Java Developer',
    'Spring Boot Developer',
    'Software Engineer',
    'Associate Software Engineer',
    'Full Stack Developer',
    'Graduate Engineer Trainee',
    'Python Developer'
  ]
} = {}) {
  const startedAt = new Date().toISOString();
  const cdpStatus = await checkChromeCdpAvailability();

  let sweepReport = {
    totalSourcesAttempted: 0,
    sourcesSuccessful: 0,
    sourcesFailed: 0,
    sourceErrors: [],
    jobsDiscovered: 0,
    jobsImported: 0,
    jobsUpdated: 0,
    duplicateJobs: 0,
    jobsRejected: 0
  };

  if (!skipSweep) {
    sweepReport = await runCareerOsJobSweep({
      queries,
      maxPerQuery,
      countries: ['in'],
      includeDirectAts: true,
      includePublicFeeds: true
    });
  }

  const db = getDatabase();

  // Select high-fit, non-applied jobs with valid apply URLs for controlled contact research
  const candidateJobs = db.prepare(`
    SELECT j.id, j.title, j.company, j.url, j.source, je.score, je.recommendation, je.fresher_eligible
    FROM jobs j
    LEFT JOIN job_evaluations je ON je.job_id = j.id
    WHERE j.status NOT IN ('applied', 'rejected', 'expired')
      AND j.url LIKE 'http%'
      AND (je.fresher_eligible IS NULL OR je.fresher_eligible = 1)
    ORDER BY COALESCE(je.score, 50) DESC, j.created_at DESC
    LIMIT ?
  `).all(Math.max(1, Number(contactLimit) || 15));

  let contactsDiscovered = 0;
  let draftsGenerated = 0;
  const processedCompanies = new Set();

  for (const job of candidateJobs) {
    const companyKey = (job.company || '').trim().toLowerCase();
    const shouldFetchDomain = fetchPublicDomain && !processedCompanies.has(companyKey);
    processedCompanies.add(companyKey);

    try {
      const discovery = await discoverContactsForJobAsync(job.id, { fetchPublicDomain: shouldFetchDomain });
      contactsDiscovered += discovery.newlyDiscoveredCount || 0;

      for (const contact of (discovery.contacts || []).slice(0, 2)) {
        if (contact.email) {
          const emailDraft = createOutreachDraft({
            jobId: job.id,
            contactId: contact.id,
            channel: 'email',
            recipientName: contact.name || 'Hiring Team',
            recipientEmail: contact.email,
            evidence: [`Source: ${contact.discovery_source || 'Public'}`]
          });
          if (emailDraft.created) draftsGenerated++;
        }
        const liDraft = createOutreachDraft({
          jobId: job.id,
          contactId: contact.id,
          channel: 'linkedin_message',
          recipientName: contact.name || 'Hiring Team',
          recipientEmail: '',
          evidence: ['Manual LinkedIn outreach draft']
        });
        if (liDraft.created) draftsGenerated++;
      }
    } catch {
      // Non-fatal per job
    }
  }

  const dbStats = db.prepare(`
    SELECT
      (SELECT COUNT(id) FROM jobs) as totalJobs,
      (SELECT COUNT(id) FROM jobs WHERE status = 'applied') as appliedJobs,
      (SELECT COUNT(id) FROM recruiter_contacts) as totalContacts,
      (SELECT COUNT(id) FROM recruiter_contacts WHERE profile_url IS NOT NULL AND profile_url != '') as linkedInProfiles,
      (SELECT COUNT(id) FROM recruiter_contacts WHERE email IS NOT NULL AND verification_status = 'Publicly Listed') as publiclySourcedEmails,
      (SELECT COUNT(id) FROM recruiter_contacts WHERE email IS NOT NULL AND verification_status IN ('Estimated', 'Probable')) as inferredEmails,
      (SELECT COUNT(id) FROM recruiter_contacts WHERE email IS NOT NULL AND verification_status = 'Verified') as verifiedEmails,
      (SELECT COUNT(id) FROM outreach_drafts) as totalDrafts
  `).get();

  const integrity = runDatabaseIntegrityCheck();

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    cdpStatus,
    sweep: sweepReport,
    contactResearch: {
      jobsEvaluated: candidateJobs.length,
      companiesResearched: processedCompanies.size,
      contactsNewlyDiscovered: contactsDiscovered,
      draftsNewlyGenerated: draftsGenerated
    },
    database: {
      ...dbStats,
      integrityOk: Boolean(integrity.healthy ?? integrity.ok ?? true)
    },
    costIncurred: '$0'
  };
}
