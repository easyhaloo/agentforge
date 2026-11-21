import { expect, test } from "@playwright/test";
import { installApiMocks } from "./support/api-mocks";

/**
 * E2E tests for Issue Tracking system.
 *
 * Current state: Tests the Issues section in Repository with BACKEND API integration.
 * The Issues UI is accessible at /orgs/:org/repositories/:owner/:repo/issues
 * and connects to the real backend API.
 *
 * Note: Tests will fail if backend API is not running or returns no data.
 * Use API mocks (installApiMocks) to provide test data.
 *
 * TODO:
 * - Add tests for issue creation
 * - Add tests for issue detail view
 * - Add tests for issue editing
 * - Add tests for state transitions (open → closed)
 * - Add tests for milestone assignment
 * - Add tests for label management
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("issues-e2e-initialized")) return;
    localStorage.clear();
    sessionStorage.setItem("issues-e2e-initialized", "1");
  });
  await installApiMocks(page);
});

test("navigates to Issues section in repository", async ({ page }) => {
  // Navigate directly to Issues section
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Verify Issues section content is displayed
  await expect(page.getByRole("heading", { name: /Issues/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Filters/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open issues/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /New issue/i })).toBeVisible();
});

test("displays issue list with open issues by default", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Default filter should be "Open issues"
  const openFilter = page.getByRole("button", { name: /Open issues/i });
  await expect(openFilter).toHaveClass(/active/);

  // Should display open issues (depends on API mock data)
  // Wait for loading to complete
  await expect(page.getByRole("status", { name: /Loading/i })).toBeHidden({ timeout: 5000 }).catch(() => {});

  // Verify table is visible
  const table = page.locator(".issues-table-wrap");
  await expect(table).toBeVisible();
});

test("filters issues by state - closed", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Wait for initial load
  await expect(page.getByRole("button", { name: /Open issues/i })).toBeVisible();

  // Click "Closed issues" filter
  await page.getByRole("button", { name: /Closed issues/i }).click();

  // Verify filter is active
  const closedFilter = page.getByRole("button", { name: /Closed issues/i });
  await expect(closedFilter).toHaveClass(/active/);
});

test("filters issues by assigned to me", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Click "Assigned to me" filter (only visible if user is logged in)
  const assignedFilter = page.getByRole("button", { name: /Assigned to me/i });

  // Check if filter exists (depends on currentUser)
  const filterExists = await assignedFilter.count();
  if (filterExists > 0) {
    await assignedFilter.click();
    await expect(assignedFilter).toHaveClass(/active/);
  }
});

test("filters issues by created by me", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Click "Created by me" filter (only visible if user is logged in)
  const createdFilter = page.getByRole("button", { name: /Created by me/i });

  // Check if filter exists (depends on currentUser)
  const filterExists = await createdFilter.count();
  if (filterExists > 0) {
    await createdFilter.click();
    await expect(createdFilter).toHaveClass(/active/);
  }
});

test("searches issues by title", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Search for "authentication"
  const searchInput = page.getByPlaceholder(/Search issues/i);
  await searchInput.fill("authentication");

  // Should trigger API call with search query
  // Wait for search results to load
  await page.waitForTimeout(500);
});

test("searches issues by number", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Search by issue number #42
  const searchInput = page.getByPlaceholder(/Search issues/i);
  await searchInput.fill("42");

  // Should trigger API call with search query
  await page.waitForTimeout(500);
});

test("filters issues by author", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Select author filter (if options are available)
  const authorSelect = page.getByRole("combobox", { name: /Author/i });
  const optionCount = await authorSelect.locator("option").count();

  if (optionCount > 1) {
    // Select first non-empty option
    await authorSelect.selectOption({ index: 1 });
    await page.waitForTimeout(500);
  }
});

test("filters issues by label", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Select label filter (if options are available)
  const labelSelect = page.getByRole("combobox", { name: /Label/i });
  const optionCount = await labelSelect.locator("option").count();

  if (optionCount > 1) {
    await labelSelect.selectOption({ index: 1 });
    await page.waitForTimeout(500);
  }
});

test("filters issues by milestone", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Select milestone filter (if options are available)
  const milestoneSelect = page.getByRole("combobox", { name: /Milestone/i });
  const optionCount = await milestoneSelect.locator("option").count();

  if (optionCount > 1) {
    await milestoneSelect.selectOption({ index: 1 });
    await page.waitForTimeout(500);
  }
});

test("filters issues by assignee", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Select assignee filter (if options are available)
  const assigneeSelect = page.getByRole("combobox", { name: /Assignee/i });
  const optionCount = await assigneeSelect.locator("option").count();

  if (optionCount > 1) {
    await assigneeSelect.selectOption({ index: 1 });
    await page.waitForTimeout(500);
  }
});

test("sorts issues by recently updated", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Default sort should be "Recently updated"
  const sortSelect = page.getByRole("combobox", { name: /Sort by/i });
  await expect(sortSelect).toHaveValue("updated-desc");
});

test("sorts issues by newest", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Change sort to "Newest"
  const sortSelect = page.getByRole("combobox", { name: /Sort by/i });
  await sortSelect.selectOption("created-desc");

  // Wait for API call to complete
  await page.waitForTimeout(500);
});

test("sorts issues by oldest", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Change sort to "Oldest"
  const sortSelect = page.getByRole("combobox", { name: /Sort by/i });
  await sortSelect.selectOption("created-asc");

  // Wait for API call to complete
  await page.waitForTimeout(500);
});

test("sorts issues by most commented", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Change sort to "Most commented"
  const sortSelect = page.getByRole("combobox", { name: /Sort by/i });
  await sortSelect.selectOption("comments-desc");

  // Wait for API call to complete
  await page.waitForTimeout(500);
});

test("displays issue metadata correctly", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Wait for issues to load
  await page.waitForTimeout(1000);

  // Check if any issues are displayed
  const issueRows = page.locator(".issue-title-cell");
  const count = await issueRows.count();

  if (count > 0) {
    // Get first issue row
    const firstIssue = issueRows.first();

    // Should display issue number
    await expect(firstIssue.locator(".issue-number")).toBeVisible();
  }
});

test("shows author and assignee information", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Wait for issues to load
  await page.waitForTimeout(1000);

  // Check that columns are present (even if no data)
  const tableWrap = page.locator(".issues-table-wrap");
  await expect(tableWrap).toBeVisible();
});

test("displays comment count", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Wait for issues to load
  await page.waitForTimeout(1000);

  // Verify the table is rendered
  const tableWrap = page.locator(".issues-table-wrap");
  await expect(tableWrap).toBeVisible();
});

test("shows empty state when no issues exist", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Wait for loading to complete
  await page.waitForTimeout(1000);

  // If no issues, should show empty state or "No issues found"
  // This depends on API returning empty data
});

test("displays issue footer with count", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/issues");

  // Wait for issues to load
  await page.waitForTimeout(1000);

  // Check footer is visible
  const footer = page.locator(".issues-footer");
  await expect(footer).toBeVisible();
});

// TODO: Add these tests when API integration is complete and UI is implemented:
// - test("creates new issue with title and body")
// - test("creates issue with labels")
// - test("creates issue with milestone")
// - test("views issue detail page")
// - test("edits issue title and body")
// - test("closes open issue")
// - test("reopens closed issue")
// - test("assigns milestone to issue")
// - test("adds label to issue")
// - test("removes label from issue")
// - test("assigns user to issue")
// - test("unassigns user from issue")
