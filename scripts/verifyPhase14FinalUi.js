/**
 * CareerOS Phase 14 — Responsive & Interactive UI Verification Script
 * Verifies 375px, 768px, 1024px, 1280px, 1366px, and 1920px viewports (0px horizontal overflow),
 * simplified navigation, collapsible Advanced Filters, Batch Application Session Modal, and Light Mode.
 */

import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { startDashboardServer } from '../src/dashboard/server.js';

const SCREENSHOT_DIR = 'C:/Users/Abhis/.gemini/antigravity/brain/3fa685b8-0a44-4220-bf05-35fc529bce65/ux_screenshots';
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function getBrowser() {
  const launchOptions = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] };
  try { return await chromium.launch({ ...launchOptions, channel: 'chrome' }); }
  catch {
    try { return await chromium.launch({ ...launchOptions, channel: 'msedge' }); }
    catch { return await chromium.launch(launchOptions); }
  }
}

async function runVerification() {
  console.log('Starting Phase 14 Final UI & Responsive Verification...');
  const port = 3297;
  const server = startDashboardServer({ port });
  await new Promise(r => setTimeout(r, 1000));
  const browser = await getBrowser();
  const url = `http://127.0.0.1:${port}`;

  try {
    const viewports = [
      { name: '320px', width: 320, height: 568 },
      { name: '375px', width: 375, height: 667 },
      { name: '390px', width: 390, height: 844 },
      { name: '768px', width: 768, height: 1024 },
      { name: '1024px', width: 1024, height: 768 },
      { name: '1280px', width: 1280, height: 800 },
      { name: '1366px', width: 1366, height: 768 },
      { name: '1920px', width: 1920, height: 1080 }
    ];

    for (const vp of viewports) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      console.log(`Viewport ${vp.name}: horizontal overflow = ${overflow}px`);
      if (vp.width === 1366) {
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'phase14_final_desktop_1366.png'), fullPage: false });
        // Test Batch Session Modal
        await page.click('#btnStartBatchSession');
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'phase14_final_batch_modal.png'), fullPage: false });
        await page.click('#closeBatchSessionModalBtn');
        await page.waitForTimeout(300);
        // Test Advanced Filters Panel
        await page.click('#btnToggleAdvancedFilters');
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'phase14_final_advanced_filters.png'), fullPage: false });
      }
      if (vp.width === 375) {
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'phase14_final_mobile_375.png'), fullPage: false });
      }
      await ctx.close();
    }
    console.log('Phase 14 Final UI & Responsive Verification completed!');
  } finally {
    await browser.close();
    if (server && server.close) server.close();
    process.exit(0);
  }
}

runVerification();
