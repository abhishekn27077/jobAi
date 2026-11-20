# CareerOS — AI Resume Studio

The **AI Resume Studio** is an integrated career engineering workbench inside CareerOS. It analyzes arbitrary job descriptions (JDs), extracts technical and seniority requirements, compares them against the candidate's verified master profile, generates tailored ATS-optimized resumes across 3 selectable templates, computes a 100-point transparent compatibility score, provides side-by-side Before & After change analysis, and exports print-ready PDFs and editable Microsoft Word `.docx` documents.

---

## 🌟 Key Capabilities

1. **Evidence-Grounded Tailoring**: Zero hallucination. Every bullet point, project stack, and skill is drawn strictly from `data/candidate_profile.json`.
2. **Deterministic & AI Provider Support**:
   - Out-of-the-box local deterministic engine requiring no external API keys or paid services.
   - Optional configurable LLM provider (OpenAI / Google Gemini / Anthropic Claude) enabled automatically when environment keys are detected.
3. **100-Point ATS Scoring Engine**:
   - Clearly labeled: `CareerOS ATS Compatibility Estimate`.
   - 7 transparent weighted categories with point-by-point breakdown and plain-language explanations.
   - Dynamic real-time recalculation after manual edits in the browser editor.
4. **3 ATS-Compliant Layout Templates**:
   - `ATS Professional` (Default): Pure B&W, single-column, standard headings, maximum parseability for Workday, Taleo, Greenhouse, and Lever.
   - `Modern Professional`: Single-column layout with subtle navy `#1e3a8a` accenting and refined typographic hierarchy.
   - `Compact One-Page`: Density-optimized margins and line heights designed to fit freshers' profiles onto a single page without sub-9pt text.
5. **Version Vault & Application Tracker Integration**:
   - Full version management per job (`v1`, `v2`, etc.).
   - Track approval state, duplicate versions, delete drafts, and link approved versions directly into the canonical SQLite vault (`career_vault.db`).
   - One-click PDF (Playwright Chrome/Edge) and DOCX (`docx` library) exports.

---

## 🛠️ Architecture & Workflow

```
[Job Selection / JD Input]
          │
          ▼
[1. JD Analyzer (jdAnalyzer.js)]
   • Required vs Preferred Skills
   • Languages, Frameworks, Databases & Tools
   • Seniority & Fresher Eligibility (0-1 yrs)
   • Degree Requirements (MCA/BCA/CS)
   • ATS Keyword Tokenization
          │
          ▼
[2. Studio Service & Truthfulness Gate (resumeStudioService.js)]
   • Selects relevant projects (e.g. NearVia & Leave Management for Java)
   • Tailors professional summary hook
   • Truthfulness Auditor: rejects unverified degrees or inflated experience
          │
          ▼
[3. ATS Scoring Engine (atsScorer.js)]
   • Dual Indicators:
       - Indicator A: Resume Compatibility Score (0-100 Content Match)
       - Indicator B: Job Eligibility Assessment (ELIGIBLE / STRETCH / MANDATORY_NOT_MET / INSUFFICIENT_INFO)
   • 100-Point Formula across 7 categories
   • Hard Safety Cap on overall score if mandatory eligibility criteria are not met
   • Matched, missing mandatory, missing preferred, and omitted profile skills
   • Actionable improvement recommendations
          │
          ▼
[4. Studio Workspace UI]
   • Left Pane: Dual Indicators, Mandatory Alert Box, 100-pt Scorecard & Keyword Chips
   • Center Pane: Live Editor, Before/After Diff, Original JD Viewer, Recalculate Button
   • Right Pane: Live Paper Preview (Iframe) & Version Vault
          │
          ├────────────────────────┬────────────────────────┐
          ▼                        ▼                        ▼
[Export PDF]              [Export DOCX]            [Approve Version]
Playwright Chrome         Native Word format       Updates SQLite status to
A4 printable format       Editable .docx           'ready_to_apply'
```

---

## 🚀 Usage & CLI Commands

### 1. From the Interactive Local Dashboard
1. Open `http://localhost:3000` in your browser.
2. Locate any job card in your feed.
3. Click **✨ AI Resume Studio**.
4. Review the extracted JD requirements and ATS compatibility scorecard.
5. Switch templates between `ATS Professional`, `Modern Professional`, and `Compact One-Page`.
6. Edit summary or skill fields, and click **⚡ Recalculate ATS Score** to observe real-time feedback.
7. Click **💾 Save Version** to archive to your local version vault.
8. Click **📥 PDF** or **📄 DOCX** to download.
9. Click **✅ Approve for Apply** to mark the job as ready in your application pipeline.

### 2. From the Terminal CLI
```bash
# Run Resume Studio for Job #4 with default ATS Professional template
node src/cli.js studio 4

# Run with Modern Professional template
node src/cli.js studio 4 --template=modern_professional

# Run with Compact One-Page template
node src/cli.js studio 4 --template=compact_one_page
```

---

## 🔒 Safety, Truthfulness & Verification Boundaries

1. **No Phantom Skills**: Skills requested by a JD that do not exist in `data/candidate_profile.json` are reported as missing mandatory requirements; they are **never** injected into the resume.
2. **No Invented Employment**: Academic capstone projects (NearVia, FinSight, Leave Management) are strictly categorized under Projects. Anudip Foundation is accurately labeled as an internship.
3. **No Phantom Metrics**: Bullets use factual technical achievements (e.g., PostGIS spatial indexing, PostgreSQL row-level locks, OpenCV eye aspect ratio) rather than fabricated user numbers or dollar revenues.
4. **Human in the Loop**: CareerOS never automatically submits an application. Final review, approval, and submission remain 100% in your hands.
