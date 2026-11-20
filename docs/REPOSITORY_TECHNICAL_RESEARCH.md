# Repository Technical Research & Architecture Deep-Dive

This report details the technical investigation of six open-source career-automation, reverse-engineering, and job-search systems. We evaluate the actual code implementations, architectural patterns, schemas, tests, and security boundaries to ground our decisions for **CareerOS**.

---

## 1. REA (`morluto/rea`)

* **Primary Language:** TypeScript / Node.js
* **License:** MIT License
* **Repository:** `https://github.com/morluto/rea` | **Docs:** `https://rea.tools`
* **Package:** `rea-agents` (`v6.9.0`)

### Architectural Overview
REA acts as an MCP server and CLI coordinator that bridges AI agents to local analysis tools. It does not replace disassemblers or web inspectors; it orchestrates them and surfaces structured evidence (ASTs, symbol graphs, network request trees, database schemas) into compact agent context windows.

### Dimension-by-Dimension Analysis
* **Strongest Features:** Clean MCP tool interfaces, evidence-first output formats (every assertion is backed by a line number or memory address), local-first privacy.
* **Actual Implementation:** Distributed via npm as `rea-agents`. Tools are exposed over standard stdio using the Model Context Protocol SDK.
* **Database & API Design:** Uses local SQLite inspection routines to query and dump schema DDLs, table row samples, and relation graphs.
* **Job Discovery / Matching / Tracking:** *Not applicable* — REA is an engineering inspection tool, not a career app.
* **Browser Automation:** Leverages Chrome DevTools Protocol (CDP) and Playwright/Puppeteer hooks to inspect running web applications, dump HAR logs, and trace DOM mutations.
* **Error Handling:** Graceful fallback when optional heavy backends (Ghidra, IDA, JADX) are missing; executes web, bundle, and SQLite inspections natively.
* **Security & Privacy:** Strictly local execution. Does not phone home or transmit reverse-engineered binaries to third-party servers.
* **Maintenance & Compatibility:** High maintenance velocity (`v6.9.0`). Node.js 22+ engine requirement. Fully operable in Windows 11.

---

## 2. FreeHire (`strelov1/freehire`)

* **Primary Language:** Go (backend), SvelteKit (frontend), PostgreSQL + Meilisearch (search engine)
* **License:** MIT License
* **Repository:** `https://github.com/strelov1/freehire` | **Web:** `https://freehire.me`

### Architectural Overview
FreeHire is an open-source, developer-focused job search engine that crawls original company career portals and applicant tracking systems (Greenhouse, Lever, Workday, SmartRecruiters, Ashby) to eliminate recruiter reposts, dead listings, and ghost jobs.

### Dimension-by-Dimension Analysis
* **Strongest Features:** Open, keyless public HTTP API (`/api/v1/agent/jobs/search`), ghost-job filtering signal, direct links to company ATS application forms, comprehensive JSON schema with enrichment metadata (experience min/max, tech tags, remote mode).
* **Actual Implementation:** Go-based crawler pipelines feed into Meilisearch for ultra-low latency full-text search. Exposes an agent-optimized REST endpoint where listings include full verbatim text without truncation.
* **Database & API Design:** REST API conforming to OpenAPI 3.1.0 (`https://freehire.me/openapi.yaml`). Response format: `{ "data": [...], "meta": { "total": N } }`.
* **Job Discovery Mechanisms:** Ingests directly from public ATS XML/JSON feeds and company sitemaps. Deduplicates by company domain and normalized job title.
* **Job Matching & Ranking:** Provides client-side and API-level faceted filtering by skills, country code, work mode, and seniority.
* **Resume Generation & Application Tracking:** Focuses on discovery and saved searches. Has lightweight tracking endpoints for authenticated users, but delegates full application management to client agents.
* **Browser Automation & Email:** None in core repository; designed as an API-first backend.
* **Security & Privacy:** Public endpoints require zero credentials. Does not scrape authenticated consumer portals.
* **Maintenance & Compatibility:** Actively maintained. The public API is highly stable, responding in < 250ms with 200 OK.

---

## 3. Career-ops (`career-ops-hq/career-ops`)

* **Primary Language:** JavaScript / Node.js (ES Modules)
* **License:** MIT License
* **Repository:** `https://github.com/career-ops-hq/career-ops`

### Architectural Overview
A local-first AI job search assistant built to run inside AI coding agent CLIs (Claude Code, Codex, OpenCode). It uses lightweight local configuration files (`portals.yml`), markdown profiles (`cv.md`), and native Node SQLite to score postings, generate ATS resumes, and track progress.

