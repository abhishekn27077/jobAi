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
import { syncRecruiterEmails } from './email/emailSyncService.js';
import { getReminders } from './tracker/followUpManager.js';
import { getCalendarEvents } from './calendar/calendarService.js';
import { analyzeSkillGaps, getSkillRoadmap, updateSkillRoadmapItem } from './intelligence/skillGapService.js';
import { getAllStories, getStoriesByCategory, searchStories } from './intelligence/storyBankService.js';
import { getApplicationAnalytics, getRejectionAnalysis } from './intelligence/careerAnalyticsService.js';
import { calculateOfferTakeHome, compareOffers } from './intelligence/salaryCalculatorService.js';
import {
  getAutomationControlStatus,
  executeTask,
  toggleTaskEnabled,
  updateTaskInterval,
  setMasterAutomationPause
} from './scheduler/automationEngine.js';
import {
  backupDatabase,
  listBackups,
  restoreDatabase,
  runDatabaseIntegrityCheck,
  exportCandidateFullArchive
} from './db/backupService.js';
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

    case 'sync-comms': {
      console.log('\n--- CareerOS: Synchronizing Recruiter Communications & Calendar ---');
      const syncResult = await syncRecruiterEmails();
      if (!syncResult.success) {
        console.log(`Sync status: ${syncResult.error || 'Failed'}`);
        if (syncResult.requiresAuth) {
          console.log(`To connect your Google account, run: node src/cli.js auth-gmail\n`);
        }
      } else {
        console.log(`Messages found in query: ${syncResult.messagesFound}`);
        console.log(`Messages imported: ${syncResult.messagesImported}`);
        console.log(`Duplicates skipped: ${syncResult.messagesSkippedDuplicate}`);
        console.log(`Interviews detected: ${syncResult.interviewsDetected}`);
        console.log(`Assessments detected: ${syncResult.assessmentsDetected}\n`);
      }
      break;
    }

    case 'comms': {
      const db = getDatabase();
      const emails = db.prepare(`
        SELECT c.*, j.company as job_company, j.title as job_title
        FROM communications c
        LEFT JOIN jobs j ON c.job_id = j.id
        WHERE c.direction = 'incoming'
        ORDER BY c.id DESC LIMIT 10
      `).all();

      const events = getCalendarEvents({ status: null, limit: 5 });
      const reminders = getReminders({ status: 'pending', limit: 5 });

      console.log('\n📬 RECENT RECRUITER COMMUNICATIONS:');
      if (emails.length === 0) {
        console.log('   (No recruiter emails synchronized yet)');
      } else {
        emails.forEach(e => {
          console.log(`   [${e.category}] ${e.sender || 'Recruiter'} - ${e.subject}`);
          console.log(`     Next action: ${e.action_item || 'None'} | Urgency: ${e.urgency}`);
        });
      }

      console.log('\n📅 UPCOMING INTERVIEWS / EVENTS:');
      if (events.length === 0) {
        console.log('   (No scheduled interview events)');
      } else {
        events.forEach(ev => {
          console.log(`   [${ev.status.toUpperCase()}] ${ev.title} (${ev.start_time} - ${ev.end_time})`);
          if (ev.meeting_link) console.log(`     Link: ${ev.meeting_link}`);
        });
      }

      console.log('\n⏰ PENDING FOLLOW-UP REMINDERS:');
      if (reminders.length === 0) {
        console.log('   (No pending reminders)');
      } else {
        reminders.forEach(r => {
          console.log(`   [#${r.id}] ${r.title} (Due: ${r.due_date}) - ${r.notes || ''}`);
        });
      }
      console.log('');
      break;
    }

    case 'skill-gaps': {
      console.log('\n--- CareerOS: Skill Gap Intelligence ---');
      const gaps = analyzeSkillGaps({ limit: 50 });
      console.log(`Jobs Analyzed: ${gaps.totalJobsAnalyzed}`);
      console.log(`Verified Strengths: ${gaps.summary.existingCount} | Partially Demonstrated: ${gaps.summary.partialCount} | Missing Gaps: ${gaps.summary.missingCount}\n`);

      console.log('🎯 TOP HIGH-DEMAND MISSING SKILLS:');
      gaps.topGaps.forEach((g, i) => {
        console.log(`  ${i + 1}. [${g.priority.toUpperCase()}] ${g.skill.toUpperCase()} (Demand: ${g.totalDemand} JDs, ${g.marketPercentage}%)`);
        console.log(`     Category: ${g.category} | Mandatory Demand: ${g.mandatoryDemand}`);
        console.log(`     Project Idea: ${g.recommendedProject}`);
      });
      console.log('');
      break;
    }

    case 'roadmap': {
      console.log('\n--- CareerOS: Priority Learning Roadmap ---');
      const roadmap = getSkillRoadmap();
      roadmap.forEach((item, i) => {
        const badge = item.status === 'acquired' ? '✅' : item.status === 'in_progress' ? '🔄' : '⏳';
        console.log(`  ${i + 1}. ${badge} [${item.priority.toUpperCase()}] ${item.skillName.toUpperCase()} — Status: ${item.status.toUpperCase()}`);
        console.log(`     Recommended Project: ${item.recommendedProjectIdea || 'Build working prototype'}`);
        if (item.verifiedEvidence) console.log(`     Evidence: ${item.verifiedEvidence}`);
      });
      console.log('\nStrict Rule: Never mark a skill as acquired without verified proof.');
      console.log('To update: node src/cli.js roadmap-update <skill> --status=acquired --evidence="Built NearVia docker-compose"\n');
      break;
    }

    case 'roadmap-update': {
      const skill = args[1];
      if (!skill) {
        console.error('Error: Please provide a skill name. Example: node src/cli.js roadmap-update docker --status=acquired --evidence="Containerized NearVia"');
        process.exit(1);
      }
      const statusArg = args.find(a => a.startsWith('--status='));
      const evidenceArg = args.find(a => a.startsWith('--evidence='));
      const status = statusArg ? statusArg.split('=')[1] : 'in_progress';
      const evidence = evidenceArg ? evidenceArg.split('=')[1] : null;

      try {
        const updated = updateSkillRoadmapItem(skill, { status, verifiedEvidence: evidence });
        console.log(`\n✅ Updated Roadmap Item: ${updated.skillName} -> ${updated.status}`);
        if (updated.verifiedEvidence) console.log(`Evidence Recorded: ${updated.verifiedEvidence}\n`);
      } catch (err) {
        console.error(`\n❌ Error: ${err.message}\n`);
        process.exit(1);
      }
      break;
    }

    case 'stories': {
      console.log('\n--- CareerOS: STAR Interview Story Bank ---');
      const queryArg = args.find(a => a.startsWith('--query='));
      const catArg = args.find(a => a.startsWith('--category='));
      const query = queryArg ? queryArg.split('=')[1] : null;
      const cat = catArg ? catArg.split('=')[1] : null;

      let stories = [];
      if (query) stories = searchStories(query);
      else if (cat) stories = getStoriesByCategory(cat);
      else stories = getAllStories();

      stories.forEach((s, idx) => {
        console.log(`\n[Story ${idx + 1}] "${s.title}" (${s.contextSource})`);
        console.log(`Category: ${s.category} | Tech: ${s.technologies}`);
        console.log(`  S (Situation): ${s.situation}`);
        console.log(`  T (Task):      ${s.task}`);
        console.log(`  A (Action):    ${s.action}`);
        console.log(`  R (Result):    ${s.result}`);
        if (s.applicableQuestions?.length > 0) {
          console.log(`  Target Qs:     ${s.applicableQuestions[0]}`);
        }
      });
      console.log('');
      break;
    }

    case 'analytics': {
      console.log('\n--- CareerOS: Application Funnel & Rejection Intelligence ---');
      const analytics = getApplicationAnalytics();
      const rejections = getRejectionAnalysis();

      console.log(`Total Applications: ${analytics.totalApplications} | Submitted: ${analytics.totalSubmitted}`);
      if (analytics.hasSmallSampleWarning) {
        console.log(`⚠️  ${analytics.smallSampleWarning}`);
      }
      console.log(`\n📊 Conversion Metrics:`);
      console.log(`  Response Rate:            ${analytics.metrics.responseRatePct}%`);
      console.log(`  Interview Conversion:     ${analytics.metrics.interviewConversionRatePct}%`);
      console.log(`  Offer Rate:               ${analytics.metrics.offerRatePct}%`);
      if (analytics.metrics.averageResponseDays !== null) {
        console.log(`  Avg Response Time:        ${analytics.metrics.averageResponseDays} days`);
      }

      console.log(`\n🛑 Rejection Pattern Breakdown:`);
      console.log(`  Known (Explicit Recruiter Reason): ${rejections.knownRejectionsCount}`);
      console.log(`  Inferred Hypotheses:               ${rejections.inferredPossibilitiesCount}`);
      if (rejections.topRepeatedGaps.length > 0) {
        console.log(`  Top Repeated Skill Gaps in JDs:`);
        rejections.topRepeatedGaps.forEach(g => console.log(`    - ${g.skill.toUpperCase()}: ${g.count} time(s)`));
      }
      console.log(`\n💡 Recommended Action Items:`);
      rejections.actionRecommendations.forEach(r => console.log(`  • ${r}`));
      console.log('');
      break;
    }

    case 'salary': {
      const ctcArg = args.find(a => a.startsWith('--ctc='));
      const locArg = args.find(a => a.startsWith('--location='));
      const modeArg = args.find(a => a.startsWith('--mode='));
      const ctc = ctcArg ? parseInt(ctcArg.split('=')[1], 10) : 450000;
      const location = locArg ? locArg.split('=')[1] : 'Bengaluru';
      const mode = modeArg ? modeArg.split('=')[1] : 'onsite';

      console.log(`\n--- CareerOS: Indian Salary & Take-Home Calculator ---`);
      const calc = calculateOfferTakeHome({ ctcAnnual: ctc, location, workMode: mode });

      const fixedAmount = calc.fixedGrossAnnual ?? calc.fixedPayAnnual ?? calc.ctcAnnual;
      console.log(`Annual CTC:                  ₹${calc.ctcAnnual.toLocaleString('en-IN')}`);
      console.log(`Fixed Compensation:          ₹${fixedAmount.toLocaleString('en-IN')}/year`);
      console.log(`Work Location & Mode:        ${calc.location} (${calc.workMode.toUpperCase()})`);
      console.log(`------------------------------------------------------`);
      console.log(`Monthly Gross Pay:           ₹${calc.monthlyBreakdown.grossPay.toLocaleString('en-IN')}`);
      console.log(`  - EPF (Provident Fund):    ₹${calc.monthlyBreakdown.epfDeduction.toLocaleString('en-IN')}`);
      console.log(`  - Professional Tax:        ₹${calc.monthlyBreakdown.professionalTax.toLocaleString('en-IN')}`);
      console.log(`  - Income Tax (TDS est):    ₹${calc.monthlyBreakdown.incomeTaxTds.toLocaleString('en-IN')}`);
      console.log(`Estimated Monthly In-Hand:   ₹${calc.monthlyBreakdown.netInHand.toLocaleString('en-IN')}`);
      console.log(`Est. Living Expenses:        ₹${calc.costOfLiving.estimatedMonthlyExpense.toLocaleString('en-IN')}/mo`);
      console.log(`Est. Net Monthly Savings:    ₹${calc.costOfLiving.estimatedNetMonthlySavings.toLocaleString('en-IN')}/mo`);
      console.log(`------------------------------------------------------`);
      console.log(`Assumptions & Disclaimers:`);
      calc.assumptions.forEach(a => console.log(`  • ${a}`));
      console.log(`\n${calc.disclaimer}\n`);
      break;
    }

    case 'automation': {
      console.log(`\n======================================================`);
      console.log(`⚙️ CAREEROS UNIFIED AUTOMATION ENGINE`);
      console.log(`======================================================\n`);

      const status = getAutomationControlStatus();
      const executing = status.health?.currentlyExecuting || status.runningLocks || [];
      console.log(`Master Engine Status: ${status.isEnginePaused ? '⏸️ PAUSED' : '⚡ ACTIVE'}`);
      console.log(`Running Locks:        ${executing.length > 0 ? executing.join(', ') : 'None (Idle)'}\n`);

      console.log('--- SCHEDULED AUTOMATION TASKS ---');
      status.tasks.forEach(t => {
        const isEnabled = t.isEnabled ?? Boolean(t.is_enabled);
        const flag = isEnabled ? '🟢 ENABLED' : '⚪ DISABLED';
        const failCount = t.consecutiveFailures ?? t.failure_count ?? 0;
        const failText = failCount > 0 ? ` (⚠️ ${failCount} failures)` : '';
        const taskKey = t.taskKey || t.task_key;
        const taskName = t.name || t.task_name;
        const interval = t.intervalMinutes ?? t.interval_minutes;
        const nextRun = t.nextRunAt || t.next_run_at || 'Pending';
        const lastRun = t.lastRunAt || t.last_run_at || 'Never';
        const lastStatus = t.lastStatus || t.last_status || 'IDLE';
        const lastError = t.lastError || t.last_error;

        console.log(`• [${taskKey}] - ${taskName} [${flag}]${failText}`);
        console.log(`    Interval: Every ${interval} mins | Next: ${nextRun}`);
        console.log(`    Last Run: ${lastRun} [${lastStatus}]`);
        if (lastError) console.log(`    Last Error: ${lastError}`);
      });

      if (status.recentRuns && status.recentRuns.length > 0) {
        console.log('\n--- RECENT RUN TELEMETRY (Last 5) ---');
        status.recentRuns.slice(0, 5).forEach(r => {
          const key = r.taskKey || r.task_key;
          const dur = r.durationMs ?? r.duration_ms ?? 0;
          const started = r.startedAt || r.started_at;
          const err = r.errorMessage || r.error_message;
          console.log(`  [${r.status}] ${key} (${dur}ms) at ${started}`);
          if (err) console.log(`      Error: ${err}`);
        });
      }
      console.log('');
      break;
    }

    case 'run-task': {
      const taskKey = args[1];
      if (!taskKey) {
        console.error('Error: Please provide a task key. Example: node src/cli.js run-task job_discovery');
        process.exit(1);
      }
      console.log(`Executing background task [${taskKey}] manually...`);
      const result = await executeTask(taskKey, { manualTrigger: true });
      console.log(`\n✅ Task Execution Complete: [${result.status}] in ${result.durationMs}ms`);
      if (result.summary) console.log('Summary:', JSON.stringify(result.summary, null, 2));
      if (result.error) console.log('Error:', result.error);
      break;
    }

    case 'backup': {
      const labelArg = args.find(a => a.startsWith('--label='));
      const label = labelArg ? labelArg.split('=')[1] : 'cli_manual';
      console.log(`Creating SQLite database backup snapshot (label: ${label})...`);
      const res = backupDatabase({ label });
      console.log(`\n✅ Database Backup Succeeded:`);
      console.log(`- Path:      ${res.backupPath}`);
      console.log(`- Size:      ${(res.sizeBytes / 1024).toFixed(1)} KB`);
      console.log(`- Timestamp: ${res.timestamp}\n`);
      break;
    }

    case 'backups': {
      const list = listBackups();
      console.log(`\nFound ${list.length} snapshots in data/backups/:\n`);
      list.forEach(b => {
        const sizeBytes = b.sizeBytes ?? b.size_bytes ?? 0;
        const createdAt = b.createdAt ?? b.created_at ?? 'Recent';
        const label = b.label || 'snapshot';
        console.log(`• ${b.filename} (${(sizeBytes / 1024).toFixed(1)} KB) - ${createdAt} [${label}]`);
      });
      console.log('');
      break;
    }

    case 'restore': {
      const backupPath = args[1];
      const force = args.includes('--force');
      if (!backupPath) {
        console.error('Error: Please provide backup file path. Example: node src/cli.js restore data/backups/careeros_backup_xxx.db --force');
        process.exit(1);
      }
      if (!force) {
        console.error('Safety Guard: Restoring will overwrite the current database. Pass --force to confirm.');
        process.exit(1);
      }
      console.log(`Restoring database from ${backupPath}...`);
      const res = restoreDatabase({ backupPath, userConfirmed: true });
      console.log(`\n✅ Database Restored Successfully:`);
      console.log(`- Source:   ${res.restoredFrom}`);
      console.log(`- Restored: ${res.restoredTo}`);
      console.log(`- Time:     ${res.timestamp}\n`);
      break;
    }

    case 'db-check': {
      console.log('Running SQLite PRAGMA integrity and foreign key checks...');
      const check = runDatabaseIntegrityCheck();
      const isPass = Boolean(check.isHealthy ?? check.ok ?? (check.integrityStatus === 'ok'));
      console.log(`\nResult: ${isPass ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`Integrity Status: ${check.integrityStatus || (isPass ? 'ok' : 'unknown')}`);
      if (check.foreignKeyViolations && check.foreignKeyViolations.length > 0) {
        console.log(`Foreign Key Violations: ${check.foreignKeyViolations.length}`);
      } else {
        console.log(`Foreign Key Violations: 0 (clean)`);
      }
      if (check.diagnostics) {
        console.log(`Diagnostics: Jobs=${check.diagnostics.totalJobs}, Applications=${check.diagnostics.totalApplications}, Comms=${check.diagnostics.totalCommunications}`);
      }
      console.log('');
      break;
    }

    case 'export-archive': {
      console.log('Exporting full candidate career data archive to JSON...');
      const archive = exportCandidateFullArchive();
      console.log(`\n✅ Candidate Data Archive Exported:`);
      console.log(`- Export Path:      ${archive.outputPath || archive.exportPath || 'data/career_vault_export.json'}`);
      console.log(`- Records Exported: ${archive.totalApplications ?? 0} applications, ${archive.totalSkillsRoadmapped ?? 0} roadmapped skills`);
      console.log(`- Success:          ${archive.success ? 'YES' : 'NO'}\n`);
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
  node src/cli.js auth-gmail                      Setup official Google OAuth integration (Gmail & Calendar)
  node src/cli.js sync-comms                      Synchronize recruiter emails, calendar events & reminders
  node src/cli.js comms                           View recent recruiter emails, interviews & reminders
  node src/cli.js skill-gaps                      Analyze market skill demand vs candidate profile
  node src/cli.js roadmap                         View prioritized learning roadmap and progress
  node src/cli.js stories [--query="..."]         Browse STAR interview story bank
  node src/cli.js analytics                       View application funnel & rejection pattern intelligence
  node src/cli.js salary [--ctc=450000]           Estimate Indian take-home pay, taxes & savings
  node src/cli.js automation                      View automation engine tasks, backoff and telemetry
  node src/cli.js run-task <key>                  Execute background task manually with error handling
  node src/cli.js backup [--label=...]            Create point-in-time SQLite snapshot in data/backups/
  node src/cli.js backups                         List all local database snapshots
  node src/cli.js restore <path> --force          Safely restore database from snapshot
  node src/cli.js db-check                        Execute PRAGMA integrity and foreign key validation
  node src/cli.js export-archive                  Export complete candidate career data archive to JSON
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
