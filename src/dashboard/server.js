import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJobs, updateJobStatus, getStats, getScanHistory, saveOrUpdateJob } from '../tracker/jobTracker.js';
import { runJobDiscovery, runCareerOsJobSweep } from '../discovery/discoveryService.js';
import { executeUnifiedSearch } from '../discovery/unifiedSearchService.js';
import { getAllSources, resolveSource, generateAssistedSearchLinks, getSourceHealthReport } from '../discovery/sourceRegistry.js';
import { importJobsFromInput } from '../discovery/jobImportService.js';
import { loadCandidateProfile } from '../profile/profileManager.js';
import { exportTailoredDocumentsForJob, generateTailoredResume, generateTailoredCoverLetter } from '../resumes/resumeGenerator.js';
import { launchFormAssistant } from '../automation/formAssistant.js';
import {
  listLocalChromeProfiles,
  getChromeProfileConfig,
  saveChromeProfileConfig,
  getChromeConnectionStatus
} from '../automation/chromeProfileConfig.js';
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
import { prepareApplication, generateApplicationPackage } from '../automation/applicationWorkflow.js';
import {
  discoverRecruitersForJob,
  discoverContactsForJobAsync,
  researchHiringTeamForJob,
  saveRecruiterContact,
  getRecruiterContacts,
  prepareContactOutreach,
  updateContactOutreachStatus,
  createOutreachDraft,
  getOutreachDrafts,
  updateOutreachDraft
} from '../intelligence/recruiterDiscoveryService.js';
import {
  createAgentTask,
  getAgentTask,
  listAgentTasks,
  pauseAgentTask,
  resumeAgentTask,
  cancelAgentTask,
  retryAgentTask,
  getAgentBridgeStatus,
  buildApplyWithAiContext,
  recoverStaleTasks
} from '../agent/agentTaskManager.js';
import {
  AGENT_TOOL_DEFINITIONS,
  executeAgentTool,
  verifyAgentBridgeAuth
} from '../agent/agentBridge.js';
import { getUnifiedTimeline } from '../tracker/timelineService.js';
import {
  createApprovalRequest,
  listApprovalRequests,
  decideApprovalRequest
} from '../tracker/approvalCenter.js';
import {
  getDriveIntegrationStatus,
  uploadDocumentToDrive,
  listDriveLinks
} from '../drive/googleDriveService.js';
import { assessApplicationReadiness } from '../automation/applicationReadiness.js';
import {
  validateBatchQueue,
  createBatchSession,
  getBatchSession,
  getActiveBatchSession,
  controlBatchSession
} from '../automation/batchSessionManager.js';
import { checkResumeAtsQuality } from '../resumes/atsQualityChecker.js';
import { saveScreeningAnswerOverride, getScreeningAnswersVault } from '../automation/screeningEngine.js';
import { getApplications, getApplicationByJobId, updateApplicationStatus as updateAppStatus, undoSubmittedApplication, getPortalSupportMatrix, checkDuplicateApplication } from '../tracker/applicationTracker.js';
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
  exportCandidateFullArchive,
  cleanTestFixtures
} from '../db/backupService.js';
import { getDatabase } from '../db/schema.js';
import {
  scheduleInterview,
  updateInterviewStage,
  getInterviewsForJob,
  getUpcomingInterviews,
  getPipelineAnalytics,
  VALID_INTERVIEW_STAGES
} from '../interview/pipelineService.js';
import {
  getQuestions,
  getQuestionById,
  updateQuestionStatus,
  addQuestion,
  getQuestionBankStats
} from '../interview/questionBankService.js';
import { calculateInterviewReadiness } from '../interview/readinessScorer.js';
import { generateFollowUpDraft } from '../interview/followUpService.js';

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

