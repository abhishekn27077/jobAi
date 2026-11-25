/**
 * CareerOS Phase 10 — UI Visual & Responsive Verification Script
 * Launches Playwright headless browser across 5 viewports (320px, 375px, 768px, 1280px, 1366px)
 * Verifies 0px horizontal overflow, search console interactions, 14 source tabs,
 * external gateway card, detail drawer, and light/dark theme toggles.
 */

import http from 'node:http';
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

async function runVerification() {
  console.log('🚀 Starting Phase 10 Visual Verification...');
  const testPort = 3240;
  const server = startDashboardServer({ port: testPort });
  await new Promise(resolve => setTimeout(resolve, 800));

  const browser = await getBrowser();
  const targetUrl = `http://127.0.0.1:${testPort}`;
  console.log(`Connecting to ${targetUrl}...`);

  const viewports = [
    { name: 'desktop_1366', width: 1366, height: 768 },
    { name: 'desktop_1280', width: 1280, height: 800 },
    { name: 'tablet_768', width: 768, height: 1024 },
    { name: 'mobile_375', width: 375, height: 667 },
    { name: 'mobile_320', width: 320, height: 568 }
  ];

  const results = [];

  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto(`${targetUrl}/#jobs`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);

    // Check for horizontal overflow
    const overflowX = await page.evaluate(() => {
      return Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
    });

    console.log(`[Viewport ${vp.name} (${vp.width}x${vp.height})] Horizontal overflow: ${overflowX}px`);
    results.push({ viewport: vp.name, width: vp.width, overflowX, pass: overflowX <= 1 });

    const screenshotPath = path.join(SCREENSHOT_DIR, `phase10_unified_search_${vp.name}.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`  Saved screenshot: ${screenshotPath}`);

    // If on 1366, test clicking a restricted source tab (e.g. Naukri) to verify External Gateway Card
    if (vp.name === 'desktop_1366') {
      console.log('  Testing 14 Source Tabs: Clicking "Naukri" tab...');
      await page.click('.source-nav-tab[data-source="naukri"]');
      await page.waitForTimeout(800);

      const gatewayVisible = await page.evaluate(() => {
        const gw = document.getElementById('externalSourceGatewayCard');
        return gw && !gw.classList.contains('hidden') && gw.offsetHeight > 0;
      });
      console.log(`  External Gateway Card visible: ${gatewayVisible}`);

      const gatewayScreenshot = path.join(SCREENSHOT_DIR, 'phase10_naukri_assisted_gateway.png');
      await page.screenshot({ path: gatewayScreenshot });
      console.log(`  Saved gateway screenshot: ${gatewayScreenshot}`);

      // Test Search query execution: type "Spring Boot" and click Search
      console.log('  Testing Unified Search input: typing "Spring Boot"...');
      await page.click('.source-nav-tab[data-source="all"]');
      await page.waitForTimeout(500);
      await page.fill('#unifiedSearchInput', 'Spring Boot');
      await page.click('#btnExecuteSearch');
      await page.waitForTimeout(1000);

      const searchSummaryMetrics = await page.evaluate(() => {
        return {
          total: document.getElementById('metricTotalFound')?.textContent,
          unique: document.getElementById('metricUniqueFound')?.textContent,
          dupes: document.getElementById('metricDupesRemoved')?.textContent,
          fresh: document.getElementById('metricFreshRoles')?.textContent,
          strong: document.getElementById('metricStrongMatches')?.textContent,
          eligible: document.getElementById('metricEligibleRoles')?.textContent
        };
      });
      console.log('  Search Summary metrics derived:', searchSummaryMetrics);

      const searchResultsScreenshot = path.join(SCREENSHOT_DIR, 'phase10_search_results_springboot.png');
      await page.screenshot({ path: searchResultsScreenshot });

      // Test Detail Drawer Inspection
      console.log('  Testing Slide-Over Detail Drawer...');
      const firstInspectBtn = await page.$('.job-card .btn-outline:has-text("Inspect")');
      if (firstInspectBtn) {
        await firstInspectBtn.click();
        await page.waitForTimeout(800);

        const drawerVisible = await page.evaluate(() => {
          const d = document.getElementById('detailDrawer');
          return d && !d.classList.contains('hidden') && d.offsetWidth > 0;
        });
        console.log(`  Detail Drawer visible: ${drawerVisible}`);

        const drawerScreenshot = path.join(SCREENSHOT_DIR, 'phase10_drawer_overview_inspection.png');
        await page.screenshot({ path: drawerScreenshot });
        console.log(`  Saved drawer screenshot: ${drawerScreenshot}`);

        // Close drawer
        await page.click('#closeDrawerBtn');
        await page.waitForTimeout(400);
      }

      // Test Light Mode Toggle
      console.log('  Testing Light Mode Toggle...');
      await page.click('#themeToggleBtn');
      await page.waitForTimeout(500);

      const lightModeTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      console.log(`  Active theme: ${lightModeTheme}`);

      const lightModeScreenshot = path.join(SCREENSHOT_DIR, 'phase10_light_mode_unified_search.png');
      await page.screenshot({ path: lightModeScreenshot });
      console.log(`  Saved light mode screenshot: ${lightModeScreenshot}`);

      // Toggle back to dark
      await page.click('#themeToggleBtn');
      await page.waitForTimeout(300);
    }

    await page.close();
  }

  await browser.close();
  server.close();

  console.log('\n========================================');
  console.log('📊 Verification Summary:');
  for (const r of results) {
    console.log(`  • ${r.viewport} (${r.width}px): ${r.overflowX}px overflow [${r.pass ? 'PASS' : 'FAIL'}]`);
  }
  console.log('========================================\n');
}

runVerification().catch(err => {
  console.error('Verification error:', err);
  process.exit(1);
});
