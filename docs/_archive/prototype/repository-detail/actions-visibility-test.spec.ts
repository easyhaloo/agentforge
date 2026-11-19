import { test, expect } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTOTYPE_URL = 'file://' + path.resolve(__dirname, 'index.html');
const SCREENSHOT_DIR = path.resolve(__dirname, '../screenshots');

test('Actions tab content visibility test', async ({ page }) => {
  await page.goto(PROTOTYPE_URL);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('.repo-tabs', { timeout: 5000 });

  // Click Actions tab
  await page.click('.repo-tab:has-text("Actions")');
  await page.waitForTimeout(500);

  // Check if ci-tab is visible
  const ciTab = page.locator('#ci-tab');
  const isVisible = await ciTab.isVisible();
  console.log('ci-tab is visible:', isVisible);

  // Check if workflow content is visible
  const workflowPage = page.locator('#workflow-ci-cd');
  const workflowVisible = await workflowPage.isVisible();
  console.log('workflow-ci-cd is visible:', workflowVisible);

  // Check for text content
  const hasText = await page.locator('text=CI/CD Pipeline').isVisible();
  console.log('CI/CD Pipeline text is visible:', hasText);

  // Get computed styles
  const ciTabDisplay = await ciTab.evaluate(el => window.getComputedStyle(el).display);
  const workflowDisplay = await workflowPage.evaluate(el => window.getComputedStyle(el).display);
  console.log('ci-tab display:', ciTabDisplay);
  console.log('workflow-ci-cd display:', workflowDisplay);

  // Take screenshot
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'actions-tab-visibility-test.png'),
    fullPage: true
  });

  // Assert content is visible
  expect(isVisible).toBe(true);
  expect(workflowVisible).toBe(true);
  expect(hasText).toBe(true);
});
