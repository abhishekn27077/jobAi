/**
 * CareerOS — Recruiter Hub & Controlled Contact Discovery Service
 * Discovers hiring contacts strictly from verified inbound communications,
 * official company career/ATS pages, and lawful public search links.
 * Never fabricates recruiter names or guesses unverified emails as verified.
 */

import { getDatabase } from '../db/schema.js';
import { generateCommunicationDraft } from '../email/communicationAssistant.js';
import { loadCandidateProfile } from '../profile/profileManager.js';

export const CONTACT_VERIFICATION_STATUSES = [
  'Verified',
  'Publicly Listed',
  'Estimated',
  'Probable',
  'Unverified',
  'Invalid',
  'Unavailable'
];
export const EMAIL_EVIDENCE_LABELS = [
  'Verified',
  'Publicly sourced',
  'Likely pattern',
  'Unverified',
  'Not found'
];
export const OUTREACH_STATUSES = ['Not Contacted', 'Draft', 'Approved', 'Sent', 'Reply Received', 'Follow-up Due', 'No Response', 'Closed'];
export const OUTREACH_CHANNELS = [
  'email',
  'linkedin_message',
  'connection_request',
  'recruiter_follow_up',
  'application_follow_up',
  'interview_thank_you'
];

export const HIRING_ROLE_PRIORITIES = [
  'Vacancy Recruiter',
  'Technical Recruiter',
  'Talent Acquisition',
  'Campus Recruiter',
  'Engineering Manager',
  'Hiring Manager'
];

const JUNK_EMAIL_DOMAINS = [
  'example.com', 'test.com', 'sentry.io', 'wixpress.com', 'schema.org',
  'w3.org', 'googleapis.com', 'github.com', 'linkedin.com', 'naukri.com',
  'indeed.com', 'internshala.com', 'freshersworld.com'
];

