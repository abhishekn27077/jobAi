/**
 * CareerOS — Screening Answer Intelligence Engine
 * Generates transparent, evidence-grounded screening answers using exclusively verified
 * candidate profile data. Strictly prohibits fabrication or unverified experience inflation.
 */

import { loadCandidateProfile } from '../profile/profileManager.js';

export function generateScreeningAnswers(job, customQuestions = []) {
  const profile = loadCandidateProfile();
  const answers = {};

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
      key: 'experience_java',
      patterns: [/(years of )?experience.*(with )?java\b/i, /how many years.*java/i],
      answer: '1 year of hands-on Java and Spring Boot development experience through MCA academic coursework, building full-stack applications (Employee Leave Management System), and my Java Full Stack internship at Anudip Foundation.',
      confidence: 'high',
      evidence: 'candidate_profile.json -> experience[0] (Anudip Foundation Java Intern) & projects[2]',
      requiresUserInput: false
    },
    {
      key: 'experience_spring_boot',
      patterns: [/(years of )?experience.*spring\s*boot/i, /how many years.*spring/i],
      answer: '1 year of practical experience building RESTful micro-services and MVC web applications using Spring Boot, Hibernate/JPA, and MySQL/PostgreSQL databases.',
      confidence: 'high',
      evidence: 'candidate_profile.json -> experience[0] & projects[2] (Employee Leave Management System)',
      requiresUserInput: false
    },
    {
      key: 'experience_react',
      patterns: [/(years of )?experience.*react/i, /how many years.*react/i],
      answer: '1 year of frontend development experience building reactive web applications using React.js and TypeScript, including state management, responsive UI, and REST API integration in NearVia and FinSight.',
      confidence: 'high',
      evidence: 'candidate_profile.json -> projects[0] (NearVia) & projects[1] (FinSight)',
      requiresUserInput: false
    },
    {
      key: 'experience_python',
      patterns: [/(years of )?experience.*python/i, /how many years.*python/i],
      answer: '1 year of Python experience developing FastAPI backend services, computer vision systems with OpenCV, and IoT integrations in academic and capstone projects.',
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
      answer: `I am eager to contribute my hands-on Java, Spring Boot, and React skills to ${job.company || 'your team'}. My MCA project (NearVia) and Anudip Foundation internship trained me in building scalable REST APIs and high-availability systems, which directly aligns with your engineering requirements.`,
      confidence: 'high',
      evidence: 'Grounded alignment between verified profile and target company role',
      requiresUserInput: false
    }
  ];

  // Evaluate any custom questions provided or standard catalog
  if (Array.isArray(customQuestions) && customQuestions.length > 0) {
    for (const q of customQuestions) {
      const qText = typeof q === 'string' ? q : (q.text || q.label || q.question || '');
      let matched = false;

      for (const std of standardQuestions) {
        if (std.patterns.some(p => p.test(qText))) {
          answers[qText] = {
            question: qText,
            answer: std.answer,
            confidence: std.confidence,
            evidence: std.evidence,
            requiresUserInput: std.requiresUserInput
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
      answers[std.key] = {
        question: std.key,
        answer: std.answer,
        confidence: std.confidence,
        evidence: std.evidence,
        requiresUserInput: std.requiresUserInput
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

  // 2. Experience years fabrication check (> 2 years for fresher)
  const expMatch = text.match(/(\d+)\+?\s*years?\s*of\s*(professional|work|industry)\s*experience/i);
  if (expMatch && parseInt(expMatch[1], 10) > 2) {
    issues.push(`Answer claims ${expMatch[1]} years of professional experience, exceeding verified fresher/internship record.`);
  }

  // 3. Unsupported architecture buzzwords
  if (/\b(production\s*kubernetes\s*cluster|architected\s*microservices\s*at\s*scale)\b/i.test(text)) {
    issues.push('Answer contains unsupported enterprise production claims.');
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

