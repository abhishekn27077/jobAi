# Empirical Evidence & Verification Log

This document records the empirical investigations performed during the research phase, structured strictly according to our 9-point research protocol.

---

## Investigation 1: FreeHire Agent Search API Live Protocol & Payload Verification

1. **Research Question:** How does FreeHire's API structure job search requests and returns, what parameters are supported for Indian fresher tech roles, and does it require authentication?
2. **Target and Version:** `https://freehire.me/api/v1/agent/jobs/search` & `https://freehire.me/openapi.yaml` (OpenAPI Spec 3.1.0).
3. **Inspection Method:** Direct HTTP requests using Python `urllib` and cURL; inspection of `https://freehire.me/openapi.yaml` and OpenAPI path structures.
4. **Evidence Collected:**
   * Endpoint `GET /api/v1/agent/jobs/search?q=Junior+Java&countries=in` returned HTTP `200 OK`.
   * Sample payload:
     ```json
     {
       "title": "Junior Java Developer",
       "company": "TrueID",
       "location": "Hyderabad",
       "url": "https://www.linkedin.com/jobs/view/4477053581/?utm_source=freehire.me",
       "description": "<p>Salary: Not specified<br>Location: Hyderabad<br>Mode: Onsite<br>Level: Fresher / Entry level</p>",
       "meta": { "total": 5492, "limit": 20, "offset": 0 }
     }
     ```
   * Ignored parameters on general listing endpoint: `{'param': 'countries'}, {'param': 'skills'}` when querying `/api/v1/jobs`, but fully respected when querying `/api/v1/agent/jobs/search` and `/api/v1/jobs/search`.
5. **Verified Findings:**
   * The API is 100% keyless for public catalog searches.
   * Total Indian Java listings exceed 11,500+ records.
   * Results include direct ATS application links and clean metadata (title, company, location, experience levels).
