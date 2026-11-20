import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadCandidateProfile } from '../profile/profileManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.resolve(__dirname, '../../output');
const RESUMES_DIR = path.join(OUTPUT_DIR, 'resumes');
const LETTERS_DIR = path.join(OUTPUT_DIR, 'cover_letters');

export function auditDocumentTruthfulness(content, profile) {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const flags = [];

  // 1. Unverified Production-grade / Production-ready claims
  const prodMatch = text.match(/\b(production-grade|production-ready|enterprise-grade)\b/i);
  if (prodMatch) {
    flags.push({
      term: prodMatch[0],
      category: 'UNVERIFIED_PRODUCTION_CLAIM',
      severity: 'CRITICAL',
      reason: `Detected "${prodMatch[0]}". Academic and personal capstone projects should not be labeled production-grade or enterprise-grade without verified commercial telemetry and deployment metrics.`
    });
  }

  // 2. Unverified Microservices claims
  const microMatch = text.match(/\bmicroservices?\b/i);
  if (microMatch) {
    flags.push({
      term: microMatch[0],
      category: 'UNVERIFIED_ARCHITECTURE_CLAIM',
      severity: 'CRITICAL',
      reason: `Detected "${microMatch[0]}". Candidate experience consists of modular Spring Boot REST APIs and FastAPI services, not commercial distributed microservices architectures.`
    });
  }

  // 3. Unverified Immediate joiner claims
  const joinerMatch = text.match(/\bimmediate\s+joiner\b/i);
  if (joinerMatch) {
    flags.push({
      term: joinerMatch[0],
      category: 'UNVERIFIED_AVAILABILITY_CLAIM',
      severity: 'CRITICAL',
      reason: `Detected "${joinerMatch[0]}". Availability should be accurately communicated as MCA 2026 graduate / entry-level candidate.`
    });
  }

  // 4. Forbidden unverified degrees
  const forbiddenDegrees = [
    { pattern: /\bB\.?Tech\b/i, name: 'B.Tech' },
    { pattern: /\bB\.?E\.?\b(?![\w])/i, name: 'B.E.' },
    { pattern: /\bM\.?Tech\b/i, name: 'M.Tech' },
    { pattern: /\bPh\.?D\b/i, name: 'Ph.D' },
    { pattern: /\bMBA\b/i, name: 'MBA' }
  ];
  for (const d of forbiddenDegrees) {
    if (d.pattern.test(text)) {
      flags.push({
        term: d.name,
        category: 'UNVERIFIED_DEGREE',
        severity: 'CRITICAL',
        reason: `Detected unverified degree "${d.name}". Candidate holds MCA (AIMS Institutes) and BCA (SSA Ballari).`
      });
    }
  }

  // 5. Inflated commercial tenure
  const tenureMatch = text.match(/\b([2-9]|\d{2,})\+?\s*(?:years?|yrs?)\s*(?:of)?\s*commercial\s*experience\b/i);
  if (tenureMatch) {
    flags.push({
      term: tenureMatch[0],
      category: 'INFLATED_TENURE',
      severity: 'CRITICAL',
      reason: `Detected "${tenureMatch[0]}". Candidate is an entry-level 2026 MCA graduate with internship experience (0-1 yrs); claiming multi-year commercial tenure is inaccurate.`
    });
  }

  // 6. Fabricated high-scale metrics
  const metricMatch = text.match(/(\$\d+[\d,]*\s*(?:k|m|million|thousand)?\s*revenue|\b\d+k\s*users|\breduced\s+latency\s+by\s+9\d%)/i);
  if (metricMatch) {
    flags.push({
      term: metricMatch[0],
      category: 'UNVERIFIED_METRIC',
      severity: 'CRITICAL',
      reason: `Detected unverified performance/financial metric "${metricMatch[0]}". Metrics must be backed by verifiable telemetry.`
    });
  }

  const warnings = flags.map(f => `[${f.category}] ${f.reason}`);
  const hasCritical = flags.some(f => f.severity === 'CRITICAL');

  return {
    passed: !hasCritical && flags.length === 0,
    hasCritical,
    flags,
    warnings
  };
}