export function startDashboardServer(portOrOptions = 3000, hostParam = '127.0.0.1') {
  const port = typeof portOrOptions === 'object' && portOrOptions !== null ? (portOrOptions.port || 3000) : (portOrOptions || 3000);
  const host = typeof portOrOptions === 'object' && portOrOptions !== null ? (portOrOptions.host || hostParam || '127.0.0.1') : (hostParam || '127.0.0.1');

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
        try {
          const db = getDatabase();
          const contactStats = db.prepare(`
            SELECT COUNT(DISTINCT job_id) as jobsWithContacts, COUNT(*) as totalContacts
            FROM recruiter_contacts
            WHERE job_id IS NOT NULL
          `).get();
          const draftStats = db.prepare(`
            SELECT COUNT(DISTINCT job_id) as jobsWithOutreachDrafts
            FROM outreach_drafts
            WHERE job_id IS NOT NULL
          `).get();
          stats.jobsWithContacts = contactStats?.jobsWithContacts || 0;
          stats.totalContacts = contactStats?.totalContacts || 0;
          stats.jobsWithOutreachDrafts = draftStats?.jobsWithOutreachDrafts || 0;
        } catch {
          // Non-fatal fallback
        }
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
        const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit') || '200', 10), 2000);
        const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);

        const jobs = getJobs({ status, recommendation, minScore, source, location, workMode, verificationStatus, limit, offset });
        sendJson(200, { jobs });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // GET /api/sources (Phase 10 Source Registry & Status)
    if (pathname === '/api/sources' && req.method === 'GET') {
      try {
        const q = parsedUrl.searchParams.get('q') || 'Java Developer';
        const loc = parsedUrl.searchParams.get('location') || 'Bengaluru';
        const fresherOnly = parsedUrl.searchParams.get('fresherOnly') === 'true';

        const db = getDatabase();
        const counts = db.prepare('SELECT source, count(*) as count FROM jobs GROUP BY source').all();
        const countsMap = {};
        let totalAll = 0;
        for (const row of counts) {
          const sDef = resolveSource(row.source);
          countsMap[sDef.id] = (countsMap[sDef.id] || 0) + row.count;
          totalAll += row.count;
        }
        countsMap.all = totalAll;

        const sources = getAllSources().map(s => ({
          ...s,
          count: countsMap[s.id] || 0
        }));

        const assistedLinks = generateAssistedSearchLinks(q, loc, { fresherOnly });
        sendJson(200, { sources, assistedLinks, totalJobs: totalAll });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // GET /api/search & POST /api/search (Phase 10 Unified Search Engine)
    if (pathname === '/api/search' && (req.method === 'GET' || req.method === 'POST')) {
      try {
        let criteria = {};
        if (req.method === 'POST') {
          criteria = await safeReadBody();
          if (criteria === null) return;
        } else {
          const locations = parsedUrl.searchParams.getAll('location');
          const skillsParam = parsedUrl.searchParams.get('skills');
          const keywordsParam = parsedUrl.searchParams.get('keywords');
          const excludedParam = parsedUrl.searchParams.get('excludedKeywords');

          criteria = {
            q: parsedUrl.searchParams.get('q') || '',
            title: parsedUrl.searchParams.get('title') || '',
            company: parsedUrl.searchParams.get('company') || '',
            location: locations.length > 1 ? locations : (locations[0] || parsedUrl.searchParams.get('location') || 'all'),
            skills: skillsParam ? skillsParam.split(',').map(s => s.trim()) : [],
            keywords: keywordsParam ? keywordsParam.split(',').map(s => s.trim()) : [],
            excludedKeywords: excludedParam ? excludedParam.split(',').map(s => s.trim()) : [],
            fresherOnly: parsedUrl.searchParams.get('fresherOnly') === 'true',
            experience: parsedUrl.searchParams.get('experience') || 'any',
            datePosted: parsedUrl.searchParams.get('datePosted') || 'all',
            workMode: parsedUrl.searchParams.get('workMode') || 'all',
            employmentType: parsedUrl.searchParams.get('employmentType') || 'all',
            salary: parsedUrl.searchParams.get('salary') || 'any',
            degree: parsedUrl.searchParams.get('degree') || 'all',
            source: parsedUrl.searchParams.get('source') || 'all',
            minScore: parseInt(parsedUrl.searchParams.get('minScore') || '0', 10),
            eligibility: parsedUrl.searchParams.get('eligibility') || 'all',
            priority: parsedUrl.searchParams.get('priority') || 'all',
            status: parsedUrl.searchParams.get('status') || 'all',
            excludeExpired: parsedUrl.searchParams.get('excludeExpired') !== 'false',
            excludeApplied: parsedUrl.searchParams.get('excludeApplied') === 'true',
            excludeSaved: parsedUrl.searchParams.get('excludeSaved') === 'true',
            excludeDismissed: parsedUrl.searchParams.get('excludeDismissed') !== 'false',
            excludeDuplicates: parsedUrl.searchParams.get('excludeDuplicates') !== 'false',
            locationRegion: parsedUrl.searchParams.get('locationRegion') || 'all',
            sort: parsedUrl.searchParams.get('sort') || 'relevance',
            limit: Math.min(parseInt(parsedUrl.searchParams.get('limit') || '500', 10), 2000),
            offset: parseInt(parsedUrl.searchParams.get('offset') || '0', 10)
          };
        }

        const searchResponse = executeUnifiedSearch(criteria);
        sendJson(200, searchResponse);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/job/import-url (Single URL or Search Results URL Import)
    if (pathname === '/api/job/import-url' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const { url, title, company, location, source, description, preview } = body;
        if (!url || typeof url !== 'string' || !url.startsWith('http')) {
          sendJson(400, { error: 'Bad Request: A valid HTTP/HTTPS URL is required.' });
          return;
        }

        const result = await importJobsFromInput({
          url,
          title,
          company,
          location,
          source,
          description,
          preview: Boolean(preview)
        });
        const first = result.items[0] || {};
        sendJson(200, {
          ...result,
          jobId: first.jobId || first.existingJobId || null,
          isNew: first.action === 'imported',
          evaluation: first.evaluation || null
        });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/jobs/import-batch (Batch URLs, JSON, CSV & Preview)
    if (pathname === '/api/jobs/import-batch' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const result = await importJobsFromInput(body || {});
        sendJson(200, result);
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // GET /api/sources/health
    if (pathname === '/api/sources/health' && req.method === 'GET') {
      try {
        sendJson(200, { sources: getSourceHealthReport() });
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

    // POST /api/discovery/sweep (CAREEROS JOB SWEEP)
    if (pathname === '/api/discovery/sweep' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;
      try {
        const result = await runCareerOsJobSweep({
          customQuery: body?.query || null,
          queries: Array.isArray(body?.queries) ? body.queries : null,
          maxPerQuery: body?.maxPerQuery || 20
        });
        sendJson(200, result);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/scan
    if (pathname === '/api/scan' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const result = await runJobDiscovery({
          customQuery: body.query || null,
          queries: Array.isArray(body.queries) ? body.queries : null
        });
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

    // GET /api/job/:id
    const jobDetailMatch = pathname.match(/^\/api\/job\/(\d+)$/);
    if (jobDetailMatch && req.method === 'GET') {
      try {
        const jobId = parseValidId(jobDetailMatch[1], 'Job ID');
        const db = getDatabase();
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        if (!job) {
          sendJson(404, { success: false, error: 'Job not found' });
          return;
        }
        sendJson(200, { success: true, job });
      } catch (e) {
        sendJson(e.statusCode || 500, { success: false, error: e.message });
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

    // GET /api/job/:id/readiness (Phase 13 Application Readiness Assessment)
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/readiness') && req.method === 'GET') {
      try {
        const jobId = parseValidId(pathname.split('/')[3], 'Job ID');
        const db = getDatabase();
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        if (!job) {
          sendJson(404, { success: false, error: 'Job not found' });
          return;
        }
        const app = getApplicationByJobId(jobId);
        const versions = getResumeVersionsForJob(jobId);
        const selectedVer = versions.find(v => v.is_approved === 1) || versions[0] || null;
        const evaluation = evaluateJobFit(job);
        const readiness = assessApplicationReadiness(job, app, selectedVer, evaluation);
        sendJson(200, { success: true, readiness });
      } catch (e) {
        sendJson(e.statusCode || 500, { success: false, error: e.message });
      }
      return;
    }

    // GET /api/job/:id/application-package (Phase 13 Full Application Package Generator)
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/application-package') && req.method === 'GET') {
      try {
        const jobId = parseValidId(pathname.split('/')[3], 'Job ID');
        const packageData = await generateApplicationPackage(jobId);
        sendJson(200, { success: true, package: packageData });
      } catch (e) {
        sendJson(e.statusCode || 500, { success: false, error: e.message });
      }
      return;
    }

    // GET /api/job/:id/resume-ats-check (Phase 13 14-Dimension ATS Quality Audit)
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/resume-ats-check') && req.method === 'GET') {
      try {
        const jobId = parseValidId(pathname.split('/')[3], 'Job ID');
        const db = getDatabase();
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        if (!job) {
          sendJson(404, { success: false, error: 'Job not found' });
          return;
        }
        const versions = getResumeVersionsForJob(jobId);
        const selectedVer = versions.find(v => v.is_approved === 1) || versions[0] || null;
        let resumeContent = selectedVer?.content;
        if (!resumeContent) {
          const studio = await generateStudioResume(job);
          resumeContent = studio.content;
        }
        const atsReport = checkResumeAtsQuality(resumeContent, job, {
          pdfPath: selectedVer?.pdf_path,
          template: selectedVer?.template || 'ats_professional'
        });
        sendJson(200, { success: true, atsReport });
      } catch (e) {
        sendJson(e.statusCode || 500, { success: false, error: e.message });
      }
      return;
    }

    // POST /api/job/:id/answers (Phase 13 Screening Answer Overrides & Vault)
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/answers') && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;
      try {
        const jobId = parseValidId(pathname.split('/')[3], 'Job ID');
        const { questionKey, answerText } = body;
        if (!questionKey || !answerText) {
          sendJson(400, { success: false, error: 'questionKey and answerText are required.' });
          return;
        }
        saveScreeningAnswerOverride(questionKey, answerText);
        sendJson(200, { success: true, message: 'Screening answer updated in vault.' });
      } catch (e) {
        sendJson(e.statusCode || 500, { success: false, error: e.message });
      }
      return;
    }

    // POST /api/job/:id/ats-resume-instant (Phase 13 Instant ATS Resume Generator)
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/ats-resume-instant') && req.method === 'POST') {
      try {
        const jobId = parseValidId(pathname.split('/')[3], 'Job ID');
        const db = getDatabase();
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        if (!job) {
          sendJson(404, { success: false, error: 'Job not found' });
          return;
        }
        const studioRes = await generateStudioResume(job, { template: 'ats_professional' });
        const savedVer = await saveResumeVersion({
          jobId,
          company: job.company,
          jobTitle: job.title,
          jdSnapshot: { title: job.title, company: job.company, description: job.description },
          template: 'ats_professional',
          generationMode: studioRes.generationMode,
          content: studioRes.content,
          atsScore: studioRes.atsScore?.overallScore || 85,
          atsBreakdown: studioRes.atsScore?.breakdown || {},
          matchedKeywords: studioRes.atsScore?.matchedSkills || [],
          missingKeywords: studioRes.atsScore?.missingSkills || []
        });
        const atsQuality = checkResumeAtsQuality(studioRes.content, job, {
          pdfPath: savedVer.pdf_path,
          template: 'ats_professional'
        });
        sendJson(200, {
          success: true,
          message: 'ATS Resume successfully generated and compiled to PDF.',
          resumeVersion: savedVer,
          pdfUrl: `/api/download/resume/${jobId}`,
          atsQuality
        });
      } catch (e) {
        sendJson(e.statusCode || 500, { success: false, error: e.message });
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

    // POST /api/job/:id/application/undo
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/application/undo') && req.method === 'POST') {
      try {
        const jobId = parseValidId(pathname.split('/')[3], 'Job ID');
        const result = undoSubmittedApplication(jobId);
        sendJson(200, { success: true, application: result });
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // POST /api/job/:id/application/status or POST /api/application/:id/status
    if (((pathname.startsWith('/api/job/') && pathname.endsWith('/application/status')) ||
         (pathname.startsWith('/api/application/') && pathname.endsWith('/status'))) && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const rawId = pathname.split('/')[3];
        const isAppPath = pathname.startsWith('/api/application/');
        const db = getDatabase();
        let jobId;
        if (isAppPath) {
          const app = db.prepare('SELECT job_id FROM applications WHERE id = ?').get(rawId);
          jobId = app ? app.job_id : parseValidId(rawId, 'Job ID');
        } else {
          jobId = parseValidId(rawId, 'Job ID');
        }
        const { status, notes, confirmationNumber, userConfirmed } = body;
        const result = updateAppStatus(jobId, status, { notes, confirmationNumber, userConfirmed });
        sendJson(200, result);
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // POST /api/job/:id/application/notes or POST /api/application/:id/notes
    if (((pathname.startsWith('/api/job/') && pathname.endsWith('/application/notes')) ||
         (pathname.startsWith('/api/application/') && pathname.endsWith('/notes'))) && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;

      try {
        const rawId = pathname.split('/')[3];
        const isAppPath = pathname.startsWith('/api/application/');
        const db = getDatabase();
        let jobId;
        if (isAppPath) {
          const app = db.prepare('SELECT job_id FROM applications WHERE id = ?').get(rawId);
          jobId = app ? app.job_id : parseValidId(rawId, 'Job ID');
        } else {
          jobId = parseValidId(rawId, 'Job ID');
        }
        const noteText = (body.notes || body.note || '').trim();
        if (!noteText) {
          sendJson(400, { error: 'Note text cannot be empty' });
          return;
        }
        const existing = db.prepare('SELECT * FROM applications WHERE job_id = ?').get(jobId);
        if (!existing) {
          sendJson(404, { error: `No application record found for job #${jobId}` });
          return;
        }
        const updatedNotes = existing.notes ? `${existing.notes} | ${noteText}` : noteText;
        db.prepare(`UPDATE applications SET notes = ?, updated_at = datetime('now') WHERE job_id = ?`).run(updatedNotes, jobId);
        sendJson(200, { success: true, jobId, notes: updatedNotes });
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    // GET /api/job/:id/application-record
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/application-record') && req.method === 'GET') {
      try {
        const jobId = parseValidId(pathname.split('/')[3], 'Job ID');
        const app = getApplicationByJobId(jobId);
        sendJson(200, { success: true, application: app });
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

    // GET /api/interviews
    if (pathname === '/api/interviews' && req.method === 'GET') {
      try {
        const jobId = parsedUrl.searchParams.get('jobId');
        const upcoming = parsedUrl.searchParams.get('upcoming') === 'true';
        let interviews = [];
        if (jobId) {
          interviews = getInterviewsForJob(parseValidId(jobId, 'Job ID'));
        } else if (upcoming) {
          interviews = getUpcomingInterviews(parseInt(parsedUrl.searchParams.get('limit') || '10', 10));
        } else {
          interviews = getUpcomingInterviews(50);
        }
        const analytics = getPipelineAnalytics();
        sendJson(200, { success: true, interviews, analytics });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/interviews
    if (pathname === '/api/interviews' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;
      try {
        const { jobId, roundName, stage, scheduledAt, interviewMode, interviewerInfo, meetingLink, timezone, prepNotes, confirmedByUser } = body;
        if (!jobId) {
          sendJson(400, { error: 'jobId is required' });
          return;
        }
        const result = scheduleInterview(parseValidId(jobId, 'Job ID'), {
          roundName,
          stage,
          scheduledAt,
          interviewMode,
          interviewerInfo,
          meetingLink,
          timezone,
          prepNotes,
          confirmedByUser
        });
        if (!result.success && result.duplicateDetected) {
          sendJson(409, result);
          return;
        }
        sendJson(201, result);
      } catch (e) {
        sendJson(e.statusCode || 400, { error: e.message });
      }
      return;
    }

    // PATCH /api/interviews/:id
    if (pathname.startsWith('/api/interviews/') && !pathname.includes('follow-up') && !pathname.includes('readiness') && req.method === 'PATCH') {
      const body = await safeReadBody();
      if (body === null) return;
      try {
        const interviewId = parseValidId(pathname.split('/')[3], 'Interview ID');
        const updated = updateInterviewStage(interviewId, body.stage, body);
        sendJson(200, { success: true, interview: updated });
      } catch (e) {
        sendJson(e.statusCode || 400, { error: e.message });
      }
      return;
    }

    // GET /api/interviews/readiness/:jobId
    if (pathname.startsWith('/api/interviews/readiness/') && req.method === 'GET') {
      try {
        const jobId = parseValidId(pathname.split('/')[4], 'Job ID');
        const readiness = calculateInterviewReadiness(jobId);
        sendJson(200, { success: true, readiness });
      } catch (e) {
        sendJson(e.statusCode || 500, { error: e.message });
      }
      return;
    }

    // GET /api/question-bank
    if (pathname === '/api/question-bank' && req.method === 'GET') {
      try {
        const category = parsedUrl.searchParams.get('category');
        const difficulty = parsedUrl.searchParams.get('difficulty');
        const search = parsedUrl.searchParams.get('search');
        const isSaved = parsedUrl.searchParams.get('isSaved');
        const reviewedStatus = parsedUrl.searchParams.get('reviewedStatus');
        const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
        const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);

        const result = getQuestions({
          category,
          difficulty,
          search,
          isSaved: isSaved !== null ? (isSaved === 'true' || isSaved === '1') : undefined,
          reviewedStatus,
          limit,
          offset
        });
        const stats = getQuestionBankStats();
        sendJson(200, { success: true, ...result, stats });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/question-bank/:id/status
    if (pathname.startsWith('/api/question-bank/') && pathname.endsWith('/status') && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;
      try {
        const questionId = parseValidId(pathname.split('/')[3], 'Question ID');
        const updated = updateQuestionStatus(questionId, body);
        sendJson(200, { success: true, question: updated });
      } catch (e) {
        sendJson(e.statusCode || 400, { error: e.message });
      }
      return;
    }

    // POST /api/interviews/:id/follow-up-draft
    if (pathname.startsWith('/api/interviews/') && pathname.endsWith('/follow-up-draft') && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;
      try {
        const interviewId = parseValidId(pathname.split('/')[3], 'Interview ID');
        const draft = generateFollowUpDraft(interviewId, body.type || 'post_technical', body);
        sendJson(200, { success: true, draft });
      } catch (e) {
        sendJson(e.statusCode || 400, { error: e.message });
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

    // POST /api/backup/cleanup-fixtures
    if (req.method === 'POST' && pathname === '/api/backup/cleanup-fixtures') {
      try {
        const result = cleanTestFixtures();
        sendJson(200, result);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // ==========================================
    // BATCH APPLICATION PREPARATION ASSISTANT (PHASE 14)
    // ==========================================
    if (pathname === '/api/batch-session/validate' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;
      try {
        const validation = validateBatchQueue(body || {});
        sendJson(200, { success: true, validation });
      } catch (e) {
        sendJson(e.statusCode || 400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname === '/api/batch-session/create' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;
      try {
        const session = createBatchSession(body || {});
        sendJson(200, { success: true, session });
      } catch (e) {
        sendJson(e.statusCode || 400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname === '/api/batch-session/active' && req.method === 'GET') {
      try {
        const session = getActiveBatchSession();
        sendJson(200, { success: true, session });
      } catch (e) {
        sendJson(500, { success: false, error: e.message });
      }
      return;
    }

    if (pathname.startsWith('/api/batch-session/') && pathname.endsWith('/control') && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;
      try {
        const sessionId = parseValidId(pathname.split('/')[3], 'Session ID');
        const session = await controlBatchSession(sessionId, body.action, body);
        sendJson(200, { success: true, session });
      } catch (e) {
        sendJson(e.statusCode || 400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname.startsWith('/api/job/') && pathname.endsWith('/duplicate-check') && req.method === 'GET') {
      try {
        const jobId = parseValidId(pathname.split('/')[3], 'Job ID');
        const dup = checkDuplicateApplication(jobId);
        sendJson(200, { success: true, ...dup });
      } catch (e) {
        sendJson(e.statusCode || 400, { success: false, error: e.message });
      }
      return;
    }

    // RECRUITER HUB — CONTACT DISCOVERY & OUTREACH
    if (pathname === '/api/recruiter-hub/contacts' && req.method === 'GET') {
      try {
        const company = parsedUrl.searchParams.get('company') || null;
        const jobId = parsedUrl.searchParams.get('jobId') ? parseValidId(parsedUrl.searchParams.get('jobId'), 'Job ID') : null;
        sendJson(200, { success: true, contacts: getRecruiterContacts({ company, jobId }) });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname === '/api/recruiter-hub/contacts' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;
      try {
        const contact = saveRecruiterContact(body || {});
        sendJson(200, { success: true, contact });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname.startsWith('/api/recruiter-hub/discover/') && req.method === 'POST') {
      try {
        const jobId = parseValidId(pathname.split('/')[4], 'Job ID');
        const discovery = await discoverContactsForJobAsync(jobId, { fetchPublicDomain: true });
        sendJson(200, { success: true, ...discovery });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname.startsWith('/api/recruiter-hub/contacts/') && pathname.endsWith('/outreach-draft') && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;
      try {
        const contactId = parseValidId(pathname.split('/')[4], 'Contact ID');
        const result = prepareContactOutreach(contactId, body || {});
        sendJson(200, { success: true, ...result });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname.startsWith('/api/recruiter-hub/contacts/') && pathname.endsWith('/outreach-status') && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;
      try {
        const contactId = parseValidId(pathname.split('/')[4], 'Contact ID');
        const contact = updateContactOutreachStatus(contactId, body.status, body);
        sendJson(200, { success: true, contact });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    // SAVED SEARCHES
    if (pathname === '/api/saved-searches' && req.method === 'GET') {
      try {
        const db = getDatabase();
        const rows = db.prepare('SELECT * FROM saved_searches ORDER BY id DESC LIMIT 20').all();
        sendJson(200, { success: true, savedSearches: rows.map(r => ({ ...r, filters: r.filters_json ? JSON.parse(r.filters_json) : {} })) });
      } catch (e) {
        sendJson(500, { success: false, error: e.message });
      }
      return;
    }

    if (pathname === '/api/saved-searches' && req.method === 'POST') {
      const body = await safeReadBody();
      if (body === null) return;
      try {
        const db = getDatabase();
        const name = (body.name || body.query || 'Saved Search').trim().slice(0, 80);
        const info = db.prepare('INSERT INTO saved_searches (name, query, filters_json) VALUES (?, ?, ?)').run(
          name,
          body.query || '',
          JSON.stringify(body.filters || {})
        );
        sendJson(200, { success: true, id: info.lastInsertRowid, name });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname.startsWith('/api/saved-searches/') && req.method === 'PATCH') {
      const body = await safeReadBody();
      if (body === null) return;
      try {
        const id = parseValidId(pathname.split('/')[3], 'Saved Search ID');
        const newName = String(body.name || '').trim();
        if (!newName) throw new Error('Search name is required.');
        const db = getDatabase();
        db.prepare('UPDATE saved_searches SET name = ? WHERE id = ?').run(newName, id);
        sendJson(200, { success: true });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname.startsWith('/api/saved-searches/') && req.method === 'DELETE') {
      try {
        const id = parseValidId(pathname.split('/')[3], 'Saved Search ID');
        const db = getDatabase();
        db.prepare('DELETE FROM saved_searches WHERE id = ?').run(id);
        sendJson(200, { success: true });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    // ==========================================
    // PHASE 15: AI AGENT TASKS, BRIDGE, OUTREACH, TIMELINE, APPROVALS & DRIVE
    // ==========================================
    if (pathname === '/api/agent/tasks' && req.method === 'GET') {
      try {
        const status = parsedUrl.searchParams.get('status') || null;
        const jobId = parsedUrl.searchParams.get('jobId') ? parseValidId(parsedUrl.searchParams.get('jobId'), 'Job ID') : null;
        sendJson(200, { success: true, tasks: listAgentTasks({ status, jobId }) });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname === '/api/agent/tasks' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const jobId = parseValidId(body.jobId, 'Job ID');
        const result = createAgentTask({
          jobId,
          taskType: body.taskType || 'apply_with_ai',
          instructions: body.instructions || '',
          agentSessionRef: body.agentSessionRef || null
        });
        sendJson(200, { success: true, ...result });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname.startsWith('/api/agent/tasks/') && req.method === 'GET') {
      try {
        const taskId = parseValidId(pathname.split('/')[4], 'Task ID');
        const task = getAgentTask(taskId);
        if (!task) return sendJson(404, { success: false, error: 'Task not found.' });
        const context = buildApplyWithAiContext(task.jobId);
        sendJson(200, { success: true, task, context });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname.match(/^\/api\/agent\/tasks\/\d+\/(pause|resume|cancel|retry)$/) && req.method === 'POST') {
      try {
        const parts = pathname.split('/');
        const taskId = parseValidId(parts[4], 'Task ID');
        const action = parts[5];
        const body = await readJsonBody(req).catch(() => ({}));
        let task;
        if (action === 'pause') task = pauseAgentTask(taskId, body.reason);
        else if (action === 'resume') task = resumeAgentTask(taskId, body.reason);
        else if (action === 'retry') task = retryAgentTask(taskId, body.reason);
        else task = cancelAgentTask(taskId, body.reason);
        sendJson(200, { success: true, task });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname === '/api/agent/status' && req.method === 'GET') {
      try {
        const chrome = await getChromeConnectionStatus();
        sendJson(200, { success: true, bridge: getAgentBridgeStatus(), chrome });
      } catch (e) {
        sendJson(500, { success: false, error: e.message });
      }
      return;
    }

    if (pathname === '/api/chrome/status' && req.method === 'GET') {
      try {
        const chrome = await getChromeConnectionStatus();
        sendJson(200, { success: true, ...chrome });
      } catch (e) {
        sendJson(500, { success: false, error: e.message });
      }
      return;
    }

    if (pathname === '/api/agent/bridge/tools' && req.method === 'GET') {
      const auth = verifyAgentBridgeAuth(req.headers);
      if (!auth.authorized) return sendJson(401, { success: false, error: auth.error });
      sendJson(200, { success: true, tools: AGENT_TOOL_DEFINITIONS });
      return;
    }

    if (pathname.startsWith('/api/agent/bridge/') && req.method === 'POST') {
      const auth = verifyAgentBridgeAuth(req.headers);
      if (!auth.authorized) return sendJson(401, { success: false, error: auth.error });
      try {
        const toolName = pathname.split('/')[4];
        const args = await readJsonBody(req);
        const result = await executeAgentTool(toolName, args);
        sendJson(200, { success: true, tool: toolName, result });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname.startsWith('/api/recruiters/research/') && req.method === 'GET') {
      try {
        const jobId = parseValidId(pathname.split('/')[4], 'Job ID');
        sendJson(200, { success: true, ...researchHiringTeamForJob(jobId) });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname === '/api/outreach/drafts' && req.method === 'GET') {
      try {
        const jobId = parsedUrl.searchParams.get('jobId') ? parseValidId(parsedUrl.searchParams.get('jobId'), 'Job ID') : null;
        const contactId = parsedUrl.searchParams.get('contactId') ? parseValidId(parsedUrl.searchParams.get('contactId'), 'Contact ID') : null;
        sendJson(200, { success: true, drafts: getOutreachDrafts({ jobId, contactId }) });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname === '/api/outreach/drafts' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const result = createOutreachDraft({
          jobId: body.jobId ? parseValidId(body.jobId, 'Job ID') : null,
          contactId: body.contactId ? parseValidId(body.contactId, 'Contact ID') : null,
          taskId: body.taskId ? parseValidId(body.taskId, 'Task ID') : null,
          channel: body.channel || 'email',
          recipientName: body.recipientName || 'Hiring Team',
          recipientEmail: body.recipientEmail || '',
          subject: body.subject || '',
          body: body.body || '',
          evidence: Array.isArray(body.evidence) ? body.evidence : []
        });
        sendJson(200, { success: true, ...result });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname.startsWith('/api/outreach/drafts/') && req.method === 'PATCH') {
      try {
        const draftId = parseValidId(pathname.split('/')[4], 'Draft ID');
        const body = await readJsonBody(req);
        const draft = updateOutreachDraft(draftId, { subject: body.subject, body: body.body });
        sendJson(200, { success: true, draft });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname === '/api/approvals' && req.method === 'GET') {
      try {
        const status = parsedUrl.searchParams.get('status') || null;
        const jobId = parsedUrl.searchParams.get('jobId') ? parseValidId(parsedUrl.searchParams.get('jobId'), 'Job ID') : null;
        sendJson(200, { success: true, approvals: listApprovalRequests({ status, jobId }) });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname === '/api/approvals' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const approval = createApprovalRequest(body);
        sendJson(200, { success: true, approval });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname.match(/^\/api\/approvals\/\d+\/decide$/) && req.method === 'POST') {
      try {
        const approvalId = parseValidId(pathname.split('/')[3], 'Approval ID');
        const body = await readJsonBody(req);
        const approval = decideApprovalRequest(approvalId, {
          decision: body.decision,
          editedContent: body.editedContent ?? null,
          decisionNote: body.decisionNote || '',
          userConfirmed: body.userConfirmed === true
        });
        sendJson(200, { success: true, approval });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname.startsWith('/api/timeline/') && req.method === 'GET') {
      try {
        const jobId = parseValidId(pathname.split('/')[3], 'Job ID');
        sendJson(200, { success: true, ...getUnifiedTimeline(jobId) });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname === '/api/drive/status' && req.method === 'GET') {
      sendJson(200, { success: true, ...getDriveIntegrationStatus() });
      return;
    }

    if (pathname === '/api/chrome/profiles' && req.method === 'GET') {
      try {
        const config = getChromeProfileConfig();
        const profiles = listLocalChromeProfiles(config.userDataDir);
        sendJson(200, { success: true, config, profiles });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname === '/api/chrome/profile' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const config = saveChromeProfileConfig({
          enabled: body.enabled !== false,
          profileDirectory: body.profileDirectory || 'Profile 21',
          profileLabel: body.profileLabel || ''
        });
        sendJson(200, { success: true, config });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname === '/api/drive/links' && req.method === 'GET') {
      try {
        const jobId = parsedUrl.searchParams.get('jobId') ? parseValidId(parsedUrl.searchParams.get('jobId'), 'Job ID') : null;
        sendJson(200, { success: true, links: listDriveLinks({ jobId }) });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    if (pathname === '/api/drive/upload' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const link = await uploadDocumentToDrive({
          jobId: body.jobId ? parseValidId(body.jobId, 'Job ID') : null,
          applicationId: body.applicationId ? parseValidId(body.applicationId, 'Application ID') : null,
          localPath: body.localPath,
          docType: body.docType,
          fileName: body.fileName || null
        });
        sendJson(200, { success: true, link });
      } catch (e) {
        sendJson(400, { success: false, error: e.message });
      }
      return;
    }

    // ==========================================
    // STATIC FILE SERVING WITH PATH TRAVERSAL GUARD
    // ==========================================
    const relativePath = pathname.replace(/^[/\\]+/, '');
    const fileName = (relativePath === '' || relativePath === 'index.html') ? 'index.html' : relativePath;
    const cleanSafe = path.normalize(fileName).replace(/^(\.\.[/\\])+/, '');
    const resolvedStaticPath = path.resolve(PUBLIC_DIR, cleanSafe);

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
    recoverStaleTasks();
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
