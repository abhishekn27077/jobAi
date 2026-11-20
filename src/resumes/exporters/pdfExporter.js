/**
 * CareerOS — PDF Resume Exporter
 * Compiles HTML templates into print-ready A4 PDF files using local Playwright Chrome / Edge.
 */

import { chromium } from 'playwright';

export async function exportToPdf(htmlContent, outputPath) {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  }

  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'load' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      margin: {
        top: '10mm',
        right: '12mm',
        bottom: '10mm',
        left: '12mm'
      },
      printBackground: true
    });
    return outputPath;
  } finally {
    if (browser) await browser.close();
  }
}
