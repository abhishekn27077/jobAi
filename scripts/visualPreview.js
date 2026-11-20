import { chromium } from 'playwright';

async function main() {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  }
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Click on Resume Studio button for Job 4
  const btn = await page.locator('button:has-text("AI Resume Studio")').first();
  await btn.click();
  await page.waitForTimeout(3000);

  await page.screenshot({ path: 'output/resumes/resume_studio_dual_indicators_preview.png' });
  console.log('Successfully captured UI screenshot at output/resumes/resume_studio_dual_indicators_preview.png');
  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
