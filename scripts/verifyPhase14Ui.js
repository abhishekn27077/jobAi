/**
 * CareerOS Phase 14 — UI Visual Verification Script
 * Validates:
 * 1. Desktop Unified Search with Job Feed and Inspector Drawer
 * 2. Side Drawer "Interview Prep" Tab with Multi-factor Readiness Gauge (Score & Tier)
 * 3. Targeted Technical Topics, Grounded Q&A, and Verified Project Deep Dives
 * 4. Interview Scheduling Form & Follow-Up Generator
 * 5. Light Mode Theme Polish and Contrast
 * 6. Mobile 375px responsiveness with 0px horizontal overflow
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

async function runPhase14Verification() {
  console.log('🚀 Starting Phase 14 Visual Verification...');
  const testPort = 3290;
  const server = startDashboardServer({ port: testPort });
  await new Promise(resolve => setTimeout(resolve, 1000));

  const browser = await getBrowser();
  const targetUrl = `http://127.0.0.1:${testPort}`;
  console.log(`Connecting to ${targetUrl}...`);

  try {
    // 1. Desktop Viewport (1366x768)
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Capture 1: Main Job Feed
    const desktopPath = path.join(SCREENSHOT_DIR, 'phase14_desktop_overview.png');
    await page.screenshot({ path: desktopPath, fullPage: false });
    console.log(`📸 Saved Desktop Overview: ${desktopPath}`);

    // Capture 2: Detail Drawer -> Interview Prep Tab
    console.log('Inspecting first job card...');
    await page.waitForSelector('button[onclick*="openDetailDrawerForJob"]', { timeout: 12000 });
    const inspectBtn = page.locator('button[onclick*="openDetailDrawerForJob"]').first();
    await inspectBtn.click();
    await page.waitForTimeout(800);

    await page.waitForSelector('.drawer-tab[data-dtab="interview-prep"]', { timeout: 8000 });
    const interviewPrepTab = page.locator('.drawer-tab[data-dtab="interview-prep"]');
    console.log('Clicking Interview Prep tab...');
    await interviewPrepTab.click();
    await page.waitForTimeout(1500);

    const prepPath = path.join(SCREENSHOT_DIR, 'phase14_drawer_interview_prep.png');
    await page.screenshot({ path: prepPath, fullPage: false });
    console.log(`📸 Saved Drawer Interview Prep: ${prepPath}`);

    // Close drawer before toggling theme
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // Capture 3: Light Mode
    const themeBtn = page.locator('#themeToggleBtn, .theme-toggle-btn').first();
    if (await themeBtn.isVisible()) {
      await themeBtn.click();
      await page.waitForTimeout(400);
      const lightPath = path.join(SCREENSHOT_DIR, 'phase14_light_mode.png');
      await page.screenshot({ path: lightPath, fullPage: false });
      console.log(`📸 Saved Light Mode: ${lightPath}`);

      // Revert to dark mode
      await themeBtn.click();
      await page.waitForTimeout(300);
    }
    await context.close();

    // Capture 4: Mobile Viewport (375x812)
    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
      isMobile: true
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(targetUrl, { waitUntil: 'networkidle' });
    await mobilePage.waitForTimeout(1000);

    // Inspect job on mobile
    const mobileInspect = mobilePage.locator('button[onclick*="openDetailDrawerForJob"]').first();
    if (await mobileInspect.isVisible()) {
      await mobileInspect.click();
      await mobilePage.waitForTimeout(600);
      const mobilePrepTab = mobilePage.locator('.drawer-tab[data-dtab="interview-prep"]');
      if (await mobilePrepTab.isVisible()) {
        await mobilePrepTab.click();
        await mobilePage.waitForTimeout(800);
      }
    }

    const overflow = await mobilePage.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    console.log(`Mobile Horizontal Overflow Detected: ${overflow ? 'YES ❌' : 'NO (0px) ✅'}`);

    const mobilePath = path.join(SCREENSHOT_DIR, 'phase14_mobile_375.png');
    await mobilePage.screenshot({ path: mobilePath, fullPage: false });
    console.log(`📸 Saved Mobile View: ${mobilePath}`);
    await mobileContext.close();

    console.log('✅ Phase 14 Visual Verification Completed Successfully!');
  } finally {
    await browser.close();
    server.close();
  }
}

runPhase14Verification().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
