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
  const p = { ...profile.personal };
  if (p.portfolio && p.portfolio.toLowerCase().includes('nearvia.app')) {
    delete p.portfolio;
  }
  const targetText = `${job.title} ${job.description || ''}`.toLowerCase();

  const isJava = /\b(java|j2ee|spring\s*boot|spring|hibernate|jpa)\b/i.test(targetText) || (jd.languages || []).includes('Java');
  const isReact = /\b(react|reactjs|react\.js|frontend|javascript|typescript|full[\s-]?stack)\b/i.test(targetText) || (jd.frameworksAndTools || []).includes('React.js');
  const isPython = /\b(python|fastapi|opencv|computer\s*vision|machine\s*learning|artificial\s*intelligence|ai\/ml|ml\s+engineer|ai\s+engineer|data\s+science)\b/i.test(targetText) || (jd.languages || []).includes('Python');
  const isIotCv = /\b(iot|esp32|embedded|sensor|computer\s*vision|opencv|hardware|robotics)\b/i.test(targetText);

  // A. Tailored Professional Summary (Truthful, grounded in verified facts, no repeated award)
  let tailoredSummary = `Software Developer with hands-on experience building full-stack applications using Java, Spring Boot, React.js, TypeScript, Node.js, and SQL/NoSQL databases. Built NearVia (location-based hyperlocal job marketplace with PostGIS spatial queries) and FinSight (AI financial health predictor). MCA graduate (Oct 2026) seeking entry-level software engineering roles.`;
  if (isJava && isReact) {
    tailoredSummary = `Java Full Stack Developer with hands-on experience building full-stack web applications using Java, Spring Boot, React.js, and relational databases (MySQL, PostgreSQL). Built NearVia, a hyperlocal job marketplace with role-based access control and row-level concurrency handling, and implemented an Employee Leave Management System during internship at Anudip Foundation. MCA graduate (Oct 2026) seeking entry-level software development roles.`;
  } else if (isJava) {
    tailoredSummary = `Java Backend Developer with strong foundations in Core Java, OOP principles, Spring Boot REST APIs, Hibernate/JPA, and SQL database design. Implemented an Employee Leave Management System during internship at Anudip Foundation and built NearVia with PostgreSQL/PostGIS concurrency control. MCA graduate (Oct 2026) seeking junior software engineer roles.`;
  } else if (isPython) {
    tailoredSummary = `Software Developer with practical experience in Python, FastAPI, computer vision (OpenCV), and full-stack web architectures. Built FinSight (AI financial health predictor), Drowsiness Detection, and NearVia. Experienced in RESTful service integration and relational/NoSQL databases.`;
  }

  // B. Selected & Ranked Projects (Master 7-Project Registry -> Role-Specific Top 3)
  const allProjects = (profile.projects || []).filter(proj => !/leave management|voting/i.test(proj.name || ''));
  const basePriority = (name = '') => {
    const n = name.toLowerCase();
    if (n.includes('nearvia')) return 100;
    if (n.includes('finsight')) return 80;
    if (n.includes('aquaponics')) return 60;
    if (n.includes('smart rover') || n.includes('rover')) return 40;
    if (n.includes('drowsiness')) return 20;
    return 0;
  };
  const rankedProjects = [...allProjects].sort((a, b) => {
    let scoreA = basePriority(a.name);
    let scoreB = basePriority(b.name);
    if (isPython) {
      if (/finsight|drowsiness|rover/i.test(a.name)) scoreA += 35;
      if (/finsight|drowsiness|rover/i.test(b.name)) scoreB += 35;
    }
    if (isIotCv) {
      if (/aquaponics|rover|drowsiness/i.test(a.name)) scoreA += 50;
      if (/aquaponics|rover|drowsiness/i.test(b.name)) scoreB += 50;
    }
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

  // D. Professional Experience / Internships (Filter out unrelated digital media internship for SWE roles)
  const isMediaRole = /\b(media|marketing|content|video)\b/i.test(targetText);
  const experience = (profile.experience || [])
    .filter(exp => isMediaRole || !/digital media/i.test(exp.role || ''))
    .map(exp => ({
      role: exp.role,
      company: exp.company,
      period: exp.period,
      type: exp.type,
      bullets: exp.bullets
    }));

  // E. Education (Keep concise; Best AI Innovation appears once in Achievements below)
  const education = (profile.education || []).map(edu => ({
    degree: edu.degree,
    institution: edu.institution,
    period: edu.period,
    status: edu.status,
    highlights: null
  }));

  // F. Certifications & Achievements (Concise, zero-duplication, 1-page balanced)
  const certificationsAndAwards = [
    'Best AI Innovation Medal — AIMS Institutes MCA Graduation (Oct 2026)',
    'Second Prize (2x) — Smart Aquaponics IoT Monitoring System (VITM Engineering Fair & Science Day)',
    'Certifications: Career Essentials in Generative AI (Microsoft & LinkedIn) • Python for Data Science (Coursera) • Java Complete Course (Udemy)'
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
