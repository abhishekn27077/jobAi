# jobAi (CareerOS): Personal AI Career Automation System

A reliable, local-first, end-to-end career assistant built specifically for **Abhishek N** to find, match, tailor applications for, track, and prepare for fresher & junior software engineering jobs in India (prioritizing Bengaluru, followed by Remote and Indian tech hubs).

---

## 🌟 Architecture & Core Principles

CareerOS is built as **one unified, dependable personal career assistant** rather than multiple disconnected bots. It enforces a strict **human-in-the-loop** safety boundary:
1. **Zero Fabrication:** Only verified data from `candidate_profile.json` (MCA 2026, AIMS Institutes, Anudip Foundation internship, NearVia, FinSight, Leave Management, Smart Rover, Aquaponics, Drowsiness Detection) is ever used.
2. **Hard Seniority Gate:** Any role demanding > 2 years experience or carrying Senior/Lead/Architect titles is automatically rejected.
3. **No Blind Submissions:** Playwright opens a visible browser and pre-fills 90% of standard fields, but **never clicks Submit**. You retain full control over final submission.
4. **Draft-Only Outbound:** Outbound recruiter replies and referral notes are generated strictly as drafts requiring your review.
5. **Canonical SQLite Vault:** One single-file local database (`career_vault.db`) powers all tracking, evaluations, and audit logs.

```
                           ┌──────────────────────────────┐
                           │   Antigravity Agent OS       │
                           └──────────────┬───────────────┘
                                          │
    ┌────────────────────────┬────────────┴───────────┬────────────────────────┐
    │                        │                        │                        │
[Discovery & Scoring]    [Dual-Agent Tailor]    [Form Assistant]      [Interview Prep & Comms]
• FreeHire Agent API     • Tailoring Agent      • Headed Chrome CDP   • STAR Question Bank
• 11.5k+ Indian jobs     • Strict Auditor Gate  • 90% DOM Auto-fill   • Project Deep Dives
• 4-Factor Rubric (0-100)• ATS Markdown/HTML    • Attached PDF Resume • Recruiter Replies
• Senior Role Rejection  • Headless PDF Render  • Human Clicks Submit • Referral Generator
    │                        │                        │                        │
    └────────────────────────┴────────────┬───────────┴────────────────────────┘
                                          │
                           ┌──────────────┴───────────────┐
                           │ Canonical Vault: SQLite DB   │
                           │   data/career_vault.db       │
                           └──────────────┬───────────────┘
                                          │
                           ┌──────────────┴───────────────┐
                           │  Interactive Local Dashboard │
                           │    http://127.0.0.1:3000     │
                           └──────────────────────────────┘
```

---

## 🚀 CLI Commands & Usage

All commands run locally with sub-second response times:

```bash
# 1. Start the interactive local dashboard
npm start
# (Opens http://localhost:3000)

# 2. Scan multi-source job pipeline (FreeHire, Lever, Ashby, Greenhouse, SmartRecruiters)
node src/cli.js scan
# Or search custom keywords:
node src/cli.js scan --query="Spring Boot Bengaluru"

# 3. List top recommended jobs in terminal
node src/cli.js list --recommended

# 4. Tailor ATS Resume & Cover Letter + Compile PDF for a job
node src/cli.js tailor <jobId>

# 5. Launch visible Chrome browser assistant to pre-fill application
node src/cli.js assist <jobId>

# 6. Generate comprehensive interview preparation dossier
node src/cli.js prep <jobId>

# 7. Run interactive terminal mock interview session
node src/cli.js mock-interview <jobId>

# 8. Verify job links & detect closed ghost postings
node src/cli.js verify-links --limit=20

# 9. Export pipeline to CSV and JSON
node src/cli.js export

# 10. Generate targeted referral outreach message
node src/cli.js referral <jobId> --type=alumni
node src/cli.js referral <jobId> --type=recruiter
node src/cli.js referral <jobId> --type=engineer

# 11. Run automated background recurring job scanner
node src/cli.js schedule --interval=24

# 12. Setup official Google OAuth integration (Gmail & Calendar)
node src/cli.js auth-gmail

# 13. Synchronize recruiter emails, calendar events & follow-up reminders
node src/cli.js sync-comms

# 14. View recent recruiter communications, interviews & reminders in terminal
node src/cli.js comms

# 15. View system & candidate status
node src/cli.js status

# 16. Test JD tailoring & ATS scoring across 6 real JD archetypes
node scripts/testRealJdTypes.js

# 17. Analyze market skill gaps vs verified candidate profile
node src/cli.js skill-gaps

# 18. View prioritized learning roadmap and record verified progress
node src/cli.js roadmap

# 19. Browse evidence-backed STAR interview story bank
node src/cli.js stories

# 20. View application funnel & rejection pattern intelligence
node src/cli.js analytics

# 21. Calculate Indian take-home pay, taxes, deductions & living savings
node src/cli.js salary --ctc=500000 --location=Bengaluru

# 22. Unified background automation engine status & telemetry
node src/cli.js automation

# 23. Manually run any automation task with error isolation & exponential backoff
node src/cli.js run-task job_discovery
node src/cli.js run-task freshness_recheck
node src/cli.js run-task reminders_check

# 24. Create point-in-time SQLite database backup snapshot
node src/cli.js backup --label=manual_snapshot

# 25. List all local snapshots in data/backups/
node src/cli.js backups

# 26. Safely restore database from backup snapshot (strict confirmation guard)
node src/cli.js restore data/backups/career_vault_backup_xxx.db --force

# 27. Run SQLite PRAGMA physical integrity and foreign key checks
node src/cli.js db-check

# 28. Export full candidate career data archive to JSON
node src/cli.js export-archive

# 29. Run the complete automated test suite (90 tests across 18 suites)
npm test
```

