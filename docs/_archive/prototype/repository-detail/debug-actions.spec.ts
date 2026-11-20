import { test } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTOTYPE_URL = 'file://' + path.resolve(__dirname, 'index.html');
const SCREENSHOT_DIR = path.resolve(__dirname, '../screenshots');

test('Debug Actions tab switching', async ({ page }) => {
  await page.goto(PROTOTYPE_URL);
  await page.waitForLoadState('networkidle');

  console.log('=== BEFORE CLICKING ACTIONS ===');

  // Check initial state
  const codeTab = await page.locator('#code-tab').evaluate(el => ({
    display: window.getComputedStyle(el).display,
    hasActive: el.classList.contains('active')
  }));
  console.log('code-tab:', codeTab);

  const ciTab = await page.locator('#ci-tab').evaluate(el => ({
    display: window.getComputedStyle(el).display,
    hasActive: el.classList.contains('active')
  }));
  console.log('ci-tab:', ciTab);

  console.log('=== CLICKING ACTIONS TAB ===');

  // Click Actions tab button
  await page.click('.repo-tab[data-tab="ci"]');
  await page.waitForTimeout(500);

  console.log('=== AFTER CLICKING ACTIONS ===');

  // Check state after click
  const codeTabAfter = await page.locator('#code-tab').evaluate(el => ({
    display: window.getComputedStyle(el).display,
    hasActive: el.classList.contains('active')
  }));
  console.log('code-tab:', codeTabAfter);

  const ciTabAfter = await page.locator('#ci-tab').evaluate(el => ({
    display: window.getComputedStyle(el).display,
    hasActive: el.classList.contains('active')
  }));
  console.log('ci-tab:', ciTabAfter);

  // Check button states
  const actionsButton = await page.locator('.repo-tab[data-tab="ci"]').evaluate(el => ({
    hasActive: el.classList.contains('active'),
    dataTab: el.getAttribute('data-tab')
  }));
  console.log('Actions button:', actionsButton);

  // Take screenshot
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'actions-debug.png'),
    fullPage: true
  });
});
