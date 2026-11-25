import { getDatabase } from '../db/schema.js';

export const QUESTION_CATEGORIES = [
  'Java',
  'Spring Boot',
  'SQL & Databases',
  'React & Frontend',
  'Full Stack & APIs',
  'AI & Computer Vision',
  'Project Deep Dives',
  'Behavioral & STAR',
  'HR & Motivation'
];

export const CANONICAL_QUESTIONS = [
  // 1. Java
  {
    category: 'Java',
    topic: 'Collections & Memory',
    question: 'How does HashMap handle bucket collisions in Java 8+, and when does it transform into a Red-Black tree?',
    sampleAnswer: 'In Java 8+, HashMap uses an array of Node buckets. When collisions occur, elements are stored in a singly-linked list. If a single bucket accumulates 8 elements (TREEIFY_THRESHOLD) and the overall map capacity is at least 64, that bucket transforms into a balanced Red-Black tree (TreeNode), reducing worst-case search time from O(n) to O(log n). If elements decrease to 6 (UNTREEIFY_THRESHOLD), it reverts back to a linked list.',
    keyConcepts: ['Bucket hashing', 'TREEIFY_THRESHOLD = 8', 'O(log n) tree search', 'hashCode() & equals() contract'],
    difficulty: 'fresher',
    tags: ['Java', 'Collections', 'HashMap', 'Data Structures']
  },
  {
    category: 'Java',
    topic: 'Core OOP & Memory',
    question: 'What is the contract between equals() and hashCode() in Java, and what happens if you override one without the other?',
    sampleAnswer: 'The contract states that if two objects are equal according to equals(), they must produce the exact same integer from hashCode(). However, two unequal objects may produce the same hash code (a hash collision). If you override equals() without hashCode(), hash-based collections like HashMap or HashSet will place equal objects into different buckets, causing lookup failures and duplicate entries.',
    keyConcepts: ['Object identity vs equality', 'hashCode contract', 'HashMap lookup failure', 'Consistent hashing'],
    difficulty: 'fresher',
    tags: ['Java', 'OOP', 'Memory']
  },
  {
    category: 'Java',
    topic: 'Concurrency & Multithreading',
    question: 'What is the difference between synchronized keyword and ReentrantLock in Java?',
    sampleAnswer: 'Synchronized is a built-in Java keyword that operates at JVM level with implicit lock acquisition and release. ReentrantLock is an API in java.util.concurrent.locks that provides advanced features like timed lock attempts (tryLock), interruptible locks, fairness policies, and multiple condition variables, but requires explicit release inside a finally block.',
    keyConcepts: ['Implicit vs explicit locking', 'tryLock() non-blocking attempts', 'Fairness policies', 'Reentrancy'],
    difficulty: 'junior',
    tags: ['Java', 'Concurrency', 'Threading']
  },

  // 2. Spring Boot
  {
    category: 'Spring Boot',
    topic: 'Architecture & IoC',
    question: 'What does @SpringBootApplication encapsulate, and how does Auto-Configuration work?',
    sampleAnswer: '`@SpringBootApplication` is a meta-annotation combining `@SpringBootConfiguration`, `@EnableAutoConfiguration`, and `@ComponentScan`. Auto-Configuration inspects the classpath for starter dependencies (e.g. spring-boot-starter-web) and automatically registers candidate beans (like DispatcherServlet or DataSource) using conditional annotations like `@ConditionalOnClass` and `@ConditionalOnMissingBean`.',
    keyConcepts: ['ComponentScan', 'EnableAutoConfiguration', 'Conditional annotations', 'Starter dependencies'],
    difficulty: 'fresher',
    tags: ['Spring Boot', 'IoC', 'Architecture']
  },
  {
    category: 'Spring Boot',
    topic: 'Transactions & Persistence',
    question: 'How does @Transactional work under the hood in Spring Boot, and what causes it to not roll back?',
    sampleAnswer: '`@Transactional` uses Spring AOP to create a dynamic proxy around the bean. The proxy intercepts the method call, begins a database transaction, executes the method, and commits upon successful return. By default, it rolls back ONLY on unchecked exceptions (RuntimeException and Error). Checked exceptions do NOT trigger rollback unless explicitly configured with `@Transactional(rollbackFor = Exception.class)`. Also, calling a transactional method from within the same class bypasses the proxy and negates transaction management.',
    keyConcepts: ['AOP Dynamic Proxy', 'Unchecked vs Checked rollback', 'Self-invocation caveat', 'ACID transaction boundary'],
    difficulty: 'junior',
    tags: ['Spring Boot', 'Transactions', 'JPA', 'AOP']
  },
  {
    category: 'Spring Boot',
    topic: 'JPA & Hibernate',
    question: 'What is the N+1 select problem in Hibernate/JPA, and how do you resolve it?',
    sampleAnswer: 'The N+1 problem occurs when querying 1 parent entity results in N additional separate queries to load each associated child entity (often due to lazy loading in a loop). It is resolved by using JOIN FETCH in JPQL queries, using `@EntityGraph` to eagerly load relationships in a single joined query, or configuring batch fetching (`@BatchSize`).',
    keyConcepts: ['Lazy vs Eager loading', 'JOIN FETCH', 'EntityGraph', 'Batch fetching'],
    difficulty: 'junior',
    tags: ['Spring Boot', 'Hibernate', 'JPA', 'Performance']
  },

  // 3. SQL & Databases
  {
    category: 'SQL & Databases',
    topic: 'Indexing & Performance',
    question: 'What is the difference between an index seek and an index scan in relational databases?',
    sampleAnswer: 'An index seek traverses the B-Tree directly to pinpoint the exact starting row matching the query predicate in O(log n) tree depth operations. An index scan reads through all leaf nodes of the index sequentially because the query condition is non-sargable (e.g. using leading wildcards like LIKE "%test" or function calls on columns) or lacks the leading index column.',
    keyConcepts: ['B-Tree traversal', 'Sargable queries', 'Index Seek vs Scan', 'Covering index'],
    difficulty: 'fresher',
    tags: ['SQL', 'Indexing', 'PostgreSQL', 'MySQL']
  },
  {
    category: 'SQL & Databases',
    topic: 'Concurrency & Locking',
    question: 'What is the difference between optimistic and pessimistic locking, and when would you use each?',
    sampleAnswer: 'Optimistic locking assumes conflicts are rare; it uses a version or timestamp column to verify the record was not modified between read and write, failing at commit time if a conflict occurs. Pessimistic locking (e.g. `SELECT ... FOR UPDATE`) acquires an exclusive database lock immediately upon reading, preventing concurrent transactions from updating the row until the transaction finishes. Pessimistic locking is ideal for high-contention operations like job vacancy acceptance in NearVia.',
    keyConcepts: ['Optimistic versioning', 'Pessimistic SELECT FOR UPDATE', 'Concurrency contention', 'ACID isolation'],
    difficulty: 'junior',
    tags: ['SQL', 'Transactions', 'Concurrency', 'Locking']
  },

  // 4. React & Frontend
  {
    category: 'React & Frontend',
    topic: 'State & Component Lifecycle',
    question: 'Explain the Virtual DOM reconciliation algorithm and the importance of stable keys in lists.',
    sampleAnswer: 'React maintains an in-memory Virtual DOM tree. When state changes, a new tree is constructed and compared against the previous tree using a heuristic O(n) diffing algorithm. Stable keys allow React to identify which items have changed, been added, or been removed across renders. Using array indices as keys can cause subtle bugs when items are reordered or filtered because the index does not persistently identify the underlying data.',
    keyConcepts: ['Virtual DOM', 'Reconciliation heuristic', 'Component diffing', 'Key stability'],
    difficulty: 'fresher',
    tags: ['React', 'Virtual DOM', 'Frontend']
  },
  {
    category: 'React & Frontend',
    topic: 'Hooks & Routing',
    question: 'How did you handle authentication state and role-based route guards in NearVia?',
    sampleAnswer: 'In NearVia, I created an AuthContext that holds the logged-in user profile, JWT token, and verified role (worker, provider, agent, or admin). ProtectedRoute wrappers check whether an authenticated session exists and whether the user role matches the allowed permissions; unauthorized users are redirected to login with a preserved returnUrl.',
    keyConcepts: ['Context API', 'JWT authentication', 'Role-Based Access Control', 'Protected Route pattern'],
    difficulty: 'junior',
    tags: ['React', 'Auth', 'Architecture', 'TypeScript']
  },

  // 5. Full Stack & APIs
  {
    category: 'Full Stack & APIs',
    topic: 'REST API Design',
    question: 'What HTTP status codes should you return for client errors, resource creation, and unauthorized vs forbidden access?',
    sampleAnswer: 'Resource creation returns 201 Created with a Location header. Validation errors return 400 Bad Request. 401 Unauthorized indicates the user is not authenticated (missing or invalid token). 403 Forbidden indicates the user is authenticated but lacks required permission to access the resource. 404 Not Found indicates the resource does not exist.',
    keyConcepts: ['HTTP semantics', '201 Created', '401 vs 403 distinction', 'Idempotency'],
    difficulty: 'fresher',
    tags: ['REST', 'HTTP', 'APIs']
  },

  // 6. Project Deep Dives
  {
    category: 'Project Deep Dives',
    topic: 'NearVia Architecture',
    question: 'Walk me through NearVia: how did you implement the 5 km proximity matching engine?',
    sampleAnswer: 'NearVia is a hyperlocal daily-wage marketplace built with React, TypeScript, Node.js, Express, and PostgreSQL with PostGIS. To discover jobs within a 5 km radius, user GPS coordinates and job locations are stored as geography types and indexed with GIST spatial indexes. Proximity queries execute native `ST_DWithin` functions directly inside PostgreSQL, executing in under 50ms without pulling large coordinate sets into JavaScript.',
    keyConcepts: ['PostGIS extension', 'GIST spatial indexing', 'ST_DWithin function', 'Hyperlocal architecture'],
    difficulty: 'fresher',
    tags: ['Projects', 'NearVia', 'PostGIS', 'Full Stack']
  },
  {
    category: 'Project Deep Dives',
    topic: 'NearVia Concurrency',
    question: 'How did you prevent two contractors from accepting the same job opening simultaneously in NearVia?',
    sampleAnswer: 'I implemented pessimistic row-level locking using PostgreSQL `SELECT ... FOR UPDATE` inside an explicit transaction when a provider accepts a job. This locks the specific job row; concurrent attempts are blocked until the first transaction completes, at which point the job status is already marked `ASSIGNED`, preventing double-booking.',
    keyConcepts: ['SELECT ... FOR UPDATE', 'Row-level locks', 'Race condition prevention', 'ACID transactions'],
    difficulty: 'junior',
    tags: ['Projects', 'NearVia', 'PostgreSQL', 'Concurrency']
  },
  {
    category: 'Project Deep Dives',
    topic: 'Employee Leave Management',
    question: 'How does the leave approval state machine and transaction boundary operate in your Leave Management project?',
    sampleAnswer: 'In my Employee Leave Management System built with Spring Boot, MySQL, and React, leave requests follow a strict state machine (`PENDING` -> `APPROVED` | `REJECTED`). The approval service method is annotated with `@Transactional`. It checks the employee remaining leave balance, transitions the request status, and decrements the balance atomically. If any constraint fails, the entire transaction is rolled back.',
    keyConcepts: ['Spring @Transactional', 'State machine pattern', 'Data integrity', 'Atomic balance update'],
    difficulty: 'fresher',
    tags: ['Projects', 'Java', 'Spring Boot', 'MySQL']
  },

  // 7. AI & Computer Vision
  {
    category: 'AI & Computer Vision',
    topic: 'Smart Rover & IoT',
    question: 'How did you process computer vision frames from the ESP32-CAM in your Smart Rover project?',
    sampleAnswer: 'The ESP32-CAM captures video and streams JPEG frames over Wi-Fi to a Python backend running OpenCV. To prevent latency and buffer overflow, frames were downscaled to 320x240 before passing to the contour detection pipeline. When waste objects were identified with consistent threshold confidence, alerts were automatically sent to municipal authorities via Telegram Bot API.',
    keyConcepts: ['ESP32-CAM streaming', 'Frame downscaling', 'OpenCV contour analysis', 'Telegram Bot webhook'],
    difficulty: 'junior',
    tags: ['AI', 'Computer Vision', 'OpenCV', 'IoT']
  },

  // 8. Behavioral & STAR
  {
    category: 'Behavioral & STAR',
    topic: 'Technical Challenge',
    question: 'Describe a difficult technical problem you faced during development and how you resolved it.',
    sampleAnswer: 'Situation: During early testing of NearVia, spatial radius searches took over 350ms on mobile when calculating Euclidean distances in Node.js loops.\nTask: Achieve sub-80ms response times for mobile workers.\nAction: I migrated calculations to native PostgreSQL PostGIS functions with GIST indexes on geographic coordinates.\nResult: Query response times dropped to 45ms (an 85% reduction), significantly improving battery life and mobile usability.',
    keyConcepts: ['STAR framework', 'Bottleneck profiling', 'Database offloading', 'Measurable latency reduction'],
    difficulty: 'fresher',
    tags: ['STAR', 'Behavioral', 'Problem Solving']
  },

  // 9. HR & Motivation
  {
    category: 'HR & Motivation',
    topic: 'Career Trajectory',
    question: 'Why should we hire you as an MCA fresher over other candidates?',
    sampleAnswer: 'I bring both verified academic foundations (graduated MCA in October 2026 with the Best AI Innovation medal) and hands-on production engineering practice. At Anudip Foundation, I completed rigorous enterprise Java full-stack training. Beyond coursework, I built and deployed complete applications like NearVia with PostGIS spatial queries and row-level locking, and a Spring Boot Leave Management System with transactional state machines. I am ready to contribute immediately with clean code, strong work ethic, and eagerness to learn.',
    keyConcepts: ['MCA 2026 graduate', 'Anudip Foundation training', 'Verified deployed projects', 'Continuous learning mindset'],
    difficulty: 'fresher',
    tags: ['HR', 'Motivation', 'Fresher Pitch']
  }
];