---

## 📊 Modules Implemented

1. **Candidate Profile (`src/profile/`):** Single source of truth loaded from verified primary documents (`data/candidate_profile.json` & `candidate_profile.md`). Supports local untracked personal profile overrides (`data/candidate_profile.local.json`) and environment variables (`CANDIDATE_PHONE`, `CANDIDATE_EMAIL`) to keep public repositories sanitized.
2. **Multi-Source Job Discovery & Pipeline Expansion (`src/discovery/`):** Unified job ingestion engine integrating 5 official/public sources without paid dependencies:
   * **Lever Public Postings API (`src/discovery/leverClient.js`):** Ingests direct corporate job boards (`api.lever.co/v0/postings/{company}?mode=json`), extracts work mode (`remote`/`hybrid`/`onsite`), employment type (`internship`/`full_time`), and requirements with `1.0` source confidence.
   * **Ashby Job Board API (`src/discovery/ashbyClient.js`):** Ingests modern tech startup boards (`api.ashbyhq.com/posting-api/job-board/{company}`), extracts compensation tiers, remote work modes, and skills.
   * **SmartRecruiters & Greenhouse Public Feeds (`src/discovery/directAtsClient.js`):** Authoritative direct corporate listings (Gloify, Taurus, Groww).
   * **FreeHire Agent API (`src/discovery/freehireClient.js`):** Live aggregator feed with over 12k Indian tech opportunities.
   * **Data Completeness & Confidence Engine (`src/discovery/jobValidator.js`):** Computes completeness scores (0.0 to 1.0) and source confidence ratings (1.0 for direct ATS, 0.85 for aggregators).
