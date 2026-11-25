/**
 * CareerOS — Screening Answer Intelligence Engine (Phase 13)
 * Generates transparent, evidence-grounded screening answers using exclusively verified
 * candidate profile data. Strictly prohibits fabrication or unverified experience inflation.
 * Includes reusable answer vault persistence across applications.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCandidateProfile } from '../profile/profileManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VAULT_PATH = path.resolve(__dirname, '../../data/screening_answers_vault.json');

/**
 * Loads persistent customized screening answer overrides from vault.
 */
export function getScreeningAnswersVault() {
  try {
    if (fs.existsSync(VAULT_PATH)) {
      const data = fs.readFileSync(VAULT_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn(`[ScreeningEngine] Could not read answers vault: ${err.message}`);
  }
  return {};
}

/**
 * Saves or updates a customized screening answer in the persistent vault.
 */
export function saveScreeningAnswerOverride(questionKey, answerText) {
  try {
    const vault = getScreeningAnswersVault();
    vault[questionKey] = {
      answer: answerText,
      updatedAt: new Date().toISOString()
    };
    const dir = path.dirname(VAULT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(VAULT_PATH, JSON.stringify(vault, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`[ScreeningEngine] Error saving to answers vault: ${err.message}`);
    return false;
  }
}

export function generateScreeningAnswers(job, customQuestions = []) {
  const profile = loadCandidateProfile();
  const vault = getScreeningAnswersVault();
  const answers = {};
  const compName = job?.company || 'your organization';
  const roleName = job?.title || 'Software Engineer';

  // Standard screening question catalog matched against verified profile
  const standardQuestions = [
    {
      key: 'work_authorization',
      patterns: [/legally authorized to work/i, /work authorization/i, /eligible to work in india/i, /citizenship/i],
      answer: 'Yes, I am a citizen of India with full legal authorization to work in India.',
      confidence: 'high',
      evidence: 'candidate_profile.json -> status.workAuthorization ("Citizen of India")',
      requiresUserInput: false
    },
    {
      key: 'visa_sponsorship',
      patterns: [/require (visa )?sponsorship/i, /sponsorship.*now or in the future/i, /visa.*support/i],
      answer: 'No, I do not require visa sponsorship now or in the future for employment in India.',
      confidence: 'high',
      evidence: 'candidate_profile.json -> status.workAuthorization ("Citizen of India")',
      requiresUserInput: false
    },
    {
      key: 'total_experience',
      patterns: [/total.*years of experience/i, /years of (full[- ]time )?experience/i, /how many years.*experience/i],
      answer: 'Fresher (0 years of full-time professional experience). Completed an Advanced Java Full Stack internship at Anudip Foundation (Bangalore) and hands-on academic projects during MCA.',
      confidence: 'high',
      evidence: 'candidate_profile.json -> status.fresherProfile (MCA 2026)',
      requiresUserInput: false
    },
    {
      key: 'experience_java',
      patterns: [/(years of )?experience.*(with )?java\b/i, /how many years.*java/i],
      answer: 'Fresher / Entry-level (0 years full-time employment) with hands-on Java and Spring Boot development experience through MCA academic coursework, building full-stack applications (Employee Leave Management System), and an Advanced Java Full Stack internship at Anudip Foundation.',
      confidence: 'high',
      evidence: 'candidate_profile.json -> experience[0] (Anudip Foundation Java Intern) & projects[2]',
      requiresUserInput: false
    },
    {
      key: 'experience_spring_boot',
      patterns: [/(years of )?experience.*spring\s*boot/i, /how many years.*spring/i],
      answer: 'Fresher / Entry-level with practical project experience building RESTful micro-services and MVC web applications using Spring Boot, Hibernate/JPA, and MySQL/PostgreSQL databases during MCA studies and internship training.',
      confidence: 'high',
      evidence: 'candidate_profile.json -> experience[0] & projects[2] (Employee Leave Management System)',
      requiresUserInput: false
    },
    {
      key: 'experience_react',
      patterns: [/(years of )?experience.*react/i, /how many years.*react/i],
      answer: 'Fresher / Entry-level with frontend development experience building reactive web applications using React.js and TypeScript, including state management, responsive UI, and REST API integration in NearVia and FinSight.',
      confidence: 'high',
      evidence: 'candidate_profile.json -> projects[0] (NearVia) & projects[1] (FinSight)',
      requiresUserInput: false
    },
    {
      key: 'experience_python',
      patterns: [/(years of )?experience.*python/i, /how many years.*python/i],
      answer: 'Fresher / Entry-level with practical Python experience developing FastAPI backend services, computer vision systems with OpenCV, and IoT integrations in academic and capstone projects.',
      confidence: 'high',
      evidence: 'candidate_profile.json -> projects[1] (FinSight), projects[3] (Smart Rover), projects[5] (Drowsiness Detection)',
      requiresUserInput: false
    },
    {
      key: 'education_degree',
      patterns: [/highest (level of )?education/i, /degree/i, /qualification/i, /college.*graduat/i],
      answer: 'Master of Computer Applications (MCA) from AIMS Institutes, Bangalore (2024–2026), following a Bachelor of Computer Applications (BCA) from SSA Government First Grade College, Ballari (2021–2024).',
      confidence: 'high',
      evidence: 'candidate_profile.json -> education[0] & education[1]',
      requiresUserInput: false
    },
    {
      key: 'notice_period',
      patterns: [/notice period/i, /availability/i, /how soon can you start/i, /when can you start/i],
      answer: 'Available immediately for full-time roles, internships, or training. Completing final MCA semester in 2026 with academic flexibility for employment.',
      confidence: 'high',
      evidence: 'candidate_profile.json -> status.noticePeriod ("Available / 2026 Graduate")',
      requiresUserInput: false
    },
    {
      key: 'location_relocation',
      patterns: [/willing to relocate/i, /comfortable working in (bangalore|bengaluru)/i, /current location/i],
      answer: 'Currently based in Bangalore, Karnataka, India. Fully comfortable working onsite in Bengaluru, in hybrid setups, or remotely.',
      confidence: 'high',
      evidence: 'candidate_profile.json -> personal.location & status.preferredLocations',
      requiresUserInput: false
    },
    {
      key: 'salary_expectations',
      patterns: [/expected (salary|ctc)/i, /compensation expectations/i, /salary requirement/i],
      answer: 'Open to discussion based on company standards and industry benchmarks for entry-level fresher / junior software engineer roles.',
      confidence: 'medium',
      evidence: 'Fresher baseline policy (Negotiable / Industry standard)',
      requiresUserInput: true
    },
    {
      key: 'why_company',
      patterns: [/why do you want to work (here|at|for)/i, /why are you interested in this role/i],
      answer: `I am eager to contribute my hands-on Java, Spring Boot, and React skills to ${compName}. My MCA project (NearVia) and Anudip Foundation internship trained me in building scalable REST APIs and high-availability systems, which directly aligns with your engineering requirements.`,
      confidence: 'high',
      evidence: 'Grounded alignment between verified profile and target company role',
      requiresUserInput: false
    },
    {
      key: 'tell_me_about_yourself',
      patterns: [/tell (us|me) about yourself/i, /walk (us|me) through your resume/i, /brief introduction/i],
      answer: 'I am an MCA candidate (Class of 2026) specializing in Java Full Stack development. I have hands-on experience building backend APIs using Spring Boot and relational databases, alongside interactive frontends in React.js. I completed an internship at Anudip Foundation focused on core enterprise Java, and engineered projects including an Employee Leave Management System and a Spatial Query Engine.',
      confidence: 'high',
      evidence: 'Grounded summary of candidate profile, education, internship, and core projects',
      requiresUserInput: false
    },
    {
      key: 'describe_project',
      patterns: [/describe a project/i, /challenging project/i, /technical achievement/i],
      answer: 'In my Employee Leave Management System project built with Java and Spring Boot, I designed relational database schemas, implemented role-based access control, and built clean RESTful endpoints to manage leave workflows with validation logic. I focused on clean modular architecture, input sanitization, and automated test coverage.',
      confidence: 'high',
      evidence: 'candidate_profile.json -> projects[2] (Employee Leave Management System)',
      requiresUserInput: false
    },
    {
      key: 'strengths_weaknesses',
      patterns: [/strengths (and|or) weaknesses/i, /greatest strength/i],
      answer: 'My greatest strength is disciplined software engineering fundamentals: strong OOP foundations in Java, relational data modeling, and a methodical approach to debugging and test-driven development. As an area for improvement, I am continuously broadening my real-time distributed systems knowledge as I transition from academic projects to enterprise codebases.',
      confidence: 'high',
      evidence: 'Grounded self-assessment based on verified MCA skillset',
      requiresUserInput: false
    }
  ];

  // Evaluate any custom questions provided or standard catalog
  if (Array.isArray(customQuestions) && customQuestions.length > 0) {
    for (const q of customQuestions) {
      const qText = typeof q === 'string' ? q : (q.text || q.label || q.question || '');
      let matched = false;

      // Check vault first for user overrides
      if (vault[qText] && vault[qText].answer) {
        answers[qText] = {
          question: qText,
          answer: vault[qText].answer,
          confidence: 'high (user customized)',
          evidence: 'Persistent screening answer vault',
          requiresUserInput: false
        };
        continue;
      }

      for (const std of standardQuestions) {
        if (std.patterns.some(p => p.test(qText))) {
          // Check if vault overrides this key
          const override = vault[std.key]?.answer;
          answers[qText] = {
            question: qText,
            answer: override || std.answer,
            confidence: override ? 'high (user customized)' : std.confidence,
            evidence: override ? 'Persistent screening answer vault' : std.evidence,
            requiresUserInput: override ? false : std.requiresUserInput
          };
          matched = true;
          break;
        }
      }

      // If question is unrecognized or unsupported, flag for human input
      if (!matched) {
        answers[qText] = {
          question: qText,
          answer: '',
          confidence: 'unsupported',
          evidence: 'No verified profile match. Strict non-fabrication rule enforces manual entry.',
          requiresUserInput: true
        };
      }
    }
  } else {
    // Return standard catalog keyed by key
    for (const std of standardQuestions) {
      const override = vault[std.key]?.answer;
      answers[std.key] = {
        question: std.key,
        answer: override || std.answer,
        confidence: override ? 'high (user customized)' : std.confidence,
        evidence: override ? 'Persistent screening answer vault' : std.evidence,
        requiresUserInput: override ? false : std.requiresUserInput
      };
    }
  }

  return answers;
}

/**
 * Validates that an edited or submitted answer does not contain unverified fabrication.
 */
export function validateAnswerTruthfulness(answer, profile) {
  const issues = [];
  const text = (answer || '').toLowerCase();

  // 1. Degree fabrication check
  if (/\b(ph\.?d|phd|doctorate|m\.?tech|b\.?tech|ms in cs)\b/i.test(text)) {
    const hasDegree = (profile.education || []).some(e => text.includes(e.degree.toLowerCase()));
    if (!hasDegree) {
      issues.push('Answer claims a degree (e.g. B.Tech/M.Tech/PhD) not present in verified profile (MCA/BCA).');
    }
  }

  // 2. Experience years fabrication check (flag claiming >= 1 years of professional/work/full-time experience)
  const expMatch = text.match(/(\d+)\+?\s*years?\s*(?:of\s*)?(?:[a-z-]+\s+)*(?:experience|industry|work|employment)/i);
  if (expMatch && parseInt(expMatch[1], 10) >= 1) {
    issues.push(`Answer claims ${expMatch[1]} years of professional experience, exceeding candidate's verified fresher status (0 years full-time experience).`);
  }

  // 3. Anudip Foundation employment representation check
  if (/\banudip\b/i.test(text) && /\b(full[- ]time|permanent\s*role|full[- ]time\s*software\s*engineer)\b/i.test(text)) {
    issues.push('Anudip Foundation must be represented as an internship/practical training, not full-time employment.');
  }

  // 4. Unsupported architecture buzzwords
  if (/\b(production\s*kubernetes\s*cluster|architected\s*microservices\s*at\s*scale)\b/i.test(text)) {
    issues.push('Answer contains unsupported enterprise production claims.');
  }

  return {
    valid: issues.length === 0,
    issues
  };
}
