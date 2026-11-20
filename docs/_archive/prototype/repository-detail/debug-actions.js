import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const filePath = 'file://' + path.resolve(__dirname, 'index.html');
  console.log('Loading:', filePath);

  await page.goto(filePath);
  await page.waitForLoadState('networkidle');

  // Click Actions tab
  console.log('\n=== Clicking Actions tab ===');
  await page.click('.repo-tab:has-text("Actions")');
  await page.waitForTimeout(500);

  // Check 1: Does ci-tab have active class?
  const ciTabActive = await page.evaluate(() => {
    const ciTab = document.getElementById('ci-tab');
    return {
      exists: !!ciTab,
      hasActiveClass: ciTab?.classList.contains('active'),
      display: ciTab ? window.getComputedStyle(ciTab).display : null,
      innerHTML: ciTab ? ciTab.innerHTML.substring(0, 200) : null
    };
  });
  console.log('\n1. CI-Tab state:', JSON.stringify(ciTabActive, null, 2));

  // Check 2: Is workflow-page visible?
  const workflowPageState = await page.evaluate(() => {
    const workflowPage = document.getElementById('workflow-ci-cd');
    return {
      exists: !!workflowPage,
      hasActiveClass: workflowPage?.classList.contains('active'),
      display: workflowPage ? window.getComputedStyle(workflowPage).display : null,
      visibility: workflowPage ? window.getComputedStyle(workflowPage).visibility : null
    };
  });
  console.log('\n2. Workflow-page state:', JSON.stringify(workflowPageState, null, 2));

  // Check 3: Console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  await page.waitForTimeout(500);
  console.log('\n3. Console errors:', errors.length > 0 ? errors : 'None');

  // Check 4: CSS variables
  const cssVars = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      '--af-color-text': style.getPropertyValue('--af-color-text'),
      '--af-color-text-secondary': style.getPropertyValue('--af-color-text-secondary'),
      '--af-color-text-muted': style.getPropertyValue('--af-color-text-muted'),
      '--gh-color-fg-default': style.getPropertyValue('--gh-color-fg-default')
    };
  });
  console.log('\n4. CSS variables:', JSON.stringify(cssVars, null, 2));

  // Check computed styles on workflow content
  const contentStyles = await page.evaluate(() => {
    const h2 = document.querySelector('#workflow-ci-cd h2');
    if (!h2) return { error: 'h2 not found' };
    const style = window.getComputedStyle(h2);
    return {
      color: style.color,
      display: style.display,
      fontSize: style.fontSize,
      textContent: h2.textContent
    };
  });
  console.log('\n5. H2 element styles:', JSON.stringify(contentStyles, null, 2));

  // Check tab-sidebar-layout
  const layoutState = await page.evaluate(() => {
    const layout = document.querySelector('#ci-tab .tab-sidebar-layout');
    if (!layout) return { error: 'layout not found' };
    const style = window.getComputedStyle(layout);
    return {
      display: style.display,
      height: style.height,
      minHeight: style.minHeight,
      childrenCount: layout.children.length
    };
  });
  console.log('\n6. Tab-sidebar-layout state:', JSON.stringify(layoutState, null, 2));

  // Take screenshot
  await page.screenshot({
    path: path.join(__dirname, '../screenshots/debug-actions-tab.png'),
    fullPage: true
  });
  console.log('\n7. Screenshot saved to: ../screenshots/debug-actions-tab.png');

  // Keep browser open for 10 seconds for manual inspection
  console.log('\nBrowser will stay open for 10 seconds for manual inspection...');
  await page.waitForTimeout(10000);

  await browser.close();
})();
