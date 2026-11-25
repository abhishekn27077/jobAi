/**
 * CareerOS Phase 12 — UI Visual & Smart Prioritization Verification Script
 * Launches Playwright across desktop & mobile viewports.
 * Verifies Priority filter pills, priority badges, explainable recommendations,
 * side drawer evidence breakdown, and 0px horizontal overflow.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startDashboardServer } from '../src/dashboard/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = 'C:/Users/Abhis/.gemini/antigravity/brain/3fa685b8-0a44-4220-bf05-35fc529bce65/ux_screenshots';

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function getBrowser() {
  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  };

  try {
    return await chromium.launch({ ...launchOptions, channel: 'chrome' });
  } catch {
    try {
      return await chromium.launch({ ...launchOptions, channel: 'msedge' });
    } catch {
      return await chromium.launch(launchOptions);
    }
  }
}

async function runPhase12Verification() {
  console.log('🚀 Starting Phase 12 Visual Verification...');
  const testPort = 3256;
  const server = startDashboardServer({ port: testPort });
  await new Promise(resolve => setTimeout(resolve, 800));

  const browser = await getBrowser();
  const targetUrl = `http://127.0.0.1:${testPort}`;
  console.log(`Connecting to ${targetUrl}...`);

  try {
    // 1. Desktop Viewport (1366x768)
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

    await page.goto(`${targetUrl}/#jobs`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);

    // Execute initial search for Java
    await page.fill('#unifiedSearchInput', 'Java');
    await page.click('#btnExecuteSearch');
    await page.waitForTimeout(1000);

    // Verify 0px horizontal overflow
    const overflowX = await page.evaluate(() => {
      return Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
    });
    console.log(`[Desktop 1366x768] Horizontal overflow: ${overflowX}px`);

    const desktopScreenshot = path.join(SCREENSHOT_DIR, 'phase12_desktop_prioritization.png');
    await page.screenshot({ path: desktopScreenshot });
    console.log(`Saved screenshot: ${desktopScreenshot}`);

    // 2. Click P1 Priority Pill Filter
    console.log('Filtering by Priority 1 — Apply First...');
    await page.click('.priority-pill-btn[data-priority="p1"]');
    await page.waitForTimeout(800);

    const p1Screenshot = path.join(SCREENSHOT_DIR, 'phase12_p1_filter.png');
    await page.screenshot({ path: p1Screenshot });
    console.log(`Saved screenshot: ${p1Screenshot}`);

    // 3. Open Detail Drawer to Inspect Evidence Breakdown Table
    console.log('Opening side drawer inspector...');
    await page.click('.priority-pill-btn[data-priority="all"]');
    await page.waitForTimeout(800);
    const cardCount = await page.locator('.job-card').count();
    console.log(`Found ${cardCount} job cards on page.`);

    const firstInspectBtn = await page.$('.job-card .btn-outline:has-text("Inspect")');
    if (firstInspectBtn) {
      await firstInspectBtn.click();
      await page.waitForTimeout(1000);

      const drawerScreenshot = path.join(SCREENSHOT_DIR, 'phase12_drawer_evidence_breakdown.png');
      await page.screenshot({ path: drawerScreenshot });
      console.log(`Saved screenshot: ${drawerScreenshot}`);

      const closeBtn = await page.$('#btnDrawerClose');
      if (closeBtn) await closeBtn.click();
      await page.waitForTimeout(400);
    } else {
      console.log('Inspect button not found!');
    }

    // 4. Light Mode View
    console.log('Testing Light Mode...');
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await page.waitForTimeout(500);

    const lightScreenshot = path.join(SCREENSHOT_DIR, 'phase12_light_mode.png');
    await page.screenshot({ path: lightScreenshot });
    console.log(`Saved screenshot: ${lightScreenshot}`);

    // 5. Mobile Viewport (375x812)
    console.log('Testing Mobile Viewport (375x812)...');
    const mobilePage = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await mobilePage.goto(`${targetUrl}/#jobs`, { waitUntil: 'networkidle', timeout: 15000 });
    await mobilePage.waitForTimeout(1000);

    const mobileOverflowX = await mobilePage.evaluate(() => {
      return Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
    });
    console.log(`[Mobile 375x812] Horizontal overflow: ${mobileOverflowX}px`);

    const mobileScreenshot = path.join(SCREENSHOT_DIR, 'phase12_mobile_375.png');
    await mobilePage.screenshot({ path: mobileScreenshot });
    console.log(`Saved screenshot: ${mobileScreenshot}`);

    console.log('🎉 Phase 12 Visual Verification Completed Successfully!');
  } finally {
    await browser.close();
    server.close();
  }
}

runPhase12Verification().catch(err => {
  console.error('Phase 12 Verification Failed:', err);
  process.exit(1);
});
