# CareerOS Architecture Recommendations & Implementation Roadmap

Based on the empirical evaluation of REA, FreeHire, Career-ops, AI Job Search, and JobPilot, this document establishes the concrete architectural blueprints and prioritized recommendations for evolving **CareerOS** into an enterprise-grade personal career assistant.

---

## 1. Job Discovery & Multi-Source Ingestion

### Research Finding
Relying on HTML web scraping of commercial job boards (LinkedIn, Indeed) creates high fragility, IP rate limits, and risk of account termination. FreeHire's model of aggregating structured ATS data directly from source company career portals provides clean, reliable, and legal listings.

### CareerOS Recommendation
* **Primary Source:** Maintain the **FreeHire Agent Search API** (`/api/v1/agent/jobs/search`) as the high-volume discovery pipeline.
* **Secondary Direct Ingestion:** Add lightweight XML/JSON readers for direct corporate ATS endpoints:
  * Greenhouse public feeds: `https://boards-api.greenhouse.io/v1/boards/{company}/jobs`
  * Lever public feeds: `https://api.lever.co/v0/postings/{company}`
  * Ashby public feeds: `https://jobs.ashbyhq.com/api/non-search-graphql`
* **Zero Web Scraping:** Strictly avoid automated HTML scraping of LinkedIn or Naukri. Instead, accept inbound job alert links or emails parsed through the candidate's approved Gmail inbox.

---

## 2. Duplicate Detection & Canonical Identity

### Research Finding
Job postings are frequently reposted across multiple platforms under slightly different URLs, titles, or tracking query parameters (e.g., `utm_source`, referral IDs).

### CareerOS Recommendation
Implement a 3-tier canonical deduplication pipeline before database insertion:
1. **URL Normalization:** Strip all query parameters (`utm_*`, `ref`, `source`, tracking tokens) and resolve redirects to the root career portal URL.
2. **Deterministic Hash:** Compute an MD5/SHA256 signature over:
   $$\text{Hash} = \text{SHA256}(\text{normalized\_company} + \text{"::"} + \text{normalized\_title} + \text{"::"} + \text{normalized\_location})$$
3. **Fuzzy Levenshtein / Jaccard Window:** For roles from the same company posted within 7 days, if title token similarity > 85%, link as an update rather than creating a duplicate entry.

---

## 3. Job Freshness & Ghost-Job Detection

### Research Finding
A major source of wasted candidate effort is applying to "ghost jobs" (expired postings left open by automated HR systems or crawler archives).

### CareerOS Recommendation
1. **HTTP Head / GET Probe:** Before preparing a tailored application or presenting a job in the priority queue, execute an automated asynchronous `HEAD` or fast `GET` check on the original URL to confirm:
   * HTTP 200 OK (not 404 Not Found or 301 redirecting to a generic careers homepage).
   * Absence of DOM markers like `"This position has been filled"`, `"Job is no longer available"`, or `"Closed"`.
2. **Aging Decay Function:** Apply an exponential freshness penalty to the fit score for jobs posted > 21 days ago without recent crawler refresh:
   $$\text{FreshnessPenalty} = \max(0, (\text{DaysActive} - 21) \times 1.5)$$

---

## 4. Eligibility & Multi-Factor Matching Engine

### Research Finding
Keyword-only matching produces catastrophic false positives (e.g., matching a Fresher to a "Staff Architect" because both mention "Java" and "Spring Boot").

### CareerOS Recommendation
Maintain our deterministic 4-factor scoring rubric with tightened semantic checks:
1. **Hard Fresher Gate (Prerequisite):**
   * If detected minimum experience $> 2$ years, or title contains `Senior`, `Lead`, `Principal`, `Architect`, `Staff`, `Manager` $\rightarrow$ **Immediate REJECT** (Score capped at 0, Recommendation = `REJECTED`).
2. **Skills Alignment (Weight 30):**
   * Prioritize verified core skills: Java, Spring Boot, React, MySQL, PostgreSQL, REST APIs.
   * Compare against candidate's primary projects (NearVia, FinSight, Leave Management).
3. **Location Weighting (Weight 20):**
   * Bengaluru: 20 pts (Top candidate preference).
   * Remote (India): 18 pts.
   * Other Tier-1 Indian hubs (Hyderabad, Pune, Chennai): 14 pts.
4. **Role Relevance (Weight 20):**
   * Java / Full Stack / Spring Boot Developer: 20 pts.
   * Graduate Engineer Trainee (GET) / Software Trainee: 18 pts.
   * Python / AI Application Developer: 16 pts.

---

## 5. ATS Resume & Cover Letter Tailoring (Stage 2 Architecture)

### Research Finding
AI Job Search proves that single-pass LLM prompts often exaggerate candidate achievements. Implementing a **Dual-Agent Review Loop** eliminates hallucinations.

