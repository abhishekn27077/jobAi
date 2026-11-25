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
        top: '13mm',
        right: '14mm',
        bottom: '13mm',
        left: '14mm'
      },
      printBackground: true
    });
    return outputPath;
  } finally {
    if (browser) await browser.close();
  }
}
