# Reverse Engineering & Empirical Research Methodology

This document outlines the systematic, ethical, and evidence-based methodology used to study existing career management, job-search, and application-assistance applications to inform the design and implementation of **CareerOS**.

---

## 1. Core Principles

1. **Evidence Over Marketing Claims:** We do not accept feature descriptions or claims from README files, landing pages, or promotional materials at face value. A feature is only credited if verified in actual source code, executable tests, or reproducible network/DOM observations.
2. **Local & Ethical Boundaries:** 
   * We do not defeat, bypass, or probe access controls, CAPTCHAs, bot challenges, or OTP verifications.
   * We do not scrape, probe, or automate proprietary platforms (such as LinkedIn, Naukri, or Indeed) in violation of their Terms of Service.
   * We treat third-party job descriptions, API payloads, and downloaded files as untrusted input.
3. **Observation Separation (Client vs. Backend):** When inspecting web applications, we explicitly distinguish between client-side observable behaviors (network requests, headers, DOM events, JavaScript bundles) and server-side processing. We never claim to have recovered proprietary backend architecture based solely on public HTTP responses.
4. **Reproducibility:** Every empirical finding must be documented with the exact command, URL, HTTP method, payload, or file line reference so that any engineer can independently verify the result.

---

## 2. The 9-Point Investigation Protocol

Every target component or feature evaluated in this research must be recorded using the standardized 9-point framework:

```
1. Research Question
   - What specific architectural, algorithmic, or protocol problem are we investigating?

2. Target and Version
   - Precise repository, commit hash, npm version, or public HTTP endpoint.

3. Inspection Method
   - How was the target analyzed? (e.g., AST inspection, source code audit, HAR capture, live API call with cURL/fetch, Playwright DOM trace).

4. Evidence Collected
   - Raw output, code snippet, network trace, schema definition, or test result.

5. Verified Findings
   - Factual capabilities, data structures, and algorithms confirmed by the evidence.

6. Unknown or Inaccessible Behaviour
   - Aspects of the target hidden behind closed backends, proprietary databases, or authentication.

7. Limitations
   - Constraints, rate limits, performance bottlenecks, or edge cases found in the target.

8. Recommended CareerOS Implementation
   - Concrete, actionable engineering decision for our system based on this evidence.

9. Tests Needed to Verify Our Implementation
   - Automated unit, integration, or end-to-end tests required to prove our solution works.
```

---

## 3. Toolchain & Techniques by Target Type

### A. Open-Source Repositories (Codebase Analysis)
* **AST & Dependency Analysis:** Inspect `package.json`, `requirements.txt`, or `go.mod` to establish exact dependency footprints and license compatibility.
* **Database Model Auditing:** Examine SQLite schemas, Prisma schemas, or SQL migrations to inspect entity relationships, indexes, and state machine transitions.
* **Control Flow Tracing:** Trace entry points from CLI or API routes down to services to verify if features (like auto-submission or scoring) are actually implemented or merely stubbed out.

### B. Public Web APIs & Job Boards
* **Contract Discovery:** Query OpenAPI specs (`/openapi.json`, `/openapi.yaml`) or public Swagger documentation.
* **HTTP Signature Auditing:** Inspect response headers (`Content-Type`, `Cache-Control`, `ETag`, `X-RateLimit-*`).
* **Payload Normalization Testing:** Send edge-case queries (special characters, country codes, empty queries) to determine parameter validation and ignored arguments.

### C. Browser Application Forms & ATS Portals (Greenhouse, Lever, Workday)
* **DOM Structure Mapping:** Inspect standard form inputs (`name`, `email`, `phone`, `resume_file`, `linkedin_url`) using Playwright / Chrome DevTools.
* **Event Listener Analysis:** Observe whether fields require synthesized `input` or `change` events to trigger client-side validation frameworks (e.g., React synthetic events).
* **Safe Form Filling Protocol:** Automate form pre-filling in headed browser sessions while strictly keeping the form submission button under human control.

---

## 4. Integrity and Compliance Checklist

Before publishing any research finding or implementing a feature derived from an external application, verify:

- [x] Has the software license been checked and documented?
- [x] Is the code being run locally without leaking private credentials?
- [x] Are personal tokens and OAuth secrets stored securely outside git?
- [x] Does the discovery mechanism avoid banned or anti-scraping techniques?
- [x] Does the application preserve the candidate's verified profile without hallucination?
- [x] Is there an explicit user confirmation gate before external actions (email, application, calendar)?