### Dimension-by-Dimension Analysis
* **Strongest Features:** Zero external backend dependency, strict human-in-the-loop application gate, ATS-optimized markdown resume compiler, 1–5 scoring rubric.
* **Actual Implementation:** Script-driven pipeline (`scan.mjs`, `doctor.mjs`, `update-system.mjs`) executing inside the user's local terminal.
* **Database & API Design:** Uses built-in `node:sqlite` for local state storage without requiring native node-gyp compilation or external database servers.
* **Job Discovery Mechanisms:** Uses configured portal lists in YAML and supports pluggable local scraping scripts in Node or Python.
* **Job Matching & Ranking:** Prompt-driven scoring rubric evaluating candidate fit on a 1 to 5 scale based on skill alignment, seniority, and location constraints.
* **Resume Generation:** Compiles structured Markdown/HTML resumes tailored to specific job descriptions with ATS keyword alignment.
* **Browser Automation:** Headless Chromium via Playwright for PDF resume printing and portal scanning. Deliberately avoids automated form submission.
* **Email & Calendar:** Relies on local file notifications and user action; no automatic email sending.
* **Security & Privacy:** Exceptional. Master CV and application history never leave the user's disk except when passed to the user's chosen LLM during active execution.
* **Maintenance & Compatibility:** Built for modern Node (v22+), works out of the box on Windows 11 with Node `v24.18.0`.

---

## 4. AI Job Search (`ai-job-search-dev/ai-job-search`)

* **Primary Language:** Python & Shell / Markdown prompts
* **License:** MIT License
* **Repository:** `https://github.com/ai-job-search-dev/ai-job-search`

### Architectural Overview
An open-source AI agent workflow originally developed for Claude Code. It implements a multi-agent review loop: one agent tailors a resume and cover letter for a job description, while a secondary "reviewer agent" critiques the output for ATS keyword alignment, formatting flaws, and potential exaggerations before human presentation.

### Dimension-by-Dimension Analysis
* **Strongest Features:** Secondary reviewer agent workflow, LaTeX/HTML resume compilation, interview preparation generator based on actual applied job history.
* **Actual Implementation:** Orchestrated through CLI commands (`/scrape`, `/rank`, `/apply`, `/interview`, `/upskill`) backed by local scripts and templates.
* **Database & API Design:** CSV-backed tracker (`job_search_tracker.csv`) and generated static HTML reports.
* **Job Matching & Ranking:** Batch evaluation prompts that score postings against a structured criteria matrix.
* **Resume Generation:** LaTeX templates compiled to clean, single-page ATS-compliant PDFs.
* **Browser Automation:** Basic URL fetching and document rendering.
* **Security & Privacy:** Safe local file storage; strictly respects human approval gates before applications.
* **Maintenance & Compatibility:** Stable architecture, easily adapted to any AI agent CLI environment.

---

## 5. JOB_HUNT (`sougataphd/JOB_HUNT`) & Python Ecosystem Analysis

* **Status of Target Slug:** `sougataphd/JOB_HUNT` is currently unindexed or private on public GitHub.
* **Ecosystem Benchmark:** Evaluated against the standard Python job automation architecture (`JobSpy` / `vesaias/JobNavigator` / `feder-cr/Jobs_Applier_AI_Agent`).

### Architectural Overview of the Open-Source Python Ecosystem
Python job search tools predominantly utilize `jobspy` (a specialized scraping library that queries LinkedIn, Indeed, Glassdoor, and ZipRecruiter without API keys) coupled with pandas, SQLite, and Playwright for form submission.

### Dimension-by-Dimension Analysis
* **Strongest Features:** Broad multi-board scraping capabilities in pure Python.
* **Actual Implementation:** Scrapers use HTTP requests with rotating browser headers to parse search result pages.
* **Critical Flaws & Risks:**
  * **Fragility:** Scraping LinkedIn or Indeed HTML DOMs is prone to breakage every time platform markup updates.
  * **Terms of Service & Anti-Bot Violations:** High risk of IP blocks, Cloudflare challenges, and account bans.
  * **Over-Automation:** Many Python bots attempt blind "easy-apply" spamming, resulting in poor-quality applications, account suspensions, and mismatched submissions.
* **Takeaway for CareerOS:** **Do not adopt scraping-based Python bots for consumer platforms.** CareerOS must rely on direct, authorized ATS APIs (like FreeHire and company feeds) and assisted browser form filling with mandatory human approval.

---

## 6. JobPilot (`anthonyturner/jobpilot` / `suxrobGM/jobpilot`)

* **Status of Target Slug:** `anthonyturner/jobpilot` is not an active public repository. The dominant open-source implementation is `suxrobGM/jobpilot` (and `arthurpanhku/job-pilot`).
* **Primary Language:** TypeScript / Python / Next.js
* **License:** MIT License

### Architectural Overview
JobPilot models autonomous and semi-autonomous browser interactions where an AI agent inspects job application portals in a real browser, identifies form inputs, pre-fills candidate details, and prompts the user to verify.

### Dimension-by-Dimension Analysis
* **Strongest Features:** Interactive browser session control, DOM input detection (mapping resume fields to diverse ATS field names).
* **Actual Implementation:** Uses Playwright to connect to a Chromium instance, injecting scripts to locate form fields via heuristics (`name="email"`, `aria-label="phone"`, `type="file"`).
* **Application Tracking:** Logs application submissions into a local database upon form completion.
* **Browser Automation:** Headed browser sessions allow the user to watch the form being filled and inspect every field before submission.
* **Takeaway for CareerOS:** Highly valuable pattern for our **Module 5 (Application Form Assistant)**. Instead of blind background API submissions, CareerOS should open a visible Playwright session, pre-fill verified data, and pause for human confirmation.
