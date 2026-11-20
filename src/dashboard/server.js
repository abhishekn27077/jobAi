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
import { getGoogleAuthUrl, disconnectAccount, getOAuthStatus } from '../email/googleOAuthClient.js';
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

export function startDashboardServer(port = 3000, host = '127.0.0.1') {
  const server = http.createServer(async (req, res) => {
    // Enable CORS for local convenience
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${host}:${port}`);
    const pathname = parsedUrl.pathname;

    // Helper to send JSON
    const sendJson = (statusCode, data) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    // API Routes
    if (pathname === '/api/stats' && req.method === 'GET') {
      try {
        const stats = getStats();
        sendJson(200, stats);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    if (pathname === '/api/jobs' && req.method === 'GET') {
      try {
        const status = parsedUrl.searchParams.get('status') || undefined;
        const recommendation = parsedUrl.searchParams.get('recommendation') || undefined;
        const source = parsedUrl.searchParams.get('source') || undefined;
        const location = parsedUrl.searchParams.get('location') || undefined;
        const workMode = parsedUrl.searchParams.get('workMode') || undefined;
        const verificationStatus = parsedUrl.searchParams.get('verificationStatus') || undefined;
        const minScore = parseInt(parsedUrl.searchParams.get('minScore') || '0', 10);
        const limit = parseInt(parsedUrl.searchParams.get('limit') || '100', 10);
        const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);

        const jobs = getJobs({ status, recommendation, minScore, source, location, workMode, verificationStatus, limit, offset });
        sendJson(200, { jobs });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    if (pathname === '/api/scan-history' && req.method === 'GET') {
      try {
        const history = getScanHistory(30);
        sendJson(200, { history });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    if (pathname === '/api/job/status' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { jobId, newStatus } = JSON.parse(body);
          const result = updateJobStatus(Number(jobId), newStatus);
          sendJson(200, result);
        } catch (e) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    if (pathname === '/api/scan' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = body ? JSON.parse(body) : {};
          const result = await runJobDiscovery({ customQuery: data.query || null });
          sendJson(200, result);
        } catch (e) {
          sendJson(500, { error: e.message });
        }
      });
      return;
    }

    if (pathname === '/api/profile' && req.method === 'GET') {
      try {
        const profile = loadCandidateProfile();
        sendJson(200, profile);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // --- NEW MODULE ENDPOINTS ---

    // 1. Tailor Resume & Cover Letter
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/tailor') && req.method === 'POST') {
      const jobId = parseInt(pathname.split('/')[3], 10);
      try {
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
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 2. Download Tailored PDF Resume
    if (pathname.startsWith('/api/download/resume/') && req.method === 'GET') {
      const jobId = parseInt(pathname.split('/')[4], 10);
      try {
        const resumesDir = path.join(OUTPUT_DIR, 'resumes');
        if (fs.existsSync(resumesDir)) {
          const files = fs.readdirSync(resumesDir);
          const pdfFile = files.find(f => f.startsWith(`${jobId}_`) && f.endsWith('.pdf'));
          if (pdfFile) {
            const fullPath = path.join(resumesDir, pdfFile);
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
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 3. Prepare Application Dossier
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/application') && req.method === 'GET') {
      const jobId = parseInt(pathname.split('/')[3], 10);
      try {
        const dossier = await prepareApplication(jobId);
        sendJson(200, { success: true, dossier });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 4. Launch Headed Playwright Form Assistant (with strict Human Approval Gate)
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/assist') && req.method === 'POST') {
      const jobId = parseInt(pathname.split('/')[3], 10);
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const db = getDatabase();
          const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
          if (!job) {
            sendJson(404, { error: `Job with ID ${jobId} not found` });
            return;
          }

          const payload = body ? JSON.parse(body) : {};
          if (!payload.userConfirmedApproval) {
            sendJson(400, {
              success: false,
              error: 'Human Approval Gate: You must explicitly approve the application preparation and proposed answers before launching the browser assistant.'
            });
            return;
          }

          // Launch in background so HTTP response returns promptly
          launchFormAssistant(job, {
            userConfirmedApproval: true,
            resumePdfPath: payload.resumePdfPath || null,
            screeningAnswers: payload.screeningAnswers || null,
            headless: false
          }).catch(err => {
            console.error('[Form Assistant Launch Error]:', err.message);
          });

          sendJson(200, {
            success: true,
            message: `Visible Chrome browser is launching for ${job.title} @ ${job.company}. Please review all pre-filled fields and submit manually.`
          });
        } catch (e) {
          sendJson(500, { error: e.message });
        }
      });
      return;
    }

    // 5. Update Application Status & Confirm Submission
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/application/status') && req.method === 'POST') {
      const jobId = parseInt(pathname.split('/')[3], 10);
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { status, notes, confirmationNumber, userConfirmed } = JSON.parse(body);
          const result = updateAppStatus(jobId, status, { notes, confirmationNumber, userConfirmed });
          sendJson(200, result);
        } catch (e) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    // 6. List Applications Pipeline
    if (pathname === '/api/applications' && req.method === 'GET') {
      try {
        const status = parsedUrl.searchParams.get('status') || undefined;
        const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
        const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);
        const applications = getApplications({ status, limit, offset });
        sendJson(200, { applications });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 7. Portal Support Matrix
    if (pathname === '/api/portals' && req.method === 'GET') {
      try {
        const portals = getPortalSupportMatrix();
        sendJson(200, { portals });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 8. Communications & Calendar Intelligence: Summary
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

    // 9. Communications: List Emails
    if (pathname === '/api/communications/emails' && req.method === 'GET') {
      try {
        const db = getDatabase();
        const category = parsedUrl.searchParams.get('category');
        const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);

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

    // 10. Communications: Sync Emails
    if (pathname === '/api/communications/sync' && req.method === 'POST') {
      try {
        const result = await syncRecruiterEmails();
        sendJson(200, result);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 11. Communications: Generate Draft
    if (pathname === '/api/communications/draft' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const db = getDatabase();
          const job = payload.jobId ? db.prepare('SELECT * FROM jobs WHERE id = ?').get(payload.jobId) : null;

          const draft = generateCommunicationDraft({
            draftType: payload.draftType || 'recruiter_reply',
            job,
            recruiterName: payload.recruiterName,
            recruiterEmail: payload.recruiterEmail,
            proposedSlots: payload.proposedSlots || [],
            interviewDetails: payload.interviewDetails,
            customContext: payload.customContext
          });

          const saved = saveDraftToVault({
            jobId: payload.jobId || null,
            recipient: payload.recruiterEmail || '',
            subject: draft.subject,
            body: draft.body,
            draftType: payload.draftType || 'recruiter_reply'
          });

          sendJson(200, {
            success: true,
            draftId: saved.draftId,
            draft
          });
        } catch (e) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    // 12. Communications: Approve Draft
    if (pathname.startsWith('/api/communications/draft/') && pathname.endsWith('/approve') && req.method === 'POST') {
      const draftId = parseInt(pathname.split('/')[4], 10);
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const result = await approveAndPublishDraft(draftId, {
            userConfirmedApproval: Boolean(payload.userConfirmedApproval)
          });
          sendJson(200, result);
        } catch (e) {
          sendJson(e.code === 'APPROVAL_REQUIRED' ? 400 : 500, { error: e.message, code: e.code });
        }
      });
      return;
    }

    // 13. Calendar: List Events
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

    // 14. Calendar: Propose / Create Event
    if (pathname === '/api/calendar/event' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const result = proposeCalendarEvent(payload);
          sendJson(200, result);
        } catch (e) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    // 15. Calendar: Approve Event
    if (pathname.startsWith('/api/calendar/event/') && pathname.endsWith('/approve') && req.method === 'POST') {
      const eventId = parseInt(pathname.split('/')[4], 10);
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const result = await approveAndCreateCalendarEvent(eventId, {
            userConfirmed: Boolean(payload.userConfirmed)
          });
          sendJson(200, result);
        } catch (e) {
          sendJson(e.code === 'APPROVAL_REQUIRED' ? 400 : 500, { error: e.message, code: e.code });
        }
      });
      return;
    }

    // 16. Calendar: Cancel Event
    if (pathname.startsWith('/api/calendar/event/') && pathname.endsWith('/cancel') && req.method === 'POST') {
      const eventId = parseInt(pathname.split('/')[4], 10);
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const result = await cancelCalendarEvent(eventId, {
            userConfirmed: Boolean(payload.userConfirmed)
          });
          sendJson(200, result);
        } catch (e) {
          sendJson(e.code === 'APPROVAL_REQUIRED' ? 400 : 500, { error: e.message, code: e.code });
        }
      });
      return;
    }

    // 17. Follow-up Reminders: List
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

    // 18. Follow-up Reminders: Create
    if (pathname === '/api/reminders' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const result = createFollowUpReminder(payload);
          sendJson(200, result);
        } catch (e) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    // 19. Follow-up Reminders: Update Status
    if (pathname.startsWith('/api/reminders/') && pathname.endsWith('/status') && req.method === 'POST') {
      const reminderId = parseInt(pathname.split('/')[3], 10);
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { status } = JSON.parse(body);
          const result = updateReminderStatus(reminderId, status);
          sendJson(200, result);
        } catch (e) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    // 20. Google OAuth Status, URL & Disconnect
    if (pathname === '/api/oauth/status' && req.method === 'GET') {
      try {
        const status = getOAuthStatus();
        sendJson(200, status);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    if (pathname === '/api/oauth/url' && req.method === 'GET') {
      try {
        const authUrl = getGoogleAuthUrl();
        sendJson(200, { authUrl });
      } catch (e) {
        sendJson(400, { error: e.message });
      }
      return;
    }

    if (pathname === '/api/oauth/disconnect' && req.method === 'POST') {
      try {
        const result = await disconnectAccount();
        sendJson(200, result);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // ==========================================
    // PHASE 5: CAREER INTELLIGENCE & GROWTH
    // ==========================================

    // 21. Skill Gap Analysis
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

    // 22. Skill Roadmap List
    if (pathname === '/api/intelligence/roadmap' && req.method === 'GET') {
      try {
        const roadmap = getSkillRoadmap();
        sendJson(200, { success: true, roadmap });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 23. Update Skill Roadmap Item
    if (pathname === '/api/intelligence/roadmap/item' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const updated = updateSkillRoadmapItem(payload.skillName, payload);
          sendJson(200, { success: true, item: updated });
        } catch (e) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    // 24. STAR Story Bank
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

    // 25. Create or Update STAR Story
    if (pathname === '/api/intelligence/stories' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const story = createOrUpdateStory(payload);
          sendJson(200, { success: true, story });
        } catch (e) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    // 26. Targeted Interview Kit
    if (pathname.startsWith('/api/intelligence/interview-prep/') && req.method === 'GET') {
      const jobId = parseInt(pathname.split('/')[4], 10);
      try {
        const db = getDatabase();
        const job = jobId ? db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) : null;
        const kit = generateTargetedInterviewKit(job);
        sendJson(200, { success: true, kit });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 27. Start Mock Interview Session
    if (pathname === '/api/intelligence/mock/start' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const session = startMockInterview(payload);
          sendJson(200, { success: true, session });
        } catch (e) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    // 28. Submit Mock Interview Answer
    if (pathname === '/api/intelligence/mock/submit' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const result = submitMockAnswer(payload);
          sendJson(200, { success: true, result });
        } catch (e) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    // 29. Get Mock Interview Session History
    if (pathname === '/api/intelligence/mock/history' && req.method === 'GET') {
      try {
        const limit = parseInt(parsedUrl.searchParams.get('limit') || '10', 10);
        const history = getMockHistory({ limit });
        sendJson(200, { success: true, history });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 30. Get Mock Interview Session by ID
    if (pathname.startsWith('/api/intelligence/mock/') && req.method === 'GET') {
      const sessionId = parseInt(pathname.split('/')[4], 10);
      try {
        const session = getMockSession(sessionId);
        if (!session) {
          sendJson(404, { error: `Session #${sessionId} not found.` });
          return;
        }
        sendJson(200, { success: true, session });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 31. Application Funnel & Conversion Analytics
    if (pathname === '/api/intelligence/analytics' && req.method === 'GET') {
      try {
        const analytics = getApplicationAnalytics();
        sendJson(200, { success: true, analytics });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 32. Rejection Pattern Analysis
    if (pathname === '/api/intelligence/rejections' && req.method === 'GET') {
      try {
        const rejections = getRejectionAnalysis();
        sendJson(200, { success: true, rejections });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 33. Company & Recruiter Research
    if (pathname.startsWith('/api/intelligence/company/') && req.method === 'GET') {
      const companyName = decodeURIComponent(pathname.split('/')[4]);
      try {
        const research = getCompanyResearch(companyName);
        sendJson(200, { success: true, research });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 34. Salary Calculator (Take-Home Pay Estimate)
    if (pathname === '/api/intelligence/salary/calculate' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const calculation = calculateOfferTakeHome(payload);
          sendJson(200, { success: true, calculation });
        } catch (e) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    // 35. Compare Multiple Offers
    if (pathname === '/api/intelligence/salary/compare' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const comparison = compareOffers(payload.offers || []);
          sendJson(200, { success: true, comparison });
        } catch (e) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    // 36. Save Offer Record
    if (pathname === '/api/intelligence/salary/save' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const saved = saveOfferComparisonRecord(payload);
          sendJson(200, { success: true, offer: saved });
        } catch (e) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    // 37. Get Saved Offers
    if (pathname === '/api/intelligence/salary/saved' && req.method === 'GET') {
      try {
        const offers = getSavedOfferComparisons();
        sendJson(200, { success: true, offers });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 4. Generate Interview Prep Dossier
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/prep') && req.method === 'GET') {
      const jobId = parseInt(pathname.split('/')[3], 10);
      try {
        const db = getDatabase();
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        if (!job) {
          sendJson(404, { error: `Job with ID ${jobId} not found` });
          return;
        }

        const dossier = generateInterviewDossier(job);
        sendJson(200, { success: true, dossier });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 5. Generate Referral Outreach Message
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/referral') && req.method === 'POST') {
      const jobId = parseInt(pathname.split('/')[3], 10);
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const db = getDatabase();
          const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
          if (!job) {
            sendJson(404, { error: `Job with ID ${jobId} not found` });
            return;
          }
          const { recipientType = 'engineer', recipientName = 'Hi' } = body ? JSON.parse(body) : {};
          const msg = generateReferralMessage(job, recipientType, recipientName);
          sendJson(200, { success: true, referral: msg });
        } catch (e) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    // 6. Verify Job Links / Ghost Job Audit
    if (pathname === '/api/verify-links' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { limit = 15 } = body ? JSON.parse(body) : {};
          const result = await verifyVaultJobs({ limit });
          sendJson(200, { success: true, ...result });
        } catch (e) {
          sendJson(500, { error: e.message });
        }
      });
      return;
    }

    // 7. Export Pipeline to CSV
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

    // 8. Export Pipeline to JSON
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

    // 9. Interactive Mock Interview Answer Evaluation
    if (pathname === '/api/mock/evaluate' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { question, answer, topic = 'general' } = JSON.parse(body);
          const evalResult = evaluateCandidateAnswer(question, answer, topic);
          sendJson(200, { success: true, evalResult });
        } catch (e) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    // 10. Save Mock Interview Session
    if (pathname === '/api/mock/save' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { jobId, round, feedbackJson } = JSON.parse(body);
          const session = saveInterviewSession(jobId, round, feedbackJson);
          sendJson(200, { success: true, session });
        } catch (e) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    // --- RESUME STUDIO API ENDPOINTS ---

    // 11. Get Studio Data for a Job (JD Analysis, Versions, Initial Tailored Draft)
    if (pathname.startsWith('/api/resume/studio-data/') && req.method === 'GET') {
      const jobId = parseInt(pathname.split('/')[4], 10);
      try {
        const db = getDatabase();
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        if (!job) {
          sendJson(404, { error: `Job #${jobId} not found` });
          return;
        }

        const jdAnalysis = extractJdRequirements(job);
        const versions = getResumeVersionsForJob(jobId);
        const initialStudio = await generateStudioResume(job, { jdAnalysis });

        sendJson(200, {
          success: true,
          job,
          jdAnalysis,
          versions,
          initialStudio
        });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 12. Recalculate ATS Score on Edited Content
    if (pathname === '/api/resume/score' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { jdAnalysis, resumeContent } = JSON.parse(body);
          const scoreResult = calculateAtsScore(jdAnalysis, resumeContent);
          sendJson(200, { success: true, atsScore: scoreResult });
        } catch (e) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    // 13. Generate/Re-generate Tailored Resume with Template
    if (pathname === '/api/resume/generate' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { jobId, template = 'ats_professional', forceAi = false } = JSON.parse(body);
          const db = getDatabase();
          const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
          if (!job) {
            sendJson(404, { error: `Job #${jobId} not found` });
            return;
          }

          const result = await generateStudioResume(job, { template, forceAi });
          sendJson(200, { success: true, result });
        } catch (e) {
          sendJson(500, { error: e.message });
        }
      });
      return;
    }

    // 14. Save Resume Version
    if (pathname === '/api/resume/save' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const savedVersion = await saveResumeVersion(data);
          sendJson(200, { success: true, version: savedVersion });
        } catch (e) {
          const status = e.statusCode || 500;
          sendJson(status, { success: false, error: e.message, audit: e.audit || null });
        }
      });
      return;
    }

    // 15. Get All Versions for a Job
    if (pathname.startsWith('/api/resume/versions/') && req.method === 'GET') {
      const jobId = parseInt(pathname.split('/')[4], 10);
      try {
        const versions = getResumeVersionsForJob(jobId);
        sendJson(200, { success: true, versions });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 16. Approve Resume Version (Link to Tracker)
    if (pathname.startsWith('/api/resume/approve/') && req.method === 'POST') {
      const versionId = parseInt(pathname.split('/')[4], 10);
      try {
        const version = await approveResumeVersion(versionId);
        sendJson(200, { success: true, version });
      } catch (e) {
        const status = e.statusCode || 500;
        sendJson(status, { success: false, error: e.message, audit: e.audit || null });
      }
      return;
    }

    // 17. Delete Resume Version
    if (pathname.startsWith('/api/resume/version/') && req.method === 'DELETE') {
      const versionId = parseInt(pathname.split('/')[4], 10);
      try {
        const resDel = deleteResumeVersion(versionId);
        sendJson(200, { success: true, ...resDel });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 18. Duplicate Resume Version
    if (pathname.startsWith('/api/resume/duplicate/') && req.method === 'POST') {
      const versionId = parseInt(pathname.split('/')[4], 10);
      try {
        const dup = await duplicateResumeVersion(versionId);
        sendJson(200, { success: true, version: dup });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 19. Download Resume PDF
    if (pathname.startsWith('/api/resume/download/') && pathname.endsWith('/pdf') && req.method === 'GET') {
      const versionId = parseInt(pathname.split('/')[4], 10);
      try {
        const version = getResumeVersionById(versionId);
        if (!version) {
          sendJson(404, { error: `Version #${versionId} not found` });
          return;
        }

        let pdfPath = version.pdf_path;
        if (!pdfPath || !fs.existsSync(pdfPath)) {
          // Compile on the fly
          const html = renderResumeHtml(version.content, version.template);
          pdfPath = path.join(OUTPUT_DIR, 'resumes', `${version.job_id}_v${version.version_number}_Resume.pdf`);
          await exportToPdf(html, pdfPath);
        }

        const safeFilename = `${(version.company || 'Company').replace(/[^a-zA-Z0-9]/g, '_')}_Abhishek_N_Resume_v${version.version_number}.pdf`;
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${safeFilename}"`
        });
        fs.createReadStream(pdfPath).pipe(res);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // 20. Download Resume DOCX
    if (pathname.startsWith('/api/resume/download/') && pathname.endsWith('/docx') && req.method === 'GET') {
      const versionId = parseInt(pathname.split('/')[4], 10);
      try {
        const version = getResumeVersionById(versionId);
        if (!version) {
          sendJson(404, { error: `Version #${versionId} not found` });
          return;
        }

        let docxPath = version.docx_path;
        if (!docxPath || !fs.existsSync(docxPath)) {
          docxPath = path.join(OUTPUT_DIR, 'resumes', `${version.job_id}_v${version.version_number}_Resume.docx`);
          await exportToDocx(version.content, docxPath);
        }

        const safeFilename = `${(version.company || 'Company').replace(/[^a-zA-Z0-9]/g, '_')}_Abhishek_N_Resume_v${version.version_number}.docx`;
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${safeFilename}"`
        });
        fs.createReadStream(docxPath).pipe(res);
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // ==========================================
    // PHASE 6: AUTOMATION ENGINE & CONTROL CENTER
    // ==========================================

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
      try {
        const parts = pathname.split('/');
        const taskKey = parts[4];
        const body = await parseBody();
        const updated = toggleTaskEnabled(taskKey, body.enabled !== undefined ? body.enabled : undefined);
        sendJson(200, { success: true, task: updated });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/automation/task/:taskKey/interval
    if (req.method === 'POST' && pathname.startsWith('/api/automation/task/') && pathname.endsWith('/interval')) {
      try {
        const parts = pathname.split('/');
        const taskKey = parts[4];
        const body = await parseBody();
        const updated = updateTaskInterval(taskKey, body.intervalMinutes);
        sendJson(200, { success: true, task: updated });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/automation/master-toggle
    if (req.method === 'POST' && pathname === '/api/automation/master-toggle') {
      try {
        const body = await parseBody();
        const paused = setMasterAutomationPause(body.paused);
        sendJson(200, { success: true, isPaused: paused });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // ==========================================
    // PHASE 6: LOCAL-FIRST BACKUP & DATA RECOVERY
    // ==========================================

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
      try {
        const body = await parseBody();
        const backupResult = backupDatabase({ label: body.label || 'manual' });
        sendJson(200, { success: true, backup: backupResult });
      } catch (e) {
        sendJson(500, { error: e.message });
      }
      return;
    }

    // POST /api/backup/restore
    if (req.method === 'POST' && pathname === '/api/backup/restore') {
      try {
        const body = await parseBody();
        if (!body.backupPath) {
          sendJson(400, { error: 'backupPath is required' });
          return;
        }
        const restoreResult = restoreDatabase({
          backupPath: body.backupPath,
          userConfirmed: body.userConfirmed === true
        });
        sendJson(200, { success: true, result: restoreResult });
      } catch (e) {
        sendJson(500, { error: e.message });
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

    // Static File Serving
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    const ext = path.extname(filePath);
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png'
    };

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      fs.createReadStream(filePath).pipe(res);
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
