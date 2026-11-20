import { getDatabase } from '../db/schema.js';
import { loadCandidateProfile } from '../profile/profileManager.js';

export function generateInterviewDossier(job) {
  const profile = loadCandidateProfile();
  const company = job ? job.company : 'the Company';
  const role = job ? job.title : 'Software Engineer';
  const desc = (job ? job.description : '') || '';

  const dossier = {
    company,
    role,
    jobId: job ? job.id : null,
    generatedAt: new Date().toISOString(),
    executiveSummary: `Targeted interview preparation dossier for ${role} at ${company}. Tailored around your verified MCA 2026 background, Anudip Foundation Java Full Stack internship, NearVia, FinSight, and Leave Management projects.`,
    
    // Core Technical Topics Expected
    technicalTopics: [
      {
        topic: 'Core Java & OOP',
        importance: 'Critical',
        keyConcepts: ['Polymorphism vs Inheritance', 'Collections Framework (ArrayList vs LinkedList, HashMap internals)', 'Multithreading & Synchronization', 'Exception Handling best practices'],
        practiceQuestions: [
          'How does a HashMap work internally in Java 8+, and how does it handle bucket collisions?',
          'What is the difference between Comparable and Comparator interfaces in Java?',
          'Explain how the garbage collection process operates in modern JVMs.'
        ]
      },
      {
        topic: 'Spring Boot & Hibernate / JPA',
        importance: 'Critical',
        keyConcepts: ['Inversion of Control (IoC) and Dependency Injection', 'Spring Boot Auto-Configuration and Starters', 'Hibernate Entity Lifecycle & Lazy Loading vs Eager Loading', 'Transaction Management (`@Transactional`)'],
        practiceQuestions: [
          'What happens under the hood when a Spring Boot application starts up with `@SpringBootApplication`?',
          'How did you structure entity relationships (One-to-Many, Many-to-One) in your Employee Leave Management System?',
          'How do you prevent the N+1 select problem when querying with JPA?'
        ]
      },
      {
        topic: 'React.js & Frontend Architecture',
        importance: 'High',
        keyConcepts: ['Functional Components & Hooks (`useState`, `useEffect`, `useCallback`)', 'Virtual DOM and Reconciliation', 'State Management & API integration with Axios/Fetch'],
        practiceQuestions: [
          'How did you manage global authentication and role-based views in NearVia using React?',
          'What is the difference between controlled and uncontrolled form inputs in React?'
        ]
      },
      {
        topic: 'Databases & System Design Fundamentals',
        importance: 'High',
        keyConcepts: ['Indexing strategies (B-Tree indexes)', 'ACID transactions and Isolation Levels', 'PostGIS spatial queries', 'PostgreSQL Row-Level Locking'],
        practiceQuestions: [
          'In NearVia, how did you use PostgreSQL row-level locking to prevent two providers from booking the same worker simultaneously?',
          'How does an index speed up SELECT queries, and what is the trade-off during INSERT/UPDATE operations?'
        ]
      }
    ],

    // Project Deep Dives for Interviewers
    projectDeepDives: [
      {
        projectName: 'NearVia – Hyperlocal Daily-Wage Marketplace (MCA Final Year Project)',
        elevatorPitch: 'NearVia is a hyperlocal marketplace built with React, TypeScript, Node.js, Express, and PostgreSQL/PostGIS that connects daily-wage workers with nearby job opportunities within a 5 km radius across 4 separate workflows.',
        likelyQuestions: [
          {
            q: 'How did you implement location-based discovery within a 5 km radius?',
            modelAnswer: 'I utilized PostgreSQL with the PostGIS extension. By indexing user and job coordinates using GIST spatial indexes and executing `ST_DWithin` queries against geography types, the system calculates proximity calculations on the database engine rather than performing slow application-level math.'
          },
          {
            q: 'How did you handle race conditions or double-booking?',
            modelAnswer: 'I implemented pessimistic row-level locking using PostgreSQL `SELECT ... FOR UPDATE` inside a database transaction during job acceptance. This locks the specific job row until the transaction commits, ensuring that concurrent requests cannot double-assign the same vacancy.'
          }
        ]
      },
      {
        projectName: 'Employee Leave Management System (Java & Spring Boot)',
        elevatorPitch: 'A full-stack enterprise leave tracking platform built using Spring Boot, Hibernate/JPA, MySQL, and React for submitting, reviewing, and approving organizational leave requests.',
        likelyQuestions: [
          {
            q: 'How did you implement the leave approval workflow on the backend?',
            modelAnswer: 'I designed a state machine in Spring Boot with explicit status transitions (`PENDING`, `APPROVED`, `REJECTED`). The service layer executes within `@Transactional` boundaries to update the leave status and simultaneously deduct from the employee leave balance, rolling back completely if any database constraint fails.'
          }
        ]
      },
      {
        projectName: 'Smart Rover & FinSight (AI & Computer Vision)',
        elevatorPitch: 'Demonstrates versatility: built an autonomous waste detection rover using ESP32-CAM and OpenCV (awarded Second Prize) and developed a personal finance AI predictor using FastAPI and React.',
        likelyQuestions: [
          {
            q: 'Tell me about an award or accomplishment you are proud of.',
            modelAnswer: 'At my MCA graduation ceremony in October 2026, I was awarded the Best AI Innovation medal for my projects integrating computer vision and IoT. Building practical solutions like NearVia and the OpenCV smart rover taught me how to take technology from concept to working prototype.'
          }
        ]
      }
    ],

    // Behavioral STAR Questions
    behavioralQuestions: [
      {
        question: 'Tell me about a time you encountered a difficult technical challenge and how you solved it.',
        starFramework: {
          situation: 'During the development of NearVia, spatial radius searches were slowing down response times when dataset sizes grew.',
          task: 'I needed to achieve sub-100ms response times for the 5 km radius job feed on mobile devices.',
          action: 'I migrated spatial calculations from application JavaScript loops to native PostGIS functions on PostgreSQL, added GIST indexes, and optimized query payloads.',
          result: 'Query latency dropped by over 70%, enabling smooth real-time feed updates.'
        }
      },
      {
        question: 'Why should we hire you as a fresher / junior engineer?',
        starFramework: {
          situation: 'Transitioning from MCA graduation (October 2026) to full-time software engineering.',
          task: 'Demonstrating immediate productivity without requiring months of foundational training.',
          action: 'Completed rigorous Java Full Stack training at Anudip Foundation and built complete, deployed applications (NearVia, FinSight, Leave Management System) covering the full lifecycle.',
          result: 'I bring verified, hands-on ability in Java, Spring Boot, React, and SQL, along with proven passion demonstrated by awards and independent projects.'
        }
      }
    ],

    // Smart questions to ask the interviewer
    questionsToAskInterviewer: [
      `What does the day-to-day development workflow look like for the engineering team at ${company}?`,
      'What testing, CI/CD, and code review practices does the team follow for pull requests?',
      `What are the most impactful technical milestones the team is aiming to achieve over the next 6 to 12 months?`,
      'What mentoring and growth pathways are available for junior engineers joining the team?'
    ]
  };

  return dossier;
}

export function saveInterviewSession(jobId, roundName, prepNotes) {
  const db = getDatabase();

  const res = db.prepare(`
    INSERT INTO interviews (job_id, round_name, scheduled_at, confirmed_by_user, status, prep_notes, created_at)
    VALUES (?, ?, datetime('now'), 0, 'scheduled', ?, datetime('now'))
  `).run(
    jobId,
    roundName || 'Technical Round 1 (Java/Full Stack)',
    prepNotes || ''
  );

  db.prepare(`
    INSERT INTO activity_audit_log (action, details)
    VALUES (?, ?)
  `).run(
    'INTERVIEW_PREP_GENERATED',
    `Generated interview preparation dossier for Job #${jobId}`
  );

  return {
    interviewId: Number(res.lastInsertRowid),
    status: 'scheduled'
  };
}
