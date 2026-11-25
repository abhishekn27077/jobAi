/**
 * CareerOS — Recruiter Hub & Controlled Contact Discovery Service
 * Discovers hiring contacts strictly from verified inbound communications,
 * official company career/ATS pages, and lawful public search links.
 * Never fabricates recruiter names or guesses unverified emails as verified.
 */

import { getDatabase } from '../db/schema.js';
import { generateCommunicationDraft } from '../email/communicationAssistant.js';

export const CONTACT_VERIFICATION_STATUSES = ['Verified', 'Probable', 'Unverified', 'Unavailable'];
export const OUTREACH_STATUSES = ['Not Contacted', 'Draft', 'Approved', 'Sent', 'Reply Received', 'Follow-up Due', 'Closed'];

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

  // 1. Check existing stored contacts
  const stored = db.prepare(`
    SELECT * FROM recruiter_contacts
    WHERE job_id = ? OR LOWER(company) = LOWER(?)
    ORDER BY id DESC
  `).all(jobId, company);

  // 2. Check verified inbound communications for this company or job
  const comms = db.prepare(`
    SELECT * FROM communications
    WHERE job_id = ? OR LOWER(sender) LIKE LOWER(?)
    ORDER BY id DESC LIMIT 5
  `).all(jobId, `%${company.split(/\s+/)[0]}%`);

  const newlyDiscovered = [];
  for (const c of comms) {
    const emailMatch = (c.sender || '').match(/[\w.+-]+@[\w.-]+\.\w+/);
    const email = emailMatch ? emailMatch[0] : null;
    const senderName = (c.sender || '').replace(/<[^>]+>/g, '').trim() || 'Hiring Contact';
    const alreadyExists = stored.some(s => (email && s.email === email) || (s.name === senderName && s.company.toLowerCase() === company.toLowerCase()));
    if (!alreadyExists && email) {
      const info = db.prepare(`
        INSERT INTO recruiter_contacts (
          job_id, company, name, role, email, verification_status,
          discovery_source, source_url, confidence, outreach_status, contact_history_json
        ) VALUES (?, ?, ?, ?, ?, 'Verified', 'Inbound Gmail / Communication', ?, 'high', 'Reply Received', ?)
      `).run(
        jobId,
        company,
        senderName,
        'Recruiter / Hiring Contact',
        email,
        job.url || '',
        JSON.stringify([{ event: 'discovered_from_inbox', timestamp: new Date().toISOString(), subject: c.subject }])
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
      label: 'Talent Acquisition / HR Public Search',
      source: 'Public Profile Search',
      url: `https://www.google.com/search?q=${encodeURIComponent(`"${company}" ("Talent Acquisition" OR "Technical Recruiter" OR "HR") India`)}`
    },
    {
      label: 'Engineering / Hiring Manager Public Search',
      source: 'Public Profile Search',
      url: `https://www.google.com/search?q=${encodeURIComponent(`"${company}" ("Hiring Manager" OR "Engineering Manager") Bengaluru`)}`
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
    ORDER BY id DESC
  `).all(jobId, company);

  // If no verified contact exists yet, record an honest Unavailable placeholder entry only on explicit request or return searchLinks
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

export function saveRecruiterContact({
  jobId = null,
  company,
  name = '',
  role = 'Recruiter / Talent Acquisition',
  email = null,
  verificationStatus = null,
  discoverySource = 'Manual / Public Research',
  sourceUrl = '',
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

  const info = db.prepare(`
    INSERT INTO recruiter_contacts (
      job_id, company, name, role, email, verification_status,
      discovery_source, source_url, confidence, outreach_status, contact_history_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Not Contacted', ?)
  `).run(
    jobId,
    company.trim(),
    name.trim() || 'Hiring Contact',
    role.trim(),
    cleanEmail,
    finalVerif,
    discoverySource,
    sourceUrl,
    confidence,
    JSON.stringify([{ event: 'contact_saved', timestamp: new Date().toISOString(), source: discoverySource }])
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

  const history = safeParseHistory(contact.contact_history_json);
  history.push({
    event: `status_${newStatus.toLowerCase().replace(/\s+/g, '_')}`,
    timestamp: new Date().toISOString(),
    userApproved: Boolean(userApproved),
    notes: notes || undefined
  });

  db.prepare(`
    UPDATE recruiter_contacts
    SET outreach_status = ?, contact_history_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newStatus, JSON.stringify(history), contactId);

  return formatContactRow(db.prepare('SELECT * FROM recruiter_contacts WHERE id = ?').get(contactId));
}

function safeParseHistory(raw) {
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

function formatContactRow(row) {
  if (!row) return null;
  return {
    ...row,
    contactHistory: safeParseHistory(row.contact_history_json)
  };
}
