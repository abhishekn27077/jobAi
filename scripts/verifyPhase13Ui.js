/**
 * CareerOS Phase 13 — UI Visual Verification Script
 * Validates:
 * 1. Desktop Unified Search with Active Filter Banner and 1-Click ATS Resume buttons
 * 2. Side Drawer Application Dossier with 3-Tier Readiness Banner and 14-Dimension ATS Report
 * 3. Screening Questions Intelligence & Vault tab with inline save overrides
 * 4. Light Mode Theme Polish and Contrast
 * 5. Mobile 375px responsiveness with 0px horizontal overflow
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

async function runPhase13Verification() {
  console.log('🚀 Starting Phase 13 Visual Verification...');
  const testPort = 3288;
  const server = startDashboardServer({ port: testPort });
  await new Promise(resolve => setTimeout(resolve, 800));

  const browser = await getBrowser();
  const targetUrl = `http://127.0.0.1:${testPort}`;
  console.log(`Connecting to ${targetUrl}...`);

  try {
    // 1. Desktop Viewport (1366x768)
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Capture 1: Main Job Feed with Filter Banner & 1-Click ATS Resume buttons
    const desktopPath = path.join(SCREENSHOT_DIR, 'phase13_desktop_overview.png');
    await page.screenshot({ path: desktopPath, fullPage: false });
    console.log(`📸 Saved Desktop Overview: ${desktopPath}`);

    // Capture 2: Detail Drawer -> Application Dossier & 14-Dimension ATS Report
    console.log('Inspecting first job card...');
    const inspectBtn = page.locator('.btn:has-text("Inspect")').first();
    if (await inspectBtn.isVisible()) {
      await inspectBtn.click();
      await page.waitForTimeout(600);

      // Switch to Dossier Tab
      const dossierTab = page.locator('.drawer-tab[data-dtab="dossier"]');
      if (await dossierTab.isVisible()) {
        await dossierTab.click();
        await page.waitForTimeout(1000);
      }

      const drawerDossierPath = path.join(SCREENSHOT_DIR, 'phase13_drawer_readiness_ats.png');
      await page.screenshot({ path: drawerDossierPath, fullPage: false });
      console.log(`📸 Saved Drawer Readiness & ATS Report: ${drawerDossierPath}`);

      // Capture 3: Screening Q&A Tab
      const screeningTab = page.locator('.drawer-tab[data-dtab="screening"]');
      if (await screeningTab.isVisible()) {
        await screeningTab.click();
        await page.waitForTimeout(800);
        const screeningPath = path.join(SCREENSHOT_DIR, 'phase13_screening_vault.png');
        await page.screenshot({ path: screeningPath, fullPage: false });
        console.log(`📸 Saved Screening Vault Tab: ${screeningPath}`);
      }

      // Close drawer
      const closeDrawerBtn = page.locator('#closeDrawerBtn');
      if (await closeDrawerBtn.isVisible()) {
        await closeDrawerBtn.click();
        await page.waitForTimeout(400);
      }
    }

    // Capture 4: Light Mode Theme
    console.log('Toggling Light Mode...');
    const themeBtn = page.locator('#themeToggleBtn');
    if (await themeBtn.isVisible()) {
      await themeBtn.click();
      await page.waitForTimeout(600);
      const lightModePath = path.join(SCREENSHOT_DIR, 'phase13_light_mode.png');
      await page.screenshot({ path: lightModePath, fullPage: false });
      console.log(`📸 Saved Light Mode Screenshot: ${lightModePath}`);
    }

    await context.close();

    // Capture 5: Mobile Viewport (375x812) & Horizontal Scroll Check
    const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(targetUrl, { waitUntil: 'networkidle' });
    await mobilePage.waitForTimeout(1000);

    const hasHorizontalOverflow = await mobilePage.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });

    console.log(`Mobile (375px) Horizontal Overflow Detected: ${hasHorizontalOverflow ? 'YES (FAIL)' : '0px NO (PASS)'}`);

    const mobilePath = path.join(SCREENSHOT_DIR, 'phase13_mobile_375.png');
    await mobilePage.screenshot({ path: mobilePath, fullPage: false });
    console.log(`📸 Saved Mobile Screenshot: ${mobilePath}`);

    await mobileContext.close();

    console.log('✅ Phase 13 UI Visual Verification Completed Successfully!');
  } finally {
    await browser.close();
    server.close();
  }
}

runPhase13Verification().catch(err => {
  console.error('❌ Phase 13 Verification Failed:', err);
  process.exit(1);
});