export function extractPublicEmailsFromText(text = '') {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  const unique = [];
  const seen = new Set();
  for (const raw of matches) {
    const email = raw.toLowerCase().replace(/[.,;:!?]+$/, '');
    if (seen.has(email)) continue;
    const [local, domain] = email.split('@');
    if (!local || !domain || !domain.includes('.')) continue;
    if (/^(no-?reply|donotreply|do-not-reply|privacy|legal|abuse|postmaster|mailer-daemon|support|bounce)/i.test(local)) continue;
    if (/\.(png|jpg|jpeg|gif|svg|webp|css|js|woff2?)$/i.test(domain)) continue;
    if (JUNK_EMAIL_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`))) continue;
    seen.add(email);
    const isRecruiting = /(career|job|recruit|talent|hr|hiring|people|campus|intern)/i.test(local);
    unique.push({ email, isRecruiting });
  }
  return unique.sort((a, b) => Number(b.isRecruiting) - Number(a.isRecruiting));
}

export function inferEmailEvidenceLabel(verificationStatus, email) {
  if (!email) return 'Not found';
  if (verificationStatus === 'Verified') return 'Verified';
  if (verificationStatus === 'Publicly Listed') return 'Publicly sourced';
  if (verificationStatus === 'Estimated' || verificationStatus === 'Probable') return 'Likely pattern';
  return 'Unverified';
}

export function computeContactRelevanceScore({ role = '', email = '', verification_status = 'Unverified', profile_url = '' } = {}) {
  const r = String(role || '').toLowerCase();
  let score = 35;
  if (r.includes('technical recruiter') || r.includes('vacancy recruiter')) score = 70;
  else if (r.includes('talent acquisition') || r.includes('campus')) score = 65;
  else if (r.includes('recruiter') || r.includes('hr')) score = 60;
  else if (r.includes('engineering manager') || r.includes('hiring manager')) score = 55;

  if (profile_url) score += 15;
  if (email) {
    if (verification_status === 'Verified') score += 15;
    else if (verification_status === 'Publicly Listed') score += 12;
    else score += 5;
  }
  return Math.min(100, score);
}

export const OPTIONAL_ENRICHMENT_PROVIDERS = [
  {
    id: 'hunter',
    name: 'Hunter.io',
    freeAllowance: '25 searches / 50 verifications per month (Free plan)',
    cost: '$0 on Free plan; paid plans start at $49/mo',
    requiresKey: 'HUNTER_API_KEY',
    enabledByDefault: false,
    privacyNote: 'Sends company domain to Hunter API only when explicitly triggered by user.'
  },
  {
    id: 'apollo',
    name: 'Apollo.io',
    freeAllowance: 'Limited free export credits on Free tier',
    cost: '$0 on Free tier; paid plans start at $49/mo',
    requiresKey: 'APOLLO_API_KEY',
    enabledByDefault: false,
    privacyNote: 'Requires explicit user API key and confirmation; disabled by default.'
  },
  {
    id: 'snovio',
    name: 'Snov.io',
    freeAllowance: '50 credits/month on Trial/Free plan',
    cost: '$0 Trial; paid plans start at $39/mo',
    requiresKey: 'SNOV_API_KEY',
    enabledByDefault: false,
    privacyNote: 'Optional enrichment only; never auto-executed.'
  },
  {
    id: 'monid',
    name: 'Monid / Public Domain Lookup',
    freeAllowance: 'Manual public web lookup only',
    cost: '$0',
    requiresKey: null,
    enabledByDefault: false,
    privacyNote: 'No automated scraping; user-assisted public search only.'
  }
];

function safeExtractDomain(urlStr) {
  try {
    if (!urlStr || !urlStr.startsWith('http')) return null;
    const host = new URL(urlStr).hostname.replace(/^www\./, '');
    const atsHosts = ['boards.greenhouse.io', 'jobs.lever.co', 'jobs.ashbyhq.com', 'jobs.smartrecruiters.com', 'apply.workable.com'];
    if (atsHosts.some(h => host.includes(h))) return null;
    return host;
  } catch {
    return null;
  }
}

/**
 * Controlled discovery workflow for a selected job:
 * 1. Check verified inbound recruiter communications in SQLite.
 * 2. Check existing recruiter_contacts records for company/job.
 * 3. Build lawful public search URLs (Official Careers, Talent Acquisition search, domain search).
 */
export function discoverRecruitersForJob(jobId) {
  const db = getDatabase();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`Job #${jobId} not found.`);

  const company = (job.company || 'Company').trim();
  const domain = safeExtractDomain(job.url) || safeExtractDomain(job.canonical_url);

  // 1. Check existing stored contacts and associate this jobId if needed
  const stored = db.prepare(`
    SELECT * FROM recruiter_contacts
    WHERE job_id = ? OR LOWER(company) = LOWER(?)
    ORDER BY relevance_score DESC, id DESC
  `).all(jobId, company);

  for (const row of stored) {
    const linked = safeParseHistory(row.associated_job_ids_json);
    if (!linked.includes(jobId)) {
      linked.push(jobId);
      db.prepare('UPDATE recruiter_contacts SET associated_job_ids_json = ? WHERE id = ?').run(JSON.stringify(linked), row.id);
    }
  }

  // 2. Check verified inbound communications for this company or job (cap 3 per company)
  const comms = db.prepare(`
    SELECT * FROM communications
    WHERE job_id = ? OR LOWER(sender) LIKE LOWER(?)
    ORDER BY id DESC LIMIT 5
  `).all(jobId, `%${company.split(/\s+/)[0]}%`);

  const newlyDiscovered = [];
  for (const c of comms) {
    if (stored.length + newlyDiscovered.length >= 3) break;
    const emailMatch = (c.sender || '').match(/[\w.+-]+@[\w.-]+\.\w+/);
    const email = emailMatch ? emailMatch[0].toLowerCase() : null;
    const senderName = (c.sender || '').replace(/<[^>]+>/g, '').trim() || 'Hiring Contact';
    const alreadyExists = [...stored, ...newlyDiscovered].some(
      s => (email && s.email && s.email.toLowerCase() === email) || (s.name === senderName && s.company.toLowerCase() === company.toLowerCase())
    );
    if (!alreadyExists && email) {
      const relScore = computeContactRelevanceScore({ role: 'Recruiter / Hiring Contact', email, verification_status: 'Verified' });
      const info = db.prepare(`
        INSERT INTO recruiter_contacts (
          job_id, company, name, role, email, verification_status, email_evidence,
          discovery_source, source_url, confidence, relevance_score, outreach_status,
          associated_job_ids_json, contact_history_json
        ) VALUES (?, ?, ?, ?, ?, 'Verified', 'Verified', 'Inbound Gmail / Communication', ?, 'high', ?, 'Reply Received', ?, ?)
      `).run(
        jobId,
        company,
        senderName,
        'Recruiter / Hiring Contact',
        email,
        job.url || '',
        relScore,
        JSON.stringify([jobId]),
        JSON.stringify([{ event: 'discovered_from_inbox', timestamp: new Date().toISOString(), subject: c.subject }])
      );
      newlyDiscovered.push(db.prepare('SELECT * FROM recruiter_contacts WHERE id = ?').get(info.lastInsertRowid));
    }
  }

  // 2b. Extract explicitly published recruiting emails from job description (never guessed)
  const jdEmails = extractPublicEmailsFromText(job.description || '');
  for (const item of jdEmails) {
    if (stored.length + newlyDiscovered.length >= 3) break;
    const alreadyExists = [...stored, ...newlyDiscovered].some(
      s => s.email && s.email.toLowerCase() === item.email
    );
    if (!alreadyExists) {
      const roleLabel = item.isRecruiting ? 'Official Recruiting Contact' : 'Company Job Posting Contact';
      const relScore = computeContactRelevanceScore({ role: roleLabel, email: item.email, verification_status: 'Publicly Listed' });
      const info = db.prepare(`
        INSERT INTO recruiter_contacts (
          job_id, company, name, role, email, verification_status, email_evidence,
          discovery_source, source_url, confidence, relevance_score, evidence_notes,
          outreach_status, associated_job_ids_json, contact_history_json
        ) VALUES (?, ?, ?, ?, ?, 'Publicly Listed', 'Publicly sourced', 'Job Posting Description', ?, ?, ?, ?, 'Not Contacted', ?, ?)
      `).run(
        jobId,
        company,
        `${company} Recruiting`,
        roleLabel,
        item.email,
        job.url || '',
        item.isRecruiting ? 'high' : 'medium',
        relScore,
        'Explicitly published in job posting description.',
        JSON.stringify([jobId]),
        JSON.stringify([{ event: 'discovered_from_jd', timestamp: new Date().toISOString(), sourceUrl: job.url || '' }])
      );
      newlyDiscovered.push(db.prepare('SELECT * FROM recruiter_contacts WHERE id = ?').get(info.lastInsertRowid));
    }
  }

  // 3. Build lawful public discovery links (never guessing emails)
  const searchLinks = [
    {
      label: 'Official Company Careers / Recruiting Page',
      source: 'Official Career Page',
      url: job.url || `https://www.google.com/search?q=${encodeURIComponent(`${company} careers talent acquisition`)}`
    },
    {
      label: 'Google site:linkedin.com/in (Technical Recruiter)',
      source: 'Public Profile Search',
      url: `https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com/in "${company}" ("Technical Recruiter" OR "Talent Acquisition" OR "Campus Recruiter") India`)}`
    },
    {
      label: 'Google site:linkedin.com/in (Hiring / Engineering Manager)',
      source: 'Public Profile Search',
      url: `https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com/in "${company}" ("Engineering Manager" OR "Hiring Manager") Bengaluru`)}`
    },
    {
      label: 'Public Recruiting Email Search',
      source: 'Public Email Search',
      url: `https://www.google.com/search?q=${encodeURIComponent(`"${company}" ("careers@" OR "jobs@" OR "talent@" OR "hr@" OR "recruiting@")`)}`
    }
  ];

  if (domain) {
    searchLinks.push({
      label: `Domain Recruiting Contact Search (${domain})`,
      source: 'Company Domain Search',
      url: `https://www.google.com/search?q=${encodeURIComponent(`site:${domain} careers OR jobs OR "@${domain}"`)}`
    });
  }

  const allContacts = db.prepare(`
    SELECT * FROM recruiter_contacts
    WHERE job_id = ? OR LOWER(company) = LOWER(?)
    ORDER BY relevance_score DESC, id DESC
    LIMIT 10
  `).all(jobId, company);

  return {
    job: { id: job.id, title: job.title, company, url: job.url, domain },
    contacts: allContacts.map(formatContactRow),
    newlyDiscoveredCount: newlyDiscovered.length,
    searchLinks,
    optionalProviders: OPTIONAL_ENRICHMENT_PROVIDERS.map(p => ({
      ...p,
      configured: p.requiresKey ? Boolean(process.env[p.requiresKey]) : false
    }))
  };
}

