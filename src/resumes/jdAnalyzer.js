/**
 * CareerOS — Job Description Analyzer & Keyword Extractor
 * Extracts required skills, preferred skills, languages, tools, experience,
 * education, responsibilities, and high-value ATS keywords from JD text.
 */

import { classifyDegreeRequirement } from '../matcher/degreeClassifier.js';

// Canonical dictionary of tech skills and synonyms
const TECH_DICTIONARY = {
  languages: [
    { name: 'Java', pattern: /\bjava\b(?!script)/i },
    { name: 'Python', pattern: /\bpython\b/i },
    { name: 'JavaScript', pattern: /\bjavascript\b|\bjs\b/i },
    { name: 'TypeScript', pattern: /\btypescript\b|\bts\b/i },
    { name: 'SQL', pattern: /\bsql\b/i },
    { name: 'PHP', pattern: /\bphp\b/i },
    { name: 'C++', pattern: /\bc\+\+\b/i },
    { name: 'C#', pattern: /\bc#\b|\bc\s*sharp\b/i },
    { name: 'Go', pattern: /\bgolang\b|\bgo\s+lang\b/i },
    { name: 'HTML5', pattern: /\bhtml5?\b/i },
    { name: 'CSS3', pattern: /\bcss3?\b/i }
  ],
  frameworks: [
    { name: 'Spring Boot', pattern: /\bspring\s*boot\b/i },
    { name: 'Spring Framework', pattern: /\bspring\s*(?:mvc|framework|core)\b|\bspring\b(?!\s*boot)/i },
    { name: 'Hibernate/JPA', pattern: /\bhibernate\b|\bjpa\b/i },
    { name: 'React.js', pattern: /\breact(?:\.js)?\b/i },
    { name: 'Node.js', pattern: /\bnode(?:\.js)?\b/i },
    { name: 'Express.js', pattern: /\bexpress(?:\.js)?\b/i },
    { name: 'FastAPI', pattern: /\bfastapi\b/i },
    { name: 'REST APIs', pattern: /\brest(?:ful)?\s*(?:api|services|endpoints)?\b/i },
    { name: 'Microservices', pattern: /\bmicroservices?\b/i },
    { name: 'Tailwind CSS', pattern: /\btailwind(?:\s*css)?\b/i },
    { name: 'Bootstrap', pattern: /\bbootstrap\b/i }
  ],
  databases: [
    { name: 'MySQL', pattern: /\bmysql\b/i },
    { name: 'PostgreSQL', pattern: /\bpostgre(?:sql)?\b|\bpostgres\b/i },
    { name: 'MongoDB', pattern: /\bmongo(?:db)?\b/i },
    { name: 'PostGIS', pattern: /\bpostgis\b/i },
    { name: 'Redis', pattern: /\bredis\b/i },
    { name: 'Oracle', pattern: /\boracle(?:\s*db)?\b/i }
  ],
  toolsAndConcepts: [
    { name: 'Git', pattern: /\bgit\b(?!hub|lab)/i },
    { name: 'GitHub', pattern: /\bgithub\b/i },
    { name: 'Docker', pattern: /\bdocker\b/i },
    { name: 'Kubernetes', pattern: /\bkubernetes\b|\bk8s\b/i },
    { name: 'Maven', pattern: /\bmaven\b/i },
    { name: 'Postman', pattern: /\bpostman\b/i },
    { name: 'Linux', pattern: /\blinux\b|\bunix\b/i },
    { name: 'AWS', pattern: /\baws\b|\bamazon\s*web\s*services\b/i },
    { name: 'Azure', pattern: /\bazure\b/i },
    { name: 'GCP', pattern: /\bgcp\b|\bgoogle\s*cloud\b/i },
    { name: 'OpenCV', pattern: /\bopencv\b/i },
    { name: 'Machine Learning', pattern: /\bmachine\s*learning\b|\bml\b/i },
    { name: 'OOP', pattern: /\boop\b|\bobject\s*oriented(?:\s*programming)?\b/i },
    { name: 'Data Structures & Algorithms', pattern: /\bdsa\b|\bdata\s*structures?\b/i },
    { name: 'Unit Testing', pattern: /\bunit\s*test(?:ing)?\b|\bjunit\b/i },
    { name: 'CI/CD', pattern: /\bci[\/\s-]?cd\b/i },
    { name: 'Agile/Scrum', pattern: /\bagile\b|\bscrum\b/i }
  ]
};

export function extractJdRequirements(job) {
  const fullText = `${job.title || ''}\n${job.company || ''}\n${job.description || ''}`;
  const lowerText = fullText.toLowerCase();

  // 1. Split text into sections (Requirements, Qualifications, Preferred, Responsibilities)
  const sections = partitionJdSections(fullText);

  // 2. Identify skills in required vs preferred sections
  const requiredSkills = new Set();
  const preferredSkills = new Set();
  const allFoundSkills = new Set();
  const languages = new Set();
  const frameworksAndTools = new Set();
  const databases = new Set();

  // Scan dictionary against sections
  const scanGroup = (list, category) => {
    for (const item of list) {
      const inRequired = item.pattern.test(sections.required) || (!sections.preferred && item.pattern.test(fullText));
      const inPreferred = item.pattern.test(sections.preferred);
      const inAny = item.pattern.test(fullText);

      if (inAny) {
        allFoundSkills.add(item.name);
        if (category === 'languages') languages.add(item.name);
        if (category === 'frameworks' || category === 'tools') frameworksAndTools.add(item.name);
        if (category === 'databases') databases.add(item.name);

        if (inPreferred && !inRequired) {
          preferredSkills.add(item.name);
        } else {
          requiredSkills.add(item.name);
        }
      }
    }
  };

  scanGroup(TECH_DICTIONARY.languages, 'languages');
  scanGroup(TECH_DICTIONARY.frameworks, 'frameworks');
  scanGroup(TECH_DICTIONARY.databases, 'databases');
  scanGroup(TECH_DICTIONARY.toolsAndConcepts, 'tools');

  // Fallback: If no required skills were segregated from sections, classify based on title and core keywords
  if (requiredSkills.size === 0 && allFoundSkills.size > 0) {
    allFoundSkills.forEach(s => requiredSkills.add(s));
  }

  // 3. Experience & Seniority requirements
  const experience = extractExperience(fullText, job);

  // 4. Education requirements
  const education = extractEducation(fullText);

  // 5. Responsibilities
  const responsibilities = extractResponsibilities(fullText);

  // 6. ATS Keywords
  const atsKeywords = extractAtsKeywords(fullText, allFoundSkills);

  return {
    jobId: job.id,
    title: job.title || 'Software Engineer',
    company: job.company || 'Hiring Company',
    location: job.location || 'India',
    requiredSkills: Array.from(requiredSkills),
    preferredSkills: Array.from(preferredSkills),
    allSkills: Array.from(allFoundSkills),
    languages: Array.from(languages),
    frameworksAndTools: Array.from(frameworksAndTools),
    databases: Array.from(databases),
    experience,
    education,
    responsibilities,
    atsKeywords,
    summary: `${job.title} at ${job.company} requiring ${Array.from(allFoundSkills).slice(0, 5).join(', ')}`
  };
}

function partitionJdSections(text) {
  const lines = text.split('\n');
  let currentSection = 'general';
  const sections = {
    general: [],
    required: [],
    preferred: [],
    responsibilities: []
  };

  const reqPattern = /requirement|qualification|must have|what you need|what we are looking for|skills required|eligibility/i;
  const prefPattern = /preferred|good to have|nice to have|plus|bonus|desirable/i;
  const respPattern = /responsibilit|what you will do|role overview|day to day|key duties/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (prefPattern.test(trimmed) && trimmed.length < 60) {
      currentSection = 'preferred';
    } else if (reqPattern.test(trimmed) && trimmed.length < 60) {
      currentSection = 'required';
    } else if (respPattern.test(trimmed) && trimmed.length < 60) {
      currentSection = 'responsibilities';
    }

    sections[currentSection].push(trimmed);
  }

  return {
    general: sections.general.join('\n'),
    required: sections.required.join('\n') || sections.general.join('\n'),
    preferred: sections.preferred.join('\n'),
    responsibilities: sections.responsibilities.join('\n')
  };
}

