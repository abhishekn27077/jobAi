import readline from 'node:readline';
import { generateInterviewDossier, saveInterviewSession } from './prepService.js';
import { getDatabase } from '../db/schema.js';

export function evaluateCandidateAnswer(question, answer, topic = 'general') {
  const words = (answer || '').trim().split(/\s+/).filter(Boolean);
  if (!answer || answer.trim().length < 25 || words.length < 5) {
    return {
      score: 3,
      feedback: 'Answer was too brief. In technical interviews, provide concrete context, mechanisms, and real project examples.',
      suggestions: ['Explain the underlying architecture or data structure.', 'Reference a real project where you solved this (e.g., NearVia or Leave Management).']
    };
  }

  const ansLower = answer.toLowerCase();
  let score = 7;
  const strengths = [];
  const suggestions = [];

  // Technical checks
  if (question.toLowerCase().includes('postgis') || question.toLowerCase().includes('location') || question.toLowerCase().includes('radius')) {
    if (ansLower.includes('gist') || ansLower.includes('st_dwithin') || ansLower.includes('index')) {
      score += 2;
      strengths.push('Excellent mention of PostGIS spatial indexing (GIST / ST_DWithin).');
    } else {
      suggestions.push('Remember to mention GIST spatial indexing and ST_DWithin queries on geography types.');
    }
  }

  if (question.toLowerCase().includes('double-booking') || question.toLowerCase().includes('concurrency') || question.toLowerCase().includes('lock')) {
    if (ansLower.includes('row-level') || ansLower.includes('select for update') || ansLower.includes('transaction')) {
      score += 2;
      strengths.push('Strong explanation of PostgreSQL row-level locking (SELECT FOR UPDATE) inside transactions.');
    } else {
      suggestions.push('Mention PostgreSQL row-level locking (SELECT ... FOR UPDATE) and ACID transaction rollback.');
    }
  }

  if (question.toLowerCase().includes('spring') || question.toLowerCase().includes('leave')) {
    if (ansLower.includes('@transactional') || ansLower.includes('jpa') || ansLower.includes('hibernate')) {
      score += 2;
      strengths.push('Good technical depth on Spring Boot transactional boundaries and JPA entity management.');
    } else {
      suggestions.push('Highlight `@Transactional` boundary management and state machine status transitions.');
    }
  }

  // STAR method checks for behavioral
  if (topic === 'behavioral') {
    const hasSituation = ansLower.includes('when') || ansLower.includes('during') || ansLower.includes('project');
    const hasAction = ansLower.includes('i implemented') || ansLower.includes('i built') || ansLower.includes('i optimized') || ansLower.includes('i designed');
    const hasResult = ansLower.includes('result') || ansLower.includes('reduced') || ansLower.includes('improved') || ansLower.includes('awarded') || ansLower.includes('%');

    if (hasSituation && hasAction && hasResult) {
      score = Math.min(10, score + 2);
      strengths.push('Clear STAR structure followed: Problem context, concrete technical action, and measurable outcome.');
    } else {
      suggestions.push('Enhance your STAR structure: clearly emphasize the measurable result (e.g. latency drop, award, or successful delivery).');
    }
  }

  score = Math.min(10, Math.max(1, score));

  return {
    score,
    strengths,
    suggestions,
    coachingSummary: score >= 8 ? '🌟 Outstanding response! Clear, confident, and technically grounded.' : '👍 Good foundational answer. Incorporate the suggestions above to maximize interviewer confidence.'
  };
}

export async function runTerminalMockSession(job) {
  const dossier = generateInterviewDossier(job);
  console.log(`\n======================================================`);
  console.log(`🎯 INTERACTIVE MOCK INTERVIEW SIMULATOR`);
  console.log(`Target: ${dossier.role} @ ${dossier.company}`);
  console.log(`======================================================`);
  console.log('Instructions: Answer each question as you would in a real technical screen.');
  console.log('Type your response and press Enter. (Type "skip" to move to next).\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const promptUser = (query) => new Promise(resolve => rl.question(query, resolve));

  const questionsToAsk = [
    {
      q: 'Can you tell me about NearVia, how you implemented 5 km location matching, and how you prevented double-booking?',
      topic: 'technical'
    },
    {
      q: 'How did you handle transactional leave approvals in your Spring Boot Employee Leave Management System?',
      topic: 'technical'
    },
    {
      q: 'Tell me about a challenging technical bug you encountered in a project and how you diagnosed and resolved it.',
      topic: 'behavioral'
    }
  ];

  let totalScore = 0;
  const sessionLog = [];

  for (let i = 0; i < questionsToAsk.length; i++) {
    const item = questionsToAsk[i];
    console.log(`\n[Question ${i + 1}/${questionsToAsk.length}]`);
    console.log(`💬 "${item.q}"\n`);

    const answer = await promptUser('Your Answer: ');
    if (answer.trim().toLowerCase() === 'skip') {
      console.log('⏩ Skipped.');
      continue;
    }

    const evalResult = evaluateCandidateAnswer(item.q, answer, item.topic);
    totalScore += evalResult.score;

    console.log(`\n📊 Score: ${evalResult.score}/10`);
    if (evalResult.strengths.length > 0) {
      console.log(`✅ Strengths: ${evalResult.strengths.join(' ')}`);
    }
    if (evalResult.suggestions.length > 0) {
      console.log(`💡 Pro-Tip: ${evalResult.suggestions.join(' ')}`);
    }
    console.log(`👉 Feedback: ${evalResult.coachingSummary}\n`);
    console.log('------------------------------------------------------');

    sessionLog.push({
      question: item.q,
      answer,
      evalResult
    });
  }

  rl.close();

  const avgScore = sessionLog.length > 0 ? (totalScore / sessionLog.length).toFixed(1) : 0;
  console.log(`\n🎉 Mock Interview Session Complete! Average Score: ${avgScore}/10`);

  // Save session record into database
  saveInterviewSession(
    job.id,
    'Mock Interview Simulator (Practice Session)',
    JSON.stringify({ avgScore, sessionLog })
  );

  return { avgScore, sessionLog };
}