/**
 * Controlled async contact discovery: runs local discovery + optional 1-request public
 * official careers page email check (cached per company, 4s timeout, never bypasses gates).
 */
export async function discoverContactsForJobAsync(jobId, { fetchPublicDomain = false } = {}) {
  const base = discoverRecruitersForJob(jobId);
  if (!fetchPublicDomain || !base.job.domain || base.contacts.length >= 3) {
    return base;
  }

  const db = getDatabase();
  const domain = base.job.domain;
  const company = base.job.company;

  // Check cache in company_research so we don't re-hit the same company domain repeatedly
  const cached = db.prepare('SELECT recruiter_info_json, updated_at FROM company_research WHERE LOWER(company_name) = LOWER(?)').get(company);
  if (cached && cached.recruiter_info_json && cached.recruiter_info_json !== 'null') {
    return base;
  }

  const candidateUrls = [`https://${domain}/careers`, `https://${domain}/contact`];
  for (const pageUrl of candidateUrls) {
    if (base.contacts.length >= 3) break;
    try {
      const resp = await fetch(pageUrl, {
        headers: { 'User-Agent': 'CareerOS-LocalResearch/1.0' },
        signal: AbortSignal.timeout(4000)
      });
      if (!resp.ok) continue;
      const html = await resp.text();
      if (/captcha|cf-chl|verify you are human/i.test(html)) continue;
      const found = extractPublicEmailsFromText(html).filter(e => e.isRecruiting).slice(0, 2);
      for (const item of found) {
        const saved = saveRecruiterContact({
          jobId,
          company,
          name: `${company} Careers`,
          role: 'Official Recruiting Contact',
          email: item.email,
          verificationStatus: 'Publicly Listed',
          discoverySource: 'Official Company Careers Page',
          sourceUrl: pageUrl,
          publicSourceUrls: [pageUrl],
          evidenceNotes: `Publicly listed on ${pageUrl}`,
          confidence: 'high'
        });
        if (saved && !base.contacts.some(c => c.id === saved.id)) {
          base.contacts.push(saved);
          base.newlyDiscoveredCount++;
        }
      }
      if (found.length > 0) break;
    } catch {
      // Timeout or network error: skip cleanly without blocking
    }
  }

  return base;
}