### CareerOS Recommendation
```
                 ┌────────────────────────────────┐
                 │     Job Description Text       │
                 └──────────────┬─────────────────┘
                                │
                 ┌──────────────▼─────────────────┐
                 │    Master Candidate Profile    │
                 │    (candidate_profile.json)    │
                 └──────────────┬─────────────────┘
                                │
                 ┌──────────────▼─────────────────┐
                 │     Agent 1: ATS Tailor        │
                 │ • Reorders relevant projects   │
                 │ • Aligns keywords (truthfully) │
                 │ • Drafts ATS Markdown Resume   │
                 └──────────────┬─────────────────┘
                                │
                 ┌──────────────▼─────────────────┐
                 │    Agent 2: Strict Auditor     │
                 │ • Verifies facts vs Profile    │
                 │ • Flags exaggerated dates/tech │
                 │ • Enforces ATS 1-page bounds   │
                 └──────────────┬─────────────────┘
                                │ (Pass)
                 ┌──────────────▼─────────────────┐
                 │    Headless Playwright Render  │
                 │    Outputs ATS-Optimized PDF   │
                 └────────────────────────────────┘
```

* **No Fabrication Rule:** The generator is strictly forbidden from introducing companies, dates, or skills not explicitly declared in `candidate_profile.json`.

---

## 6. Browser Form Assistant (Playwright Human-in-the-Loop)

### Research Finding
JobPilot demonstrates that headless auto-submitting fails on custom dropdowns, file uploads, and CAPTCHAs. A **headed browser assistant** provides massive productivity gains while keeping the user 100% in control.

### CareerOS Recommendation
* **Module Architecture:** When Abhishek clicks `"⚡ Assist Application"` on a saved job card:
  1. Playwright launches Google Chrome in **visible (headed)** mode at the application URL.
  2. The assistant injects verified candidate metadata into standard fields:
     * Full Name, First/Last Name
     * Email, Phone (+91-XXXXXXXXXX), Location (Bangalore)
     * LinkedIn, GitHub, Portfolio (nearvia.app)
     * Highest Education (MCA, AIMS Institutes, 2026)
  3. Pre-selects the tailored PDF resume file for the file upload input.
  4. **The Assistant Stops:** It highlights custom question fields for Abhishek to review and **never clicks the final Submit button**. Abhishek reviews the inputs and completes the submission manually.

---

## 7. Email & Communication Pipeline (Stage 3 Architecture)

### Research Finding
Application tracking without email synchronization requires tedious manual updates. Official Gmail OAuth2 allows reading recruiter status updates safely without exposing passwords.

### CareerOS Recommendation
* **Read Mechanism:** Query Gmail periodically for approved sender domains (`@greenhouse.io`, `@lever.co`, `@myworkday.com`, `@smartrecruiters.com`) and keywords (`"application received"`, `"invitation to interview"`, `"status of your application"`).
* **Automatic Pipeline Progression:** Update job status from `applied` to `interviewing` or `rejected` based on verified recruiter response patterns.
* **Drafts-Only Outbound:** When assisting with recruiter replies or follow-up notes, the system **only creates drafts in Gmail**. No email is ever dispatched automatically.

---

## 8. Database Architecture & State Machine

### CareerOS Canonical State Machine
The canonical SQLite database (`career_vault.db`) enforces a single valid lifecycle for every tracked job:

```
[Discovered] ──► [Saved] ──► [Tailoring / Ready] ──► [Applied] ──► [Interviewing] ──► [Offer]
     │              │                                     │              │
     ▼              ▼                                     ▼              ▼
[Dismissed]    [Dismissed]                           [Rejected]     [Rejected]
```

### Relational Table Design
* `jobs`: Normalized listing metadata, URLs, salary, and current lifecycle state.
* `job_evaluations`: Score breakdown, match reasons, missing skills, and fresher eligibility flag.
* `applications`: Application timestamp, tailored resume version used, portal type, and user approval record.
* `communications`: Email message IDs, thread status, inbound recruiter text, and approved outgoing drafts.
* `interviews`: Scheduled rounds (HR, Tech 1, System Design), meeting links, prep notes, and feedback.
* `activity_audit_log`: Append-only audit trail logging every automated scan and user decision.

---

## 9. Priority Implementation Roadmap

| Phase | Module / Capability | Dependencies | Human Gate Required | Target Timing |
| :---: | :--- | :--- | :---: | :---: |
| **Phase 1 (Completed)** | Verified Profile, FreeHire Discovery, SQLite Vault, Scoring Engine, CLI, Local Dashboard | Node.js 24 (`node:sqlite`) | None | **Done** |
| **Phase 2 (Next)** | ATS Resume Tailor + Headed Playwright Application Form Assistant | `playwright`, Chromium | **Yes** (Human clicks Submit) | Stage 2 |
| **Phase 3** | Gmail OAuth2 Inbound Tracking + Recruiter Draft Assistant | Google Cloud OAuth2 | **Yes** (Human sends emails) | Stage 3 |
| **Phase 4** | Mock Interview Simulator (STAR Method) + Calendar Sync | Node.js CLI / Audio | **Yes** (Human confirms times) | Stage 4 |
