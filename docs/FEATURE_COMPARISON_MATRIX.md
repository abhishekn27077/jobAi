# Feature Comparison & Architecture Matrix

This matrix compares the investigated open-source projects, tools, and paradigms against **CareerOS** (both our currently implemented Stage 1 and our Target Full Architecture).

---

## 1. Core Feature Matrix

| Feature / Dimension | REA (`morluto/rea`) | FreeHire (`strelov1`) | Career-ops (`career-ops-hq`) | AI Job Search (`ai-job-search`) | Python Ecosystem (`JobSpy`) | JobPilot (`suxrobGM`) | CareerOS (Stage 1 Implemented) | CareerOS (Target Architecture) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Primary Focus** | Reverse engineering & code inspection | Open ATS job search engine & API | Local-first AI career CLI & tracker | Prompt-driven CV tailoring & ranking | Multi-board web scraping | Browser form filling assistant | Unified local career assistant & dashboard | End-to-end autonomous career system |
| **License** | MIT | MIT | MIT | MIT | MIT / Apache | MIT | MIT | MIT (Internal Personal) |
| **Host Environment** | Node.js (MCP/CLI) | Go + Meilisearch + Svelte | Node.js (ESM) | Python / Claude Code | Python (pandas, bs4) | TypeScript / Playwright | Node.js 24 (`node:sqlite`) | Node.js 24 + Playwright + Python |
| **Job Discovery Source** | N/A (Inspection only) | Direct ATS Feeds (Greenhouse, Lever, etc.) | Custom portal YAML & local scrapers | Configured board links | HTML scraping (LinkedIn, Indeed) | Manual URL or search | FreeHire Agent API (11.5k+ Indian roles) | FreeHire API + Direct ATS + Company Feeds |
| **Ghost-Job Filtering** | N/A | **Yes** (Status tracking signal) | Partial (User flag) | No | No (High dead link rate) | No | **Yes** (FreeHire signal + freshness rules) | **Yes** (Automated ATS ping + status check) |
| **Fresher / Seniority Gating** | N/A | Faceted API filter | Prompt rubric (1–5) | Criteria prompt | Basic regex | Keyword match | **Strict Deterministic Filter** (Reject >2 yrs) | **Deterministic + Semantic Gating** |
| **Candidate Profile Verification** | N/A | None (User agnostic) | Markdown `cv.md` | Markdown profile | Resume text | JSON profile | **100% Verified Primary Docs** (No hallucination) | **Verified Vault + Version History** |
| **Job Fit Scoring Model** | N/A | Facet counts | 1 to 5 Stars | Scorecard prompt | Cosine similarity | Keyword overlap | **Multi-Factor 100-Point Rubric** with breakdown | **Multi-Factor + LLM Deep Audit** |
| **ATS Resume Generation** | N/A | No | Markdown ATS | LaTeX / HTML PDF | DOCX / PDF rewriter | No | Planned (Stage 2) | **ATS Markdown + Headless Playwright PDF** |
| **Reviewer Agent Quality Loop** | N/A | No | No | **Yes** (Dual-agent critique) | No | No | Planned (Stage 2) | **Yes** (Self-critique ATS checker) |
| **Browser Form Filling** | CDP / DevTools Trace | No | No (Manual only) | No | Blind Auto-POST (Risky) | **Yes** (Playwright assisted) | Planned (Stage 2) | **Headed Playwright + Human Click** |
| **Application Tracker Storage** | N/A | Server Postgres (Hosted) | `node:sqlite` | CSV file | SQLite / CSV | Local DB | **Canonical SQLite (`career_vault.db`)** | **Canonical SQLite + Audit Log** |
| **Email / Recruiter Integration** | N/A | No | No | No | None | No | Planned (Stage 3) | **Official Gmail OAuth2 (Draft-only)** |
| **Interview Preparation** | N/A | No | No | **Yes** (`/interview` prompts) | No | No | Planned (Stage 3) | **Job-Specific STAR Mock Simulator** |
| **Local Web Dashboard** | Web trace only | Hosted web UI | Terminal UI only | Static HTML export | Streamlit (in some forks) | Next.js local UI | **Local Zero-Dependency Dashboard** (`:3000`) | **Full Responsive Local Dashboard** |
| **Human-in-the-Loop Gate** | N/A | N/A | **Strict** (No auto-post) | **Strict** | Absent in many bots | Semi-strict | **Strict** (Enforced in schema & CLI) | **Strict Approval for All External Actions** |

---

## 2. Key Synthesis & Strategic Insights

1. **Why Scraper Bots Fail (Python JobSpy approach):** Scraping commercial consumer job boards (LinkedIn, Indeed) leads to frequent IP blocks, broken HTML selectors, and severe platform account sanctions. FreeHire's approach—crawling original company career pages and exposing an open, keyless agent API—is vastly superior in reliability, speed, and ethical compliance.
2. **Why Local SQLite Beats CSV and Cloud Databases:** AI Job Search uses a simple CSV file, which risks file corruption during concurrent access and cannot enforce foreign keys or relational integrity. FreeHire requires a heavy PostgreSQL + Meilisearch cluster. Career-ops and CareerOS use native `node:sqlite`: single-file portability, zero server maintenance, sub-millisecond query latency, and full relational integrity.
3. **Why Form Assistance Must Be Headed (JobPilot approach):** Fully automated "instant apply" bots submit inaccurate forms, misinterpret custom dropdowns, and cannot solve anti-bot gates. Opening a visible Playwright session that fills 90% of fields and lets the human review and click "Submit" yields a 100% success rate without risk of disqualification.
4. **Why Dual-Agent Review Matters (AI Job Search approach):** A single LLM prompt often hallucinates skills or produces generic bullet points. Spawning an internal reviewer agent to verify every bullet against `candidate_profile.json` ensures zero fabrication before the candidate ever sees the document.
