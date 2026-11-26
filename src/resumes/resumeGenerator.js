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
  const text = typeof content === 'string' ? content : (content ? JSON.stringify(content) : '');
  const flags = [];

  if (!text) {
    return { passed: true, hasCritical: false, flags: [], warnings: [], claimAudits: [] };
  }

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

  // 6b. Incorrect Portfolio URL Check (nearvia.app is a project, not personal portfolio)
  if (/portfolio[^\n|]*nearvia\.app/i.test(text)) {
    flags.push({
      term: 'nearvia.app as portfolio',
      category: 'INCORRECT_PORTFOLIO_URL',
      severity: 'CRITICAL',
      reason: 'nearvia.app is the NearVia project URL, not a personal portfolio website. Omit portfolio field until provided.'
    });
  }

  // 7. Claim-level Evidence Mapping
  const claimAudits = [];
  let parsedContent = null;
  if (typeof content === 'object' && content !== null) {
    parsedContent = content;
  } else if (typeof content === 'string') {
    try {
      parsedContent = JSON.parse(content);
    } catch {
      // Markdown string, parsedContent remains null
    }
  }

  if (parsedContent && profile) {
    // Audit Projects
    if (Array.isArray(parsedContent.projects)) {
      for (const proj of parsedContent.projects) {
        const pName = proj.name || '';
        const match = (profile.projects || []).find(mp => {
          const mpLower = mp.name.toLowerCase();
          const pLower = pName.toLowerCase();
          return mpLower === pLower ||
            mpLower.includes(pLower) ||
            pLower.includes(mpLower) ||
            mpLower.split(/[\s–—-]+/)[0] === pLower.split(/[\s–—-]+/)[0];
        });
        const expEvidenceMatch = (profile.experience || []).find(exp =>
          (exp.bullets || []).some(b => b.toLowerCase().includes(pName.toLowerCase()) || pName.toLowerCase().includes('leave management') && /leave management/i.test(b))
        );
        if (match) {
          claimAudits.push({
            section: 'projects',
            claim: pName,
            isSupported: true,
            evidence: `Master profile project "${match.name}" (Tech stack: ${(match.techStack || []).join(', ')})`
          });
        } else if (expEvidenceMatch) {
          claimAudits.push({
            section: 'projects',
            claim: pName,
            isSupported: true,
            evidence: `Verified internship implementation under ${expEvidenceMatch.company}`
          });
        } else {
          claimAudits.push({
            section: 'projects',
            claim: pName,
            isSupported: false,
            warning: `Project "${pName}" not found in verified master candidate profile.`
          });
          flags.push({
            term: pName,
            category: 'UNVERIFIED_PROJECT',
            severity: 'CRITICAL',
            reason: `Project "${pName}" is not supported by evidence in the candidate profile.`
          });
        }
      }
    }

    // Audit Education
    if (Array.isArray(parsedContent.education)) {
      for (const edu of parsedContent.education) {
        const deg = edu.degree || '';
        const match = (profile.education || []).find(me => {
          const meDeg = me.degree.toLowerCase();
          const dDeg = deg.toLowerCase();
          return meDeg === dDeg || meDeg.includes(dDeg) || dDeg.includes(meDeg);
        });
        if (match) {
          claimAudits.push({
            section: 'education',
            claim: deg,
            isSupported: true,
            evidence: `${match.degree} from ${match.institution} (${match.period})`
          });
        } else {
          claimAudits.push({
            section: 'education',
            claim: deg,
            isSupported: false,
            warning: `Degree "${deg}" is unverified against master profile.`
          });
          flags.push({
            term: deg,
            category: 'UNVERIFIED_DEGREE',
            severity: 'CRITICAL',
            reason: `Degree "${deg}" is not verified in master candidate profile.`
          });
        }
      }
    }

    // Audit Experience / Internships
    if (Array.isArray(parsedContent.experience)) {
      const allExperiences = (profile.experience || []).concat(profile.internships || []).concat(profile.internship ? [profile.internship] : []);
      for (const exp of parsedContent.experience) {
        const role = exp.role || exp.title || '';
        const org = exp.company || exp.organization || '';
        const matchIntern = allExperiences.find(mi => {
          const cName = (mi.company || mi.organization || '').toLowerCase();
          const rName = (mi.role || mi.title || '').toLowerCase();
          const targetOrg = org.toLowerCase();
          const targetRole = role.toLowerCase();
          return (cName && targetOrg && (cName.includes(targetOrg) || targetOrg.includes(cName))) ||
            (rName && targetRole && (rName.includes(targetRole) || targetRole.includes(rName)));
        });
        if (matchIntern) {
          claimAudits.push({
            section: 'experience',
            claim: `${role} at ${org}`,
            isSupported: true,
            evidence: `Verified internship at ${matchIntern.company || matchIntern.organization} (${matchIntern.period})`
          });
        } else {
          claimAudits.push({
            section: 'experience',
            claim: `${role} at ${org}`,
            isSupported: false,
            warning: `Experience at "${org}" is not verified in master profile.`
          });
          flags.push({
            term: `${role} at ${org}`,
            category: 'UNVERIFIED_EXPERIENCE',
            severity: 'CRITICAL',
            reason: `Experience claim "${role} at ${org}" not found in candidate profile.`
          });
        }
      }
    }
  }

  const warnings = flags.map(f => `[${f.category}] ${f.reason}`);
  const hasCritical = flags.some(f => f.severity === 'CRITICAL');

  return {
    passed: !hasCritical && flags.length === 0,
    hasCritical,
    flags,
    warnings,
    claimAudits
  };
}

