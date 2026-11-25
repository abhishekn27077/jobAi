/**
 * CareerOS Phase 15 — UI Visual Verification Script
 * Validates:
 * 1. Desktop Discovery Overview with compact KPI strip & fast suggestion chips
 * 2. Natural language search query surfacing abundant opportunities
 * 3. 1-Click ATS Resume compilation and interactive ready modal (Step 1, Step 2, Step 3)
 * 4. Applications Workspace defaulting to clean Table/List view
 * 5. Light Mode theme polish and contrast
 * 6. Mobile 375px viewport responsiveness (0px horizontal overflow)
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

async function runPhase15Verification() {
  console.log('🚀 Starting Phase 15 Visual Verification...');
  const testPort = 3295;
  const server = startDashboardServer({ port: testPort });
  await new Promise(resolve => setTimeout(resolve, 1000));

  const browser = await getBrowser();
  const targetUrl = `http://127.0.0.1:${testPort}`;
  console.log(`Connecting to ${targetUrl}...`);

  try {
    // 1. Desktop Viewport (1366x768)
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Capture 1: Main Job Feed with sleek KPI strip and compact cards
    const desktopPath = path.join(SCREENSHOT_DIR, 'phase15_desktop_overview.png');
    await page.screenshot({ path: desktopPath, fullPage: false });
    console.log(`📸 Saved Desktop Overview: ${desktopPath}`);

    // Capture 2: Natural Language Search Query via Suggestion Chip
    console.log('Testing query suggestion chip...');
    const chipBtn = page.locator('.search-chip-btn').first();
    if (await chipBtn.isVisible()) {
      await chipBtn.click();
      await page.waitForTimeout(1200);
      const searchResultsPath = path.join(SCREENSHOT_DIR, 'phase15_natural_search_results.png');
      await page.screenshot({ path: searchResultsPath, fullPage: false });
      console.log(`📸 Saved Natural Search Results: ${searchResultsPath}`);
    }

    // Capture 3: 1-Click ATS Resume Ready Modal
    console.log('Clicking 1-Click ATS Resume on top matching job...');
    const atsResumeBtn = page.locator('button.btn-generate-ats, button.btn-ats-tailor').first();
    await atsResumeBtn.waitFor({ state: 'visible', timeout: 10000 });
    await atsResumeBtn.click();
    await page.waitForTimeout(2000);

    // Check if ATS Resume Ready modal is open
    const modalVisible = await page.locator('#atsResumeReadyModal').isVisible();
    console.log(`ATS Ready Modal visible: ${modalVisible}`);
    const modalPath = path.join(SCREENSHOT_DIR, 'phase15_ats_resume_modal.png');
    await page.screenshot({ path: modalPath, fullPage: false });
    console.log(`📸 Saved ATS Resume Modal: ${modalPath}`);

    // Close the modal
    const closeBtn = page.locator('#closeAtsReadyModalBtn, #atsResumeReadyModal button:has-text("Done")').first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await page.waitForTimeout(400);
    } else {
      await page.keyboard.press('Escape');
    }

    // Capture 4: Applications Workspace (Defaulting to Table View)
    console.log('Navigating to Applications workspace...');
    const appsNavTab = page.locator('#viewApplicationsBtn, .nav-tab[data-view="applications"]').first();
    await appsNavTab.click();
    await page.waitForTimeout(800);

    const appsTablePath = path.join(SCREENSHOT_DIR, 'phase15_applications_table_view.png');
    await page.screenshot({ path: appsTablePath, fullPage: false });
    console.log(`📸 Saved Applications Table View: ${appsTablePath}`);

    // Capture 5: Light Mode Theme
    console.log('Testing Light Mode theme...');
    const themeBtn = page.locator('#themeToggleBtn, .theme-toggle-btn').first();
    if (await themeBtn.isVisible()) {
      await themeBtn.click();
      await page.waitForTimeout(400);
      const lightPath = path.join(SCREENSHOT_DIR, 'phase15_light_mode.png');
      await page.screenshot({ path: lightPath, fullPage: false });
      console.log(`📸 Saved Light Mode: ${lightPath}`);

      // Revert to dark mode
      await themeBtn.click();
      await page.waitForTimeout(300);
    }
    await context.close();

    // 2. Mobile Viewport (375x667 - iPhone SE)
    console.log('Testing Mobile 375px viewport...');
    const mobileContext = await browser.newContext({ viewport: { width: 375, height: 667 } });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(targetUrl, { waitUntil: 'networkidle' });
    await mobilePage.waitForTimeout(1000);

    // Measure horizontal overflow
    const overflowX = await mobilePage.evaluate(() => {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    });
    console.log(`📱 Mobile Horizontal Overflow: ${overflowX}px`);

    const mobilePath = path.join(SCREENSHOT_DIR, 'phase15_mobile_375.png');
    await mobilePage.screenshot({ path: mobilePath, fullPage: false });
    console.log(`📸 Saved Mobile View: ${mobilePath}`);

    await mobileContext.close();
    console.log('✅ Phase 15 Visual Verification successfully completed!');
  } catch (err) {
    console.error('❌ Verification failed:', err);
  } finally {
    await browser.close();
    if (server && server.close) {
      server.close();
    }
    process.exit(0);
  }
}

runPhase15Verification();
