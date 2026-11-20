import { getDatabase } from '../db/schema.js';
import { generateTargetedInterviewKit } from './interviewIntelligence.js';

export const MOCK_DISCLAIMER = 'Notice: Practice evaluation only. Automated scores are intended for personal self-coaching and interview skill calibration; they do not represent official employer hiring assessments.';

/**
 * Initiates an interactive mock interview session
 */
export function startMockInterview({ jobId = null, interviewType = 'technical', questionCount = 3 } = {}) {
  const db = getDatabase();

  let job = null;
  if (jobId) {
    job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  }

  const kit = generateTargetedInterviewKit(job);
  const questions = selectQuestionsForType(kit, interviewType, questionCount);

  const initialLog = questions.map((q, idx) => ({
    questionIndex: idx,
    category: q.category,
    question: q.question,
    sampleAnswer: q.sampleAnswer,
    keyConcepts: q.keyConcepts || [],
    answer: null,
    evaluation: null
  }));

  const role = job?.title || 'Software Engineer (Java / Full Stack)';
  const company = job?.company || 'General Practice';

  const insert = db.prepare(`
    INSERT INTO mock_interviews 
    (job_id, interview_type, target_role, target_company, total_questions, completed_questions, status, qa_log_json, created_at)
    VALUES (?, ?, ?, ?, ?, 0, 'in_progress', ?, datetime('now'))
  `);

  const info = insert.run(
    jobId,
    interviewType,
    role,
    company,
    questions.length,
    JSON.stringify(initialLog)
  );

  const sessionId = info.lastInsertRowid;

  return {
    sessionId,
    targetRole: role,
    targetCompany: company,
    interviewType,
    totalQuestions: questions.length,
    currentQuestionNumber: 1,
    currentQuestion: {
      index: 0,
      category: questions[0].category,
      question: questions[0].question,
      keyConcepts: questions[0].keyConcepts || []
    },
    status: 'in_progress',
    disclaimer: MOCK_DISCLAIMER
  };
}

/**
 * Submits an answer for the current pending question in a mock interview
 */
export function submitMockAnswer({ sessionId, answer }) {
  if (!sessionId) throw new Error('Session ID is required.');
  const db = getDatabase();

  const session = db.prepare('SELECT * FROM mock_interviews WHERE id = ?').get(sessionId);
  if (!session) throw new Error(`Mock interview session #${sessionId} not found.`);
  if (session.status === 'completed') throw new Error(`Session #${sessionId} has already been completed.`);

  let qaLog = [];
  try {
    qaLog = JSON.parse(session.qa_log_json || '[]');
  } catch {
    qaLog = [];
  }

  // Find next unanswered question
  const pendingIndex = qaLog.findIndex(q => q.answer === null);
  if (pendingIndex === -1) {
    throw new Error('All questions in this session have already been evaluated.');
  }

  const currentQ = qaLog[pendingIndex];
  const evalResult = evaluateMockResponse(currentQ.question, answer, currentQ.category, currentQ.sampleAnswer, currentQ.keyConcepts);

  currentQ.answer = answer || '';
  currentQ.evaluation = evalResult;

  const completedCount = pendingIndex + 1;
  const isFinished = completedCount >= qaLog.length;

  let overallScore = 0;
  let feedbackSummary = '';

  if (isFinished) {
    const totalScore = qaLog.reduce((acc, q) => acc + (q.evaluation?.overallScore || 0), 0);
    overallScore = Number((totalScore / qaLog.length).toFixed(1));

    if (overallScore >= 8.5) {
      feedbackSummary = '🌟 Outstanding performance! Your answers are technically rigorous, clearly structured, and effectively grounded in your verified project accomplishments.';
    } else if (overallScore >= 7.0) {
      feedbackSummary = '👍 Solid performance! You demonstrated good foundational knowledge. Work on incorporating specific architecture trade-offs and quantitative results into your answers.';
    } else {
      feedbackSummary = '💡 Foundational answer. To build interview confidence, provide more concrete context, mechanism explanations, and concrete project citations (e.g. NearVia or Leave Management).';
    }
  }

  db.prepare(`
    UPDATE mock_interviews
    SET completed_questions = ?,
        status = ?,
        overall_score = ?,
        feedback_summary = ?,
        qa_log_json = ?
    WHERE id = ?
  `).run(
    completedCount,
    isFinished ? 'completed' : 'in_progress',
    isFinished ? overallScore : session.overall_score,
    isFinished ? feedbackSummary : session.feedback_summary,
    JSON.stringify(qaLog),
    sessionId
  );

  const nextQuestion = !isFinished ? {
    index: pendingIndex + 1,
    category: qaLog[pendingIndex + 1].category,
    question: qaLog[pendingIndex + 1].question,
    keyConcepts: qaLog[pendingIndex + 1].keyConcepts || []
  } : null;

  return {
    sessionId,
    completedQuestionNumber: completedCount,
    totalQuestions: qaLog.length,
    isFinished,
    questionEvaluation: {
      question: currentQ.question,
      category: currentQ.category,
      userAnswer: answer,
      ...evalResult
    },
    nextQuestion,
    overallScore: isFinished ? overallScore : null,
    feedbackSummary: isFinished ? feedbackSummary : null,
    disclaimer: MOCK_DISCLAIMER
  };
}