function extractExperience(text, job) {
  let min = 0;
  let max = 1;
  let isFresherEligible = true;

  const lower = text.toLowerCase();

  // Check explicit database fields first
  if (job.experience_min !== undefined && job.experience_min !== null) {
    min = job.experience_min;
    max = job.experience_max !== null ? job.experience_max : min + 1;
    isFresherEligible = min <= 1;
    return { min, max, isFresherEligible, rawText: `${min}-${max} years` };
  }

  // Regex patterns for experience (e.g. "0-2 years", "7+ years of commercial experience")
  const expMatch = text.match(/(\d+)\s*(?:-|to)\s*(\d+)\s*(?:years?|yrs?)/i) ||
                   text.match(/(\d+)\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+[a-z]+)*\s*(?:experience|exp)/i) ||
                   text.match(/(\d+)\+?\s*(?:years?|yrs?)/i);

  if (expMatch) {
    min = parseInt(expMatch[1], 10);
    max = expMatch[2] ? parseInt(expMatch[2], 10) : min + 2;
    isFresherEligible = min <= 1;
  }

  if (/senior|lead|architect|staff|principal|manager|head\s+of/i.test(lower) && !/junior|entry|trainee/i.test(lower)) {
    isFresherEligible = false;
    if (min === 0) min = 3;
  }

  if (/fresher|intern|trainee|graduate|entry[\s-]level|2024|2025|2026/i.test(lower) && isFresherEligible) {
    isFresherEligible = true;
    if (min > 1) min = 0;
  }

  return {
    min,
    max,
    isFresherEligible,
    rawText: `${min}-${max} years`
  };
}

