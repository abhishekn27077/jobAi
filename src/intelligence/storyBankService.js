import { getDatabase } from '../db/schema.js';

export const CANONICAL_STORIES = [
  {
    title: 'NearVia 5km Proximity Search Optimization',
    category: 'technical_challenge',
    context_source: 'NearVia (MCA Final Project)',
    technologies: 'PostgreSQL, PostGIS, GIST Indexing, ST_DWithin, Express.js',
    situation: 'During initial testing of NearVia, searching for nearby daily-wage work across growing applicant and vacancy records resulted in noticeable response latency (>350ms) using application-level Euclidean distance math.',
    task: 'I needed to achieve sub-80ms query response times on mobile devices for workers searching within a strict 5 km radius.',
    action: 'I migrated spatial calculations from application JavaScript loops to the PostgreSQL PostGIS extension. I indexed candidate and employer GPS coordinates with GIST spatial indexes and restructured the search query using native `ST_DWithin` on geography types.',
    result: 'Spatial query latency dropped from 380ms to 45ms (over 85% improvement), allowing seamless real-time location filtering and low battery consumption on mobile devices.',
    applicable_questions: [
      'Tell me about a difficult technical challenge you solved.',
      'How have you optimized database query performance?',
      'Have you ever worked with spatial data or complex indexing?'
    ]
  },
  {
    title: 'Preventing Concurrent Double-Booking in NearVia',
    category: 'problem_solving',
    context_source: 'NearVia (MCA Final Project)',
    technologies: 'PostgreSQL, Row-Level Locking, ACID Transactions, Node.js',
    situation: 'In a hyperlocal daily-wage market, multiple contractors often attempt to accept the same high-urgency job vacancy simultaneously during morning peak hours.',
    task: 'Ensure zero double-allocation of job vacancies without introducing distributed locking overhead or blocking other unrelated job acceptances.',
    action: 'I implemented pessimistic row-level locking using PostgreSQL `SELECT ... FOR UPDATE` enclosed within an explicit database transaction. When one provider initiates acceptance, the specific job record is locked until the transaction commits or rolls back, while other transactions wait cleanly and then receive a vacancy-filled status.',
    result: 'Zero race conditions or double-bookings occurred during stress testing with 50 concurrent simulated client requests, maintaining total transactional integrity.',
    applicable_questions: [
      'How do you handle race conditions or concurrent updates in a database?',
      'Explain an ACID transaction implementation you have built.',
      'What is the difference between optimistic and pessimistic locking?'
    ]
  },
  {
    title: 'Transactional Workflow in Employee Leave Management',
    category: 'academic_project',
    context_source: 'Employee Leave Management System',
    technologies: 'Java, Spring Boot, Hibernate/JPA, MySQL, React.js',
    situation: 'The leave management system required robust approval workflows where approving a leave request had to deduct from the employee leave balance, record manager comments, and notify the employee atomically.',
    task: 'Guarantee that partial database updates never occur if any validation or database constraint fails during multi-step manager approvals.',
    action: 'I designed a state-machine approval service in Spring Boot managed by `@Transactional` boundaries. I implemented JPA entity lifecycle hooks to audit state changes and validated balance thresholds before persisting status updates.',
    result: 'Created an enterprise-grade leave portal with zero balance discrepancies across 100+ simulated approval cycles, complete with automated rollbacks on validation failures.',
    applicable_questions: [
      'How do you manage transactions in Spring Boot?',
      'How have you structured backend business logic with Spring and JPA?',
      'Walk me through an end-to-end full stack application you built.'
    ]
  },
  {
    title: 'Cross-Disciplinary Teamwork on Smart Rover',
    category: 'teamwork',
    context_source: 'Smart Rover Project',
    technologies: 'ESP32-CAM, Python, OpenCV, Telegram Bot API',
    situation: 'During our college robotics initiative, our 3-member team was tasked with building an autonomous vehicle that detects waste in real time and alerts municipal coordinators.',
    task: 'Coordinate hardware assembly, camera streaming stability, and computer vision classification between members with differing technical backgrounds.',
    action: 'I took ownership of the OpenCV computer vision pipeline and Telegram notification API, while setting up daily check-ins and an interface contract with my teammate managing the motor drivers and power supply. When frame drops occurred over Wi-Fi, I downscaled video frames before processing to preserve throughput.',
    result: 'Our team successfully built and demonstrated the working rover live at the College Science Exhibition, winning Second Prize among 25 competing teams.',
    applicable_questions: [
      'Tell me about a time you collaborated with a team under a deadline.',
      'How do you resolve technical disagreements or communication gaps?',
      'Describe a project where you worked with IoT or computer vision.'
    ]
  },
  {
    title: 'Enterprise Full-Stack Internship Training at Anudip Foundation',
    category: 'internship',
    context_source: 'Anudip Foundation, Bangalore',
    technologies: 'Java, OOP, JDBC, Collections, Spring Boot, MySQL',
    situation: 'Transitioning from academic theory to industry-standard Java software engineering standards during my intensive full stack training internship.',
    task: 'Master advanced Core Java constructs, Spring Boot service architectures, clean coding practices, and multithreading under strict weekly evaluation rubrics.',
    action: 'I developed Java applications focusing on Collections Framework optimizations (ArrayList vs LinkedList, HashMap collision handling), structured relational schemas using JDBC and Hibernate, and built REST APIs with Spring Boot and MySQL.',
    result: 'Successfully completed the program with high marks, gaining verified proficiency in backend enterprise Java patterns that I subsequently applied to my production-ready MCA capstone.',
    applicable_questions: [
      'Tell me about your internship experience.',
      'What were the most important technical lessons from your training at Anudip Foundation?',
      'Why did you choose Java and Spring Boot as your core backend specialization?'
    ]
  },
  {
    title: 'Best AI Innovation Medal at MCA Graduation',
    category: 'achievement',
    context_source: 'AIMS Institutes MCA Graduation (Oct 2026)',
    technologies: 'Python, OpenCV, ESP32, React, Full Stack Engineering',
    situation: 'Graduating from AIMS Institutes with Master of Computer Applications (MCA) in October 2026 among a cohort of talented engineering peers.',
    task: 'Demonstrate sustained innovation, academic dedication, and practical software engineering capability across final-year project evaluations.',
    action: 'I consistently built working, tangible prototypes rather than theoretical reports—combining computer vision on IoT edge hardware (Smart Rover) with full-stack societal platforms (NearVia) and financial forecasting (FinSight).',
    result: 'Awarded the Best AI Innovation Medal by the faculty and university leadership at the graduation ceremony on 31 October 2026, alongside two science fair project awards.',
    applicable_questions: [
      'What is your proudest academic or engineering accomplishment?',
      'What drives your passion for software engineering?',
      'How do you stand out among fresher candidates?'
    ]
  }
];