/**
 * Seed canonical questions if question bank is empty
 */
export function seedQuestionBank() {
  const db = getDatabase();

  const countRow = db.prepare('SELECT COUNT(*) as count FROM interview_question_bank').get();
  if (countRow && countRow.count > 0) {
    return { seeded: false, count: countRow.count };
  }

  const insertStmt = db.prepare(`
    INSERT INTO interview_question_bank (
      category, topic, question, sample_answer, key_concepts_json,
      difficulty, tags_json, is_saved, reviewed_status, user_notes,
      revision_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'unreviewed', '', 0, datetime('now'), datetime('now'))
  `);

  let added = 0;
  for (const q of CANONICAL_QUESTIONS) {
    insertStmt.run(
      q.category,
      q.topic,
      q.question,
      q.sampleAnswer,
      JSON.stringify(q.keyConcepts || []),
      q.difficulty || 'junior',
      JSON.stringify(q.tags || [])
    );
    added++;
  }

  return { seeded: true, count: added };
}

/**
 * Get questions with filtering, searching, and pagination
 */
export function getQuestions(filter = {}) {
  const db = getDatabase();
  seedQuestionBank(); // ensure seeded

  const {
    category,
    difficulty,
    search,
    isSaved,
    reviewedStatus,
    limit = 50,
    offset = 0
  } = filter;

  let query = 'SELECT * FROM interview_question_bank WHERE 1=1';
  const params = [];

  if (category && category !== 'all') {
    query += ' AND category = ?';
    params.push(category);
  }

  if (difficulty && difficulty !== 'all') {
    query += ' AND difficulty = ?';
    params.push(difficulty);
  }

  if (isSaved !== undefined && isSaved !== null && isSaved !== '') {
    query += ' AND is_saved = ?';
    params.push(isSaved ? 1 : 0);
  }

  if (reviewedStatus && reviewedStatus !== 'all') {
    query += ' AND reviewed_status = ?';
    params.push(reviewedStatus);
  }

  if (search && search.trim()) {
    query += ' AND (question LIKE ? OR topic LIKE ? OR sample_answer LIKE ?)';
    const term = `%${search.trim()}%`;
    params.push(term, term, term);
  }

  // Count total matching
  const countSql = query.replace('SELECT *', 'SELECT COUNT(*) as count');
  const countRow = db.prepare(countSql).get(...params);
  const total = countRow ? countRow.count : 0;

  query += ' ORDER BY id ASC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params);

  const questions = rows.map(r => ({
    ...r,
    key_concepts: JSON.parse(r.key_concepts_json || '[]'),
    tags: JSON.parse(r.tags_json || '[]')
  }));

  return {
    total,
    limit,
    offset,
    questions
  };
}

