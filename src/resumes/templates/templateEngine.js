/**
 * CareerOS — Professional Resume Template Engine
 * Renders structured resume data into 3 ATS-compliant templates:
 * 1. ATS Professional (Default) - Single-column, pure B&W, strict ATS headings, no graphics.
 * 2. Modern Professional - Single-column, subtle navy accent headers, refined typography.
 * 3. Compact One-Page - Density-tuned layout to guarantee a single-page output for freshers.
 */

export function renderResumeHtml(data, templateName = 'ats_professional') {
  const p = data.personal || {};
  const s = data.summary || '';
  const skills = data.technicalSkills || {};
  const exp = data.experience || [];
  const projects = data.projects || [];
  const edu = data.education || [];
  const certs = data.certificationsAndAwards || [];

  switch (templateName) {
    case 'modern_professional':
      return renderModernProfessionalHtml(p, s, skills, exp, projects, edu, certs);
    case 'compact_one_page':
      return renderCompactOnePageHtml(p, s, skills, exp, projects, edu, certs);
    case 'ats_professional':
    default:
      return renderAtsProfessionalHtml(p, s, skills, exp, projects, edu, certs);
  }
}

export function renderResumeMarkdown(data) {
  const p = data.personal || {};
  const s = data.summary || '';
  const skills = data.technicalSkills || {};
  const exp = data.experience || [];
  const projects = data.projects || [];
  const edu = data.education || [];
  const certs = data.certificationsAndAwards || [];

  let md = `# ${p.fullName || 'Abhishek N'}\n`;
  md += `**Location:** ${p.location || 'Bangalore, India'} | **Phone:** ${p.phone || ''} | **Email:** ${p.email || ''}\n`;
  md += `**LinkedIn:** [${p.linkedIn}](${p.linkedIn}) | **GitHub:** [${p.gitHub}](${p.gitHub}) | **Portfolio:** [${p.portfolio}](${p.portfolio})\n\n`;
  md += `---\n\n`;

  md += `## PROFESSIONAL SUMMARY\n${s}\n\n`;
  md += `---\n\n`;

  md += `## TECHNICAL SKILLS\n`;
  if (skills.languages?.length) md += `- **Programming Languages:** ${skills.languages.join(', ')}\n`;
  if (skills.backend?.length) md += `- **Backend & Java:** ${skills.backend.join(', ')}\n`;
  if (skills.frontend?.length) md += `- **Frontend:** ${skills.frontend.join(', ')}\n`;
  if (skills.databases?.length) md += `- **Databases:** ${skills.databases.join(', ')}\n`;
  if (skills.toolsAndConcepts?.length) md += `- **Tools & Concepts:** ${skills.toolsAndConcepts.join(', ')}\n`;
  md += `\n---\n\n`;

  md += `## PROFESSIONAL EXPERIENCE\n`;
  for (const e of exp) {
    md += `### ${e.role} | ${e.company} (${e.period})\n`;
    if (e.bullets?.length) {
      md += e.bullets.map(b => `- ${b}`).join('\n') + '\n';
    }
  }
  md += `\n---\n\n`;

  md += `## RELEVANT PROJECTS\n`;
  for (const proj of projects) {
    md += `### ${proj.name}\n`;
    if (proj.techStack?.length) md += `*Tech Stack: ${proj.techStack.join(', ')}*\n`;
    const links = [];
    if (proj.url) links.push(`[Live Website](${proj.url})`);
    if (proj.github) links.push(`[GitHub Code](${proj.github})`);
    if (links.length) md += `*${links.join(' | ')}*\n`;
    if (proj.bullets?.length) {
      md += proj.bullets.map(b => `- ${b}`).join('\n') + '\n';
    }
    md += '\n';
  }
  md += `---\n\n`;

  md += `## EDUCATION\n`;
  for (const ed of edu) {
    md += `- **${ed.degree}** — ${ed.institution} (${ed.period})\n`;
    if (ed.highlights) md += `  *${ed.highlights}*\n`;
  }
  md += `\n---\n\n`;

  if (certs.length) {
    md += `## CERTIFICATIONS & ACHIEVEMENTS\n`;
    md += certs.map(c => `- ${c}`).join('\n') + '\n';
  }

  return md;
}

