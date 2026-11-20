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

# 2. Scan FreeHire for fresh tech listings across India
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

# 12. Setup official Gmail OAuth integration
node src/cli.js auth-gmail

# 13. View system & candidate status
node src/cli.js status

# 14. Test JD tailoring & ATS scoring across 6 real JD archetypes
node scripts/testRealJdTypes.js

# 15. Run the complete automated test suite (37 tests across 11 suites)
npm test
```

---

## 📊 Modules Implemented

1. **Candidate Profile (`src/profile/`):** Single source of truth loaded from verified primary documents (`data/candidate_profile.json` & `candidate_profile.md`). Supports local untracked personal profile overrides (`data/candidate_profile.local.json`) and environment variables (`CANDIDATE_PHONE`, `CANDIDATE_EMAIL`) to keep public repositories sanitized.
2. **Job Discovery (`src/discovery/`):** Connects to FreeHire's open agent search API (`/api/v1/agent/jobs/search`) across 9 queries in India.
3. **Job Matching & Ranking (`src/matcher/`):** 4-factor scoring rubric: Seniority/Fresher fit (30%), Skills match (30%), Location fit (20%), Role relevance (20%).
4. **AI Resume Studio (`src/resumes/`):** Interactive resume workbench with side-by-side editing, 3 selectable templates (`ATS Professional`, `Modern Professional`, `Compact One-Page`), dynamic Before & After diff tracking, and one-click PDF/DOCX downloads.
5. **Dual-Indicator ATS Scoring Engine (`src/resumes/atsScorer.js`):** 100-point transparent rubric decoupling **Indicator A (Resume Compatibility Score, 0–100)** from **Indicator B (Job Eligibility Assessment: `ELIGIBLE`, `POTENTIAL_STRETCH`, `MANDATORY_NOT_MET`, `INSUFFICIENT_INFO`)**. Mandatory skills (max 25) are separated from preferred skills (max 5) to prevent score inflation.
6. **Strict Truthfulness Auditor (`src/resumes/resumeGenerator.js` & `resumeVersionManager.js`):** Enforces zero fabrication. Blocks saving or approving resumes if unverified degrees, inflated experience, unsupported architectures (e.g. microservices), or fake metrics are detected.
7. **Multi-Provider AI Abstraction (`src/resumes/aiProvider.js`):** Modular integration supporting Google Gemini (`gemini-1.5-flash`), OpenAI (`gpt-4o-mini`), and Anthropic Claude (`claude-3-haiku-20240307`) with strict schema validation, 12-second timeouts, truthfulness checks, and automatic fallback to the deterministic engine when no API keys are configured.
8. **Dual-Agent ATS Resume & Cover Letter Generator:** Tailoring agent aligns projects, Auditor agent verifies zero fabrication, Playwright compiles ATS-optimized 1-page A4 PDFs into `output/resumes/`.
9. **Application Form Assistant (`src/automation/`):** Visible Chrome browser launcher using Playwright that fills Name, Email, Phone, LinkedIn, GitHub, City, and automatically selects the tailored PDF resume for file inputs.
10. **Application Tracker (`src/tracker/`):** Canonical SQLite vault managing lifecycle states (`discovered` $\rightarrow$ `saved` $\rightarrow$ `ready_to_apply` $\rightarrow$ `applied` $\rightarrow$ `interviewing`) and linking specific resume version IDs.
11. **Gmail Recruiter Reply Assistant (`src/email/`):** Classifies incoming recruiter updates (Interview invitation, Acknowledgment, Rejection) and drafts polite responses.
12. **HR Contact & Referral Research (`src/networking/`):** Tailors referral outreach messages for alumni, hiring managers, and peer engineers with grounded candidate evidence.
13. **Interview Preparation & Mock Simulator (`src/interview/`):** Builds interview dossiers covering Core Java, Spring Boot, React, SQL, project deep dives (NearVia PostGIS/concurrency, Leave Management, Smart Rover), and behavioral STAR questions, with an interactive mock coaching evaluation system.
14. **Ghost-Job Liveness Auditor (`src/matcher/jobVerifier.js`):** Performs automated HTTP status audits and closed-vacancy marker detection to mark stale or expired postings.
15. **Pipeline Exporter (`src/tracker/vaultExporter.js`):** Generates clean, standard CSV and JSON exports (`output/career_pipeline.csv` & `career_pipeline.json`).
16. **Automated Background Scanner (`src/scheduler/dailyScanner.js`):** Runs periodic multi-source scans without user intervention.
17. **Interactive Local Dashboard (`src/dashboard/`):** Zero-dependency local web app at `http://localhost:3000` with filtering, stats, one-click document generation, live mock interview practice modal, link verification, pipeline downloads, and assistant launching.

---

## 🛡️ Safety & Ethics Standards

* **Zero Fabrication:** All generated text is strictly audited against `data/candidate_profile.json`. Unsupported claims cause HTTP 422 blockages upon save/approval.
* **Privacy by Design:** Public repository files are sanitized of personal phone numbers and emails. Sensitive details load exclusively from untracked `.env` or `data/candidate_profile.local.json`.
* **Zero Scraper Fragility:** No fragile HTML scraping of LinkedIn or Indeed; uses direct ATS feeds and APIs.
* **Human-in-the-Loop:** Antigravity and CareerOS never submit an application or send an email without your explicit manual action.
* **Secret Protection:** Local databases (`*.db`), keys, tokens, and local profile configurations are protected via `.gitignore`.
