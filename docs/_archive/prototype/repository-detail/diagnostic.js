// Diagnostic Script for Repository Detail Prototype
// Copy-paste this into the browser console to diagnose issues

console.log('=== Repository Detail Prototype Diagnostics ===\n');

// Test 1: Check if main tab containers exist
console.log('1. Main Tab Containers:');
const tabs = ['code', 'issues', 'pulls', 'ci', 'packages', 'wiki', 'settings', 'members'];
tabs.forEach(tab => {
  const element = document.getElementById(tab + '-tab');
  console.log(`  ${tab}-tab: ${element ? '✓ EXISTS' : '✗ MISSING'}`);
});

// Test 2: Check Wiki structure
console.log('\n2. Wiki Tab Structure:');
const wikiTab = document.getElementById('wiki-tab');
console.log(`  wiki-tab container: ${wikiTab ? '✓' : '✗'}`);
if (wikiTab) {
  const wikiSidebarItems = wikiTab.querySelectorAll('.github-sidebar-item[data-wiki-page]');
  console.log(`  Wiki sidebar items: ${wikiSidebarItems.length}`);
  wikiSidebarItems.forEach(item => {
    console.log(`    - data-wiki-page="${item.dataset.wikiPage}"`);
  });
  console.log(`  #wiki-page-title: ${document.getElementById('wiki-page-title') ? '✓' : '✗'}`);
  console.log(`  #wiki-page-body: ${document.getElementById('wiki-page-body') ? '✓' : '✗'}`);
}

// Test 3: Check Actions/Workflows structure
console.log('\n3. Actions Tab Structure:');
const ciTab = document.getElementById('ci-tab');
console.log(`  ci-tab container: ${ciTab ? '✓' : '✗'}`);
if (ciTab) {
  const workflowItems = ciTab.querySelectorAll('[data-workflow-id]');
  console.log(`  Workflow sidebar items: ${workflowItems.length}`);
  workflowItems.forEach(item => {
    console.log(`    - data-workflow-id="${item.dataset.workflowId}"`);
  });
  const workflowPages = ciTab.querySelectorAll('.workflow-page');
  console.log(`  Workflow pages: ${workflowPages.length}`);
  workflowPages.forEach(page => {
    console.log(`    - id="${page.id}" active=${page.classList.contains('active')}`);
  });
}

// Test 4: Check Packages structure
console.log('\n4. Packages Tab Structure:');
const packagesTab = document.getElementById('packages-tab');
console.log(`  packages-tab container: ${packagesTab ? '✓' : '✗'}`);
if (packagesTab) {
  const packageItems = packagesTab.querySelectorAll('[data-package-id]');
  console.log(`  Package sidebar items: ${packageItems.length}`);
  packageItems.forEach(item => {
    console.log(`    - data-package-id="${item.dataset.packageId}"`);
  });
  const packagePages = packagesTab.querySelectorAll('.package-page');
  console.log(`  Package pages: ${packagePages.length}`);
  packagePages.forEach(page => {
    console.log(`    - id="${page.id}" active=${page.classList.contains('active')}`);
  });
}

// Test 5: Check Settings structure
console.log('\n5. Settings Tab Structure:');
const settingsTab = document.getElementById('settings-tab');
console.log(`  settings-tab container: ${settingsTab ? '✓' : '✗'}`);
if (settingsTab) {
  const settingsItems = settingsTab.querySelectorAll('[data-settings-page]');
  console.log(`  Settings sidebar items: ${settingsItems.length}`);
  settingsItems.forEach(item => {
    console.log(`    - data-settings-page="${item.dataset.settingsPage}"`);
  });
  const settingsPages = settingsTab.querySelectorAll('.settings-page');
  console.log(`  Settings pages: ${settingsPages.length}`);
  settingsPages.forEach(page => {
    console.log(`    - id="${page.id}" active=${page.classList.contains('active')}`);
  });
}

// Test 6: Check Members structure
console.log('\n6. Members Tab Structure:');
const membersTab = document.getElementById('members-tab');
console.log(`  members-tab container: ${membersTab ? '✓' : '✗'}`);
if (membersTab) {
  const memberFilters = membersTab.querySelectorAll('[data-member-filter-type]');
  console.log(`  Member filter items: ${memberFilters.length}`);
  const memberItems = membersTab.querySelectorAll('.member-item');
  console.log(`  Member items: ${memberItems.length}`);
}

// Test 7: Test Wiki page switching manually
console.log('\n7. Manual Test - Wiki Page Switching:');
if (wikiTab) {
  const testWikiPage = wikiTab.querySelector('[data-wiki-page="getting-started"]');
  if (testWikiPage) {
    console.log('  Attempting to click "Getting Started" page...');
    testWikiPage.click();
    setTimeout(() => {
      const title = document.getElementById('wiki-page-title');
      const body = document.getElementById('wiki-page-body');
      console.log(`  Title after click: "${title ? title.textContent : 'N/A'}"`);
      console.log(`  Body has content: ${body && body.innerHTML.length > 100 ? '✓' : '✗'}`);
    }, 100);
  }
}

console.log('\n=== End Diagnostics ===');
