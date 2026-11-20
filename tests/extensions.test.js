import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportVaultToCsv, exportVaultToJson } from '../src/tracker/vaultExporter.js';
import { evaluateCandidateAnswer } from '../src/interview/mockSimulator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.resolve(__dirname, '../output');

test('Vault Exporter generates non-empty CSV and JSON pipeline files', () => {
  const csvRes = exportVaultToCsv();
  assert.ok(csvRes.count > 0, 'CSV export should contain rows');
  assert.ok(fs.existsSync(csvRes.csvPath), 'CSV file should exist');

  const csvContent = fs.readFileSync(csvRes.csvPath, 'utf-8');
  assert.ok(csvContent.includes('ID,Title,Company'), 'CSV should contain header line');

  const jsonRes = exportVaultToJson();
  assert.ok(jsonRes.count > 0, 'JSON export should contain items');
  assert.ok(fs.existsSync(jsonRes.jsonPath), 'JSON file should exist');

  const jsonData = JSON.parse(fs.readFileSync(jsonRes.jsonPath, 'utf-8'));
  assert.ok(Array.isArray(jsonData), 'Exported JSON should be an array');
  assert.strictEqual(jsonData.length, jsonRes.count, 'JSON items count should match');
});

test('Mock Interview Evaluator scores technical answer with spatial and concurrency depth', () => {
  const question = 'Can you tell me about NearVia, how you implemented 5 km location matching, and how you prevented double-booking?';
  const goodAnswer = 'In NearVia, I utilized PostgreSQL with PostGIS extension. I created a GIST index on geography points and queried nearby providers using ST_DWithin within a 5 km radius. To prevent double-booking, I used database transactions with row-level locks using SELECT FOR UPDATE on the appointment slot.';

  const result = evaluateCandidateAnswer(question, goodAnswer, 'technical');
  assert.ok(result.score >= 8, `Expected score >= 8, got ${result.score}`);
  assert.ok(result.strengths.some(s => s.includes('PostGIS') || s.includes('GIST')), 'Should recognize PostGIS indexing');
  assert.ok(result.strengths.some(s => s.includes('row-level locking')), 'Should recognize row-level locking');
});

test('Mock Interview Evaluator identifies incomplete or too-brief answers', () => {
  const question = 'How does Spring Boot handle transactions?';
  const shortAnswer = 'It handles it.';

  const result = evaluateCandidateAnswer(question, shortAnswer, 'technical');
  assert.ok(result.score <= 3, `Expected low score for brief answer, got ${result.score}`);
  assert.ok(result.feedback.includes('too brief'), 'Should give feedback that answer was too brief');
  assert.ok(result.suggestions.length > 0, 'Should offer actionable suggestions');
});

test('Mock Interview Evaluator recognizes STAR framework in behavioral answers', () => {
  const question = 'Tell me about a difficult technical challenge you solved.';
  const starAnswer = 'During my NearVia project, when concurrent booking caused race conditions, I implemented pessimistic row-level locking in PostgreSQL transactions. As a result, concurrency race conditions dropped by 100% and data consistency was guaranteed.';

  const result = evaluateCandidateAnswer(question, starAnswer, 'behavioral');
  assert.ok(result.score >= 8, `Expected STAR answer to score >= 8, got ${result.score}`);
  assert.ok(result.strengths.some(s => s.includes('STAR')), 'Should explicitly detect STAR structure');
});
