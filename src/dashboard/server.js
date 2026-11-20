import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJobs, updateJobStatus, getStats } from '../tracker/jobTracker.js';
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
        const minScore = parseInt(parsedUrl.searchParams.get('minScore') || '0', 10);
        const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
        const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);

        const jobs = getJobs({ status, recommendation, minScore, limit, offset });
        sendJson(200, { jobs });
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

    // 3. Launch Headed Playwright Form Assistant
    if (pathname.startsWith('/api/job/') && pathname.endsWith('/assist') && req.method === 'POST') {
      const jobId = parseInt(pathname.split('/')[3], 10);
      try {
        const db = getDatabase();
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        if (!job) {
          sendJson(404, { error: `Job with ID ${jobId} not found` });
          return;
        }

        // Launch in background so HTTP response returns promptly
        launchFormAssistant(job).catch(err => {
          console.error('[Form Assistant Launch Error]:', err.message);
        });

        sendJson(200, {
          success: true,
          message: `Visible Chrome browser is launching for ${job.title} @ ${job.company}. Please review pre-filled fields and submit manually.`
        });
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

  server.listen(port, host, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 CareerOS Dashboard Live at http://${host}:${port}`);
    console.log(`======================================================\n`);
  });

  return server;
}
