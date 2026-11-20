#!/usr/bin/env node

import { runJobDiscovery } from './discovery/discoveryService.js';
import { getJobs, getStats, updateJobStatus } from './tracker/jobTracker.js';
import { startDashboardServer } from './dashboard/server.js';
import { getProfileMarkdown, loadCandidateProfile } from './profile/profileManager.js';
import { exportTailoredDocumentsForJob } from './resumes/resumeGenerator.js';
import { launchFormAssistant } from './automation/formAssistant.js';
import { generateInterviewDossier } from './interview/prepService.js';
import { generateReferralMessage } from './networking/referralAssistant.js';
import { startDailyScanner } from './scheduler/dailyScanner.js';
import { verifyVaultJobs } from './matcher/jobVerifier.js';
import { exportVaultToCsv, exportVaultToJson } from './tracker/vaultExporter.js';
import { runTerminalMockSession } from './interview/mockSimulator.js';
import { extractJdRequirements } from './resumes/jdAnalyzer.js';
import { generateStudioResume } from './resumes/resumeStudioService.js';
import { saveResumeVersion } from './resumes/resumeVersionManager.js';
import { isGmailConfigured, isGmailAuthenticated, getGoogleAuthUrl, exchangeCodeForTokens } from './email/gmailOAuthClient.js';
import { getDatabase } from './db/schema.js';

const args = process.argv.slice(2);
const command = args[0] || 'help';