3. **Canonical URL Normalization & Deduplication (`src/discovery/urlNormalizer.js`):** Cleans tracking parameters (`utm_*`, `ref`, `gh_src`, session tokens), normalizes hostnames, and detects duplicates across sources using canonical URLs and fuzzy `company::title::city` signatures while strictly preserving existing pipeline status (`saved`, `applied`).
4. **India & Bengaluru Relevance Filtering:** Recognizes Bengaluru tech corridors (Whitefield, Bellandur, Electronic City, Koramangala, Indiranagar, HSR Layout, Manyata) standardizing them to `Bengaluru, Karnataka, India`. Prioritizes Bengaluru (20/20 location score) and Remote India (18/20), enforcing hard 0–2 years experience limits for MCA 2026 freshers.
5. **Job Matching & Ranking (`src/matcher/`):** 4-factor scoring rubric: Seniority/Fresher fit (30%), Skills match (30%), Location fit (20%), Role relevance (20%).
6. **AI Resume Studio (`src/resumes/`):** Interactive resume workbench with side-by-side editing, 3 selectable templates (`ATS Professional`, `Modern Professional`, `Compact One-Page`), dynamic Before & After diff tracking, and one-click PDF/DOCX downloads.
7. **Dual-Indicator ATS Scoring Engine (`src/resumes/atsScorer.js`):** 100-point transparent rubric decoupling **Indicator A (Resume Compatibility Score, 0–100)** from **Indicator B (Job Eligibility Assessment: `ELIGIBLE`, `POTENTIAL_STRETCH`, `MANDATORY_NOT_MET`, `INSUFFICIENT_INFO`)**. Mandatory skills (max 25) are separated from preferred skills (max 5) to prevent score inflation.
8. **Strict Truthfulness Auditor (`src/resumes/resumeGenerator.js` & `resumeVersionManager.js`):** Enforces zero fabrication with claim-level evidence verification. Blocks saving or approving resumes if unverified degrees, inflated experience, unsupported architectures, or fake metrics are detected.
9. **Multi-Provider AI Abstraction (`src/resumes/aiProvider.js`):** Modular integration supporting Google Gemini (`gemini-1.5-flash`), OpenAI (`gpt-4o-mini`), and Anthropic Claude (`claude-3-haiku-20240307`) with strict schema validation, 12-second timeouts, truthfulness checks, and automatic fallback to the deterministic engine when no API keys are configured.
10. **Dual-Agent ATS Resume & Cover Letter Generator:** Tailoring agent aligns projects, Auditor agent verifies zero fabrication, Playwright compiles ATS-optimized 1-page A4 PDFs into `output/resumes/`.
11. **Application Intelligence & Workflow Orchestrator (`src/automation/applicationWorkflow.js`):** End-to-end bridge transforming job discovery into an actionable application package:
    * Re-verifies live job freshness and fresher eligibility before initiating applications.
    * Automatically recommends the most relevant approved or tailored resume version and generates a company/JD-aligned cover letter.
    * Compiles a structured 8-point job-specific preparation checklist.
    * Enforces duplicate application prevention by maintaining canonical application records in `applications`.
12. **Portal Adapter Matrix & Form Intelligence (`src/automation/portalAdapters/`):** Dedicated modular adapter layer with transparent tier classifications:
    * **Greenhouse (`boards.greenhouse.io` — Supported):** Pre-fills standard candidate inputs, social URLs, custom question textareas, attaches tailored PDF resumes, and performs DOM read-back value verification.
    * **Lever (`jobs.lever.co` — Supported):** Pre-fills single-page application inputs, organization, portfolio/links, custom screening textareas, attaches PDF resume, and verifies DOM values.
    * **Ashby (`jobs.ashbyhq.com` — Supported):** Pre-fills modern single-page candidate forms, social profiles, and attaches PDF resumes with DOM verification.
    * **SmartRecruiters (`jobs.smartrecruiters.com` — Supported):** Pre-fills first/last names, contact details, city, and attaches PDF resume on public postings.
    * **Workday (`*.myworkdayjobs.com` — Partially Supported):** Detects candidate account creation and login walls; fills public text inputs when available; guides candidate with structured side-panel manual assist.
    * **Generic ATS / Custom Career Pages (Partially Supported):** Heuristic selector mapping for arbitrary HTML career pages with automated session-expiry and CAPTCHA challenge detection.