/**
 * Returns all STAR stories, seeding the database if empty
 */
export function getAllStories() {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM interview_stories ORDER BY id ASC').all();

  if (rows.length > 0) {
    return rows.map(formatStoryRow);
  }

  // Seed canonical stories
  const insert = db.prepare(`
    INSERT INTO interview_stories
    (title, category, context_source, situation, task, action, result, technologies, applicable_questions_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const s of CANONICAL_STORIES) {
    insert.run(
      s.title,
      s.category,
      s.context_source,
      s.situation,
      s.task,
      s.action,
      s.result,
      s.technologies,
      JSON.stringify(s.applicable_questions)
    );
  }

  return db.prepare('SELECT * FROM interview_stories ORDER BY id ASC').all().map(formatStoryRow);
}

/**
 * Returns stories filtered by category
 */
export function getStoriesByCategory(category) {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM interview_stories WHERE category = ? ORDER BY id ASC').all(category);
  return rows.map(formatStoryRow);
}

/**
 * Searches stories by keyword across title, situation, action, result, and technologies
 */
export function searchStories(keyword) {
  if (!keyword || !keyword.trim()) return getAllStories();
  const db = getDatabase();
  const pattern = `%${keyword.trim().toLowerCase()}%`;

  const rows = db.prepare(`
    SELECT * FROM interview_stories
    WHERE LOWER(title) LIKE ?
       OR LOWER(situation) LIKE ?
       OR LOWER(action) LIKE ?
       OR LOWER(result) LIKE ?
       OR LOWER(technologies) LIKE ?
       OR LOWER(context_source) LIKE ?
    ORDER BY id ASC
  `).all(pattern, pattern, pattern, pattern, pattern, pattern);

  return rows.map(formatStoryRow);
}

/**
 * Creates or updates an interview story
 */
export function createOrUpdateStory({ id, title, category, contextSource, situation, task, action, result, technologies, applicableQuestions }) {
  if (!title || !situation || !action || !result) {
    throw new Error('Stories must include title, situation, action, and result.');
  }

  const db = getDatabase();
  const questionsJson = JSON.stringify(applicableQuestions || []);

  if (id) {
    db.prepare(`
      UPDATE interview_stories
      SET title = ?, category = ?, context_source = ?, situation = ?, task = ?, action = ?, result = ?, technologies = ?, applicable_questions_json = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(title, category || 'academic_project', contextSource || 'Profile Project', situation, task || '', action, result, technologies || '', questionsJson, id);
    const updated = db.prepare('SELECT * FROM interview_stories WHERE id = ?').get(id);
    return formatStoryRow(updated);
  } else {
    const info = db.prepare(`
      INSERT INTO interview_stories
      (title, category, context_source, situation, task, action, result, technologies, applicable_questions_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, category || 'academic_project', contextSource || 'Profile Project', situation, task || '', action, result, technologies || '', questionsJson);
    const inserted = db.prepare('SELECT * FROM interview_stories WHERE id = ?').get(info.lastInsertRowid);
    return formatStoryRow(inserted);
  }
}

function formatStoryRow(row) {
  let questions = [];
  try {
    questions = row.applicable_questions_json ? JSON.parse(row.applicable_questions_json) : [];
  } catch {
    questions = [];
  }

  return {
    id: row.id,
    title: row.title,
    category: row.category,
    contextSource: row.context_source,
    situation: row.situation,
    task: row.task,
    action: row.action,
    result: row.result,
    technologies: row.technologies,
    applicableQuestions: questions,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