async function main() {
  switch (command) {
    case 'scan': {
      const queryArg = args.find(a => a.startsWith('--query='));
      const customQuery = queryArg ? queryArg.split('=')[1] : null;
      console.log('--- CareerOS: Starting Job Discovery ---');
      await runJobDiscovery({ customQuery });
      break;
    }

    case 'list': {
      const isRecommendedOnly = args.includes('--recommended');
      const jobs = getJobs({
        recommendation: isRecommendedOnly ? 'RECOMMENDED' : undefined,
        limit: 25
      });

      console.log(`\nFound ${jobs.length} jobs in vault:\n`);
      for (const j of jobs) {
        const star = '★'.repeat(j.rating) + '☆'.repeat(5 - j.rating);
        console.log(`[#${j.id}] ${j.title} @ ${j.company}`);
        console.log(`     Location: ${j.location || 'India'} | Score: ${j.score}/100 (${star}) | [${j.recommendation}]`);
        console.log(`     Why: ${j.summary_reason}`);
        console.log(`     URL: ${j.url}\n`);
      }
      break;
    }

    case 'tailor': {
      const jobId = parseInt(args[1], 10);
      if (!jobId) {
        console.error('Error: Please provide a valid job ID. Example: node src/cli.js tailor 1');
        process.exit(1);
      }
      const db = getDatabase();
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
      if (!job) {
        console.error(`Job ID #${jobId} not found in vault.`);
        process.exit(1);
      }
      console.log(`Compiling ATS Resume & Cover Letter for Job #${jobId} (${job.title} @ ${job.company})...`);
      const docs = await exportTailoredDocumentsForJob(job);
      console.log('\n✅ Documents Successfully Compiled:');
      console.log(`- Resume PDF:   ${docs.resumePdfPath}`);
      console.log(`- Resume MD:    ${docs.resumeMdPath}`);
      console.log(`- Cover Letter: ${docs.letterMdPath}\n`);
      break;
    }

    case 'studio': {
      const jobId = parseInt(args[1], 10);
      if (!jobId) {
        console.error('Error: Please provide a valid job ID. Example: node src/cli.js studio 4 --template=ats_professional');
        process.exit(1);
      }
      const tmplArg = args.find(a => a.startsWith('--template='));
      const template = tmplArg ? tmplArg.split('=')[1] : 'ats_professional';

      const db = getDatabase();
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
      if (!job) {
        console.error(`Job ID #${jobId} not found in vault.`);
        process.exit(1);
      }

      console.log(`\n======================================================`);
      console.log(`✨ CAREEROS AI RESUME STUDIO: ${job.title} @ ${job.company}`);
      console.log(`======================================================\n`);

      console.log('1. Analyzing Job Description & Extracting Requirements...');
      const jdAnalysis = extractJdRequirements(job);
      console.log(`   - Required Skills: ${(jdAnalysis.requiredSkills || []).join(', ') || 'General'}`);
      console.log(`   - Preferred Skills: ${(jdAnalysis.preferredSkills || []).join(', ') || 'None'}`);
      console.log(`   - Experience: ${jdAnalysis.experience.rawText} (${jdAnalysis.experience.isFresherEligible ? 'Fresher Eligible' : 'Senior'})`);

      console.log('\n2. Generating Tailored Resume & Computing ATS Compatibility...');
      const studioRes = await generateStudioResume(job, { jdAnalysis, template });
      const ats = studioRes.atsScore;

      console.log(`\n📊 CareerOS ATS Compatibility Estimate: ${ats.totalScore}/100`);
      console.log('--- CATEGORY BREAKDOWN ---');
      for (const [key, cat] of Object.entries(ats.categories)) {
        console.log(`* ${key}: ${cat.score}/${cat.max} — ${cat.reason}`);
      }

      console.log('\n3. Saving Version and Compiling PDF & DOCX...');
      const savedVersion = await saveResumeVersion({
        jobId: job.id,
        company: job.company,
        jobTitle: job.title,
        jdSnapshot: job.description,
        template,
        generationMode: studioRes.generationMode,
        content: studioRes.content,
        atsScore: ats.totalScore,
        atsBreakdown: ats.categories,
        missingKeywords: ats.keywordAnalysis.missingMandatory,
        matchedKeywords: ats.keywordAnalysis.matchedKeywords
      });

      console.log(`\n✅ Saved Resume Version v${savedVersion.version_number} (Record ID #${savedVersion.id}):`);
      console.log(`- PDF:  ${savedVersion.pdf_path}`);
      console.log(`- DOCX: ${savedVersion.docx_path}\n`);
      break;
    }

    case 'assist': {
      const jobId = parseInt(args[1], 10);
      if (!jobId) {
        console.error('Error: Please provide a valid job ID. Example: node src/cli.js assist 1');
        process.exit(1);
      }
      const db = getDatabase();
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
      if (!job) {
        console.error(`Job ID #${jobId} not found in vault.`);
        process.exit(1);
      }
      await launchFormAssistant(job);
      break;
    }

    case 'prep': {
      const jobId = parseInt(args[1], 10);
      if (!jobId) {
        console.error('Error: Please provide a valid job ID. Example: node src/cli.js prep 1');
        process.exit(1);
      }
      const db = getDatabase();
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
      if (!job) {
        console.error(`Job ID #${jobId} not found in vault.`);
        process.exit(1);
      }
      const d = generateInterviewDossier(job);
      console.log(`\n======================================================`);
      console.log(`INTERVIEW DOSSIER: ${d.role} @ ${d.company}`);
      console.log(`======================================================\n`);
      console.log(d.executiveSummary + '\n');
      console.log('--- TECHNICAL TOPICS ---');
      for (const t of d.technicalTopics) {
        console.log(`* ${t.topic} [${t.importance}]`);
        t.practiceQuestions.forEach(q => console.log(`  - Q: ${q}`));
      }
      console.log('\n--- PROJECT DEEP DIVES ---');
      for (const p of d.projectDeepDives) {
        console.log(`* ${p.projectName}`);
        p.likelyQuestions.forEach(q => {
          console.log(`  - Q: ${q.q}`);
          console.log(`    A: ${q.modelAnswer}`);
        });
      }
      console.log('\n--- BEHAVIORAL QUESTIONS (STAR) ---');
      for (const b of d.behavioralQuestions) {
        console.log(`* ${b.question}`);
        console.log(`  S: ${b.starFramework.situation}`);
        console.log(`  T: ${b.starFramework.task}`);
        console.log(`  A: ${b.starFramework.action}`);
        console.log(`  R: ${b.starFramework.result}\n`);
      }
      break;
    }

    case 'referral': {
      const jobId = parseInt(args[1], 10);
      if (!jobId) {
        console.error('Error: Please provide a valid job ID. Example: node src/cli.js referral 1 --type=alumni');
        process.exit(1);
      }
      const typeArg = args.find(a => a.startsWith('--type='));
      const type = typeArg ? typeArg.split('=')[1] : 'alumni';

      const db = getDatabase();
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
      if (!job) {
        console.error(`Job ID #${jobId} not found in vault.`);
        process.exit(1);
      }
      const msg = generateReferralMessage(job, type, 'Hi');
      console.log(`\n--- REFERRAL OUTREACH MESSAGE (${type.toUpperCase()}) ---`);
      console.log(`Channel: ${msg.channel}`);
      console.log(`Subject: ${msg.subject}\n`);
      console.log(msg.message);
      console.log('---------------------------------------------------------\n');
      break;
    }

    case 'status': {
      const stats = getStats();
      const profile = loadCandidateProfile();
      console.log('\n=========================================');
      console.log('       CAREEROS SYSTEM STATUS');
      console.log('=========================================');
      console.log(`Candidate: ${profile.personal.fullName} (${profile.status.currentDegree})`);
      console.log(`Target:    ${profile.status.targetLevel}`);
      console.log(`Location:  ${profile.personal.location}`);
      console.log('-----------------------------------------');
      console.log(`Total Scanned Jobs:   ${stats.totalScanned}`);
      console.log(`⭐ Recommended Jobs:  ${stats.recommended}`);
      console.log(`🔍 Consider / Review: ${stats.consider}`);
      console.log(`❌ Excluded / Senior: ${stats.rejected}`);
      console.log(`💾 Saved Pipeline:    ${stats.saved}`);
      console.log(`🚀 Applied:           ${stats.applied}`);
      console.log('=========================================\n');
      break;
    }

    case 'profile': {
      console.log(getProfileMarkdown());
      break;
    }

    case 'serve':
    case 'dashboard': {
      const portArg = args.find(a => a.startsWith('--port='));
      const port = portArg ? parseInt(portArg.split('=')[1], 10) : (process.env.PORT || 3000);
      startDashboardServer(port);
      break;
    }

    case 'schedule': {
      const intervalArg = args.find(a => a.startsWith('--interval='));
      const interval = intervalArg ? parseInt(intervalArg.split('=')[1], 10) : 24;
      console.log(`Starting automated daily scanner (interval: ${interval} hours)...`);
      startDailyScanner(interval);
      break;
    }

    case 'auth-gmail': {
      console.log('\n=========================================');
      console.log('       GMAIL OAUTH AUTHENTICATION');
      console.log('=========================================');
      if (!isGmailConfigured()) {
        console.log('Google Cloud OAuth credentials not found in environment.');
        console.log('To connect Gmail:');
        console.log('1. Go to Google Cloud Console (console.cloud.google.com)');
        console.log('2. Create an OAuth 2.0 Client ID (Web Application or Desktop)');
        console.log('3. Set redirect URI: http://localhost:3000/oauth2callback');
        console.log('4. Add GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET to .env file');
        console.log('=========================================\n');
        break;
      }

      if (isGmailAuthenticated()) {
        console.log('✅ Gmail is already authenticated! Token file exists in data/.oauth_tokens/token.json');
        console.log('=========================================\n');
        break;
      }

      const authUrl = getGoogleAuthUrl();
      console.log('\n👉 Open this URL in your browser to authorize Gmail:\n');
      console.log(authUrl);
      console.log('\nAfter granting consent, copy the authorization code from the redirect URL.');
      console.log('Then run: node src/cli.js auth-gmail --code=<YOUR_CODE>\n');

      const codeArg = args.find(a => a.startsWith('--code='));
      if (codeArg) {
        const code = codeArg.split('=')[1];
        console.log('Exchanging code for tokens...');
        await exchangeCodeForTokens(code);
        console.log('✅ Successfully connected Gmail!');
      }
      break;
    }

    case 'verify-links': {
      const limitArg = args.find(a => a.startsWith('--limit='));
      const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 20;
      await verifyVaultJobs({ limit });
      break;
    }

    case 'export': {
      console.log('--- CareerOS: Exporting Pipeline ---');
      const csv = exportVaultToCsv();
      const json = exportVaultToJson();
      console.log(`✅ Successfully exported ${csv.count} pipeline records.`);
      console.log(`- CSV:  ${csv.csvPath}`);
      console.log(`- JSON: ${json.jsonPath}\n`);
      break;
    }

    case 'mock-interview': {
      const jobId = parseInt(args[1], 10);
      if (!jobId) {
        console.error('Error: Please provide a valid job ID. Example: node src/cli.js mock-interview 1');
        process.exit(1);
      }
      const db = getDatabase();
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
      if (!job) {
        console.error(`Job ID #${jobId} not found in vault.`);
        process.exit(1);
      }
      await runTerminalMockSession(job);
      break;
    }

    case 'help':
    default: {
      console.log(`
CareerOS CLI Commands:
  node src/cli.js scan [--query="..."]            Scan FreeHire for fresher tech jobs in India
  node src/cli.js list [--recommended]            List top evaluated jobs from local vault
  node src/cli.js status                          Display candidate & pipeline statistics
  node src/cli.js profile                         Print verified candidate markdown profile
  node src/cli.js tailor <jobId>                  Generate tailored ATS Resume & Cover Letter PDF
  node src/cli.js studio <jobId> [--template=...] AI Resume Studio: JD-tailor, ATS score, PDF & DOCX export
  node src/cli.js assist <jobId>                  Launch visible Chrome Playwright form assistant
  node src/cli.js prep <jobId>                    Generate comprehensive interview prep dossier
  node src/cli.js referral <jobId> [--type=...]   Generate referral message (alumni/recruiter/engineer)
  node src/cli.js mock-interview <jobId>          Run interactive mock technical & STAR interview
  node src/cli.js verify-links [--limit=20]       Verify job links & flag closed/expired ghost postings
  node src/cli.js export                          Export full pipeline to CSV and JSON files
  node src/cli.js schedule [--interval=24]        Run automated recurring background job scanner
  node src/cli.js auth-gmail                      Setup official Gmail OAuth integration
  node src/cli.js serve [--port=3000]             Launch the interactive local dashboard
      `);
      break;
    }
  }
}

main().catch(err => {
  console.error('[Error]:', err.message);
  process.exit(1);
});
