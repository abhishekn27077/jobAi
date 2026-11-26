/**
 * CareerOS — PDF Resume Exporter
 * Compiles HTML templates into print-ready A4 PDF files using local Playwright Chrome / Edge.
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

export async function exportToPdf(htmlContent, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    try {
      browser = await chromium.launch({ channel: 'msedge', headless: true });
    } catch {
      browser = await chromium.launch({ headless: true });
    }
  }

  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'load' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      margin: {
        top: '10mm',
        right: '13mm',
        bottom: '10mm',
        left: '13mm'
      },
      printBackground: true
    });
    return outputPath;
  } finally {
    if (browser) await browser.close();
  }
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Extracts text from a generated PDF using Python pypdf and validates layout,
 * contact details, project order, internship placement, and non-fabrication.
 */
export async function validateGeneratedPdf(pdfPath, options = {}) {
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    return { valid: false, errors: ['PDF file does not exist'], pageCount: 0, extractedText: '' };
  }

  const pyScript = `
import json, sys, pypdf
reader = pypdf.PdfReader(sys.argv[1])
pages = [p.extract_text() or '' for p in reader.pages]
print(json.dumps({"pageCount": len(pages), "pages": pages}))
`.trim();

  let parsed = { pageCount: 0, pages: [] };
  try {
    const { stdout } = await execFileAsync('python', ['-c', pyScript, pdfPath], { timeout: 10000 });
    parsed = JSON.parse(stdout);
  } catch (err) {
    return { valid: false, errors: [`PDF text extraction failed: ${err.message}`], pageCount: 0, extractedText: '' };
  }

  const extractedText = (parsed.pages || []).join('\n');
  const lower = extractedText.toLowerCase();
  const errors = [];

  if (!extractedText.trim() || extractedText.trim().length < 150) {
    errors.push('Extracted PDF text is empty or unexpectedly short.');
  }
  if (parsed.pageCount > 2) {
    errors.push(`PDF spans ${parsed.pageCount} pages; expected 1-2 pages.`);
  }

  const expectedName = options.expectedName || 'Abhishek N';
  if (!lower.includes(expectedName.toLowerCase())) {
    errors.push(`Missing candidate name "${expectedName}" in PDF text.`);
  }
  if (!lower.includes('linkedin.com/in/abhishekn27077') || !lower.includes('github.com/abhishekn27077')) {
    errors.push('Missing verified LinkedIn or GitHub URL in PDF text.');
  }
  if (/portfolio[^\n]*nearvia\.app/i.test(extractedText)) {
    errors.push('Incorrect portfolio URL (nearvia.app) detected in PDF header.');
  }

  if (Array.isArray(options.expectedProjectOrder) && options.expectedProjectOrder.length >= 2) {
    let prevIdx = -1;
    for (const projName of options.expectedProjectOrder) {
      const idx = lower.indexOf(projName.toLowerCase());
      if (idx === -1) {
        errors.push(`Expected project "${projName}" missing from PDF.`);
      } else if (idx < prevIdx) {
        errors.push(`Project order mismatch: "${projName}" appeared out of expected priority order.`);
      } else {
        prevIdx = idx;
      }
    }
  }

  if (options.requireLeaveManagementUnderInternship) {
    const internIdx = lower.indexOf('anudip foundation');
    const leaveIdx = lower.indexOf('leave management');
    const projectsIdx = lower.indexOf('projects');
    if (internIdx === -1 || leaveIdx === -1) {
      errors.push('Anudip Foundation internship or Employee Leave Management missing from PDF.');
    } else if (projectsIdx !== -1 && leaveIdx > projectsIdx) {
      errors.push('Employee Leave Management must appear under Internship Experience, not Projects.');
    }
  }

  return {
    valid: errors.length === 0,
    pageCount: parsed.pageCount,
    isOnePage: parsed.pageCount === 1,
    extractedText,
    errors
  };
}
