# CareerOS — ATS Scoring & Job Eligibility Methodology

**Label:** `CareerOS ATS Compatibility Estimate`  
**Disclaimer:** *This score is an internal algorithmic estimate of resume alignment against a specific job description. It is designed to assist candidates in tailoring their materials and identifies gaps based on verified evidence. It is not an official employer Applicant Tracking System score or guarantee of interview selection.*

---

## 1. Dual-Indicator Decision Architecture

To ensure candidates are never misled by high technical keyword overlap on roles they are legally or contractually ineligible for (such as senior roles requesting 3–7+ years), CareerOS decouples the evaluation into two independent, co-equal indicators:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CAREEROS DECISION MATRIX                          │
├──────────────────────────────────────┬──────────────────────────────────────┤
│ INDICATOR A: RESUME COMPATIBILITY     │ INDICATOR B: JOB ELIGIBILITY         │
│ (0 – 100 Content Match)              │ (Gatekeeper Status)                  │
│                                      │                                      │
│ • Evaluates content resonance:       │ • Evaluates non-negotiable gates:    │
│   - Required skill keyword coverage  │   - Experience & commercial tenure   │
│   - Technical stack overlap          │   - Mandatory degree qualifications  │
│   - Featured project proof           │   - Work authorization / citizenship │
│   - Education & honours match        │                                      │
│   - ATS single-column parseability   │ Statuses:                            │
│                                      │   [ELIGIBLE]                         │
│ Score: 0 – 100                       │   [POTENTIAL_STRETCH]                │
│                                      │   [MANDATORY_NOT_MET]                │
│                                      │   [INSUFFICIENT_INFO]                │
└──────────────────────────────────────┴──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      OVERALL MATCH SCORE & SAFETY CAP                       │
│                                                                             │
│ • If ELIGIBLE:           Overall Match = Resume Compatibility Score         │
│ • If POTENTIAL_STRETCH:  Overall Match = Math.round(Compat * 0.85)          │
│ • If MANDATORY_NOT_MET:  Overall Match = min(45, Math.round(Compat * 0.40)) │
│                          + High-visibility Alert Banner with unmet criteria │
│ • If INSUFFICIENT_INFO:  Overall Match = Math.round(Compat * 0.90)          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Weighted Categories & Mathematical Formula

Indicator A (Resume Compatibility Score) is calculated out of **100 points** across 7 weighted dimensions:

$$\text{ATS Score} = C_{\text{req}} + C_{\text{tech}} + C_{\text{exp}} + C_{\text{edu}} + C_{\text{proj}} + C_{\text{struct}} + C_{\text{ach}}$$

| Category | Weight / Max Points | Evaluation Focus |
|---|:---:|---|
| **Required Skill & Keyword Coverage** | 30 | Presence of mandatory JD skills backed by candidate profile evidence. |
| **Technical Stack Relevance** | 20 | Domain alignment across languages, frameworks, databases, and tools. |
| **Experience & Seniority Eligibility** | 15 | Fresher / entry-level fit (0-1 yrs) vs strict penalty for senior roles (>2 yrs). |
| **Education & Qualification Match** | 10 | MCA / BCA / Computer Science degree alignment. |
| **Project Relevance & Evidence** | 10 | Direct proof of requested tech stack in candidate's hands-on projects. |
| **Resume Structure & ATS Readability** | 10 | Standard single-column layout, standard headings, complete contact info. |
| **Relevant Achievements & Clarity** | 5 | Verified honors (Best AI Innovation medal, awards, live portfolio URLs). |

---

## 3. Job Eligibility Assessment Breakdown

### Status 1: `ELIGIBLE`
- **Criteria**: Role explicitly accepts Freshers / 0–1 Years, Entry Level, Associate, or Graduate trainees; and candidate degree (MCA 2026) satisfies educational criteria.
- **UI Treatment**: Green pill badge `✅ Eligible`, normal compatibility score pass-through.

### Status 2: `POTENTIAL_STRETCH`
- **Criteria**: Role requests 2 years (or 1–2 years) experience. Candidate possesses strong production internships, full-stack live projects (NearVia, FinSight), and graduation honours, but lacks multi-year commercial tenure.
- **UI Treatment**: Amber pill badge `⚠️ Potential stretch`, warning banner suggesting cover letter focus on production project complexity.

### Status 3: `MANDATORY_NOT_MET`
- **Criteria**: Role requires 3+ years experience, Senior/Lead/Staff/Architect title, or non-CS specialized degree.
- **UI Treatment**: Red pill badge `⛔ Mandatory requirement not met`, high-visibility alert banner itemizing exact unmet requirements, and overall match score strictly capped at $\le 45$ to prevent false confidence.

### Status 4: `INSUFFICIENT_INFO`
- **Criteria**: Job description lacks explicit experience or degree prerequisites.
- **UI Treatment**: Blue pill badge `ℹ️ Insufficient information`, neutral recommendation to verify during recruiter screening.