/**
 * Retrieves a mock interview session by ID
 */
export function getMockSession(sessionId) {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM mock_interviews WHERE id = ?').get(sessionId);
  if (!row) return null;
  return formatSessionRow(row);
}

/**
 * Retrieves past mock interview history
 */
export function getMockHistory({ limit = 10 } = {}) {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM mock_interviews ORDER BY id DESC LIMIT ?').all(limit);
  return rows.map(formatSessionRow);
}

/**
 * Evaluates candidate response on 4 core dimensions
 */
export function evaluateMockResponse(question, answer, category, referenceAnswer = '', keyConcepts = []) {
  const text = (answer || '').trim();
  const words = text.split(/\s+/).filter(Boolean);

  if (!text || words.length < 5) {
    return {
      overallScore: 2.0,
      scores: { relevance: 2, correctness: 2, clarity: 3, structure: 2 },
      strengths: [],
      improvements: [
        'Response was too brief. In technical interviews, provide context, mechanism details, and concrete examples.',
        'Reference specific projects where you encountered this problem (e.g. NearVia or Leave Management).'
      ],
      coachingNotes: 'Elaborate on the mechanism rather than giving one-sentence answers.',
      improvedAnswer: referenceAnswer || 'In my projects, I structure this by explaining the core concept, the implementation mechanism, and the measurable outcome.'
    };
  }

  const textLower = text.toLowerCase();
  const strengths = [];
  const improvements = [];

  // 1. Relevance Score (0-10)
  let relevance = 7;
  const qTerms = question.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 3);
  const matchedTerms = qTerms.filter(t => textLower.includes(t));
  if (matchedTerms.length >= 2) {
    relevance = Math.min(10, relevance + 2);
    strengths.push('Directly addressed the core themes asked in the question.');
  } else {
    relevance = Math.max(4, relevance - 2);
    improvements.push('Ensure your answer directly targets the exact keywords in the interviewer’s prompt.');
  }

  // 2. Correctness & Technical Depth (0-10)
  let correctness = 7;
  let conceptsHit = 0;
  for (const concept of keyConcepts) {
    const cTerms = concept.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (cTerms.some(t => textLower.includes(t))) {
      conceptsHit++;
    }
  }

  if (conceptsHit >= 2) {
    correctness = Math.min(10, correctness + 2);
    strengths.push(`Demonstrated solid technical depth, mentioning key concepts (${conceptsHit} identified).`);
  } else if (conceptsHit === 0 && keyConcepts.length > 0) {
    correctness = Math.max(5, correctness - 1);
    improvements.push(`Consider mentioning relevant architectural terms such as: ${keyConcepts.slice(0, 2).join(', ')}.`);
  }

  // Check project citations
  if (textLower.includes('nearvia') || textLower.includes('leave management') || textLower.includes('smart rover') || textLower.includes('finsight') || textLower.includes('anudip')) {
    correctness = Math.min(10, correctness + 1);
    strengths.push('Grounded response in real, verified project experience.');
  }

  // 3. Clarity & Conciseness (0-10)
  let clarity = 8;
  if (words.length > 250) {
    clarity = 7;
    improvements.push('Answer is somewhat verbose. Aim for crisp 1.5 to 2-minute spoken explanations (120–180 words).');
  } else if (words.length < 15) {
    clarity = 4;
    correctness = Math.min(correctness, 4);
    improvements.push('Answer is too brief (< 15 words) to demonstrate technical depth or problem-solving capability.');
  } else if (words.length < 25) {
    clarity = 6;
    improvements.push('Answer could benefit from more technical elaboration.');
  } else {
    strengths.push('Clear, well-paced explanation.');
  }

  // 4. Structure (0-10)
  let structure = 7;
  const isBehavioral = category.toLowerCase().includes('behavioral') || category.toLowerCase().includes('hr') || category.toLowerCase().includes('teamwork') || category.toLowerCase().includes('graduation');
  if (isBehavioral) {
    const hasSituation = textLower.includes('when') || textLower.includes('during') || textLower.includes('project') || textLower.includes('in my');
    const hasAction = textLower.includes('i built') || textLower.includes('i implemented') || textLower.includes('i coordinated') || textLower.includes('i optimized') || textLower.includes('i designed');
    const hasResult = textLower.includes('result') || textLower.includes('outcome') || textLower.includes('award') || textLower.includes('dropped') || textLower.includes('reduced') || textLower.includes('successfully');

    if (hasSituation && hasAction && hasResult) {
      structure = 10;
      strengths.push('Excellent adherence to the STAR framework (Situation, Task, Action, Result).');
    } else {
      structure = 6;
      improvements.push('Follow the STAR method: define the context, describe your specific technical action, and conclude with the tangible result.');
    }
  } else {
    // Technical structure: definition + mechanism + example
    if (textLower.includes('for example') || textLower.includes('such as') || textLower.includes('in nearvia') || textLower.includes('in my project')) {
      structure = 9;
      strengths.push('Structured technically with a clear mechanism explanation followed by a concrete real-world example.');
    } else {
      structure = 7;
      improvements.push('Follow up theoretical explanations with a concrete code or project example.');
    }
  }

  const overallScore = Number(((relevance * 0.3) + (correctness * 0.35) + (clarity * 0.15) + (structure * 0.2)).toFixed(1));

  let coachingNotes = 'Good answer. Incorporate the suggestions above to deliver a crisp, authoritative interview response.';
  if (overallScore >= 8.5) coachingNotes = 'Strong answer! You communicated technical competence and clear thinking.';
  else if (overallScore < 6.5) coachingNotes = 'Review the model answer below and try answering with specific architectural details.';

  return {
    overallScore,
    scores: {
      relevance,
      correctness,
      clarity,
      structure
    },
    strengths,
    improvements,
    coachingNotes,
    improvedAnswer: referenceAnswer
  };
}

