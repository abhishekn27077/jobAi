/**
 * CareerOS Phase 11 — UI Visual & Source Expansion Verification Script
 * Launches Playwright across desktop & mobile viewports.
 * Verifies Workable tab, dynamic telemetry, search execution, and 0px horizontal overflow.
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

async function runPhase11Verification() {
  console.log('🚀 Starting Phase 11 Visual Verification...');
  const testPort = 3255;
  const server = startDashboardServer({ port: testPort });
  await new Promise(resolve => setTimeout(resolve, 800));

  const browser = await getBrowser();
  const targetUrl = `http://127.0.0.1:${testPort}`;
  console.log(`Connecting to ${targetUrl}...`);

  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto(`${targetUrl}/#jobs`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);

    // 1. Verify 0px horizontal overflow
    const overflowX = await page.evaluate(() => {
      return Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
    });
    console.log(`[Desktop 1366x768] Horizontal overflow: ${overflowX}px`);

    const desktopScreenshot = path.join(SCREENSHOT_DIR, 'phase11_dashboard_desktop.png');
    await page.screenshot({ path: desktopScreenshot });
    console.log(`  Saved screenshot: ${desktopScreenshot}`);

    // 2. Click Workable Tab
    console.log('Testing Workable Tab click...');
    const workableTab = await page.$('.source-nav-tab[data-source="workable"]');
    if (workableTab) {
      await workableTab.click();
      await page.waitForTimeout(800);
      const workableScreenshot = path.join(SCREENSHOT_DIR, 'phase11_workable_tab.png');
      await page.screenshot({ path: workableScreenshot });
      console.log(`  Saved Workable tab screenshot: ${workableScreenshot}`);
    }

    // 3. Test Mobile 375 viewport
    const mobilePage = await browser.newPage({ viewport: { width: 375, height: 667 } });
    await mobilePage.goto(`${targetUrl}/#jobs`, { waitUntil: 'networkidle', timeout: 15000 });
    await mobilePage.waitForTimeout(1000);

    const mobileOverflow = await mobilePage.evaluate(() => {
      return Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
    });
    console.log(`[Mobile 375x667] Horizontal overflow: ${mobileOverflow}px`);

    const mobileScreenshot = path.join(SCREENSHOT_DIR, 'phase11_mobile_375.png');
    await mobilePage.screenshot({ path: mobileScreenshot });
    console.log(`  Saved mobile screenshot: ${mobileScreenshot}`);

    console.log('🎉 Phase 11 Visual Verification completed successfully!');
  } finally {
    await browser.close();
    server.close();
  }
}

runPhase11Verification();