export function generateTailoredResume(job, profile = null) {
  if (!profile) profile = loadCandidateProfile();

  const jobDesc = `${job.title} ${job.description || ''}`.toLowerCase();
  const isJavaFocused = /java|spring|backend/i.test(jobDesc);
  const isReactFocused = /react|frontend|javascript|typescript/i.test(jobDesc);
  const isPythonAiFocused = /python|ai|ml|machine\s*learning|vision|fastapi/i.test(jobDesc);

  // Tailor Professional Summary (Evidence-grounded, zero unverified claims)
  let summary = profile.summary;
  if (isJavaFocused && isReactFocused) {
    summary = `Java Full Stack Developer with hands-on experience building web applications using Java, Spring Boot, React.js and MySQL/PostgreSQL. Built full-stack applications including NearVia (hyperlocal job marketplace) and an Employee Leave Management System with REST API architecture. MCA graduate (2026) seeking entry-level software development roles.`;
  } else if (isJavaFocused) {
    summary = `Java Backend Developer with strong foundations in Core Java, OOP, Spring Boot, Hibernate/JPA, and relational databases (MySQL, PostgreSQL). Hands-on experience developing RESTful APIs, transactional leave management applications, and PostGIS location-based query engines. MCA graduate (2026) seeking junior software engineering positions.`;
  } else if (isPythonAiFocused) {
    summary = `Software Engineer with hands-on experience in Python, FastAPI, computer vision (OpenCV), and full-stack development (React, Node.js). Developer of FinSight AI financial predictor and Smart Rover computer-vision vehicle. Recipient of Best AI Innovation medal at MCA graduation.`;
  }

  // Reorder projects by relevance
  const projects = [...profile.projects].sort((a, b) => {
    let scoreA = 0;
    let scoreB = 0;
    if (isJavaFocused) {
      if (a.name.includes('Leave Management')) scoreA += 10;
      if (b.name.includes('Leave Management')) scoreB += 10;
      if (a.name.includes('NearVia')) scoreA += 8;
      if (b.name.includes('NearVia')) scoreB += 8;
    }
    if (isReactFocused) {
      if (a.name.includes('NearVia')) scoreA += 10;
      if (b.name.includes('NearVia')) scoreB += 10;
      if (a.name.includes('FinSight')) scoreA += 8;
      if (b.name.includes('FinSight')) scoreB += 8;
    }
    if (isPythonAiFocused) {
      if (a.name.includes('FinSight') || a.name.includes('Smart Rover')) scoreA += 10;
      if (b.name.includes('FinSight') || b.name.includes('Smart Rover')) scoreB += 10;
    }
    return scoreB - scoreA;
  });

  // Highlight key matching skills
  const skills = profile.skills;
  const p = profile.personal;

  // Generate ATS-optimized Markdown
  const markdown = `# ${p.fullName}
**Location:** ${p.location} | **Phone:** ${p.phone} | **Email:** ${p.email}  
**LinkedIn:** [linkedin.com/in/abhishekn27077](${p.linkedIn}) | **GitHub:** [github.com/abhishekn27077](${p.gitHub}) | **Portfolio:** [nearvia.app](${p.portfolio})

---

## PROFESSIONAL SUMMARY
${summary}

---

## TECHNICAL SKILLS
- **Programming Languages:** ${skills.languages.join(', ')}
- **Backend & Java:** ${skills.backend.join(', ')}
- **Frontend:** ${skills.frontend.join(', ')}
- **Databases:** ${skills.databases.join(', ')}
- **AI / Machine Learning:** ${skills.ai_ml.join(', ')}
- **Developer Tools & Cloud:** ${skills.tools.join(', ')}

---

## EDUCATION
- **Master of Computer Applications (MCA)** | 2024 – 2026 (Completed Oct 2026)  
  *AIMS Institutes, Bangalore*  
  *Honors: Received the Best AI Innovation medal at graduation*
- **Bachelor of Computer Applications (BCA)** | 2021 – 2024  
  *SSA Government First Grade College, Ballari*

---

## PROFESSIONAL EXPERIENCE
- **Advanced Java Full Stack Development Intern** | Oct 2026  
  *Anudip Foundation, Bangalore*  
  - Developed Java applications applying Object-Oriented Programming (OOP), JDBC, Collections Framework, and Multithreading.
  - Built full-stack web applications using Spring Boot, React.js, MySQL, and REST APIs.
- **Digital Media Intern** | Feb 2026  
  *Association of Women Entrepreneurs of Karnataka (AWAKE), Bangalore*  
  - Coordinated digital branding campaigns and community awareness initiatives (30-hour internship).

---

## PROJECTS
${projects.slice(0, 4).map(proj => `
### ${proj.name}
*Tech Stack: ${proj.techStack.join(', ')}*  
${proj.url ? `*Website: [${proj.url}](${proj.url})* | ` : ''}${proj.github ? `*GitHub: [${proj.github}](${proj.github})*` : ''}
${proj.bullets.map(b => `- ${b}`).join('\n')}
`).join('\n')}

---

## CERTIFICATIONS & AWARDS
- Best AI Innovation medal recipient at AIMS Institutes MCA Graduation (31 October 2026).
- Second Prize twice for Smart Aquaponics Monitoring System (College Science Day & VITM Engineering Fair 2026).
- Career Essentials in Generative AI (Microsoft & LinkedIn Learning).
- Python for Data Science and AI Development (Coursera).
- Java Complete Course (Udemy).
`;

  // Auditor Verification Gate
  const audit = auditDocumentTruthfulness(markdown, profile);
  if (!audit.passed) {
    console.warn('[Auditor Warning]', audit.warnings);
  }

  // Generate ATS HTML version
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    color: #1a1a1a;
    line-height: 1.4;
    font-size: 10pt;
    margin: 0;
    padding: 24px 32px;
  }
  h1 { font-size: 18pt; margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.5px; }
  .contact { font-size: 9pt; color: #444; margin-bottom: 12px; }
  .contact a { color: #004499; text-decoration: none; }
  h2 { font-size: 11pt; border-bottom: 1px solid #333; margin: 12px 0 6px 0; text-transform: uppercase; padding-bottom: 2px; }
  h3 { font-size: 10pt; margin: 6px 0 2px 0; }
  .subtitle { font-size: 9pt; color: #555; font-style: italic; margin-bottom: 4px; }
  ul { margin: 2px 0 6px 18px; padding: 0; }
  li { margin-bottom: 2px; }
  .skills-list p { margin: 2px 0; }
</style>
</head>
<body>
  <h1>${p.fullName}</h1>
  <div class="contact">
    ${p.location} | ${p.phone} | ${p.email} |
    <a href="${p.linkedIn}">LinkedIn</a> |
    <a href="${p.gitHub}">GitHub</a> |
    <a href="${p.portfolio}">Portfolio (nearvia.app)</a>
  </div>

  <h2>Professional Summary</h2>
  <p>${summary}</p>

  <h2>Technical Skills</h2>
  <div class="skills-list">
    <p><strong>Languages:</strong> ${skills.languages.join(', ')}</p>
    <p><strong>Backend & Java:</strong> ${skills.backend.join(', ')}</p>
    <p><strong>Frontend:</strong> ${skills.frontend.join(', ')}</p>
    <p><strong>Databases:</strong> ${skills.databases.join(', ')}</p>
    <p><strong>AI / ML & Tools:</strong> ${skills.ai_ml.join(', ')}, ${skills.tools.slice(0, 6).join(', ')}</p>
  </div>

  <h2>Education</h2>
  <h3>Master of Computer Applications (MCA) — AIMS Institutes, Bangalore</h3>
  <div class="subtitle">2024 – 2026 (Completed Oct 2026) | Recipient of Best AI Innovation Medal</div>
  <h3>Bachelor of Computer Applications (BCA) — SSA Government First Grade College, Ballari</h3>
  <div class="subtitle">2021 – 2024</div>

  <h2>Professional Experience</h2>
  <h3>Advanced Java Full Stack Development Intern — Anudip Foundation, Bangalore</h3>
  <div class="subtitle">Oct 2026</div>
  <ul>
    <li>Developed Java applications applying Object-Oriented Programming (OOP), JDBC, Collections Framework, and Multithreading.</li>
    <li>Built full-stack web applications using Spring Boot, React.js, MySQL, and REST APIs.</li>
  </ul>

  <h2>Key Projects</h2>
  ${projects.slice(0, 3).map(proj => `
    <h3>${proj.name}</h3>
    <div class="subtitle">Tech: ${proj.techStack.join(', ')} ${proj.url ? `| <a href="${proj.url}">Website</a>` : ''}</div>
    <ul>
      ${proj.bullets.map(b => `<li>${b}</li>`).join('')}
    </ul>
  `).join('')}

  <h2>Certifications & Awards</h2>
  <ul>
    <li><strong>Best AI Innovation Medal</strong> – AIMS Institutes MCA Graduation (31 Oct 2026).</li>
    <li><strong>Second Prize (2x)</strong> for Smart Aquaponics Monitoring System (College Science Day & VITM Engineering Fair 2026).</li>
    <li>Career Essentials in Generative AI (Microsoft & LinkedIn Learning) | Python for Data Science (Coursera).</li>
  </ul>
</body>
</html>`;

  return {
    markdown,
    html,
    tailoredSummary: summary,
    audit
  };
}

export function generateTailoredCoverLetter(job, profile = null) {
  if (!profile) profile = loadCandidateProfile();
  const p = profile.personal;
  const company = job.company || 'Hiring Team';
  const title = job.title || 'Software Engineer';

  const letterMarkdown = `# Application for ${title} — ${p.fullName}

**Date:** ${new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}  
**To:** The Hiring Team at ${company}  
**From:** ${p.fullName} (${p.email} | ${p.phone} | Bangalore, India)

Dear Hiring Manager,

I am writing to express my strong enthusiasm for the **${title}** position at **${company}**. Having completed my Master of Computer Applications (MCA) from AIMS Institutes, Bangalore in October 2026, alongside advanced Java Full Stack training through Anudip Foundation, I have developed solid engineering foundations in Java, Spring Boot, React.js, and relational database systems.

During my academic and practical journey, I led the development of **NearVia**, a full-stack hyperlocal marketplace built with React, TypeScript, Node.js, Express, and PostgreSQL/PostGIS. On this project, I implemented location-based discovery, concurrency control using PostgreSQL row-level locking to prevent double-booking, and role-based access control. Additionally, I built an **Employee Leave Management System** utilizing Spring Boot, Hibernate/JPA, React, and MySQL, which solidified my proficiency in enterprise Java patterns, REST API design, and component-based frontend architecture.

My work in AI and IoT—such as developing FinSight (AI financial health predictor) and building an OpenCV computer-vision vehicle that won the **Best AI Innovation medal** at my MCA graduation—demonstrates my proactive problem-solving ability, fast learning curve, and dedication to building reliable software.

I am particularly excited about the opportunity at ${company} because my verified background in Java, Spring Boot, React, and databases aligns directly with your technical requirements. As an MCA graduate based in Bangalore, I would welcome the opportunity to discuss how my technical skills and enthusiasm can add value to your engineering team.

Thank you for your time and consideration.

Sincerely,  
**${p.fullName}**  
Email: ${p.email}  
Phone: ${p.phone}  
Portfolio: [nearvia.app](https://nearvia.app)  
GitHub: [github.com/abhishekn27077](https://github.com/abhishekn27077)  
LinkedIn: [linkedin.com/in/abhishekn27077](https://linkedin.com/in/abhishekn27077)
`;

  return {
    markdown: letterMarkdown,
    company,
    title
  };
}

export async function compileToPdf(htmlContent, outputPath) {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  }
  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'load' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      margin: {
        top: '15mm',
        right: '15mm',
        bottom: '15mm',
        left: '15mm'
      },
      printBackground: true
    });
    return outputPath;
  } finally {
    if (browser) await browser.close();
  }
}

export async function exportTailoredDocumentsForJob(job) {
  const profile = loadCandidateProfile();
  const resume = generateTailoredResume(job, profile);
  const coverLetter = generateTailoredCoverLetter(job, profile);

  const safeCompany = (job.company || 'Company').replace(/[^a-zA-Z0-9]/g, '_');
  const safeJobId = job.id || Date.now();

  const resumeMdPath = path.join(RESUMES_DIR, `${safeJobId}_${safeCompany}_Resume.md`);
  const resumePdfPath = path.join(RESUMES_DIR, `${safeJobId}_${safeCompany}_Resume.pdf`);
  const letterMdPath = path.join(LETTERS_DIR, `${safeJobId}_${safeCompany}_CoverLetter.md`);

  fs.writeFileSync(resumeMdPath, resume.markdown, 'utf-8');
  fs.writeFileSync(letterMdPath, coverLetter.markdown, 'utf-8');

  // Compile PDF via Playwright
  await compileToPdf(resume.html, resumePdfPath);

  return {
    resumeMdPath,
    resumePdfPath,
    letterMdPath,
    resume,
    coverLetter
  };
}
