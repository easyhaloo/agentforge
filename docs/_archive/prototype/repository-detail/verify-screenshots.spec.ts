import { test, expect } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTOTYPE_URL = 'file://' + path.resolve(__dirname, 'index.html');
const SCREENSHOT_DIR = path.resolve(__dirname, '../screenshots');

test.describe('Repository Detail Prototype - Screenshot Verification', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(PROTOTYPE_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.repo-tabs', { timeout: 5000 });
  });

  test('Code Tab - Default view', async ({ page }) => {
    // Click Code tab
    await page.click('.repo-tab:has-text("Code")');
    await page.waitForTimeout(500);

    // Take screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'code-tab-1-default.png'),
      fullPage: true
    });
  });

  test('Code Tab - File selected', async ({ page }) => {
    // Click Code tab
    await page.click('.repo-tab:has-text("Code")');
    await page.waitForTimeout(300);

    // Click on a file in the tree - find any clickable file
    const fileItem = page.locator('.file-item').first();
    if (await fileItem.count() > 0) {
      await fileItem.click();
      await page.waitForTimeout(300);
    }

    // Take screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'code-tab-2-file-selected.png'),
      fullPage: true
    });
  });

  test('Issues Tab - Sidebar view', async ({ page }) => {
    // Click Issues tab
    await page.click('.repo-tab:has-text("Issues")');
    await page.waitForTimeout(300);

    // Take screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'issues-tab-1-sidebar.png'),
      fullPage: true
    });
  });

  test('Issues Tab - Dropdown expanded', async ({ page }) => {
    // Click Issues tab
    await page.click('.repo-tab:has-text("Issues")');
    await page.waitForTimeout(300);

    // Try to click on a dropdown button if visible, otherwise just take screenshot
    const dropdown = page.locator('.quick-filter-btn').first();
    const count = await dropdown.count();
    if (count > 0) {
      try {
        await dropdown.click({ force: true, timeout: 2000 });
        await page.waitForTimeout(300);
      } catch (e) {
        // If click fails, continue with screenshot
      }
    }

    // Take screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'issues-tab-2-dropdown.png'),
      fullPage: true
    });
  });

  test('Pull Requests Tab - This Repository', async ({ page }) => {
    // Click Pull Requests tab
    await page.click('.repo-tab:has-text("Pull Requests")');
    await page.waitForTimeout(300);

    // Take screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'pulls-tab-1-this-repo.png'),
      fullPage: true
    });
  });

  test('Pull Requests Tab - Related', async ({ page }) => {
    // Click Pull Requests tab
    await page.click('.repo-tab:has-text("Pull Requests")');
    await page.waitForTimeout(300);

    // Click "Related" subtab
    const relatedTab = page.locator('.pr-subtab:has-text("Related")');
    if (await relatedTab.count() > 0) {
      await relatedTab.click();
      await page.waitForTimeout(300);
    }

    // Take screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'pulls-tab-2-related.png'),
      fullPage: true
    });
  });

  test('Actions Tab - CI/CD Pipeline', async ({ page }) => {
    // Click Actions tab
    await page.click('.repo-tab:has-text("Actions")');
    await page.waitForTimeout(300);

    // Take screenshot (CI/CD Pipeline should be selected by default)
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'actions-tab-1-cicd-pipeline.png'),
      fullPage: true
    });
  });

  test('Actions Tab - Security Scan', async ({ page }) => {
    // Click Actions tab
    await page.click('.repo-tab:has-text("Actions")');
    await page.waitForTimeout(300);

    // Click "Security Scan" workflow
    const securityScan = page.locator('.github-sidebar-item[data-workflow-id="security-scan"]');
    if (await securityScan.count() > 0) {
      await securityScan.click();
      await page.waitForTimeout(300);
    }

    // Take screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'actions-tab-2-security-scan.png'),
      fullPage: true
    });
  });

  test('Packages Tab - Default package', async ({ page }) => {
    // Click Packages tab
    await page.click('.repo-tab:has-text("Packages")');
    await page.waitForTimeout(300);

    // Take screenshot (first package should be selected by default)
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'packages-tab-1-default.png'),
      fullPage: true
    });
  });

  test('Packages Tab - Different package', async ({ page }) => {
    // Click Packages tab
    await page.click('.repo-tab:has-text("Packages")');
    await page.waitForTimeout(300);

    // Click on a different package (agentforge-cli)
    const cliPackage = page.locator('.github-sidebar-item[data-package-id="agentforge-cli"]');
    if (await cliPackage.count() > 0) {
      await cliPackage.click();
      await page.waitForTimeout(300);
    }

    // Take screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'packages-tab-2-different-package.png'),
      fullPage: true
    });
  });

  test('Wiki Tab - Home page', async ({ page }) => {
    // Click Wiki tab
    await page.click('.repo-tab:has-text("Wiki")');
    await page.waitForTimeout(300);

    // Take screenshot (Home should be selected by default)
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'wiki-tab-1-home.png'),
      fullPage: true
    });
  });

  test('Wiki Tab - Getting Started', async ({ page }) => {
    // Click Wiki tab
    await page.click('.repo-tab:has-text("Wiki")');
    await page.waitForTimeout(500);

    // Click "Getting Started" with force click
    const gettingStarted = page.locator('.github-sidebar-item[data-wiki-page="getting-started"]');
    const count = await gettingStarted.count();
    if (count > 0) {
      try {
        await gettingStarted.click({ force: true, timeout: 2000 });
        await page.waitForTimeout(300);
      } catch (e) {
        // If click fails, continue with screenshot
      }
    }

    // Take screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'wiki-tab-2-getting-started.png'),
      fullPage: true
    });
  });

  test('Settings Tab - General settings', async ({ page }) => {
    // Click Settings tab
    await page.click('.repo-tab:has-text("Settings")');
    await page.waitForTimeout(300);

    // Take screenshot (General should be selected by default)
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'settings-tab-1-general.png'),
      fullPage: true
    });
  });

  test('Settings Tab - Other setting page', async ({ page }) => {
    // Click Settings tab
    await page.click('.repo-tab:has-text("Settings")');
    await page.waitForTimeout(500);

    // Click on "Branches" or another settings page with force click
    const branches = page.locator('.github-sidebar-item[data-settings-page="branches"]');
    const count = await branches.count();
    if (count > 0) {
      try {
        await branches.click({ force: true, timeout: 2000 });
        await page.waitForTimeout(300);
      } catch (e) {
        // If click fails, continue with screenshot
      }
    }

    // Take screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'settings-tab-2-other-setting.png'),
      fullPage: true
    });
  });

  test('Members Tab - Organization Members', async ({ page }) => {
    // Click Members tab
    await page.click('.repo-tab:has-text("Members")');
    await page.waitForTimeout(300);

    // Take screenshot (Organization Members should be selected by default)
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'members-tab-1-org-members.png'),
      fullPage: true
    });
  });

  test('Members Tab - External Collaborators', async ({ page }) => {
    // Click Members tab
    await page.click('.repo-tab:has-text("Members")');
    await page.waitForTimeout(300);

    // Click "External Collaborators"
    const external = page.locator('.github-sidebar-item[data-member-filter-type="external"]');
    if (await external.count() > 0) {
      await external.click();
      await page.waitForTimeout(300);
    }

    // Take screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'members-tab-2-external.png'),
      fullPage: true
    });
  });
});