// -------------------------------------------------------------
// TEMPLATE 1: ATS Professional (Pure B&W, Standard Single Column)
// -------------------------------------------------------------
function renderAtsProfessionalHtml(p, s, skills, exp, projects, edu, certs) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeXml(p.fullName)} - Resume</title>
<style>
  @page {
    size: A4;
    margin: 0;
  }
  body {
    font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
    color: #111111;
    background: #ffffff;
    line-height: 1.32;
    font-size: 9.5pt;
    margin: 0;
    padding: 0;
  }
  h2, .entry-title, ul {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .header {
    text-align: center;
    border-bottom: 2px solid #000000;
    padding-bottom: 8px;
    margin-bottom: 12px;
  }
  h1 {
    font-size: 18pt;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0 0 4px 0;
  }
  .contact-line {
    font-size: 9pt;
    color: #222222;
  }
  .contact-line a {
    color: #000000;
    text-decoration: underline;
  }
  h2 {
    font-size: 11pt;
    font-weight: bold;
    text-transform: uppercase;
    border-bottom: 1px solid #000000;
    margin: 10px 0 4px 0;
    padding-bottom: 2px;
    letter-spacing: 0.5px;
  }
  .entry-title {
    font-size: 10pt;
    font-weight: bold;
    margin: 4px 0 1px 0;
  }
  .entry-sub {
    font-size: 9pt;
    font-style: italic;
    color: #333333;
    margin-bottom: 3px;
  }
  ul {
    margin: 2px 0 6px 18px;
    padding: 0;
  }
  li {
    margin-bottom: 2px;
    font-size: 9.5pt;
  }
  p {
    margin: 2px 0 6px 0;
    font-size: 9.5pt;
  }
  .skills-row {
    margin: 2px 0;
    font-size: 9.5pt;
  }
</style>
</head>
<body>
  <div class="header">
    <h1>${escapeXml((p.fullName || 'Abhishek N').toUpperCase())}</h1>
    <div class="contact-line">
      ${escapeXml(p.location)} | ${escapeXml(p.phone)} | ${escapeXml(p.email)}<br>
      <a href="${p.linkedIn}">${p.linkedIn}</a> |
      <a href="${p.gitHub}">${p.gitHub}</a> |
      <a href="${p.portfolio}">${p.portfolio}</a>
    </div>
  </div>

  <h2>Professional Summary</h2>
  <p>${escapeXml(s)}</p>

  <h2>Technical Skills</h2>
  <div class="skills-row"><strong>Programming Languages:</strong> ${(skills.languages || []).join(', ')}</div>
  <div class="skills-row"><strong>Backend & Java:</strong> ${(skills.backend || []).join(', ')}</div>
  <div class="skills-row"><strong>Frontend:</strong> ${(skills.frontend || []).join(', ')}</div>
  <div class="skills-row"><strong>Databases:</strong> ${(skills.databases || []).join(', ')}</div>
  <div class="skills-row"><strong>Developer Tools:</strong> ${(skills.toolsAndConcepts || []).join(', ')}</div>

  <h2>Professional Experience</h2>
  ${exp.map(e => `
    <div class="entry-title">${escapeXml(e.role)} — ${escapeXml(e.company)}</div>
    <div class="entry-sub">${escapeXml(e.period)} | ${escapeXml(e.type || 'Internship')}</div>
    <ul>
      ${(e.bullets || []).map(b => `<li>${escapeXml(b)}</li>`).join('')}
    </ul>
  `).join('')}

  <h2>Relevant Projects</h2>
  ${projects.map(proj => `
    <div class="entry-title">${escapeXml(proj.name)}</div>
    <div class="entry-sub">Tech Stack: ${(proj.techStack || []).join(', ')} ${proj.url ? `| Link: ${proj.url}` : ''}</div>
    <ul>
      ${(proj.bullets || []).map(b => `<li>${escapeXml(b)}</li>`).join('')}
    </ul>
  `).join('')}

  <h2>Education</h2>
  ${edu.map(ed => `
    <div class="entry-title">${escapeXml(ed.degree)} — ${escapeXml(ed.institution)}</div>
    <div class="entry-sub">${escapeXml(ed.period)} ${ed.status ? `(${escapeXml(ed.status)})` : ''} ${ed.highlights ? `| ${escapeXml(ed.highlights)}` : ''}</div>
  `).join('')}

  <h2>Certifications & Achievements</h2>
  <ul>
    ${certs.map(c => `<li>${escapeXml(c)}</li>`).join('')}
  </ul>
</body>
</html>`;
}

// -------------------------------------------------------------
// TEMPLATE 2: Modern Professional (Subtle Navy Accent, Crisp Typography)
// -------------------------------------------------------------
function renderModernProfessionalHtml(p, s, skills, exp, projects, edu, certs) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeXml(p.fullName)} - Modern Resume</title>
<style>
  @page {
    size: A4;
    margin: 0;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1e293b;
    background: #ffffff;
    line-height: 1.35;
    font-size: 9.5pt;
    margin: 0;
    padding: 0;
  }
  h2, .entry-header, ul {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .header {
    border-bottom: 2px solid #1e3a8a;
    padding-bottom: 8px;
    margin-bottom: 12px;
  }
  h1 {
    font-size: 20pt;
    font-weight: 700;
    color: #0f172a;
    letter-spacing: -0.5px;
    margin: 0 0 4px 0;
  }
  .tagline {
    font-size: 10pt;
    color: #1e3a8a;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .contact-line {
    font-size: 9pt;
    color: #475569;
  }
  .contact-line a {
    color: #1e3a8a;
    text-decoration: none;
  }
  h2 {
    font-size: 11pt;
    font-weight: 700;
    color: #1e3a8a;
    text-transform: uppercase;
    border-bottom: 1px solid #cbd5e1;
    margin: 12px 0 6px 0;
    padding-bottom: 2px;
    letter-spacing: 0.5px;
  }
  .entry-header {
    display: flex;
    justify-content: space-between;
    margin-top: 5px;
  }
  .entry-title {
    font-size: 10pt;
    font-weight: 600;
    color: #0f172a;
  }
  .entry-date {
    font-size: 9pt;
    color: #64748b;
  }
  .entry-sub {
    font-size: 9pt;
    color: #475569;
    font-style: italic;
    margin-bottom: 3px;
  }
  ul {
    margin: 2px 0 6px 18px;
    padding: 0;
  }
  li {
    margin-bottom: 2px;
    font-size: 9.5pt;
    color: #334155;
  }
  p {
    margin: 2px 0 6px 0;
    font-size: 9.5pt;
    color: #334155;
  }
  .skill-badge-row {
    margin: 2px 0;
    font-size: 9.5pt;
  }
</style>
</head>
<body>
  <div class="header">
    <h1>${escapeXml(p.fullName)}</h1>
    <div class="tagline">Java Full Stack Developer • MCA 2026 • Bangalore, India</div>
    <div class="contact-line">
      ${escapeXml(p.location)} | ${escapeXml(p.phone)} | ${escapeXml(p.email)} |
      <a href="${p.linkedIn}">LinkedIn</a> |
      <a href="${p.gitHub}">GitHub</a> |
      <a href="${p.portfolio}">Portfolio</a>
    </div>
  </div>

  <h2>Professional Summary</h2>
  <p>${escapeXml(s)}</p>

  <h2>Technical Skills</h2>
  <div class="skill-badge-row"><strong>Languages:</strong> ${(skills.languages || []).join(', ')}</div>
  <div class="skill-badge-row"><strong>Backend & Java:</strong> ${(skills.backend || []).join(', ')}</div>
  <div class="skill-badge-row"><strong>Frontend:</strong> ${(skills.frontend || []).join(', ')}</div>
  <div class="skill-badge-row"><strong>Databases:</strong> ${(skills.databases || []).join(', ')}</div>
  <div class="skill-badge-row"><strong>Tools & Cloud:</strong> ${(skills.toolsAndConcepts || []).join(', ')}</div>

  <h2>Professional Experience</h2>
  ${exp.map(e => `
    <div class="entry-header">
      <span class="entry-title">${escapeXml(e.role)} — ${escapeXml(e.company)}</span>
      <span class="entry-date">${escapeXml(e.period)}</span>
    </div>
    <div class="entry-sub">${escapeXml(e.type || 'Internship')}</div>
    <ul>
      ${(e.bullets || []).map(b => `<li>${escapeXml(b)}</li>`).join('')}
    </ul>
  `).join('')}

  <h2>Relevant Projects</h2>
  ${projects.map(proj => `
    <div class="entry-header">
      <span class="entry-title">${escapeXml(proj.name)}</span>
      ${proj.url ? `<span class="entry-date"><a href="${proj.url}" style="color: #1e3a8a; text-decoration: none;">${proj.url}</a></span>` : ''}
    </div>
    <div class="entry-sub">Tech: ${(proj.techStack || []).join(', ')}</div>
    <ul>
      ${(proj.bullets || []).map(b => `<li>${escapeXml(b)}</li>`).join('')}
    </ul>
  `).join('')}

  <h2>Education</h2>
  ${edu.map(ed => `
    <div class="entry-header">
      <span class="entry-title">${escapeXml(ed.degree)} — ${escapeXml(ed.institution)}</span>
      <span class="entry-date">${escapeXml(ed.period)}</span>
    </div>
    <div class="entry-sub">${ed.status ? `${escapeXml(ed.status)} ` : ''}${ed.highlights ? `| ${escapeXml(ed.highlights)}` : ''}</div>
  `).join('')}

  <h2>Certifications & Honors</h2>
  <ul>
    ${certs.map(c => `<li>${escapeXml(c)}</li>`).join('')}
  </ul>
</body>
</html>`;
}