/**
 * Get question by ID
 */
export function getQuestionById(id) {
  const db = getDatabase();
  const r = db.prepare('SELECT * FROM interview_question_bank WHERE id = ?').get(id);
  if (!r) return null;
  return {
    ...r,
    key_concepts: JSON.parse(r.key_concepts_json || '[]'),
    tags: JSON.parse(r.tags_json || '[]')
  };
}

/**
 * Update question status (save, review status, user notes)
 */
export function updateQuestionStatus(id, updates = {}) {
  const db = getDatabase();
  const q = db.prepare('SELECT * FROM interview_question_bank WHERE id = ?').get(id);
  if (!q) {
    throw new Error(`Question #${id} not found in Question Bank`);
  }

  const isSaved = updates.isSaved !== undefined ? (updates.isSaved ? 1 : 0) : q.is_saved;
  const reviewedStatus = updates.reviewedStatus || q.reviewed_status;
  const userNotes = updates.userNotes !== undefined ? updates.userNotes : q.user_notes;

  // Increment revision count if notes or reviewed status changed
  const notesChanged = updates.userNotes !== undefined && updates.userNotes !== q.user_notes;
  const statusChanged = updates.reviewedStatus !== undefined && updates.reviewedStatus !== q.reviewed_status;
  const newRevisionCount = (notesChanged || statusChanged) ? (q.revision_count + 1) : q.revision_count;

  db.prepare(`
    UPDATE interview_question_bank
    SET is_saved = ?,
        reviewed_status = ?,
        user_notes = ?,
        revision_count = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    isSaved,
    reviewedStatus,
    userNotes,
    newRevisionCount,
    id
  );

  return getQuestionById(id);
}

/**
 * Add custom question
 */
export function addQuestion(questionData) {
  const db = getDatabase();
  const {
    category = 'General',
    topic = 'Custom Topic',
    question,
    sampleAnswer,
    keyConcepts = [],
    difficulty = 'junior',
    tags = [],
    userNotes = '',
    jobId = null
  } = questionData;

  if (!question || !sampleAnswer) {
    throw new Error('Question and sampleAnswer are required');
  }

  const res = db.prepare(`
    INSERT INTO interview_question_bank (
      category, topic, question, sample_answer, key_concepts_json,
      difficulty, tags_json, is_saved, reviewed_status, user_notes,
      revision_count, job_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'unreviewed', ?, 0, ?, datetime('now'), datetime('now'))
  `).run(
    category,
    topic,
    question,
    sampleAnswer,
    JSON.stringify(keyConcepts),
    difficulty,
    JSON.stringify(tags),
    userNotes,
    jobId
  );

  return getQuestionById(Number(res.lastInsertRowid));
}

/**
 * Get question bank statistics
 */
export function getQuestionBankStats() {
  const db = getDatabase();
  seedQuestionBank();

  const totalRow = db.prepare('SELECT COUNT(*) as count FROM interview_question_bank').get();
  const savedRow = db.prepare('SELECT COUNT(*) as count FROM interview_question_bank WHERE is_saved = 1').get();
  const reviewedRow = db.prepare("SELECT COUNT(*) as count FROM interview_question_bank WHERE reviewed_status = 'reviewed'").get();

  const categories = db.prepare(`
    SELECT category, COUNT(*) as count
    FROM interview_question_bank
    GROUP BY category
  `).all();

  return {
    totalQuestions: totalRow ? totalRow.count : 0,
    savedQuestions: savedRow ? savedRow.count : 0,
    reviewedQuestions: reviewedRow ? reviewedRow.count : 0,
    categories
  };
}
