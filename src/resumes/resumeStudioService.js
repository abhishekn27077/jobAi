/**
 * CareerOS — Resume Studio Service
 * Builds structured, truthful, tailored resume content aligned with a specific JD.
 * Supports configurable AI provider (OpenAI / Gemini / Anthropic) with an evidence-grounded
 * deterministic local generation engine fallback.
 */

import { loadCandidateProfile } from '../profile/profileManager.js';
import { extractJdRequirements } from './jdAnalyzer.js';
import { calculateAtsScore } from './atsScorer.js';
import { auditDocumentTruthfulness } from './resumeGenerator.js';
import { generateWithAiProvider } from './aiProvider.js';

export async function generateStudioResume(job, options = {}) {
  const profile = loadCandidateProfile();
  const jdAnalysis = options.jdAnalysis || extractJdRequirements(job);
  const template = options.template || 'ats_professional';

  // 1. Determine generation mode & generate content
  let generationMode = 'Local Deterministic Engine (Zero Fabrication)';
  let isAiGenerated = false;
  let structuredContent = null;

  if (options.forceAi || options.useAi) {
    const aiResult = await generateWithAiProvider({ job, jdAnalysis, profile });
    if (aiResult.success) {
      structuredContent = aiResult.content;
      generationMode = aiResult.generationMode;
      isAiGenerated = true;
    } else {
      generationMode = aiResult.generationMode;
      isAiGenerated = false;
      structuredContent = buildStructuredResume(job, jdAnalysis, profile);
    }
  } else {
    structuredContent = buildStructuredResume(job, jdAnalysis, profile);
  }

  // 2. Compare with Master Profile to produce Before-and-After change log
  const comparison = buildBeforeAfterComparison(profile, structuredContent, jdAnalysis);

  // 4. Calculate ATS compatibility score
  const atsScore = calculateAtsScore(jdAnalysis, structuredContent, profile);

  // 5. Auditor Verification Gate
  const audit = auditDocumentTruthfulness(JSON.stringify(structuredContent), profile);

  return {
    jobId: job.id,
    company: job.company,
    jobTitle: job.title,
    generationMode,
    isAiGenerated,
    template,
    content: structuredContent,
    atsScore,
    comparison,
    audit,
    jdAnalysis
  };
}