// -------------------------------------------------------------
// TEMPLATE 3: Compact One-Page (Fresher-Optimized Density)
// -------------------------------------------------------------
function renderCompactOnePageHtml(p, s, skills, exp, projects, edu, certs) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeXml(p.fullName)} - Compact One-Page</title>
<style>
  @page {
    size: A4;
    margin: 0;
  }
  body {
    font-family: Arial, sans-serif;
    color: #111111;
    background: #ffffff;
    line-height: 1.25;
    font-size: 8.5pt;
    margin: 0;
    padding: 0;
  }
  h2, .entry-title, ul {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .header {
    text-align: center;
    border-bottom: 1.5px solid #000;
    padding-bottom: 4px;
    margin-bottom: 6px;
  }
  h1 {
    font-size: 15pt;
    font-weight: bold;
    margin: 0 0 2px 0;
    text-transform: uppercase;
  }
  .contact-line {
    font-size: 8.5pt;
  }
  .contact-line a {
    color: #000;
    text-decoration: underline;
  }
  h2 {
    font-size: 9.5pt;
    font-weight: bold;
    text-transform: uppercase;
    border-bottom: 1px solid #333;
    margin: 6px 0 2px 0;
    padding-bottom: 1px;
  }
  .entry-title {
    font-size: 9pt;
    font-weight: bold;
    margin: 2px 0 1px 0;
  }
  .entry-sub {
    font-size: 8.5pt;
    font-style: italic;
    color: #333;
    margin-bottom: 2px;
  }
  ul {
    margin: 1px 0 4px 14px;
    padding: 0;
  }
  li {
    margin-bottom: 1px;
    font-size: 8.5pt;
  }
  p {
    margin: 1px 0 4px 0;
    font-size: 8.5pt;
  }
  .skills-row {
    margin: 1px 0;
    font-size: 8.5pt;
  }
</style>
</head>
<body>
  <div class="header">
    <h1>${escapeXml((p.fullName || 'Abhishek N').toUpperCase())}</h1>
    <div class="contact-line">
      ${escapeXml(p.location)} | ${escapeXml(p.phone)} | ${escapeXml(p.email)} |
      <a href="${p.linkedIn}">LinkedIn</a> |
      <a href="${p.gitHub}">GitHub</a> |
      <a href="${p.portfolio}">Portfolio</a>
    </div>
  </div>

  <h2>Professional Summary</h2>
  <p>${escapeXml(s)}</p>

  <h2>Technical Skills</h2>
  <div class="skills-row"><strong>Languages:</strong> ${(skills.languages || []).join(', ')}</div>
  <div class="skills-row"><strong>Backend & Frameworks:</strong> ${(skills.backend || []).join(', ')}</div>
  <div class="skills-row"><strong>Frontend & Databases:</strong> ${(skills.frontend || []).join(', ')} | ${(skills.databases || []).join(', ')}</div>
  <div class="skills-row"><strong>Tools & Cloud:</strong> ${(skills.toolsAndConcepts || []).join(', ')}</div>

  <h2>Professional Experience</h2>
  ${exp.map(e => `
    <div class="entry-title">${escapeXml(e.role)} — ${escapeXml(e.company)} (${escapeXml(e.period)})</div>
    <ul>
      ${(e.bullets || []).map(b => `<li>${escapeXml(b)}</li>`).join('')}
    </ul>
  `).join('')}

  <h2>Key Projects</h2>
  ${projects.slice(0, 3).map(proj => `
    <div class="entry-title">${escapeXml(proj.name)} ${proj.url ? `(${proj.url})` : ''}</div>
    <div class="entry-sub">Stack: ${(proj.techStack || []).join(', ')}</div>
    <ul>
      ${(proj.bullets || []).map(b => `<li>${escapeXml(b)}</li>`).join('')}
    </ul>
  `).join('')}

  <h2>Education</h2>
  ${edu.map(ed => `
    <div class="entry-title">${escapeXml(ed.degree)} — ${escapeXml(ed.institution)} (${escapeXml(ed.period)})</div>
    ${ed.highlights ? `<div class="entry-sub">${escapeXml(ed.highlights)}</div>` : ''}
  `).join('')}

  <h2>Certifications & Awards</h2>
  <ul>
    ${certs.slice(0, 3).map(c => `<li>${escapeXml(c)}</li>`).join('')}
  </ul>
</body>
</html>`;
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