---

## 4. Category Details & Scoring Logic

### Category 1: Required Skill & Keyword Coverage (Max 30)
- **Strict Decoupled Sub-Scores:**
  - **Mandatory Requirements Coverage (Max 25):**
    $$\text{Mandatory Score} = \min\left(25, \operatorname{round}\left(\frac{\text{Verified Matched Mandatory Skills}}{\text{Total Required Mandatory Skills}} \times 25\right)\right)$$
    *If no explicit mandatory skills are identified, this defaults to 20/25 baseline.*
  - **Preferred Keywords Coverage (Max 5):**
    $$\text{Preferred Score} = \min\left(5, \operatorname{round}\left(\frac{\text{Verified Matched Preferred Skills}}{\text{Total Preferred Skills}} \times 5\right)\right)$$
    *Preferred keywords can never inflate mandatory coverage. If no preferred skills exist, defaults to 5/5.*
  - **Category Total:** $\text{Mandatory Score} + \text{Preferred Score} \le 30$.
- **Evidence Requirement**: A keyword must be present in the resume **AND** present in `data/candidate_profile.json` (or verified local profile). If a keyword is typed into the resume but absent from candidate profile, 0 points are awarded, and an unverified claim deduction is triggered.
- **Categorization**:
  - `Matched Skills`: In JD, in Profile, in Resume.
  - `Missing Mandatory`: In JD requirements, not in Resume.
  - `Missing Preferred`: In JD "nice-to-have" section, not in Resume.
  - `In Profile but Omitted`: In Candidate Profile, in JD, but missing from current draft (highlights quick score improvement opportunities).

### Category 2: Technical Stack Relevance (Max 20)
- Scans target technology sets across:
  - Languages: Java, Python, JavaScript, TypeScript, SQL, PHP.
  - Frameworks: Spring Boot, React.js, Node.js, Express, FastAPI.
  - Databases: MySQL, PostgreSQL, PostGIS, MongoDB.
  - Tools: Git, GitHub, Postman, Docker, Linux, Maven.
- Evaluates total overlap and domain coherence.

### Category 3: Experience & Seniority Eligibility (Max 15)
- **Fresher / 0–1 Years**: Full 15 points awarded.
- **2 Years Experience**: 8 points awarded (labeled as a potential junior stretch).
- **>2 Years or Senior/Lead/Architect Titles**: **0 points** awarded. Explicit reason displayed: `"Strict mismatch: Job requires X+ years experience. Exceeds junior/fresher threshold."`

### Category 4: Education & Qualification Match (Max 10)
- **MCA / BCA / Computer Science / IT / Any Engineering Degree**: Full 10 points awarded.
- **Unrelated Specialized Degree**: 6 points awarded with note.

### Category 5: Project Relevance & Evidence (Max 10)
- Scans candidate projects for direct demonstration of the target stack:
  - **Java / Backend**: `Employee Leave Management System` (Spring Boot, Hibernate, MySQL) and `NearVia` (REST APIs, PostgreSQL, PostGIS).
  - **Full Stack / React**: `NearVia` (React, TypeScript, Node.js) and `FinSight` (React, REST APIs).
  - **Python / AI / ML**: `FinSight` (FastAPI, ML), `Smart Rover` (OpenCV, ESP32-CAM), `Drowsiness Detection` (Python, Computer Vision).
- $\ge 2$ matching projects: 10 points. 1 project: 7 points.

### Category 6: Resume Structure & ATS Readability (Max 10)
- Evaluates structural parseability:
  - Standard ATS headings present (Summary, Technical Skills, Experience, Projects, Education, Certifications): 5 points.
  - Single-column standard flow, complete contact information (Name, Email, Phone, LinkedIn, GitHub, Portfolio): 5 points.

### Category 7: Relevant Achievements & Clarity (Max 5)
- Verified honors (e.g. Best AI Innovation medal, VITM Engineering Fair awards): 3 points.
- Active verified URLs (`nearvia.app`, `github.com`): 2 points.

---

## 5. Dynamic Real-Time Recalculation

When a user modifies their resume in the Resume Studio editor:
1. The client sends `{ jdAnalysis, resumeContent }` to `POST /api/resume/score`.
2. The server re-runs `calculateAtsScore(jdAnalysis, editedContent)`.
3. The UI updates Indicator A, Indicator B, the alert banner, and category progress bars in real time without page reload.

---

## 6. Limitations & Truthfulness Guarantees

1. **Not an Employer Guarantee**: High ATS compatibility indicates alignment with stated JD criteria, but does not guarantee human recruiter review.
2. **Zero Hallucination Guarantee**: The scoring engine never awards points for skills absent from the candidate profile, ensuring no fabricated claims are incentivized.
3. **Hard Cap Transparency**: When a role fails mandatory eligibility, the score is capped immediately so the user can never be misled by an 85% technical match on a 5-year role.