function extractEducation(text) {
  const degrees = [];
  if (/\bmca\b|\bmaster\s*of\s*computer\s*applications\b/i.test(text)) degrees.push('MCA');
  if (/\bbca\b|\bbachelor\s*of\s*computer\s*applications\b/i.test(text)) degrees.push('BCA');
  if (/\bb\.?e\.?\b|\bb\.?tech\b|\bbachelor\s*of\s*engineering\b|\bbachelor\s*of\s*technology\b/i.test(text)) degrees.push('B.Tech/B.E.');
  if (/\bm\.?tech\b|\bmaster\s*of\s*technology\b/i.test(text)) degrees.push('M.Tech');
  if (/\bcomputer\s*science\b|\bit\b|\binformation\s*technology\b/i.test(text)) degrees.push('Computer Science / IT');

  const degreeClassification = classifyDegreeRequirement(text);

  return {
    degrees: degrees.length > 0 ? degrees : ['Degree in Computer Science or related field'],
    isEligibleForMCA: degreeClassification.isStrictlyIneligible ? false : true,
    degreeClassification: degreeClassification.classification,
    eligibilityStatus: degreeClassification.eligibilityStatus,
    classificationDetails: degreeClassification
  };
}

function extractResponsibilities(text) {
  const lines = text.split('\n');
  const actionVerbs = /^(?:develop|design|build|maintain|implement|collaborate|write|test|troubleshoot|integrate|optimize|participate|ensure|work|assist|create)/i;
  const bullets = [];

  for (const line of lines) {
    const trimmed = line.replace(/^[\s*•\-–—\d.)]+/, '').trim();
    if (trimmed.length > 25 && trimmed.length < 200 && actionVerbs.test(trimmed)) {
      bullets.push(trimmed);
      if (bullets.length >= 6) break;
    }
  }

  return bullets;
}

function extractAtsKeywords(text, techSkills) {
  const domainKeywords = [
    'Object-Oriented Programming', 'OOP', 'Data Structures', 'Algorithms',
    'REST APIs', 'Microservices', 'Relational Database', 'SQL Queries',
    'Unit Testing', 'Debugging', 'Agile Methodology', 'Git Version Control',
    'Full Stack Development', 'Backend Engineering', 'Frontend Engineering',
    'Database Normalization', 'Concurrency', 'Multithreading', 'SDLC'
  ];

  const matched = new Set(techSkills);
  for (const kw of domainKeywords) {
    const regex = new RegExp(`\\b${kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
    if (regex.test(text)) {
      matched.add(kw);
    }
  }

  return Array.from(matched);
}