export function saveRecruiterContact({
  jobId = null,
  company,
  name = '',
  role = 'Recruiter / Talent Acquisition',
  email = null,
  verificationStatus = null,
  discoverySource = 'Manual / Public Research',
  sourceUrl = '',
  profileUrl = '',
  publicSourceUrls = [],
  evidenceNotes = '',
  notes = '',
  confidence = 'medium'
}) {
  if (!company) throw new Error('Company is required.');
  const db = getDatabase();

  const cleanEmail = email ? email.trim() : null;
  let finalVerif = verificationStatus;
  if (!finalVerif || !CONTACT_VERIFICATION_STATUSES.includes(finalVerif)) {
    finalVerif = cleanEmail ? 'Unverified' : 'Unavailable';
  }
  // Strict Rule: Never label an unverified guessed email as Verified without inbox/domain proof
  if (!cleanEmail && finalVerif === 'Verified') {
    finalVerif = 'Unavailable';
  }

  // Prevent duplicate contact for same job + email or same company + name
  if (cleanEmail) {
    const dup = db.prepare(`
      SELECT * FROM recruiter_contacts
      WHERE LOWER(company) = LOWER(?) AND LOWER(email) = LOWER(?)
      LIMIT 1
    `).get(company.trim(), cleanEmail);
    if (dup) return formatContactRow(dup);
  }

  const now = new Date().toISOString();
  const sourcesJson = JSON.stringify(
    Array.isArray(publicSourceUrls) && publicSourceUrls.length > 0
      ? publicSourceUrls
      : (sourceUrl ? [sourceUrl] : [])
  );
  const emailEvidence = inferEmailEvidenceLabel(finalVerif, cleanEmail);
  const relevanceScore = computeContactRelevanceScore({
    role,
    email: cleanEmail,
    verification_status: finalVerif,
    profile_url: profileUrl
  });
  const associatedJobIds = jobId ? [jobId] : [];

  const info = db.prepare(`
    INSERT INTO recruiter_contacts (
      job_id, company, name, role, email, verification_status, email_evidence,
      discovery_source, source_url, profile_url, public_source_urls_json,
      research_timestamp, evidence_notes, notes, confidence, relevance_score,
      outreach_status, associated_job_ids_json, contact_history_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Not Contacted', ?, ?)
  `).run(
    jobId,
    company.trim(),
    name.trim() || 'Hiring Contact',
    role.trim(),
    cleanEmail,
    finalVerif,
    emailEvidence,
    discoverySource,
    sourceUrl,
    profileUrl || null,
    sourcesJson,
    now,
    evidenceNotes || '',
    notes || '',
    confidence,
    relevanceScore,
    JSON.stringify(associatedJobIds),
    JSON.stringify([{ event: 'contact_saved', timestamp: now, source: discoverySource }])
  );

  return formatContactRow(db.prepare('SELECT * FROM recruiter_contacts WHERE id = ?').get(info.lastInsertRowid));
}