13. **Screening Answer Intelligence Engine (`src/automation/screeningEngine.js`):** Generates transparent screening answers derived strictly from verified facts in `data/candidate_profile.json` (India work authorization, fresher entry-level status with hands-on Java/Spring Boot experience from Anudip Foundation internship & Leave Management project, MCA 2026 / BCA 2024 from AIMS Institutes, immediate availability, Bengaluru location). Unsupported questions (e.g. 7+ years experience or unverified cloud certs) are strictly flagged (`confidence: 'unsupported'`, `requiresUserInput: true`) without fabrication. An automated `validateAnswerTruthfulness` validator rejects inflated claims, unsupported 1+ year professional experience claims, and misrepresentation of internships as full-time employment.
14. **Human Approval Gate & Safety Protections (`src/automation/formAssistant.js`):** Mandatory safety barrier requiring explicit human confirmation (`userConfirmedApproval: true`) before launching browser automation. Never clicks submit automatically, never bypasses CAPTCHA/OTP/SSO, and never signs legal declarations on behalf of the user.
15. **Application Lifecycle Tracker (`src/tracker/applicationTracker.js`):** Manages full 9-stage lifecycle states (`interested` $\rightarrow$ `preparing` $\rightarrow$ `ready_for_review` $\rightarrow$ `submitted` $\rightarrow$ `assessment` $\rightarrow$ `interview` $\rightarrow$ `rejected` $\rightarrow$ `offer` $\rightarrow$ `withdrawn`). Enforces strict gatekeeper rule blocking `submitted` transitions unless user explicitly confirms submission (`userConfirmed: true`), recording timestamped audit logs and confirmation numbers.
16. **Interactive Application Workbench Modal (`src/dashboard/`):** Dashboard UI (`http://127.0.0.1:3000`) featuring `[📝 Applications]` pipeline viewer, `[🌐 Portals]` support matrix dialog, and a modal Application Workbench for every job showing real-time freshness, recommended resume version, editable screening questions with verified evidence citations, safety warnings, and manual submission confirmation.
17. **Unified Communication & Calendar Intelligence (`src/email/`, `src/calendar/`, `src/tracker/followUpManager.js`):**
    * **Google OAuth Integration (`src/email/googleOAuthClient.js`):** Enforces minimum required scopes (`gmail.readonly`, `gmail.compose`, `calendar.events`). Implements cryptographically secure state parameters (256-bit random), PKCE S256 code challenge/verifier protection, exact redirect URI allowlist validation, AES-256-GCM authenticated token encryption at rest (`src/email/tokenEncryption.js`), automatic token refresh, seamless migration from legacy plaintext tokens, and secure disconnect wiping with user confirmation (`userConfirmed: true`). Never requests or stores the candidate's Google account password.
    * **Recruiter Email Intelligence (`src/email/recruiterEmailParser.js`):** Multi-class categorization engine recognizing 8 message categories:
      - `INTERVIEW_INVITATION`
      - `ASSESSMENT`
      - `OFFER`
      - `REJECTION`
      - `APPLICATION_ACKNOWLEDGED`
      - `RECRUITER_REQUEST`
      - `GENERAL_INQUIRY`
      - `UNCERTAIN_MANUAL_REVIEW`
      Extracts company name, job title, recruiter contact info, interview dates/times/timezones, online meeting links (Google Meet, Zoom, Microsoft Teams), assessment deadlines, requested candidate information, and explicit next actions.
    * **Profile-Grounded Communication Assistant (`src/email/communicationAssistant.js`):** Drafts tailored, professional email responses across 8 communication archetypes (`application_follow_up`, `recruiter_reply`, `interview_confirmation`, `interview_availability`, `thank_you_message`, `referral_request`, `assessment_acknowledgement`, `offer_questions`). All claims and qualifications are strictly grounded in verified profile data (Abhishek N, MCA 2026 from AIMS Institutes, Anudip Foundation, NearVia). Enforces a mandatory **Human Approval Gate** (`userConfirmedApproval: true`) before any draft is staged to Gmail or saved.
    * **Google Calendar Intelligence & Conflict Detection (`src/calendar/calendarService.js`):** Automatically extracts interview schedules, converts foreign timezones to Indian Standard Time (IST), detects scheduling overlaps against existing commitments, creates proposed calendar events, and requires explicit candidate confirmation to approve, update, or cancel calendar entries.
    * **Automated Follow-Up Reminders Manager (`src/tracker/followUpManager.js`):** Automatically schedules and tracks critical post-application milestones:
      - Application follow-up check-in (10 days post-submission)
      - Online assessment deadlines (scheduled 12h prior to cut-off)
      - Technical & STAR interview preparation (scheduled 24h prior)
      - Post-interview thank-you notes (scheduled within 24h)
    * **Incremental Email Synchronizer (`src/email/emailSyncService.js`):** Runs query-targeted incremental inbox synchronization using standard RFC `message_id` deduplication to prevent re-processing. Automatically synchronizes candidate lifecycle statuses across the database (`applications`), links new events, and logs telemetry in `email_sync_history`.
    * **Interactive Communication Hub Modal (`src/dashboard/`):** Dedicated modal with 4 interactive tabs (`📬 Recruiter Emails`, `📅 Interviews & Calendar`, `⏰ Follow-Ups`, `✍️ Pending Drafts`), live Google OAuth status badges, manual synchronization triggers, and one-click draft and calendar approval buttons.