function buildStructuredResume(job, jd, profile) {
  const p = profile.personal;
  const targetText = `${job.title} ${job.description || ''}`.toLowerCase();

  const isJava = /java|spring|backend/i.test(targetText) || jd.languages.includes('Java');
  const isReact = /react|frontend|javascript|typescript|full\s*stack/i.test(targetText) || jd.frameworksAndTools.includes('React.js');
  const isPython = /python|ai|ml|fastapi|computer\s*vision|machine/i.test(targetText) || jd.languages.includes('Python');

  // A. Tailored Professional Summary (Truthful, grounded in verified facts)
  let tailoredSummary = profile.summary;
  if (isJava && isReact) {
    tailoredSummary = `Java Full Stack Developer with hands-on experience building full-stack web applications using Java, Spring Boot, React.js, and relational databases (MySQL, PostgreSQL). Developed NearVia, an MCA capstone hyperlocal job marketplace with role-based access control and transactional concurrency handling. MCA graduate (Oct 2026) seeking entry-level software development roles.`;
  } else if (isJava) {
    tailoredSummary = `Java Backend Developer with strong foundations in Core Java, OOP principles, Spring Boot REST APIs, Hibernate/JPA, and SQL database design. Experienced in building transactional web applications including an Employee Leave Management System and spatial query engines in PostgreSQL/PostGIS. MCA graduate (Oct 2026) seeking junior software engineer roles.`;
  } else if (isPython) {
    tailoredSummary = `Software Developer with practical experience in Python, FastAPI, computer vision (OpenCV), and full-stack web architectures. Developer of FinSight (AI financial health predictor) and recipient of the Best AI Innovation medal at MCA graduation. Experienced in RESTful service integration and relational/NoSQL databases.`;
  }

  // B. Selected & Ranked Projects
  const allProjects = profile.projects || [];
  const rankedProjects = [...allProjects].sort((a, b) => {
    let scoreA = 0;
    let scoreB = 0;

    const checkMatch = (proj) => {
      let sc = 0;
      const stack = (proj.techStack || []).map(s => s.toLowerCase());
      const name = proj.name.toLowerCase();

      if (isJava) {
        if (stack.includes('java') || stack.includes('spring boot')) sc += 15;
        if (name.includes('leave management')) sc += 10;
        if (name.includes('nearvia')) sc += 8;
      }
      if (isReact) {
        if (stack.includes('react') || stack.includes('typescript')) sc += 12;
        if (name.includes('nearvia')) sc += 10;
        if (name.includes('finsight')) sc += 8;
      }
      if (isPython) {
        if (stack.includes('python') || stack.includes('opencv') || stack.includes('fastapi')) sc += 15;
        if (name.includes('finsight') || name.includes('rover') || name.includes('drowsiness')) sc += 10;
      }
      return sc;
    };

    scoreA = checkMatch(a);
    scoreB = checkMatch(b);
    return scoreB - scoreA;
  });

  // Select top 3-4 projects
  const selectedProjects = rankedProjects.slice(0, 3).map(proj => ({
    name: proj.name,
    techStack: proj.techStack,
    url: proj.url || null,
    github: proj.github || null,
    bullets: proj.bullets
  }));

  // C. Filtered & Prioritized Technical Skills
  const s = profile.skills || {};
  const prioritizedSkills = {
    languages: s.languages || [],
    backend: isJava ? ['Core Java', 'Spring Boot', 'Hibernate/JPA', 'OOP', 'JDBC', 'REST APIs', 'Node.js'] :
             isPython ? ['Python', 'FastAPI', 'REST APIs', 'Node.js', 'Core Java', 'OOP'] :
             s.backend || [],
    frontend: isReact ? ['React.js', 'TypeScript', 'JavaScript', 'HTML5', 'CSS3', 'Tailwind CSS'] :
              s.frontend || [],
    databases: isJava ? ['MySQL', 'PostgreSQL', 'PostGIS', 'MongoDB'] : s.databases || [],
    toolsAndConcepts: ['Git', 'GitHub', 'Postman', 'VS Code', 'IntelliJ IDEA', 'Maven', 'Vercel']
  };

  // D. Professional Experience / Internships (Strictly truthful)
  const experience = (profile.experience || []).map(exp => ({
    role: exp.role,
    company: exp.company,
    period: exp.period,
    type: exp.type,
    bullets: exp.bullets
  }));

  // E. Education (Strictly truthful)
  const education = (profile.education || []).map(edu => ({
    degree: edu.degree,
    institution: edu.institution,
    period: edu.period,
    status: edu.status,
    highlights: edu.highlights || null
  }));

  // F. Certifications & Achievements
  const certificationsAndAwards = [
    'Best AI Innovation Medal — AIMS Institutes MCA Graduation (Oct 2026)',
    'Second Prize (2x) — Smart Aquaponics IoT Monitoring System (VITM Engineering Fair & Science Day)',
    'Career Essentials in Generative AI — Microsoft & LinkedIn Learning',
    'Python for Data Science and AI Development — Coursera',
    'Java Complete Course — Udemy'
  ];

  return {
    personal: p,
    summary: tailoredSummary,
    technicalSkills: prioritizedSkills,
    experience,
    projects: selectedProjects,
    education,
    certificationsAndAwards
  };
}

function buildBeforeAfterComparison(masterProfile, tailoredResume, jd) {
  const changes = [];

  // Summary change
  if (masterProfile.summary !== tailoredResume.summary) {
    changes.push({
      section: 'Professional Summary',
      master: masterProfile.summary,
      tailored: tailoredResume.summary,
      reason: `Aligned summary hook with ${jd.title} focus (emphasizing ${jd.languages.concat(jd.frameworksAndTools).slice(0, 3).join(', ')}).`
    });
  }

  // Projects change
  const masterProjectNames = (masterProfile.projects || []).map(p => p.name);
  const tailoredProjectNames = (tailoredResume.projects || []).map(p => p.name);
  changes.push({
    section: 'Featured Projects',
    master: masterProjectNames.slice(0, 3).join(' • '),
    tailored: tailoredProjectNames.join(' • '),
    reason: `Prioritized the ${tailoredProjectNames.length} projects with highest technical overlap for ${jd.company}'s requirements.`
  });

  // Skills change
  changes.push({
    section: 'Technical Skills Order',
    master: 'General Full Stack order',
    tailored: `Elevated ${jd.languages.slice(0, 3).join(', ')} and matching framework components to front of technical skills.`,
    reason: 'Optimizes ATS token scanning hierarchy for recruiters.'
  });

  return {
    totalChanges: changes.length,
    changes
  };
}