function selectQuestionsForType(kit, interviewType, count) {
  let pool = [];
  switch (interviewType) {
    case 'behavioral':
      pool = kit.behavioralQuestions.map(q => ({
        category: 'Behavioral & HR',
        question: q.question,
        sampleAnswer: q.sampleAnswer,
        keyConcepts: q.tips || []
      }));
      break;
    case 'project':
      pool = kit.projectQuestions.map(q => ({
        category: `Project: ${q.project}`,
        question: q.question,
        sampleAnswer: q.sampleAnswer,
        keyConcepts: q.keyConcepts || []
      }));
      break;
    case 'mixed':
      pool = [
        ...kit.technicalQuestions.slice(0, 2).map(q => ({ ...q, category: `Technical: ${q.category}` })),
        ...kit.projectQuestions.slice(0, 1).map(q => ({ ...q, category: `Project: ${q.project}` })),
        ...kit.behavioralQuestions.slice(0, 1).map(q => ({ category: 'Behavioral', question: q.question, sampleAnswer: q.sampleAnswer, keyConcepts: q.tips || [] }))
      ];
      break;
    case 'technical':
    default:
      pool = kit.technicalQuestions.map(q => ({
        category: `Technical: ${q.category}`,
        question: q.question,
        sampleAnswer: q.sampleAnswer,
        keyConcepts: q.keyConcepts || []
      }));
      break;
  }

  return pool.slice(0, count);
}

function formatSessionRow(row) {
  let qaLog = [];
  try {
    qaLog = row.qa_log_json ? JSON.parse(row.qa_log_json) : [];
  } catch {
    qaLog = [];
  }

  return {
    id: row.id,
    jobId: row.job_id,
    interviewType: row.interview_type,
    targetRole: row.target_role,
    targetCompany: row.target_company,
    totalQuestions: row.total_questions,
    completedQuestions: row.completed_questions,
    overallScore: row.overall_score,
    feedbackSummary: row.feedback_summary,
    qaLog,
    status: row.status,
    createdAt: row.created_at,
    disclaimer: MOCK_DISCLAIMER
  };
}
