import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJobs, updateJobStatus, getStats, getScanHistory } from '../tracker/jobTracker.js';
import { runJobDiscovery } from '../discovery/discoveryService.js';
import { loadCandidateProfile } from '../profile/profileManager.js';
import { exportTailoredDocumentsForJob, generateTailoredResume, generateTailoredCoverLetter } from '../resumes/resumeGenerator.js';
import { launchFormAssistant } from '../automation/formAssistant.js';
import { generateInterviewDossier, saveInterviewSession } from '../interview/prepService.js';
import { generateReferralMessage } from '../networking/referralAssistant.js';
import { verifyVaultJobs } from '../matcher/jobVerifier.js';
import { exportVaultToCsv, exportVaultToJson } from '../tracker/vaultExporter.js';
import { evaluateCandidateAnswer } from '../interview/mockSimulator.js';
import { extractJdRequirements } from '../resumes/jdAnalyzer.js';
import { calculateAtsScore } from '../resumes/atsScorer.js';
import { generateStudioResume } from '../resumes/resumeStudioService.js';
import { renderResumeHtml } from '../resumes/templates/templateEngine.js';
import { exportToPdf } from '../resumes/exporters/pdfExporter.js';
import { exportToDocx } from '../resumes/exporters/docxExporter.js';
import {
  saveResumeVersion,
  getResumeVersionsForJob,
  getResumeVersionById,
  approveResumeVersion,
  deleteResumeVersion,
  duplicateResumeVersion
} from '../resumes/resumeVersionManager.js';
import { prepareApplication } from '../automation/applicationWorkflow.js';
import { getApplications, getApplicationByJobId, updateApplicationStatus as updateAppStatus, getPortalSupportMatrix } from '../tracker/applicationTracker.js';
import { getGoogleAuthUrl, disconnectAccount, getOAuthStatus, exchangeCodeForTokens } from '../email/googleOAuthClient.js';
import { generateCommunicationDraft, saveDraftToVault, approveAndPublishDraft } from '../email/communicationAssistant.js';
import { syncRecruiterEmails } from '../email/emailSyncService.js';
import { proposeCalendarEvent, approveAndCreateCalendarEvent, cancelCalendarEvent, getCalendarEvents } from '../calendar/calendarService.js';
import { createFollowUpReminder, getReminders, updateReminderStatus } from '../tracker/followUpManager.js';
import { analyzeSkillGaps, getSkillRoadmap, updateSkillRoadmapItem } from '../intelligence/skillGapService.js';
import { getAllStories, getStoriesByCategory, searchStories, createOrUpdateStory } from '../intelligence/storyBankService.js';
import { generateTargetedInterviewKit } from '../intelligence/interviewIntelligence.js';
import { startMockInterview, submitMockAnswer, getMockSession, getMockHistory } from '../intelligence/mockInterviewService.js';
import { getApplicationAnalytics, getRejectionAnalysis } from '../intelligence/careerAnalyticsService.js';
import { getCompanyResearch } from '../intelligence/companyResearchService.js';
import { calculateOfferTakeHome, compareOffers, saveOfferComparisonRecord, getSavedOfferComparisons } from '../intelligence/salaryCalculatorService.js';
import {
  getAutomationControlStatus,
  executeTask,
  toggleTaskEnabled,
  updateTaskInterval,
  setMasterAutomationPause,
  initializeAutomationEngine
} from '../scheduler/automationEngine.js';
import {
  backupDatabase,
  listBackups,
  restoreDatabase,
  runDatabaseIntegrityCheck,
  exportCandidateFullArchive
} from '../db/backupService.js';
import { getDatabase } from '../db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const OUTPUT_DIR = path.resolve(__dirname, '../../output');
const MAX_BODY_SIZE_BYTES = 512 * 1024; // 512 KB request limit

/**
 * Strips internal server filesystem paths and stack traces from error messages before sending to clients.
 */
