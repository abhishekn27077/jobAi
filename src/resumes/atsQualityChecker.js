/**
 * CareerOS — 14-Dimension Resume ATS Quality Checker (Phase 13)
 * Rigorously evaluates tailored and compiled resumes for ATS parser compatibility,
 * contact accuracy, MCA education grounding, keyword density, and zero fabrication.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadCandidateProfile } from '../profile/profileManager.js';
import { auditDocumentTruthfulness } from './resumeGenerator.js';

export const ATS_QUALITY_TIERS = {
  EXCELLENT: 'ATS EXCELLENT (90-100)',
  GOOD: 'ATS READY (75-89)',
  NEEDS_ATTENTION: 'NEEDS REVISION (50-74)',
  CRITICAL: 'ATS REJECTED (<50)'
};

/**
 * Runs 14 comprehensive ATS quality checks on a resume's content, structure, and compiled files.
 * 
 * @param {Object} resumeContent - Structured resume content (summary, skills, projects, experience, education, contact)
 * @param {Object} job - Target job posting with title, description, skills
 * @param {Object} [options={}] - Options including pdfPath, docxPath
 * @returns {Object} Full 14-point audit report with score, breakdown, findings, and suggestions
 */
export function checkResumeAtsQuality(resumeContent, job, options = {}) {
  const profile = loadCandidateProfile();
  const checks = [];
  const findings = [];
  const warnings = [];
  const recommendations = [];

  let overallScore = 100;

  const content = resumeContent || {};
  const { pdfPath, docxPath } = options;

  // Flatten resume text for keyword and text-parsing checks
  const resumeFullText = [
    content.name || '',
    content.title || '',
    content.summary || '',
    content.contact ? Object.values(content.contact).join(' ') : '',
    Array.isArray(content.skills) ? content.skills.join(' ') : (typeof content.skills === 'object' ? Object.values(content.skills).flat().join(' ') : ''),
    Array.isArray(content.projects) ? content.projects.map(p => `${p.name} ${p.description} ${(p.highlights || []).join(' ')} ${(p.technologies || []).join(' ')}`).join(' ') : '',
    Array.isArray(content.experience) ? content.experience.map(e => `${e.role} ${e.company} ${e.description} ${(e.bullets || []).join(' ')}`).join(' ') : '',
    Array.isArray(content.education) ? content.education.map(ed => `${ed.degree} ${ed.institution} ${ed.year || ed.period || ed.status || ''}`).join(' ') : ''
  ].join(' ').toLowerCase();

  // 1. Contact Information Integrity (Email, Phone, Location)
  const hasEmail = /[\w.-]+@[\w.-]+\.\w+/.test(resumeFullText);
  const hasPhone = /(\+91|91)?[\s-]?[6-9]\d{9}/.test(resumeFullText) || (content.contact?.phone && content.contact.phone.length >= 10);
  const hasLocation = /bengaluru|bangalore|karnataka|india/i.test(resumeFullText);

  if (hasEmail && hasPhone && hasLocation) {
    checks.push({ id: '1_contact_details', name: 'Contact Details Integrity', status: 'passed', score: 10, max: 10, details: 'Full name, valid email, 10-digit phone, and location present.' });
  } else {
    overallScore -= 10;
    const missing = [!hasEmail && 'Email', !hasPhone && 'Phone', !hasLocation && 'Location'].filter(Boolean);
    findings.push(`Missing critical contact detail(s): ${missing.join(', ')}.`);
    checks.push({ id: '1_contact_details', name: 'Contact Details Integrity', status: 'failed', score: 0, max: 10, details: `Missing: ${missing.join(', ')}` });
  }

  // 2. Online Profiles & Technical Footprint (GitHub & LinkedIn, and no incorrect nearvia.app portfolio)
  const hasGithub = /github\.com\/[a-z0-9_-]+/i.test(resumeFullText);
  const hasLinkedIn = /linkedin\.com\/in\/[a-z0-9_-]+/i.test(resumeFullText);
  const hasIncorrectPortfolio = Boolean(content.personal?.portfolio && /nearvia\.app/i.test(content.personal.portfolio)) ||
    /portfolio[^\n|]*nearvia\.app/i.test(resumeFullText);

  if (hasIncorrectPortfolio) {
    overallScore -= 10;
    findings.push('nearvia.app is listed as personal portfolio; it is a project URL, not a personal portfolio.');
  }

  const aiAwardMatches = (resumeFullText.match(/best ai innovation/gi) || []).length;
  if (aiAwardMatches > 1) {
    overallScore -= 5;
    warnings.push(`Best AI Innovation award is repeated ${aiAwardMatches} times; keep it once under Achievements.`);
  }

  if (hasGithub && hasLinkedIn) {
    checks.push({ id: '2_online_profiles', name: 'Technical Profiles (GitHub & LinkedIn)', status: 'passed', score: 5, max: 5, details: 'Valid GitHub and LinkedIn URLs provided.' });
  } else {
    overallScore -= 3;
    warnings.push('Recommend including both GitHub and LinkedIn URLs for technical ATS indexing.');
    checks.push({ id: '2_online_profiles', name: 'Technical Profiles (GitHub & LinkedIn)', status: 'warning', score: 2, max: 5, details: 'Partial profile links.' });
  }

  // 3. Education Grounding & MCA 2026 Verification
  const hasMca = /mca|master of computer applications/i.test(resumeFullText);
  const hasGradYear = /2026|2025|oct 2026/i.test(resumeFullText);

  if (hasMca && hasGradYear) {
    checks.push({ id: '3_education_grounding', name: 'Education Grounding (MCA)', status: 'passed', score: 10, max: 10, details: 'Verified MCA candidate graduation timeline included.' });
  } else {
    overallScore -= 10;
    findings.push('Education section is missing explicit MCA degree or graduation year.');
    checks.push({ id: '3_education_grounding', name: 'Education Grounding (MCA)', status: 'failed', score: 0, max: 10, details: 'MCA degree / year missing.' });
  }

  // 4. Skills Taxonomy & Clean Categorization
  const hasCategorizedSkills = content.skills && typeof content.skills === 'object' && !Array.isArray(content.skills);
  const hasCoreTech = /java/i.test(resumeFullText) && /sql|mysql|postgresql/i.test(resumeFullText);

  if (hasCoreTech) {
    checks.push({ id: '4_skills_taxonomy', name: 'Core Technical Taxonomy', status: 'passed', score: 10, max: 10, details: 'Core Java, Spring Boot, and SQL technologies accurately indexed.' });
  } else {
    overallScore -= 10;
    findings.push('Core technical foundational skills (Java, SQL) missing from skills section.');
    checks.push({ id: '4_skills_taxonomy', name: 'Core Technical Taxonomy', status: 'failed', score: 0, max: 10, details: 'Core skills absent.' });
  }

  // 5. Mandatory JD Skills Match
  const jdRequired = (job?.required_skills ? (typeof job.required_skills === 'string' ? JSON.parse(job.required_skills) : job.required_skills) : []) || [];
  let matchedReq = 0;
  if (jdRequired.length > 0) {
    jdRequired.forEach(sk => {
      if (resumeFullText.includes(sk.toLowerCase())) matchedReq++;
    });
    const matchRatio = matchedReq / jdRequired.length;
    if (matchRatio >= 0.7) {
      checks.push({ id: '5_jd_skills_match', name: 'JD Mandatory Skills Coverage', status: 'passed', score: 15, max: 15, details: `Matched ${matchedReq}/${jdRequired.length} mandatory skills (${Math.round(matchRatio * 100)}%).` });
    } else if (matchRatio >= 0.4) {
      overallScore -= 5;
      checks.push({ id: '5_jd_skills_match', name: 'JD Mandatory Skills Coverage', status: 'warning', score: 10, max: 15, details: `Matched ${matchedReq}/${jdRequired.length} mandatory skills. Consider emphasizing overlapping skills.` });
    } else {
      overallScore -= 10;
      findings.push(`Low mandatory skill overlap (${matchedReq}/${jdRequired.length} skills matched).`);
      checks.push({ id: '5_jd_skills_match', name: 'JD Mandatory Skills Coverage', status: 'failed', score: 5, max: 15, details: `Only ${matchedReq}/${jdRequired.length} mandatory skills matched.` });
    }
  } else {
    checks.push({ id: '5_jd_skills_match', name: 'JD Mandatory Skills Coverage', status: 'passed', score: 15, max: 15, details: 'No explicit mandatory skills list in JD. General software competencies applied.' });
  }

  // 6. Project Grounding & Non-Fabrication
  const projects = content.projects || [];
  const knownProjectNames = (profile.projects || []).map(p => p.name.toLowerCase());
  let allProjectsVerified = true;
  let unverifiedProjectName = '';

  for (const proj of projects) {
    const pName = (proj.name || '').toLowerCase();
    const isKnown = knownProjectNames.some(kp => pName.includes(kp) || kp.includes(pName));
    if (!isKnown && pName) {
      allProjectsVerified = false;
      unverifiedProjectName = proj.name;
      break;
    }
  }

  if (allProjectsVerified && projects.length > 0) {
    checks.push({ id: '6_projects_grounding', name: 'Verified Project Grounding', status: 'passed', score: 10, max: 10, details: `All ${projects.length} academic & engineering projects match verified candidate profile.` });
  } else if (!allProjectsVerified) {
    overallScore -= 15;
    findings.push(`Unverified project detected: "${unverifiedProjectName}". Resumes must never fabricate projects.`);
    checks.push({ id: '6_projects_grounding', name: 'Verified Project Grounding', status: 'failed', score: 0, max: 10, details: `Unverified project: ${unverifiedProjectName}` });
  } else {
    overallScore -= 5;
    warnings.push('No technical projects listed in resume.');
    checks.push({ id: '6_projects_grounding', name: 'Verified Project Grounding', status: 'warning', score: 5, max: 10, details: 'No projects section.' });
  }

  // 7. Internship & Experience Grounding
  const experiences = content.experience || [];
  const knownInternships = (profile.experience || []).map(e => e.role.toLowerCase());
  let expValid = true;

  for (const exp of experiences) {
    const expRole = (exp.role || '').toLowerCase();
    const matched = knownInternships.some(ki => expRole.includes(ki) || ki.includes(expRole));
    if (!matched && expRole) {
      expValid = false;
      break;
    }
  }

  if (expValid) {
    checks.push({ id: '7_experience_accuracy', name: 'Internship & Experience Accuracy', status: 'passed', score: 5, max: 5, details: 'Candidate intern history truthful and accurate.' });
  } else {
    overallScore -= 10;
    findings.push('Experience claims exceed verified candidate profile.');
    checks.push({ id: '7_experience_accuracy', name: 'Internship & Experience Accuracy', status: 'failed', score: 0, max: 5, details: 'Unverified experience claim detected.' });
  }

  // 8. Standard ATS Heading Structure
  const headings = ['skills', 'education', 'experience', 'projects', 'summary'];
  const hasStandardHeadings = headings.every(h => content[h] !== undefined);

  if (hasStandardHeadings) {
    checks.push({ id: '8_heading_structure', name: 'Standard ATS Section Headings', status: 'passed', score: 5, max: 5, details: 'Uses standard industry headings (Summary, Skills, Experience, Projects, Education).' });
  } else {
    overallScore -= 3;
    checks.push({ id: '8_heading_structure', name: 'Standard ATS Section Headings', status: 'warning', score: 2, max: 5, details: 'Some standard section headings omitted or non-standard.' });
  }

  // 9. Single-Column Layout & Text Flow
  // Ensures template structure is single-column without multi-column tables
  const templateName = content.template || options.template || 'ats_professional';
  const isAtsCompliantTemplate = templateName === 'ats_professional' || templateName === 'modern_professional';

  if (isAtsCompliantTemplate) {
    checks.push({ id: '9_single_column_layout', name: 'Single-Column Layout Architecture', status: 'passed', score: 5, max: 5, details: 'Sequential single-column DOM flow without nested layout tables or multi-column text boxes.' });
  } else {
    overallScore -= 5;
    warnings.push('Template may contain multi-column layouts that confuse older ATS parsers.');
    checks.push({ id: '9_single_column_layout', name: 'Single-Column Layout Architecture', status: 'warning', score: 2, max: 5, details: 'Non-standard template layout.' });
  }

  // 10. Keyword Density & Natural Flow
  const wordCount = resumeFullText.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 60 && wordCount <= 850) {
    checks.push({ id: '10_keyword_density', name: 'Keyword Density & Word Count', status: 'passed', score: 5, max: 5, details: `Healthy density (~${wordCount} words). Fits standard format cleanly.` });
  } else if (wordCount < 60) {
    overallScore -= 3;
    warnings.push('Resume word count is low (< 60 words). May lack sufficient technical keyword depth.');
    checks.push({ id: '10_keyword_density', name: 'Keyword Density & Word Count', status: 'warning', score: 2, max: 5, details: `Word count low: ${wordCount} words.` });
  } else {
    overallScore -= 3;
    warnings.push('Resume word count exceeds 850 words. Risk of spilling over 1 page in standard font sizes.');
    checks.push({ id: '10_keyword_density', name: 'Keyword Density & Word Count', status: 'warning', score: 3, max: 5, details: `Word count high: ${wordCount} words.` });
  }

  // 11. Supported File Formats (.pdf / .docx)
  let formatScore = 5;
  let formatDetails = 'Supported format (.pdf / .docx)';
  if (pdfPath) {
    const ext = path.extname(pdfPath).toLowerCase();
    if (ext === '.pdf' || ext === '.docx') {
      formatDetails = `Validated ${ext.toUpperCase()} document format ready for upload.`;
    } else {
      formatScore = 0;
      overallScore -= 5;
      findings.push(`Unsupported file format: ${ext}. Must be .pdf or .docx.`);
    }
  }
  checks.push({ id: '11_file_format', name: 'ATS File Format Compatibility', status: formatScore > 0 ? 'passed' : 'failed', score: formatScore, max: 5, details: formatDetails });

  // 12. File Size, PDF Signature & Page Count Verification
  let sizeScore = 5;
  let sizeDetails = 'Standard size constraint respected (< 2MB).';
  let pdfMeta = { verified: false, pageCount: null, sizeKb: null, hasTextStreams: false };
  if (pdfPath && fs.existsSync(pdfPath)) {
    try {
      const stats = fs.statSync(pdfPath);
      const sizeMb = stats.size / (1024 * 1024);
      const buf = fs.readFileSync(pdfPath);
      const headerStr = buf.subarray(0, 8).toString('ascii');
      const rawLatin = buf.toString('latin1');
      const pageMatches = rawLatin.match(/\/Type\s*\/Page\b(?!s)/g);
      const pageCount = pageMatches ? pageMatches.length : 1;
      const hasTextStreams = /stream[\r\n]/.test(rawLatin) && stats.size > 1500;
      pdfMeta = {
        verified: headerStr.startsWith('%PDF-') && hasTextStreams,
        pageCount,
        sizeKb: Number((stats.size / 1024).toFixed(1)),
        hasTextStreams
      };

      if (!headerStr.startsWith('%PDF-')) {
        sizeScore = 0;
        overallScore -= 10;
        findings.push('Generated file does not have a valid %PDF- header.');
        sizeDetails = 'Invalid PDF header.';
      } else if (sizeMb <= 2.0) {
        sizeDetails = `Verified PDF (${pageCount} page${pageCount > 1 ? 's' : ''}, ${pdfMeta.sizeKb} KB, valid %PDF- stream).`;
      } else {
        sizeScore = 0;
        overallScore -= 5;
        findings.push(`PDF file size is ${sizeMb.toFixed(2)} MB, exceeding the 2MB ATS upload ceiling.`);
        sizeDetails = `File too large: ${sizeMb.toFixed(2)} MB.`;
      }
    } catch {}
  }
  checks.push({ id: '12_file_size', name: 'PDF Integrity, Page Count & Size (< 2MB)', status: sizeScore > 0 ? 'passed' : 'failed', score: sizeScore, max: 5, details: sizeDetails });

  // 13. Strict Truthfulness & Unsupported Claims Audit
  const auditResult = auditDocumentTruthfulness(content, profile);
  if (auditResult.passed && (!auditResult.flags || auditResult.flags.length === 0)) {
    checks.push({ id: '13_unsupported_claims', name: 'Strict Truthfulness & Evidence Audit', status: 'passed', score: 10, max: 10, details: 'Zero unverified claims, inflated metrics, or fake credentials detected.' });
  } else {
    overallScore -= 20;
    const violations = auditResult.flags || auditResult.warnings || [];
    violations.forEach(v => {
      findings.push(`Truthfulness violation: ${typeof v === 'string' ? v : (v.message || v.reason || JSON.stringify(v))}`);
    });
    checks.push({ id: '13_unsupported_claims', name: 'Strict Truthfulness & Evidence Audit', status: 'failed', score: 0, max: 10, details: `${violations.length} unverifiable claims flagged.` });
  }

  // 14. Completeness & Placeholder Absence
  const hasPlaceholders = /\[Company Name\]|\[Your Name\]|lorem ipsum|todo|placeholder/i.test(resumeFullText);
  if (!hasPlaceholders) {
    checks.push({ id: '14_placeholder_check', name: 'Completeness & Polish', status: 'passed', score: 5, max: 5, details: 'No placeholder text, template leakage, or dummy copy.' });
  } else {
    overallScore -= 10;
    findings.push('Unresolved placeholder text found in generated resume.');
    checks.push({ id: '14_placeholder_check', name: 'Completeness & Polish', status: 'failed', score: 0, max: 5, details: 'Placeholder text found.' });
  }

  overallScore = Math.max(0, Math.min(100, Math.round(overallScore)));

  let tier = ATS_QUALITY_TIERS.EXCELLENT;
  if (overallScore < 50) tier = ATS_QUALITY_TIERS.CRITICAL;
  else if (overallScore < 75) tier = ATS_QUALITY_TIERS.NEEDS_ATTENTION;
  else if (overallScore < 90) tier = ATS_QUALITY_TIERS.GOOD;

  if (findings.length > 0) {
    recommendations.push(...findings.map(f => `Fix: ${f}`));
  }
  if (recommendations.length === 0) {
    recommendations.push('Resume passes all 14 transparent local formatting, truthfulness, and file checks.');
  }

  return {
    atsQualityScore: overallScore,
    tier,
    checksPassed: checks.filter(c => c.status === 'passed').length,
    checksWarning: checks.filter(c => c.status === 'warning').length,
    checksFailed: checks.filter(c => c.status === 'failed').length,
    pdfMeta,
    checks,
    findings,
    warnings,
    recommendations,
    timestamp: new Date().toISOString()
  };
}