18. **HR Contact & Referral Research (`src/networking/`):** Tailors referral outreach messages for alumni, hiring managers, and peer engineers with grounded candidate evidence.
19. **Interview Preparation & Mock Simulator (`src/interview/`):** Builds interview dossiers covering Core Java, Spring Boot, React, SQL, and project deep dives, with an interactive mock coaching evaluation system.
20. **Job Liveness & Verification Auditor (`src/matcher/jobVerifier.js`):** Performs automated link verification and ghost-job detection, accurately distinguishing between `verified_active`, `expired`, `blocked` (preserved active for manual browser inspection), `inaccessible`, and `unverified`.
21. **Pipeline Exporter (`src/tracker/vaultExporter.js`):** Generates clean, standard CSV and JSON exports (`output/career_pipeline.csv` & `career_pipeline.json`).
22. **Automated Background Scanner (`src/scheduler/dailyScanner.js`):** Runs periodic multi-source scans without user intervention.
23. **Interactive Local Dashboard (`src/dashboard/`):** Zero-dependency local web app at `http://localhost:3000` with multi-source filters (FreeHire, Lever, Ashby, SmartRecruiters, Greenhouse), location filters (Bengaluru, Remote, India), work mode dropdowns, live scan history telemetry modal, one-click document generation, and assistant launching.
24. **Career Intelligence & Growth (`src/intelligence/`):**
    * **Skill Gap Intelligence (`src/intelligence/skillGapService.js`):** Compares verified candidate skills against market demand across active fresher/junior JDs. Distinguishes Verified Strengths, Partially Demonstrated, and Missing skills. Calculates market frequency, separates mandatory demand from preferred demand, prioritizes learning roadmaps, and attaches curated tutorials and concrete mini-project ideas.
    * **Strict Verification Gatekeeper:** Enforces the absolute rule that no skill can be marked as acquired simply because it appears on a tailored resume or roadmap. Transitions to `acquired` strictly require verified proof or a project commit (minimum 10 characters).
    * **Evidence-Backed STAR Story Bank (`src/intelligence/storyBankService.js`):** 6 canonical, reusable STAR stories across academic projects (NearVia 5km PostGIS), internship (Anudip Foundation), technical challenges (PostgreSQL row-level locking), teamwork (Smart Rover with OpenCV/ESP32), problem solving (FinSight transaction categorization), and achievements (Best AI Innovation Medal at MCA graduation).
    * **Targeted Interview Intelligence (`src/intelligence/interviewIntelligence.js`):** Generates company- and role-specific technical questions (Java, Spring Boot, React, SQL), candidate project deep dives, missing skill strategy questions (Docker, Microservices), behavioral questions, and coding challenges with complete solutions.
    * **Interactive Mock Interview Simulator (`src/intelligence/mockInterviewService.js`):** Multi-round mock interview workflow evaluating relevance, technical depth, clarity, and structure. Provides constructive strengths, pro-tips, and model benchmark answers. Enforces mandatory disclaimer that automated scores are for self-coaching and not employer hiring decisions.
    * **Application Funnel & Conversion Analytics (`src/intelligence/careerAnalyticsService.js`):** Computes response rate, interview conversion rate, offer rate, and average response latency. Enforces small-sample size warning gate ($N < 10$) to prevent premature statistical conclusions.
    * **Rejection Pattern Intelligence (`src/intelligence/careerAnalyticsService.js`):** Explicitly separates known recruiter reasons from heuristic JD mismatch hypotheses, generating targeted action items.
    * **Company & Recruiter Research (`src/intelligence/companyResearchService.js`):** Synthesizes structured company profiles, verified tech stacks, standard interview processes, and legitimate recruiter contacts with distinct verification tiers (`verified_official` vs `community_reported`).
    * **Indian Salary & Offer Calculator (`src/intelligence/salaryCalculatorService.js`):** Computes net in-hand pay under official Government of India income tax rules (Finance (No. 2) Act, 2024 / Section 115BAC New Tax Regime with ₹75,000 standard deduction, Section 87A rebate of zero tax up to ₹7 LPA, marginal relief, Old Regime comparisons, and EPF/PT statutory rates). Explicitly separates CTC, fixed gross pay, variable pay, employer contributions (employer EPF + gratuity), employee deductions (employee EPF + PT + income tax TDS), and monthly/annual in-hand take-home. Discloses all calculation assumptions and non-binding estimate notices.