function sanitizeErrorMessage(msg) {
  if (!msg || typeof msg !== 'string') return 'An error occurred during processing.';
  return msg
    .replace(/[A-Za-z]:\\[^ \t\r\n'"]+/g, '[REDACTED_PATH]')
    .replace(/\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+/g, '[REDACTED_PATH]');
}

/**
 * Safely reads and parses JSON request body with strict Content-Type and payload size validation.
 */
function readJsonBody(req, { maxSize = MAX_BODY_SIZE_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const contentLength = req.headers['content-length'];
    if (contentLength && parseInt(contentLength, 10) > maxSize) {
      const err = new Error('Payload Too Large: Request body exceeds the 512KB limit.');
      err.statusCode = 413;
      return reject(err);
    }

    const contentType = req.headers['content-type'] || '';
    // If body is present and Content-Type is specified, must be JSON
    if (contentType && !contentType.toLowerCase().includes('application/json')) {
      const err = new Error(`Unsupported Media Type: Expected application/json but received "${contentType}".`);
      err.statusCode = 415;
      return reject(err);
    }

    let rawData = '';
    let bytesReceived = 0;

    req.on('data', chunk => {
      bytesReceived += chunk.length;
      if (bytesReceived > maxSize) {
        req.destroy();
        const err = new Error('Payload Too Large: Request body exceeds the 512KB limit.');
        err.statusCode = 413;
        return reject(err);
      }
      rawData += chunk;
    });

    req.on('end', () => {
      if (!rawData || rawData.trim() === '') {
        return resolve({});
      }
      try {
        const parsed = JSON.parse(rawData);
        resolve(parsed);
      } catch {
        const err = new Error('Bad Request: Malformed JSON payload.');
        err.statusCode = 400;
        reject(err);
      }
    });

    req.on('error', err => {
      err.statusCode = 400;
      reject(err);
    });
  });
}

/**
 * Helper to validate positive integer IDs in URL paths.
 */
function parseValidId(paramStr, paramName = 'ID') {
  const num = parseInt(paramStr, 10);
  if (!Number.isInteger(num) || num <= 0) {
    const err = new Error(`Bad Request: Invalid ${paramName} parameter.`);
    err.statusCode = 400;
    throw err;
  }
  return num;
}

export function startDashboardServer(port = 3000, host = '127.0.0.1') {
  const allowedHosts = [
    `${host}:${port}`,
    `localhost:${port}`,
    `127.0.0.1:${port}`,
    `[::1]:${port}`,
    'localhost',
    '127.0.0.1',
    '[::1]'
  ];

  const allowedOrigins = [
    `http://${host}:${port}`,
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`
  ];

  const server = http.createServer(async (req, res) => {
    // 1. Host Header Validation (DNS Rebinding Prevention)
    const reqHost = req.headers['host'];
    if (!reqHost || !allowedHosts.includes(reqHost)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad Request: Host header validation failed.' }));
      return;
    }

    // 2. Strict Origin & CORS Validation (No Wildcards)
    const reqOrigin = req.headers['origin'];
    if (reqOrigin) {
      if (!allowedOrigins.includes(reqOrigin)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: Untrusted cross-origin request rejected.' }));
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CareerOS-CSRF, X-Requested-With');
      res.setHeader('Vary', 'Origin');
    }

    // Handle Preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 3. CSRF Protection for State-Changing Requests
    const isStateChanging = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
    if (isStateChanging) {
      const secFetchSite = req.headers['sec-fetch-site'];
      if (secFetchSite === 'cross-site') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: Cross-site state-changing request blocked.' }));
        return;
      }
    }

    const parsedUrl = new URL(req.url, `http://${host}:${port}`);
    const pathname = parsedUrl.pathname;

    // Helper to send sanitized JSON responses
    const sendJson = (statusCode, data) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      if (data && data.error) {
        data.error = sanitizeErrorMessage(data.error);
      }
      res.end(JSON.stringify(data));
    };

    // Helper to handle body reading errors
    const safeReadBody = async () => {
      try {
        return await readJsonBody(req);
      } catch (err) {
        sendJson(err.statusCode || 400, { error: err.message });
        return null;
      }
    };

    // ==========================================
    // API ROUTES
    // ==========================================

    // OAuth 2.0 Callback Handler
    if ((pathname === '/oauth2callback' || pathname === '/api/oauth/callback') && req.method === 'GET') {
      const code = parsedUrl.searchParams.get('code');
      const state = parsedUrl.searchParams.get('state');
      const oauthErr = parsedUrl.searchParams.get('error');

      if (oauthErr) {
        sendJson(400, { error: `Google OAuth authorization declined: ${oauthErr}` });
        return;
      }

      if (!code || !state) {
        sendJson(400, { error: 'Bad Request: Missing OAuth authorization code or state parameter.' });
        return;
      }

      try {
        await exchangeCodeForTokens(code, {
          state,
          redirectUri: `http://localhost:${port}/oauth2callback`
        });
        res.writeHead(302, { Location: '/?oauth=connected' });
        res.end();
      } catch (err) {
        sendJson(400, { error: err.message });
      }
      return;
    }

    // GET /api/stats
    if (pathname === '/api/stats' && req.method === 'GET') {
      try {
        const stats = getStats();
        sendJson(200, stats);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // GET /api/jobs
    if (pathname === '/api/jobs' && req.method === 'GET') {
      try {
        const status = parsedUrl.searchParams.get('status') || undefined;
        const recommendation = parsedUrl.searchParams.get('recommendation') || undefined;
        const source = parsedUrl.searchParams.get('source') || undefined;
        const location = parsedUrl.searchParams.get('location') || undefined;
        const workMode = parsedUrl.searchParams.get('workMode') || undefined;
        const verificationStatus = parsedUrl.searchParams.get('verificationStatus') || undefined;
        const minScore = parseInt(parsedUrl.searchParams.get('minScore') || '0', 10);
        const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit') || '100', 10), 500);
        const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);

        const jobs = getJobs({ status, recommendation, minScore, source, location, workMode, verificationStatus, limit, offset });
        sendJson(200, { jobs });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // GET /api/scan-history
    if (pathname === '/api/scan-history' && req.method === 'GET') {
      try {
        const history = getScanHistory(30);
        sendJson(200, { history });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/job/status
    if (pathname === '/api/job/status' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const jobId = parseValidId(body.jobId, 'jobId');
        const result = updateJobStatus(jobId, body.newStatus);
        sendJson(200, result);
      } catch (e) {
        sendJson(e.statusCode || 400, { error: e.message });
      }
      return;
    }

    // POST /api/scan
    if (pathname === '/api/scan' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const result = await runJobDiscovery({ customQuery: body.query || null });
        sendJson(200, result);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // GET /api/profile
    if (pathname === '/api/profile' && req.method === 'GET') {
      try {
        const profile = loadCandidateProfile();
        sendJson(200, profile);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/job/:id/tailor
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/tailor') && req.method === 'POST') {
      try {
        const jobId = parseValidId(pathname.split('/')[3], 'Job ID');
        const db = getDatabase();
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        if (!job) {
          sendJson(404, { error: `Job with ID ${jobId} not found` });
          return;
        }

        const exported = await exportTailoredDocumentsForJob(job);
        sendJson(200, {
          success: true,
          jobId,
          resumeMarkdown: exported.resume.markdown,
          coverLetterMarkdown: exported.coverLetter.markdown,
          pdfUrl: `/api/download/resume/${jobId}`,
          resumeMdPath: exported.resumeMdPath,
          resumePdfPath: exported.resumePdfPath
        });
      } catch (e) {
        sendJson(e.statusCode || 500, { error: e.message });
      }
      return;
    }

    // GET /api/download/resume/:id (with Path Traversal Guard)
    if (pathname.startsWith('/api/download/resume/') && req.method === 'GET') {
      try {
        const jobId = parseValidId(pathname.split('/')[4], 'Job ID');
        const resumesDir = path.resolve(OUTPUT_DIR, 'resumes');
        if (fs.existsSync(resumesDir)) {
          const files = fs.readdirSync(resumesDir);
          const pdfFile = files.find(f => f.startsWith(`${jobId}_`) && f.endsWith('.pdf'));
          if (pdfFile) {
            const fullPath = path.resolve(resumesDir, pdfFile);
            if (!fullPath.startsWith(resumesDir)) {
              sendJson(403, { error: 'Access Denied: Path outside allowed directory.' });
              return;
            }
            res.writeHead(200, {
              'Content-Type': 'application/pdf',
              'Content-Disposition': `inline; filename="${pdfFile}"`
            });
            fs.createReadStream(fullPath).pipe(res);
            return;
          }
        }
        sendJson(404, { error: 'PDF not generated yet. Please click Tailor Resume first.' });
      } catch (e) {
        sendJson(e.statusCode || 500, { error: e.message });
      }
      return;
    }

    // GET /api/job/:id/application
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/application') && req.method === 'GET') {
      try {
        const jobId = parseValidId(pathname.split('/')[3], 'Job ID');
        const dossier = await prepareApplication(jobId);
        sendJson(200, { success: true, dossier });
      } catch (e) {
        sendJson(e.statusCode || 500, { error: e.message });
      }
      return;
    }

    // POST /api/job/:id/assist (Strict Human Approval Gate)
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/assist') && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const jobId = parseValidId(pathname.split('/')[3], 'Job ID');
        const db = getDatabase();
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        if (!job) {
          sendJson(404, { error: `Job with ID ${jobId} not found` });
          return;
        }

        if (!body.userConfirmedApproval) {
          sendJson(400, {
            success: false,
            error: 'Human Approval Gate: You must explicitly approve application preparation before launching browser assistant.'
          });
          return;
        }

        if (job.status === 'expired' || job.verification_status === 'expired') {
          sendJson(400, {
            success: false,
            error: `Job Freshness Safeguard: Job #${jobId} is marked as expired or closed. Autofill is blocked.`
          });
          return;
        }

        if (job.fresher_eligible === 0) {
          sendJson(400, {
            success: false,
            error: 'Eligibility Safeguard: Candidate fresher profile is ineligible for this role. Autofill is blocked.'
          });
          return;
        }

        launchFormAssistant(job, {
          userConfirmedApproval: true,
          resumePdfPath: body.resumePdfPath || null,
          screeningAnswers: body.screeningAnswers || null,
          headless: false
        }).catch(err => {
          console.error('[Form Assistant Launch Error]:', err.message);
        });

        sendJson(200, {
          success: true,
          message: `Browser assistant launching for ${job.title} @ ${job.company}. Review all fields and submit manually.`
        });
      } catch (e) {
        sendJson(e.statusCode || 500, { error: e.message });
      }
      return;
    }

    // POST /api/job/:id/application/status
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/application/status') && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const jobId = parseValidId(pathname.split('/')[3], 'Job ID');
        const { status, notes, confirmationNumber, userConfirmed } = body;
        const result = updateAppStatus(jobId, status, { notes, confirmationNumber, userConfirmed });
        sendJson(200, result);
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // GET /api/applications
    if (pathname === '/api/applications' && req.method === 'GET') {
      try {
        const status = parsedUrl.searchParams.get('status') || undefined;
        const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit') || '50', 10), 200);
        const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);
        const applications = getApplications({ status, limit, offset });
        sendJson(200, { applications });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // GET /api/portals
    if (pathname === '/api/portals' && req.method === 'GET') {
      try {
        const portals = getPortalSupportMatrix();
        sendJson(200, { portals });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // GET /api/communications/summary
    if (pathname === '/api/communications/summary' && req.method === 'GET') {
      try {
        const db = getDatabase();
        const recentEmails = db.prepare(`
          SELECT c.*, j.company as job_company, j.title as job_title
          FROM communications c
          LEFT JOIN jobs j ON c.job_id = j.id
          WHERE c.direction = 'incoming'
          ORDER BY c.id DESC LIMIT 10
        `).all();

        const pendingDrafts = db.prepare(`
          SELECT c.*, j.company as job_company, j.title as job_title
          FROM communications c
          LEFT JOIN jobs j ON c.job_id = j.id
          WHERE c.approval_status = 'pending_approval'
          ORDER BY c.id DESC
        `).all();

        const upcomingInterviews = getCalendarEvents({ limit: 10, upcomingOnly: true });
        const pendingReminders = getReminders({ status: 'pending', limit: 15 });
        const oauthStatus = getOAuthStatus();

        sendJson(200, {
          success: true,
          summary: {
            recentEmailsCount: recentEmails.length,
            pendingDraftsCount: pendingDrafts.length,
            upcomingInterviewsCount: upcomingInterviews.length,
            pendingRemindersCount: pendingReminders.length,
            oauth: oauthStatus
          },
          recentEmails,
          pendingDrafts,
          upcomingInterviews,
          pendingReminders
        });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // GET /api/communications/emails
    if (pathname === '/api/communications/emails' && req.method === 'GET') {
      try {
        const db = getDatabase();
        const category = parsedUrl.searchParams.get('category');
        const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit') || '50', 10), 200);

        let query = `
          SELECT c.*, j.company as job_company, j.title as job_title
          FROM communications c
          LEFT JOIN jobs j ON c.job_id = j.id
          WHERE c.direction = 'incoming'
        `;
        const params = [];
        if (category && category !== 'all') {
          query += ' AND c.category = ?';
          params.push(category);
        }
        query += ' ORDER BY c.id DESC LIMIT ?';
        params.push(limit);

        const emails = db.prepare(query).all(...params);
        sendJson(200, { success: true, emails });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/communications/sync
    if (pathname === '/api/communications/sync' && req.method === 'POST') {
      try {
        const result = await syncRecruiterEmails();
        sendJson(200, result);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/communications/draft
    if (pathname === '/api/communications/draft' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const db = getDatabase();
        const job = body.jobId ? db.prepare('SELECT * FROM jobs WHERE id = ?').get(body.jobId) : null;

        const draft = generateCommunicationDraft({
          draftType: body.draftType || 'recruiter_reply',
          job,
          recruiterName: body.recruiterName,
          recruiterEmail: body.recruiterEmail,
          proposedSlots: body.proposedSlots || [],
          interviewDetails: body.interviewDetails,
          customContext: body.customContext
        });

        const saved = saveDraftToVault({
          jobId: body.jobId || null,
          recipient: body.recruiterEmail || '',
          subject: draft.subject,
          body: draft.body,
          draftType: body.draftType || 'recruiter_reply'
        });

        sendJson(200, { success: true, draftId: saved.draftId, draft });
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // POST /api/communications/draft/:id/approve
    if (pathname.startsWith('/api/communications/draft/') && pathname.endsWith('/approve') && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const draftId = parseValidId(pathname.split('/')[4], 'Draft ID');
        const result = await approveAndPublishDraft(draftId, {
          userConfirmedApproval: Boolean(body.userConfirmedApproval)
        });
        sendJson(200, result);
      } catch (e) {
        sendJson(e.code === 'APPROVAL_REQUIRED' ? 400 : 500, { error: e.message, code: e.code });
      }
      return;
    }

    // GET /api/calendar/events
    if (pathname === '/api/calendar/events' && req.method === 'GET') {
      try {
        const status = parsedUrl.searchParams.get('status') || null;
        const events = getCalendarEvents({ status, limit: 50 });
        sendJson(200, { success: true, events });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/calendar/event
    if (pathname === '/api/calendar/event' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const result = proposeCalendarEvent(body);
        sendJson(200, result);
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // POST /api/calendar/event/:id/approve
    if (pathname.startsWith('/api/calendar/event/') && pathname.endsWith('/approve') && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const eventId = parseValidId(pathname.split('/')[4], 'Event ID');
        const result = await approveAndCreateCalendarEvent(eventId, {
          userConfirmed: Boolean(body.userConfirmed)
        });
        sendJson(200, result);
      } catch (e) {
        sendJson(e.code === 'APPROVAL_REQUIRED' ? 400 : 500, { error: e.message, code: e.code });
      }
      return;
    }

    // POST /api/calendar/event/:id/cancel
    if (pathname.startsWith('/api/calendar/event/') && pathname.endsWith('/cancel') && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const eventId = parseValidId(pathname.split('/')[4], 'Event ID');
        const result = await cancelCalendarEvent(eventId, {
          userConfirmed: Boolean(body.userConfirmed)
        });
        sendJson(200, result);
      } catch (e) {
        sendJson(e.code === 'APPROVAL_REQUIRED' ? 400 : 500, { error: e.message, code: e.code });
      }
      return;
    }

    // GET /api/reminders
    if (pathname === '/api/reminders' && req.method === 'GET') {
      try {
        const status = parsedUrl.searchParams.get('status') || 'pending';
        const reminders = getReminders({ status, limit: 50 });
        sendJson(200, { success: true, reminders });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/reminders
    if (pathname === '/api/reminders' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const result = createFollowUpReminder(body);
        sendJson(200, result);
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // POST /api/reminders/:id/status
    if (pathname.startsWith('/api/reminders/') && pathname.endsWith('/status') && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const reminderId = parseValidId(pathname.split('/')[3], 'Reminder ID');
        const result = updateReminderStatus(reminderId, body.status);
        sendJson(200, result);
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // GET /api/oauth/status
    if (pathname === '/api/oauth/status' && req.method === 'GET') {
      try {
        const status = getOAuthStatus();
        sendJson(200, status);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // GET /api/oauth/url
    if (pathname === '/api/oauth/url' && req.method === 'GET') {
      try {
        const authUrl = getGoogleAuthUrl();
        sendJson(200, { authUrl });
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // POST /api/oauth/disconnect (Strict Confirmation Gate)
    if (pathname === '/api/oauth/disconnect' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        if (!body.userConfirmed) {
          sendJson(400, { error: 'User Confirmation Required: Disconnecting your Google OAuth account requires explicit confirmation (userConfirmed: true).' });
          return;
        }
        const result = await disconnectAccount({ userConfirmed: true });
        sendJson(200, result);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // GET /api/intelligence/skill-gaps
    if (pathname === '/api/intelligence/skill-gaps' && req.method === 'GET') {
      try {
        const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
        const gaps = analyzeSkillGaps({ limit });
        sendJson(200, { success: true, ...gaps });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // GET /api/intelligence/roadmap
    if (pathname === '/api/intelligence/roadmap' && req.method === 'GET') {
      try {
        const roadmap = getSkillRoadmap();
        sendJson(200, { success: true, roadmap });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/intelligence/roadmap/item
    if (pathname === '/api/intelligence/roadmap/item' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        if (!body.skillName) {
          sendJson(400, { error: 'skillName is required' });
          return;
        }
        const updated = updateSkillRoadmapItem(body.skillName, body);
        sendJson(200, { success: true, item: updated });
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // GET /api/intelligence/stories
    if (pathname === '/api/intelligence/stories' && req.method === 'GET') {
      try {
        const category = parsedUrl.searchParams.get('category');
        const q = parsedUrl.searchParams.get('q');
        let stories = [];
        if (q) {
          stories = searchStories(q);
        } else if (category && category !== 'all') {
          stories = getStoriesByCategory(category);
        } else {
          stories = getAllStories();
        }
        sendJson(200, { success: true, stories });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/intelligence/stories
    if (pathname === '/api/intelligence/stories' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const story = createOrUpdateStory(body);
        sendJson(200, { success: true, story });
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // GET /api/intelligence/interview-prep/:id
    if (pathname.startsWith('/api/intelligence/interview-prep/') && req.method === 'GET') {
      try {
        const jobId = parseValidId(pathname.split('/')[4], 'Job ID');
        const db = getDatabase();
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        const kit = generateTargetedInterviewKit(job);
        sendJson(200, { success: true, kit });
      } catch (e) {
        sendJson(e.statusCode || 500, { error: e.message });
      }
      return;
    }

    // POST /api/intelligence/mock/start
    if (pathname === '/api/intelligence/mock/start' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const session = startMockInterview(body);
        sendJson(200, { success: true, session });
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // POST /api/intelligence/mock/submit
    if (pathname === '/api/intelligence/mock/submit' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const result = submitMockAnswer(body);
        sendJson(200, { success: true, result });
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // GET /api/intelligence/mock/history
    if (pathname === '/api/intelligence/mock/history' && req.method === 'GET') {
      try {
        const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit') || '10', 10), 100);
        const history = getMockHistory({ limit });
        sendJson(200, { success: true, history });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // GET /api/intelligence/mock/:id
    if (pathname.startsWith('/api/intelligence/mock/') && req.method === 'GET') {
      try {
        const sessionId = parseValidId(pathname.split('/')[4], 'Session ID');
        const session = getMockSession(sessionId);
        if (!session) {
          sendJson(404, { error: `Session #${sessionId} not found.` });
          return;
        }
        sendJson(200, { success: true, session });
      } catch (e) {
        sendJson(e.statusCode || 500, { error: e.message });
      }
      return;
    }

    // GET /api/intelligence/analytics
    if (pathname === '/api/intelligence/analytics' && req.method === 'GET') {
      try {
        const analytics = getApplicationAnalytics();
        sendJson(200, { success: true, analytics });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // GET /api/intelligence/rejections
    if (pathname === '/api/intelligence/rejections' && req.method === 'GET') {
      try {
        const rejections = getRejectionAnalysis();
        sendJson(200, { success: true, rejections });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // GET /api/intelligence/company/:name
    if (pathname.startsWith('/api/intelligence/company/') && req.method === 'GET') {
      try {
        const companyName = decodeURIComponent(pathname.split('/')[4] || '');
        if (!companyName) {
          sendJson(400, { error: 'Company name is required.' });
          return;
        }
        const research = getCompanyResearch(companyName);
        sendJson(200, { success: true, research });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/intelligence/salary/calculate
    if (pathname === '/api/intelligence/salary/calculate' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const calculation = calculateOfferTakeHome(body);
        sendJson(200, { success: true, calculation });
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // POST /api/intelligence/salary/compare
    if (pathname === '/api/intelligence/salary/compare' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const comparison = compareOffers(body.offers || []);
        sendJson(200, { success: true, comparison });
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // POST /api/intelligence/salary/save
    if (pathname === '/api/intelligence/salary/save' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const saved = saveOfferComparisonRecord(body);
        sendJson(200, { success: true, offer: saved });
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // GET /api/intelligence/salary/saved
    if (pathname === '/api/intelligence/salary/saved' && req.method === 'GET') {
      try {
        const offers = getSavedOfferComparisons();
        sendJson(200, { success: true, offers });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // GET /api/job/:id/prep
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/prep') && req.method === 'GET') {
      try {
        const jobId = parseValidId(pathname.split('/')[3], 'Job ID');
        const db = getDatabase();
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        if (!job) {
          sendJson(404, { error: `Job with ID ${jobId} not found` });
          return;
        }

        const dossier = generateInterviewDossier(job);
        sendJson(200, { success: true, dossier });
      } catch (e) {
        sendJson(e.statusCode || 500, { error: e.message });
      }
      return;
    }

    // POST /api/job/:id/referral
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/referral') && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const jobId = parseValidId(pathname.split('/')[3], 'Job ID');
        const db = getDatabase();
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        if (!job) {
          sendJson(404, { error: `Job with ID ${jobId} not found` });
          return;
        }
        const { recipientType = 'engineer', recipientName = 'Hi' } = body;
        const msg = generateReferralMessage(job, recipientType, recipientName);
        sendJson(200, { success: true, referral: msg });
      } catch (e) {
        sendJson(e.statusCode || 400, { error: e.message });
      }
      return;
    }

    // POST /api/verify-links
    if (pathname === '/api/verify-links' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const limit = Math.min(Number(body.limit) || 15, 50);
        const result = await verifyVaultJobs({ limit });
        sendJson(200, { success: true, ...result });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // GET /api/export/csv
    if (pathname === '/api/export/csv' && req.method === 'GET') {
      try {
        const { csvPath } = exportVaultToCsv();
        res.writeHead(200, {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="career_pipeline.csv"'
        });
        fs.createReadStream(csvPath).pipe(res);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // GET /api/export/json
    if (pathname === '/api/export/json' && req.method === 'GET') {
      try {
        const { jsonPath } = exportVaultToJson();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="career_pipeline.json"'
        });
        fs.createReadStream(jsonPath).pipe(res);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/mock/evaluate
    if (pathname === '/api/mock/evaluate' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const { question, answer, topic = 'general' } = body;
        const evalResult = evaluateCandidateAnswer(question, answer, topic);
        sendJson(200, { success: true, evalResult });
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // POST /api/mock/save
    if (pathname === '/api/mock/save' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const { jobId, round, feedbackJson } = body;
        const session = saveInterviewSession(jobId, round, feedbackJson);
        sendJson(200, { success: true, session });
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // GET /api/resume/studio-data/:id
    if (pathname.startsWith('/api/resume/studio-data/') && req.method === 'GET') {
      try {
        const jobId = parseValidId(pathname.split('/')[4], 'Job ID');
        const db = getDatabase();
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        if (!job) {
          sendJson(404, { error: `Job #${jobId} not found` });
          return;
        }

        const jdAnalysis = extractJdRequirements(job);
        const versions = getResumeVersionsForJob(jobId);
        const initialStudio = await generateStudioResume(job, { jdAnalysis });

        sendJson(200, { success: true, job, jdAnalysis, versions, initialStudio });
      } catch (e) {
        sendJson(e.statusCode || 500, { error: e.message });
      }
      return;
    }

    // POST /api/resume/score
    if (pathname === '/api/resume/score' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const { jdAnalysis, resumeContent } = body;
        const scoreResult = calculateAtsScore(jdAnalysis, resumeContent);
        sendJson(200, { success: true, atsScore: scoreResult });
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // POST /api/resume/generate
    if (pathname === '/api/resume/generate' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const { jobId, template = 'ats_professional', forceAi = false } = body;
        const validJobId = parseValidId(jobId, 'jobId');
        const db = getDatabase();
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(validJobId);
        if (!job) {
          sendJson(404, { error: `Job #${validJobId} not found` });
          return;
        }

        const result = await generateStudioResume(job, { template, forceAi });
        sendJson(200, { success: true, result });
      } catch (e) {
        sendJson(e.statusCode || 500, { error: e.message });
      }
      return;
    }

    // POST /api/resume/save
    if (pathname === '/api/resume/save' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const savedVersion = await saveResumeVersion(body);
        sendJson(200, { success: true, version: savedVersion });
      } catch (e) {
        const status = e.statusCode || 500;
        sendJson(status, { success: false, error: e.message, audit: e.audit || null });
      }
      return;
    }

    // GET /api/resume/versions/:id
    if (pathname.startsWith('/api/resume/versions/') && req.method === 'GET') {
      try {
        const jobId = parseValidId(pathname.split('/')[4], 'Job ID');
        const versions = getResumeVersionsForJob(jobId);
        sendJson(200, { success: true, versions });
      } catch (e) {
        sendJson(e.statusCode || 500, { error: e.message });
      }
      return;
    }

    // POST /api/resume/approve/:id
    if (pathname.startsWith('/api/resume/approve/') && req.method === 'POST') {
      try {
        const versionId = parseValidId(pathname.split('/')[4], 'Version ID');
        const version = await approveResumeVersion(versionId);
        sendJson(200, { success: true, version });
      } catch (e) {
        const status = e.statusCode || 500;
        sendJson(status, { success: false, error: e.message, audit: e.audit || null });
      }
      return;
    }

    // DELETE /api/resume/version/:id
    if (pathname.startsWith('/api/resume/version/') && req.method === 'DELETE') {
      try {
        const versionId = parseValidId(pathname.split('/')[4], 'Version ID');
        const resDel = deleteResumeVersion(versionId);
        sendJson(200, { success: true, ...resDel });
      } catch (e) {
        sendJson(e.statusCode || 500, { error: e.message });
      }
      return;
    }

    // POST /api/resume/duplicate/:id
    if (pathname.startsWith('/api/resume/duplicate/') && req.method === 'POST') {
      try {
        const versionId = parseValidId(pathname.split('/')[4], 'Version ID');
        const dup = await duplicateResumeVersion(versionId);
        sendJson(200, { success: true, version: dup });
      } catch (e) {
        sendJson(e.statusCode || 500, { error: e.message });
      }
      return;
    }

    // GET /api/resume/download/:id/pdf (with Path Traversal Guard)
    if (pathname.startsWith('/api/resume/download/') && pathname.endsWith('/pdf') && req.method === 'GET') {
      try {
        const versionId = parseValidId(pathname.split('/')[4], 'Version ID');
        const version = getResumeVersionById(versionId);
        if (!version) {
          sendJson(404, { error: `Version #${versionId} not found` });
          return;
        }

        let pdfPath = version.pdf_path;
        const resumesDir = path.resolve(OUTPUT_DIR, 'resumes');
        if (!pdfPath || !fs.existsSync(pdfPath)) {
          const html = renderResumeHtml(version.content, version.template);
          pdfPath = path.resolve(resumesDir, `${version.job_id}_v${version.version_number}_Resume.pdf`);
          await exportToPdf(html, pdfPath);
        }

        const resolvedPdf = path.resolve(pdfPath);
        if (!resolvedPdf.startsWith(resumesDir)) {
          sendJson(403, { error: 'Access Denied: Path outside allowed directory.' });
          return;
        }

        const safeFilename = `${(version.company || 'Company').replace(/[^a-zA-Z0-9]/g, '_')}_Abhishek_N_Resume_v${version.version_number}.pdf`;
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${safeFilename}"`
        });
        fs.createReadStream(resolvedPdf).pipe(res);
      } catch (e) {
        sendJson(e.statusCode || 500, { error: e.message });
      }
      return;
    }

    // GET /api/resume/download/:id/docx (with Path Traversal Guard)
    if (pathname.startsWith('/api/resume/download/') && pathname.endsWith('/docx') && req.method === 'GET') {
      try {
        const versionId = parseValidId(pathname.split('/')[4], 'Version ID');
        const version = getResumeVersionById(versionId);
        if (!version) {
          sendJson(404, { error: `Version #${versionId} not found` });
          return;
        }

        let docxPath = version.docx_path;
        const resumesDir = path.resolve(OUTPUT_DIR, 'resumes');
        if (!docxPath || !fs.existsSync(docxPath)) {
          docxPath = path.resolve(resumesDir, `${version.job_id}_v${version.version_number}_Resume.docx`);
          await exportToDocx(version.content, docxPath);
        }

        const resolvedDocx = path.resolve(docxPath);
        if (!resolvedDocx.startsWith(resumesDir)) {
          sendJson(403, { error: 'Access Denied: Path outside allowed directory.' });
          return;
        }

        const safeFilename = `${(version.company || 'Company').replace(/[^a-zA-Z0-9]/g, '_')}_Abhishek_N_Resume_v${version.version_number}.docx`;
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${safeFilename}"`
        });
        fs.createReadStream(resolvedDocx).pipe(res);
      } catch (e) {
        sendJson(e.statusCode || 500, { error: e.message });
      }
      return;
    }

    // GET /api/automation/status
    if (req.method === 'GET' && pathname === '/api/automation/status') {
      try {
        const status = getAutomationControlStatus();
        sendJson(200, status);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/automation/task/:taskKey/run
    if (req.method === 'POST' && pathname.startsWith('/api/automation/task/') && pathname.endsWith('/run')) {
      try {
        const parts = pathname.split('/');
        const taskKey = parts[4];
        if (!taskKey) {
          sendJson(400, { error: 'Task key is required' });
          return;
        }
        const result = await executeTask(taskKey, { manualTrigger: true });
        sendJson(200, { success: true, result });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/automation/task/:taskKey/toggle
    if (req.method === 'POST' && pathname.startsWith('/api/automation/task/') && pathname.endsWith('/toggle')) {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const parts = pathname.split('/');
        const taskKey = parts[4];
        const updated = toggleTaskEnabled(taskKey, body.enabled !== undefined ? body.enabled : undefined);
        sendJson(200, { success: true, task: updated });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/automation/task/:taskKey/interval
    if (req.method === 'POST' && pathname.startsWith('/api/automation/task/') && pathname.endsWith('/interval')) {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const parts = pathname.split('/');
        const taskKey = parts[4];
        const updated = updateTaskInterval(taskKey, body.intervalMinutes);
        sendJson(200, { success: true, task: updated });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/automation/master-toggle
    if (req.method === 'POST' && pathname === '/api/automation/master-toggle') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const paused = setMasterAutomationPause(body.paused);
        sendJson(200, { success: true, isPaused: paused });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // GET /api/backup/list
    if (req.method === 'GET' && pathname === '/api/backup/list') {
      try {
        const backups = listBackups();
        sendJson(200, { success: true, backups });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/backup/create
    if (req.method === 'POST' && pathname === '/api/backup/create') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const backupResult = backupDatabase({ label: body.label || 'manual' });
        sendJson(200, { success: true, backup: backupResult });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/backup/restore (Strict User Confirmation Gate)
    if (req.method === 'POST' && pathname === '/api/backup/restore') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        if (!body.backupPath) {
          sendJson(400, { error: 'backupPath is required' });
          return;
        }
        if (body.userConfirmed !== true) {
          sendJson(400, {
            error: 'Destructive Action Protection: You must explicitly confirm database restoration (userConfirmed: true).'
          });
          return;
        }

        const restoreResult = restoreDatabase(body.backupPath, {
          userConfirmed: true
        });
        sendJson(200, { success: true, result: restoreResult });
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // GET /api/backup/integrity
    if (req.method === 'GET' && pathname === '/api/backup/integrity') {
      try {
        const integrity = runDatabaseIntegrityCheck();
        sendJson(200, { success: true, integrity });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/backup/export-full
    if (req.method === 'POST' && pathname === '/api/backup/export-full') {
      try {
        const archive = exportCandidateFullArchive();
        sendJson(200, { success: true, archive });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // ==========================================
    // STATIC FILE SERVING WITH PATH TRAVERSAL GUARD
    // ==========================================
    const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const fileName = safePath === '/' || safePath === '' ? 'index.html' : safePath;
    const resolvedStaticPath = path.resolve(PUBLIC_DIR, fileName.replace(/^[/\\]+/, ''));

    if (!resolvedStaticPath.startsWith(path.resolve(PUBLIC_DIR))) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access Denied');
      return;
    }

    const ext = path.extname(resolvedStaticPath);
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png'
    };

    if (fs.existsSync(resolvedStaticPath) && fs.statSync(resolvedStaticPath).isFile()) {
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      fs.createReadStream(resolvedStaticPath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  try {
    initializeAutomationEngine({ runStartupChecks: false });
  } catch (err) {
    console.warn('[Dashboard] Could not initialize automation engine:', err.message);
  }

  server.listen(port, host, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 CareerOS Dashboard Live at http://${host}:${port}`);
    console.log(`======================================================\n`);
  });

  return server;
}
