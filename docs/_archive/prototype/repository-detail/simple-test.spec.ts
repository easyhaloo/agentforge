import { test, expect } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTOTYPE_URL = 'file://' + path.resolve(__dirname, 'index.html');
const SCREENSHOT_DIR = path.resolve(__dirname, '../screenshots');

test('Code Tab - Default view', async ({ page }) => {
  console.log('Loading URL:', PROTOTYPE_URL);
  await page.goto(PROTOTYPE_URL);
  await page.waitForLoadState('networkidle');

  console.log('Page title:', await page.title());

  // Wait for the page to be ready
  await page.waitForSelector('.repo-tabs', { timeout: 5000 });

  // Click Code tab
  const codeTab = page.locator('.repo-tab:has-text("Code")');
  console.log('Code tab count:', await codeTab.count());
  await codeTab.click();
  await page.waitForTimeout(500);

  // Verify file tree is visible
  const fileTree = page.locator('.file-tree');
  console.log('File tree visible:', await fileTree.isVisible());

  // Take screenshot
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'test-code-tab-1.png'),
    fullPage: true
  });

  console.log('Screenshot saved');
});