export function getRecruiterContacts({ company = null, jobId = null } = {}) {
  const db = getDatabase();
  let query = `
    SELECT rc.*, j.title as job_title, j.url as job_url
    FROM recruiter_contacts rc
    LEFT JOIN jobs j ON rc.job_id = j.id
    WHERE 1=1
  `;
  const params = [];
  if (company) {
    query += ' AND LOWER(rc.company) LIKE LOWER(?)';
    params.push(`%${company.trim()}%`);
  }
  if (jobId) {
    query += ' AND rc.job_id = ?';
    params.push(jobId);
  }
  query += ' ORDER BY rc.id DESC LIMIT 100';
  return db.prepare(query).all(...params).map(formatContactRow);
}

/**
 * Prepares or updates outreach for a contact with mandatory human approval gate.
 */
export function prepareContactOutreach(contactId, { draftType = 'application_follow_up', customContext = '' } = {}) {
  const db = getDatabase();
  const contact = db.prepare('SELECT * FROM recruiter_contacts WHERE id = ?').get(contactId);
  if (!contact) throw new Error(`Contact #${contactId} not found.`);

  const job = contact.job_id ? db.prepare('SELECT * FROM jobs WHERE id = ?').get(contact.job_id) : { company: contact.company, title: 'Software Engineer' };
  const draft = generateCommunicationDraft({
    draftType,
    job,
    recruiterName: contact.name || 'Hiring Team',
    recruiterEmail: contact.email || '',
    customContext
  });

  const history = safeParseHistory(contact.contact_history_json);
  history.push({ event: 'draft_prepared', timestamp: new Date().toISOString(), subject: draft.subject });

  db.prepare(`
    UPDATE recruiter_contacts
    SET outreach_status = 'Draft', contact_history_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(history), contactId);

  return {
    contact: formatContactRow(db.prepare('SELECT * FROM recruiter_contacts WHERE id = ?').get(contactId)),
    draft
  };
}

export function updateContactOutreachStatus(contactId, newStatus, { userApproved = false, notes = '' } = {}) {
  if (!OUTREACH_STATUSES.includes(newStatus)) {
    throw new Error(`Invalid outreach status "${newStatus}".`);
  }
  if (['Approved', 'Sent'].includes(newStatus) && !userApproved) {
    throw new Error(`Approval Gate Violation: Outreach cannot be marked "${newStatus}" without explicit user approval.`);
  }

  const db = getDatabase();
  const contact = db.prepare('SELECT * FROM recruiter_contacts WHERE id = ?').get(contactId);
  if (!contact) throw new Error(`Contact #${contactId} not found.`);

  const now = new Date().toISOString();
  const history = safeParseHistory(contact.contact_history_json);
  history.push({
    event: `status_${newStatus.toLowerCase().replace(/\s+/g, '_')}`,
    timestamp: now,
    userApproved: Boolean(userApproved),
    notes: notes || undefined
  });

  const lastContactDate = newStatus === 'Sent' ? now : contact.last_contact_date;

  db.prepare(`
    UPDATE recruiter_contacts
    SET outreach_status = ?,
        last_contact_date = ?,
        notes = CASE WHEN ? != '' THEN ? ELSE notes END,
        contact_history_json = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(newStatus, lastContactDate, notes || '', notes || '', JSON.stringify(history), contactId);

  return formatContactRow(db.prepare('SELECT * FROM recruiter_contacts WHERE id = ?').get(contactId));
}

function safeParseHistory(raw) {
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

function formatContactRow(row) {
  if (!row) return null;
  let publicSourceUrls = [];
  try {
    publicSourceUrls = row.public_source_urls_json ? JSON.parse(row.public_source_urls_json) : [];
  } catch {
    publicSourceUrls = [];
  }
  const associatedJobIds = safeParseHistory(row.associated_job_ids_json);
  const emailEvidence = row.email_evidence || inferEmailEvidenceLabel(row.verification_status, row.email);
  const relevanceScore = row.relevance_score || computeContactRelevanceScore(row);
  return {
    ...row,
    email_evidence: emailEvidence,
    relevance_score: relevanceScore,
    associatedJobIds,
    publicSourceUrls,
    contactHistory: safeParseHistory(row.contact_history_json)
  };
}

/**
 * Phase 4: Prioritized Hiring Team research for a job (aims for 1-3 top contacts).
 * Never scrapes LinkedIn or fabricates contacts/emails; generates manual LinkedIn search links.
 */
export function researchHiringTeamForJob(jobId) {
  const base = discoverRecruitersForJob(jobId);
  const company = base.job.company;
  const roleTitle = base.job.title;

  const manualLinkedInLinks = [
    {
      label: `LinkedIn People Search: ${company} Technical Recruiter`,
      priority: 2,
      url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${company} Technical Recruiter`)}`
    },
    {
      label: `LinkedIn People Search: ${company} Talent Acquisition`,
      priority: 3,
      url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${company} Talent Acquisition`)}`
    },
    {
      label: `LinkedIn People Search: ${company} Engineering Manager`,
      priority: 4,
      url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${company} Engineering Manager`)}`
    }
  ];

  // Prioritize up to 3 most relevant stored contacts by role & verification status
  const roleScore = (role = '') => {
    const r = role.toLowerCase();
    if (r.includes('technical recruiter')) return 5;
    if (r.includes('recruiter')) return 4;
    if (r.includes('talent')) return 3;
    if (r.includes('engineering manager')) return 2;
    if (r.includes('hiring manager')) return 1;
    return 0;
  };
  const topContacts = [...base.contacts]
    .sort((a, b) => roleScore(b.role) - roleScore(a.role))
    .slice(0, 3);

  return {
    ...base,
    roleTitle,
    topContacts,
    manualLinkedInLinks,
    researchTimestamp: new Date().toISOString(),
    complianceNote: 'Public sources & manual search links only. No automated LinkedIn scraping or outreach.'
  };
}

/**
 * Phase 5: Outreach Composer with duplicate-outreach guard and manual LinkedIn enforcement.
 */
export function createOutreachDraft({
  jobId = null,
  contactId = null,
  taskId = null,
  channel = 'email',
  recipientName = 'Hiring Team',
  recipientEmail = '',
  subject = '',
  body = '',
  evidence = []
}) {
  if (!OUTREACH_CHANNELS.includes(channel)) {
    throw new Error(`Invalid outreach channel "${channel}".`);
  }
  const db = getDatabase();

  // Prevent repeated identical outreach to same contact & channel for the same job
  if (contactId) {
    const recent = db.prepare(`
      SELECT * FROM outreach_drafts
      WHERE contact_id = ? AND channel = ? AND (job_id IS ? OR (job_id IS NULL AND ? IS NULL))
        AND status IN ('draft', 'awaiting_approval', 'approved', 'sent')
      ORDER BY id DESC LIMIT 1
    `).get(contactId, channel, jobId, jobId);
    if (recent) {
      return {
        created: false,
        duplicatePrevented: true,
        draft: formatOutreachDraftRow(recent)
      };
    }
  }

  let finalSubject = subject;
  let finalBody = body;
  if (!finalBody) {
    const job = jobId ? db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) : null;
    const contact = contactId ? db.prepare('SELECT * FROM recruiter_contacts WHERE id = ?').get(contactId) : null;
    const isHiringManager = /engineering manager|hiring manager|tech lead|architect/i.test(contact?.role || '');
    const profile = loadCandidateProfile();
    const p = profile.personal || {};
    const companyName = job?.company || contact?.company || 'your team';
    const roleTitle = job?.title || 'Software Engineer';
    const greetingName = recipientName && recipientName !== 'Hiring Team' ? recipientName : 'there';

    if (channel === 'connection_request') {
      finalSubject = finalSubject || `Connecting re: ${roleTitle} at ${companyName}`;
      finalBody = `Hi ${greetingName}, I'm an MCA 2026 graduate (Bengaluru) skilled in Java, Spring Boot, React & PostgreSQL. I applied for ${roleTitle} at ${companyName} and would love to connect!`;
    } else if (channel === 'linkedin_message') {
      finalSubject = finalSubject || `${roleTitle} at ${companyName} — ${p.fullName || 'Abhishek N'}`;
      finalBody = isHiringManager
        ? `Hi ${greetingName},\n\nI recently applied for the ${roleTitle} role at ${companyName}. I'm an MCA 2026 graduate from AIMS Institutes, Bangalore, with hands-on Java Full Stack training (Anudip Foundation) and projects like NEARVIA (hyperlocal job platform with PostGIS & row-level locking) and FinSight (FastAPI + React).\n\nIf you're open to a quick look at my profile (${p.portfolio || p.gitHub || ''}), I'd truly appreciate any guidance.\n\nBest,\n${p.fullName || 'Abhishek N'}`
        : `Hi ${greetingName},\n\nI hope you're doing well. I recently applied for the ${roleTitle} opening at ${companyName}. I'm an MCA 2026 graduate based in Bengaluru with hands-on experience in Core Java, Spring Boot, React, and SQL (built NEARVIA & FinSight).\n\nWould love to be considered if my profile fits what your team is looking for.\n\nPortfolio: ${p.portfolio || p.gitHub || ''}\nThanks!\n${p.fullName || 'Abhishek N'}`;
    } else {
      const draftTypeMap = {
        email: 'application_follow_up',
        recruiter_follow_up: 'application_follow_up',
        application_follow_up: 'application_follow_up',
        interview_thank_you: 'thank_you_message'
      };
      const generated = generateCommunicationDraft({
        draftType: draftTypeMap[channel] || 'application_follow_up',
        job,
        recruiterName: recipientName || 'Hiring Team',
        recruiterEmail: recipientEmail || ''
      });
      finalSubject = finalSubject || generated.subject;
      finalBody = generated.body;
    }
  }

  const res = db.prepare(`
    INSERT INTO outreach_drafts (
      job_id, contact_id, task_id, channel, recipient_name, recipient_email,
      subject, body, evidence_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
  `).run(
    jobId,
    contactId,
    taskId,
    channel,
    recipientName,
    recipientEmail,
    finalSubject,
    finalBody,
    JSON.stringify(evidence || [])
  );

  return {
    created: true,
    duplicatePrevented: false,
    draft: formatOutreachDraftRow(db.prepare('SELECT * FROM outreach_drafts WHERE id = ?').get(res.lastInsertRowid))
  };
}