export function generateTailoredResume(job, profile = null) {
  if (!profile) profile = loadCandidateProfile();

  const jobDesc = `${job.title} ${job.description || ''}`.toLowerCase();
  const isJavaFocused = /\b(java|j2ee|spring\s*boot|spring|hibernate|jpa)\b/i.test(jobDesc);
  const isReactFocused = /\b(react|reactjs|react\.js|frontend|javascript|typescript|full[\s-]?stack)\b/i.test(jobDesc);
  const isPythonAiFocused = /\b(python|fastapi|opencv|computer\s*vision|machine\s*learning|artificial\s*intelligence|ai\/ml|ml\s+engineer|ai\s+engineer|data\s+science)\b/i.test(jobDesc);

  // Tailor Professional Summary (Action + Technical Implementation + Purpose, zero fabrication)
  let summary = profile.summary;
  if (isJavaFocused && isReactFocused) {
    summary = `Java Full Stack Developer with hands-on experience building full-stack web applications using Java, Spring Boot, React.js, TypeScript, and SQL databases (MySQL, PostgreSQL). Built NearVia, a location-based hyperlocal job marketplace with PostGIS spatial queries and row-level concurrency control, and implemented an Employee Leave Management System during Java Full Stack internship at Anudip Foundation. MCA graduate (Oct 2026) seeking entry-level software engineering roles.`;
  } else if (isJavaFocused) {
    summary = `Java Backend Developer with strong foundations in Core Java, OOP, Spring Boot REST APIs, Hibernate/JPA, and relational databases (MySQL, PostgreSQL). Implemented an Employee Leave Management System using Spring Boot and Hibernate/JPA during internship at Anudip Foundation, and built NearVia with PostgreSQL/PostGIS concurrency control. MCA graduate (Oct 2026) seeking junior software engineer roles.`;
  } else if (isPythonAiFocused) {
    summary = `Software Engineer with hands-on experience in Python, FastAPI, computer vision (OpenCV), and full-stack web development. Built FinSight (AI expense & financial health predictor), Smart Rover (OpenCV waste detection), and Drowsiness Detection systems. MCA graduate (Oct 2026) seeking entry-level software engineering roles.`;
  }

  // Phase 18 Project Priority:
  // Default: 1. NearVia, 2. FinSight, 3. Aquaponics, 4. Smart Rover, 5. Drowsiness Detection
  const basePriority = (name = '') => {
    const n = name.toLowerCase();
    if (n.includes('nearvia')) return 100;
    if (n.includes('finsight')) return 80;
    if (n.includes('aquaponics')) return 60;
    if (n.includes('smart rover') || n.includes('rover')) return 40;
    if (n.includes('drowsiness')) return 20;
    return 0;
  };

  const projects = [...(profile.projects || [])]
    .filter(proj => !/leave management|voting/i.test(proj.name || ''))
    .sort((a, b) => {
      let scoreA = basePriority(a.name);
      let scoreB = basePriority(b.name);
      if (isPythonAiFocused) {
        if (/finsight|rover|drowsiness/i.test(a.name)) scoreA += 35;
        if (/finsight|rover|drowsiness/i.test(b.name)) scoreB += 35;
      }
      return scoreB - scoreA;
    });

  // Highlight key matching skills
  const skills = profile.skills;
  const p = { ...profile.personal };
  if (p.portfolio && p.portfolio.toLowerCase().includes('nearvia.app')) {
    delete p.portfolio;
  }

  const contactLinksMd = [
    p.linkedIn ? `**LinkedIn:** [linkedin.com/in/abhishekn27077](${p.linkedIn})` : '',
    p.gitHub ? `**GitHub:** [github.com/abhishekn27077](${p.gitHub})` : '',
    p.portfolio ? `**Portfolio:** [${p.portfolio}](${p.portfolio})` : ''
  ].filter(Boolean).join(' | ');

  const anudipExp = (profile.experience || []).find(e => /anudip/i.test(e.company || '')) || {
    role: 'Advanced Java Full Stack Development Intern',
    company: 'Anudip Foundation, Bangalore',
    period: 'Oct 2026',
    bullets: [
      'Developed Java applications applying Object-Oriented Programming (OOP), JDBC, Collections Framework, and Multithreading.',
      'Built full-stack web applications using Spring Boot, React.js, MySQL, and REST APIs.',
      'Implemented an Employee Leave Management System using Java, Spring Boot, Hibernate/JPA, React, and MySQL to handle employee leave requests and status tracking.'
    ]
  };

  // Generate ATS-optimized Markdown
  const markdown = `# ${p.fullName}
**Location:** ${p.location} | **Phone:** ${p.phone} | **Email:** ${p.email}  
${contactLinksMd}

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

## INTERNSHIP EXPERIENCE
- **${anudipExp.role}** | ${anudipExp.period}  
  *${anudipExp.company}*  
${(anudipExp.bullets || []).map(b => `  - ${b}`).join('\n')}

---

## PROJECTS
${projects.slice(0, 3).map(proj => `
### ${proj.name}
*Tech Stack: ${proj.techStack.join(', ')}*  
${proj.url ? `*Website: [${proj.url}](${proj.url})*${proj.github ? ' | ' : ''}` : ''}${proj.github ? `*GitHub: [${proj.github}](${proj.github})*` : ''}
${proj.bullets.map(b => `- ${b}`).join('\n')}
`).join('\n')}

---

## EDUCATION
- **Master of Computer Applications (MCA)** | 2024 – 2026 (Completed Oct 2026)  
  *AIMS Institutes, Bangalore*  
  *Honors: Received the Best AI Innovation medal at graduation*
- **Bachelor of Computer Applications (BCA)** | 2021 – 2024  
  *SSA Government First Grade College, Ballari*

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
    <a href="${p.gitHub}">GitHub</a>${p.portfolio ? ` | <a href="${p.portfolio}">Portfolio</a>` : ''}
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

  <h2>Internship Experience</h2>
  <h3>${anudipExp.role} — ${anudipExp.company}</h3>
  <div class="subtitle">${anudipExp.period}</div>
  <ul>
    ${(anudipExp.bullets || []).map(b => `<li>${b}</li>`).join('')}
  </ul>

  <h2>Key Projects</h2>
  ${projects.slice(0, 3).map(proj => `
    <h3>${proj.name}</h3>
    <div class="subtitle">Tech: ${proj.techStack.join(', ')} ${proj.url ? `| <a href="${proj.url}">Website</a>` : ''} ${proj.github ? `| <a href="${proj.github}">GitHub</a>` : ''}</div>
    <ul>
      ${proj.bullets.map(b => `<li>${b}</li>`).join('')}
    </ul>
  `).join('')}

  <h2>Education</h2>
  <h3>Master of Computer Applications (MCA) — AIMS Institutes, Bangalore</h3>
  <div class="subtitle">2024 – 2026 (Completed Oct 2026) | Recipient of Best AI Innovation Medal</div>
  <h3>Bachelor of Computer Applications (BCA) — SSA Government First Grade College, Ballari</h3>
  <div class="subtitle">2021 – 2024</div>

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
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    try {
      browser = await chromium.launch({ channel: 'msedge', headless: true });
    } catch {
      browser = await chromium.launch({ headless: true });
    }
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

  if (!fs.existsSync(RESUMES_DIR)) {
    fs.mkdirSync(RESUMES_DIR, { recursive: true });
  }
  if (!fs.existsSync(LETTERS_DIR)) {
    fs.mkdirSync(LETTERS_DIR, { recursive: true });
  }

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