25. **Unified Automation Engine & Control Center (`src/scheduler/automationEngine.js`):**
    * **Configurable Background Tasks:** Orchestrates 7 independent, fully configurable background tasks:
      - `job_discovery`: Scheduled job scans across ATS feeds (Lever, Ashby, Greenhouse, SmartRecruiters) and FreeHire.
      - `freshness_recheck`: Audits saved and applied job URLs for expired or ghost postings without marking bot-challenges as closed.
      - `profile_matching`: Recalibrates compatibility matches across newly discovered vault jobs.
      - `application_status_sync`: Synchronizes application lifecycle states and notes.
      - `gmail_sync`: Performs incremental sync of recruiter communications with RFC `message_id` deduplication.
      - `reminders_check`: Sweeps overdue and upcoming interview, assessment, and follow-up reminders.
      - `weekly_report`: Synthesizes weekly pipeline health and career conversion telemetry.
    * **Robust Reliability & Concurrency Mutex:** In-memory execution lock (`runningTaskLocks`) prevents concurrent duplicate runs of the same task.
    * **Exponential Backoff Retries:** Failed tasks automatically back off with formula $\min(60\text{s} \times 2^{\text{failures}}, 1800\text{s})$ to prevent flooding external servers or APIs during rate limits or network issues.
    * **Complete Error Isolation:** Any failure in a background task is trapped, logged to `automation_runs`, and updates task health without crashing the web server or other tasks.
    * **Interactive Control Center UI (`src/dashboard/`):** Dashboard modal (`[⚙️ Automation & Backup]`) with real-time health indicators, Master Engine Pause/Resume switch, manual run triggers, per-task interval reconfiguration, and run history telemetry.
26. **Local-First Data Protection & Recovery (`src/db/backupService.js`):**
    * **Automated SQLite Snapshots:** Synchronously backs up `career_vault.db` to timestamped `.db` files in `data/backups/`.
    * **Physical Integrity Validation:** Runs SQLite `PRAGMA integrity_check` on the backup copy immediately upon creation before confirming success.
    * **Destructive Action Protection Gate:** Strict confirmation gate requires explicit user approval (`userConfirmed: true` or typing `"RESTORE"`) before restoring any snapshot to prevent accidental data loss.
    * **Database Health Diagnostics:** Runs `PRAGMA integrity_check` and `PRAGMA foreign_key_check` on demand to confirm data health.
    * **Full Career Archive Export:** One-click JSON export of candidate profile, tracked jobs, applications, communications, interview stories, and learning roadmap to `data/career_vault_export.json` with sensitive token sanitization.
27. **Windows 8GB RAM Laptop Production Profile:**
    * **Lightweight Memory Footprint:** Sub-120MB RSS memory footprint under full operation.
    * **Bounded Queries & Streaming:** Strict `LIMIT` and pagination prevents unbounded in-memory collection growth.
    * **SQLite WAL Mode:** Configured with `PRAGMA journal_mode = WAL;` and `PRAGMA busy_timeout = 5000;` for non-blocking concurrent reads and fast transactions.
    * **Local Interface Binding:** Binds strictly to `127.0.0.1` by default to prevent unwanted LAN exposure.
28. **Critical Security & Accuracy Remediation (Phase 8):**
    * **Local Dashboard API Hardening:** Removed unrestricted CORS; implemented strict Host header validation (DNS rebinding defense), same-origin validation, CSRF defenses (`Sec-Fetch-Site: cross-site` blocking), 512KB payload size limits, parameterized ID validations, path traversal guards on static/download/restore routes, and sanitized error messages.
    * **OAuth 2.0 PKCE & At-Rest Encryption:** Cryptographic state validation (single-use), PKCE S256 challenge/verifier, minimum necessary scopes (3 scopes), AES-256-GCM token encryption with machine/user-bound key derivation, automatic legacy plaintext migration, and confirmation-gated account revocation and secure file wiping.
    * **Candidate Truthfulness & Grounding:** Candidate profile strictly represents Abhishek N as an MCA 2026 fresher (0 years full-time commercial experience), Anudip Foundation as internship/practical training, and rejects any unsupported claims of 1+ year professional experience or full-time employment.
    * **Statutory Indian Salary Calculator:** Multi-year statutory verification across FY 2024–25 (Finance (No. 2) Act, 2024), FY 2025–26 (Finance Act, 2025), and FY 2026–27 (Income-tax Act, 2025 with Section 19(1) employment tax deduction and ₹12 LPA rebate threshold). Itemized separation of CTC, fixed gross, variable pay, employer contributions, employee deductions, and net in-hand take-home.
    * **Browser Automation SSRF Protection:** Prevents Playwright from accessing local network hosts, cloud metadata services (169.254.169.254), private IP ranges, or non-HTTP(S) schemes.