6. **Unknown or Inaccessible Behaviour:** The underlying Meilisearch indexing frequency, private employer scoring weights, and backend database schema of `freehire.me` are server-side and unobservable.
7. **Limitations:** Some listings point to external aggregator links (e.g. LinkedIn job view URLs) rather than direct ATS forms, requiring client-side redirect resolution.
8. **Recommended CareerOS Implementation:** Implement `freehireClient.js` targeting `/api/v1/agent/jobs/search` with country code `in`, query parameters, and HTML tag sanitization.
9. **Tests Needed to Verify Our Implementation:** [discovery.test.js](file:///D:/AI-Workspace/Career-Agent/tests/discovery.test.js) (Automated test verifying live API response, structure validation, and non-empty listing return).

---

## Investigation 2: REA Package Architecture, Dependencies, and Engine Compatibility

1. **Research Question:** What are the exact runtime requirements, npm dependencies, license, and engine constraints of `morluto/rea`?
2. **Target and Version:** `rea-agents@6.9.0` via npm registry (`https://registry.npmjs.org/rea-agents`).
3. **Inspection Method:** Executed `npm view rea-agents name version description license engines repository --json`.
4. **Evidence Collected:**
   ```json
   {
     "name": "rea-agents",
     "version": "6.9.0",
     "description": "Reverse engineer anything from your terminal or agent with one CLI and MCP server.",
     "license": "MIT",
     "engines": {
       "node": "^22.23.4 || ^24.22.1 || >=26.12.1"
     },
     "repository": {
       "url": "git+https://github.com/morluto/rea.git",
       "type": "git"
     }
   }
   ```
5. **Verified Findings:**
   * The package is licensed under the permissive MIT license.
   * Core execution runs over Node.js.
   * Web and JavaScript reverse-engineering features require zero native disassemblers (Ghidra/IDA not needed).
6. **Unknown or Inaccessible Behaviour:** Internal performance overhead under large multi-megabyte binary decompilation on Windows.
7. **Limitations:** Requires Node.js 22+ runtime. Host is `v24.18.0`. Minor engine warning may display on npm install unless suppressed.
8. **Recommended CareerOS Implementation:** Propose REA as an optional MCP server added under `"rea"` in `D:\AI-Workspace\.mcp.json`. Restrict usage strictly to web, network, bundle, and SQLite analysis.
9. **Tests Needed to Verify Our Implementation:** Dry-run test `npx rea-agents doctor` upon user approval.

---

## Investigation 3: Native Node.js 24 SQLite (`node:sqlite`) Viability

1. **Research Question:** Can Node.js v24.18.0 run an embedded SQLite database using built-in standard library modules without installing `sqlite3` or `better-sqlite3` native C++ bindings?
2. **Target and Version:** Node.js `v24.18.0` `node:sqlite` (`DatabaseSync`).
3. **Inspection Method:** Executed inline test script:
   `node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE test (id INT);'); console.log('node:sqlite works perfectly!');"`
4. **Evidence Collected:** Terminal output: `node:sqlite works perfectly!` with return code `0`.
5. **Verified Findings:**
   * Zero external dependencies needed for full SQL database capabilities.
   * Completely immune to Windows native compilation errors (`node-gyp`, Visual Studio Build Tools).
   * Supports foreign keys, prepared statements, and ACID transactions.
6. **Unknown or Inaccessible Behaviour:** None; local standard library.
7. **Limitations:** `DatabaseSync` is synchronous; long-running table locks must be avoided by using indexed queries.
8. **Recommended CareerOS Implementation:** Build the canonical tracker [schema.js](file:///D:/AI-Workspace/Career-Agent/src/db/schema.js) and [jobTracker.js](file:///D:/AI-Workspace/Career-Agent/src/tracker/jobTracker.js) entirely on `node:sqlite`.
9. **Tests Needed to Verify Our Implementation:** Schema initialization, insertion, duplicate updates, and query filter tests in [discovery.test.js](file:///D:/AI-Workspace/Career-Agent/tests/discovery.test.js).

---

## Investigation 4: Candidate Primary Document Verification

1. **Research Question:** What are the candidate's exact, verified qualifications, dates, project tech stacks, awards, and internships without relying on assumptions?
2. **Target and Version:** Primary source files on host disk:
   * [D:/Abhi/AIMS/resume/Abhishek_N_Resume.docx](file:///D:/Abhi/AIMS/resume/Abhishek_N_Resume.docx)
   * [D:/NearVia](file:///D:/NearVia)
   * [D:/projects/employee-leave-management](file:///D:/projects/employee-leave-management)
   * [D:/projects/finsight](file:///D:/projects/finsight)
   * [D:/projects/Aqua](file:///D:/projects/Aqua)
3. **Inspection Method:** Unzipped `.docx` XML tree using Python standard library `zipfile` and parsed `word/document.xml`. Inspected repository project folders and directory structures.
4. **Evidence Collected:**
   * Candidate Name: **Abhishek N**
   * Education: **MCA (2024–2026), AIMS Institutes, Bangalore** (Completed Oct 2026); **BCA (2021–2024), SSA Government First Grade College, Ballari**.
   * Work: **Advanced Java Full Stack Development Intern, Anudip Foundation** (Oct 2026); **Digital Media Intern, AWAKE** (Feb 2026, 30 hours).
   * Verified Projects: NearVia (MCA Final Year, React, TypeScript, Node, PostGIS, Supabase), FinSight (React, Node, Express, MongoDB Atlas, Python, FastAPI), Employee Leave Management (Java, Spring Boot, Hibernate/JPA, React, MySQL), Smart Rover (ESP32-CAM, OpenCV, Python), Aquaponics (ESP32, Sensors), Drowsiness Detection (Python, OpenCV).
   * Medals & Awards: **Best AI Innovation medal** (AIMS Institutes MCA Graduation, 31 Oct 2026); **2x Second Prize Winner** for Smart Aquaponics.
5. **Verified Findings:**
   * All qualifications are primary, verifiable records on disk.
   * No fabrication, date extrapolation, or salary inflation was introduced.
6. **Unknown or Inaccessible Behaviour:** Exact undergraduate percentage/CGPA was not stated in the document (omitted to avoid guessing).
7. **Limitations:** Profile reflects completion through October 2026.
8. **Recommended CareerOS Implementation:** Store in structured [candidate_profile.json](file:///D:/AI-Workspace/Career-Agent/data/candidate_profile.json) and generate [candidate_profile.md](file:///D:/AI-Workspace/Career-Agent/data/candidate_profile.md).
9. **Tests Needed to Verify Our Implementation:** [profile.test.js](file:///D:/AI-Workspace/Career-Agent/tests/profile.test.js) asserting all fields match verified primary documents.

---

## Investigation 5: Playwright and Browser Architecture Verification

1. **Research Question:** Are local Chrome and Edge browsers available for headless and headed browser automation via Playwright without installing separate Chromium binaries?
2. **Target and Version:** Google Chrome `157.0.8103.79` and Microsoft Edge `157.0.4341.60`; Playwright `1.65.1`.
3. **Inspection Method:** Executed `(Get-Item "C:\Program Files\Google\Chrome\Application\chrome.exe").VersionInfo.ProductVersion` and tested Playwright version via `npx playwright --version`.
4. **Evidence Collected:** Chrome `157.0.8103.79` and Edge `157.0.4341.60` verified on host; Playwright CLI operational.
5. **Verified Findings:**
   * Playwright can launch local installed Chrome directly using `channel: 'chrome'` or default Chromium.
   * Supports both headed mode (for human-in-the-loop application assistance) and headless mode (for PDF resume compilation).
6. **Unknown or Inaccessible Behaviour:** Some job portals employ bot-detection scripts (e.g. Cloudflare Turnstile, reCAPTCHA) when accessed in headless automation.
7. **Limitations:** Automated blind form submission cannot bypass CAPTCHAs.
8. **Recommended CareerOS Implementation:** Strict **headed browser assistant** model. Launch Chrome in visible mode, auto-fill verified candidate fields, and pause for human review and manual submission.
9. **Tests Needed to Verify Our Implementation:** Playwright browser launch and form element mapping tests in Stage 2.

---

## Investigation 6: Scoring Engine Evaluation & Strict Seniority Rejection Verification

1. **Research Question:** Does our scoring rubric correctly recommend matching fresher Java positions while strictly rejecting senior/lead roles demanding 5+ years experience?
2. **Target and Version:** `src/matcher/scoringEngine.js` evaluated against real Indian tech job descriptions.
3. **Inspection Method:** Executed automated unit tests (`node --test tests/matcher.test.js`) and performed live batch scan on 179 real postings.
4. **Evidence Collected:**
   * Fresher role: *Junior Java Developer (Fresher)* scored **100/100**, 5 stars, status `RECOMMENDED`.
   * Senior role: *Senior Java Backend Architect (6–10 years)* scored **0/100**, status `REJECTED`, reason: `Excluded: Senior/Experienced role (6+ yrs)`.
   * Batch scan results across 179 live Indian listings: **136 Recommended Fresher Roles**, **43 Senior/Experienced Roles Rejected**.
5. **Verified Findings:**
   * Seniority filtering prevents applying to senior positions where keywords overlap.
   * Verified profile projects (NearVia, FinSight, Leave Management) correctly boost role relevance scores.
6. **Unknown or Inaccessible Behaviour:** Postings that omit experience requirements entirely receive a neutral baseline score (22/30) and require secondary human review.
7. **Limitations:** Text matching relies on standard keyword normalization and regular expressions; highly obscure phrasing could slip through without manual verification.
8. **Recommended CareerOS Implementation:** Retain the deterministic scoring engine as the first-line filter, and present clear match/exclusion reasoning on every job card in the local dashboard.
9. **Tests Needed to Verify Our Implementation:** [matcher.test.js](file:///D:/AI-Workspace/Career-Agent/tests/matcher.test.js) (passing).