export function getOutreachDrafts({ jobId = null, contactId = null } = {}) {
  const db = getDatabase();
  const clauses = [];
  const params = [];
  if (jobId) { clauses.push('job_id = ?'); params.push(jobId); }
  if (contactId) { clauses.push('contact_id = ?'); params.push(contactId); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM outreach_drafts ${where} ORDER BY id DESC LIMIT 100`).all(...params).map(formatOutreachDraftRow);
}

export function updateOutreachDraft(draftId, { subject = null, body = null } = {}) {
  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM outreach_drafts WHERE id = ?').get(draftId);
  if (!existing) throw new Error(`Outreach draft #${draftId} not found.`);
  db.prepare(`
    UPDATE outreach_drafts
    SET subject = COALESCE(?, subject),
        body = COALESCE(?, body),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(subject, body, draftId);
  return formatOutreachDraftRow(db.prepare('SELECT * FROM outreach_drafts WHERE id = ?').get(draftId));
}

function formatOutreachDraftRow(row) {
  if (!row) return null;
  let evidence = [];
  try {
    evidence = row.evidence_json ? JSON.parse(row.evidence_json) : [];
  } catch {
    evidence = [];
  }
  const mailtoUrl = row.recipient_email
    ? `mailto:${encodeURIComponent(row.recipient_email)}?subject=${encodeURIComponent(row.subject || '')}&body=${encodeURIComponent(row.body || '')}`
    : null;
  return {
    ...row,
    evidence,
    mailtoUrl,
    manualSendRequired: row.channel === 'linkedin_message' || row.channel === 'connection_request'
  };
}