29. **Application Correctness & Freshness Safeguards:**
    * **Strict Application Submission Gate:** `applied_date` is not set prematurely upon preparation; stamped only after explicit user confirmation on employer portal.
    * **Job Ingestion Gate:** Rejects corrupted records at the validation gate before SQLite storage.
    * **Honest Date Preservation:** Unknown posting dates are stored honestly as `NULL` and rendered as `'Date unlisted'` (zero fake timestamp substitution).
    * **Freshness & Eligibility Safeguards:** Expired jobs and fresher-ineligible roles are hard-blocked from browser autofill.
    * **Company Research Transparency:** Zero fabrication for unknown companies (`techStack: []`, clearly labelled as unverified templates).
    * **Resilient Gmail Synchronization:** Incremental sync (`after:${epoch}`), pagination traversal (`nextPageToken`), robust base64url/multipart MIME parsing, and defensive RFC 2822 date parsing.

---

## 🛡️ Safety & Ethics Standards

* **Zero Fabrication:** All generated text is strictly audited against `data/candidate_profile.json`. Unsupported claims cause HTTP 422 blockages upon save/approval.
* **Privacy by Design:** Public repository files are sanitized of personal phone numbers and emails. Sensitive details load exclusively from untracked `.env` or `data/candidate_profile.local.json`.
* **Zero Scraper Fragility:** No fragile HTML scraping of LinkedIn or Indeed; uses direct ATS feeds and APIs.
* **Human-in-the-Loop:** Antigravity and CareerOS never submit an application or send an email without your explicit manual action.
* **Secret Protection:** Local databases (`*.db`), keys, tokens, and local profile configurations are protected via `.gitignore`.
* **Zero Automatic Emails & Silent Calendar Events:** CareerOS only creates Gmail drafts (`gmail.compose`) requiring candidate review. Never sends emails automatically, never modifies calendar events without approval, and never requests full mailbox administrative permissions.

---

## 🔐 Google OAuth Setup Guide (Gmail & Calendar)

CareerOS includes an official Google OAuth 2.0 integration designed for recruiter communication synchronization and interview scheduling.

### 1. Offline / Synthetic Testing Mode (Default)
When Google OAuth credentials are not configured, CareerOS operates safely in **Offline / Local Synthetic Mode**:
- Email parsing, classification, draft generation, calendar conflict detection, and follow-up reminders function locally with synthetic test data.
- Zero outbound network requests are made to Google services.

### 2. Connecting Live Google Services
To connect your real Gmail and Google Calendar:
1. Navigate to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or select an existing one) and enable the **Gmail API** and **Google Calendar API**.
3. Go to **APIs & Services > Credentials** and create an **OAuth 2.0 Client ID** (Application type: *Web application* or *Desktop app*).
4. Add the authorized redirect URI: `http://localhost:3000/api/oauth/callback` (or your chosen port).
5. Add your credentials to your local untracked `.env` file:
   ```env
   GOOGLE_CLIENT_ID=your_google_client_id_here
   GOOGLE_CLIENT_SECRET=your_google_client_secret_here
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/oauth/callback
   ```
6. Run the CLI auth flow or open the local dashboard:
   ```bash
   node src/cli.js auth-gmail
   # OR: Click [📬 Comms & Calendar] -> [⚙️ Google OAuth] in the web dashboard
   ```
7. Authorize the 3 minimum required scopes:
   - `https://www.googleapis.com/auth/gmail.readonly` (read recruiter emails)
   - `https://www.googleapis.com/auth/gmail.compose` (create draft replies only; cannot send directly)
   - `https://www.googleapis.com/auth/calendar.events` (read & create interview appointments)

OAuth tokens are saved locally in `data/.oauth_tokens/token.json` encrypted via AES-256-GCM (strictly excluded by `.gitignore`). Tokens auto-refresh using the refresh token, and accounts can be instantly disconnected, revoked, and wiped at any time via the dashboard or CLI with explicit confirmation.

