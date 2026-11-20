import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabase } from '../db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.resolve(__dirname, '../../output');

export function exportVaultToCsv() {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT 
      j.id, j.title, j.company, j.location, j.url, j.salary, j.status,
      e.score, e.rating, e.recommendation, e.summary_reason, j.created_at
    FROM jobs j
    LEFT JOIN job_evaluations e ON j.id = e.job_id
    ORDER BY e.score DESC, j.id DESC
  `).all();

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const csvPath = path.join(OUTPUT_DIR, 'career_pipeline.csv');
  const headers = ['ID', 'Title', 'Company', 'Location', 'Score', 'Rating', 'Recommendation', 'Status', 'URL', 'Analysis', 'Date'];

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const lines = [
    headers.join(','),
    ...rows.map(r => [
      r.id,
      escapeCsv(r.title),
      escapeCsv(r.company),
      escapeCsv(r.location),
      r.score || 0,
      r.rating || 1,
      escapeCsv(r.recommendation),
      escapeCsv(r.status),
      escapeCsv(r.url),
      escapeCsv(r.summary_reason),
      escapeCsv(r.created_at)
    ].join(','))
  ];

  fs.writeFileSync(csvPath, lines.join('\n'), 'utf-8');
  console.log(`[Vault Exporter] Exported ${rows.length} jobs to CSV: ${csvPath}`);
  return { csvPath, count: rows.length };
}

export function exportVaultToJson() {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT 
      j.*, e.score, e.rating, e.recommendation, e.summary_reason, e.skills_matched, e.skills_missing
    FROM jobs j
    LEFT JOIN job_evaluations e ON j.id = e.job_id
    ORDER BY e.score DESC
  `).all();

  const jsonPath = path.join(OUTPUT_DIR, 'career_pipeline.json');
  fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2), 'utf-8');
  console.log(`[Vault Exporter] Exported ${rows.length} jobs to JSON: ${jsonPath}`);
  return { jsonPath, count: rows.length };
}
