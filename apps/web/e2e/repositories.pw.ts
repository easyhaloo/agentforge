import { expect, test } from "@playwright/test";
import { installApiMocks } from "./support/api-mocks";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("repository-e2e-initialized")) return;
    localStorage.clear();
    sessionStorage.setItem("repository-e2e-initialized", "1");
  });
  await installApiMocks(page);
});

test("the organization has its own repositories page", async ({ page }) => {
  await page.goto("/orgs/demo/repositories");

  await expect(page.getByRole("heading", { name: "Repositories", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "easyhaloo/agentforge" })).toBeVisible();
});

test("filters, sorts, and restores a saved repository view on desktop and mobile", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/\/api\/v1\/organizations\/org-demo\/repositories(?:\?details=1)?$/, route => route.fulfill({ json: { items: [
    { slug: "agentforge/web-console", default_branch: "main", created_by: "user-owner", updated_at: "2026-11-18T09:00:00Z", git: { branch_count: 1, language: "TypeScript", last_commit_at: "2026-11-10T09:00:00Z" } },
    { slug: "agentforge/workflow-engine", default_branch: "develop", created_by: "user-member", updated_at: "2026-11-17T09:00:00Z", git: { branch_count: 1, language: "Go", last_commit_at: "2026-11-09T09:00:00Z" } },
    { slug: "agentforge/api-gateway", default_branch: "main", created_by: "user-owner", updated_at: "2026-11-16T09:00:00Z", git: { branch_count: 1, language: "Go", last_commit_at: "2026-11-08T09:00:00Z" } },
  ] } }));
  await page.goto("/orgs/demo/repositories");
  const list = page.getByRole("list", { name: "Repositories" });
  await expect(list.locator(".repo-catalog-name").first()).toHaveAccessibleName("agentforge/web-console");
  await page.screenshot({ path: testInfo.outputPath("repositories-desktop.png"), animations: "disabled" });

  const filter = page.getByRole("textbox", { name: "Find a repository…" });
  const names = list.locator(".repo-catalog-name");
  await page.getByRole("button", { name: "Registered by me" }).click();
  await expect(filter).toHaveValue("created-by:@me");
  await expect(names).toHaveCount(2);
  const adminAccess = page.getByRole("button", { name: "Admin access" });
  await expect(page.getByRole("navigation").filter({ has: adminAccess })).toHaveCSS("row-gap", "0px");
  await adminAccess.hover();
  await expect(adminAccess).toHaveCSS("cursor", "pointer");
  await expect(adminAccess).toHaveCSS("height", "32px");
  await expect(adminAccess).toHaveCSS("background-color", "rgba(129, 139, 152, 0.1)");
  await adminAccess.click();
  await expect(filter).toHaveValue("access:admin");
  await expect(names).toHaveCount(3);
  await expect(page.getByRole("button", { name: "My forks" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "My contributions" })).toBeDisabled();
  await filter.fill("  language:GO branch:main  ");
  await expect(filter).toHaveCSS("outline-offset", "-2px");
  await expect(filter).toHaveCSS("box-shadow", "none");
  await expect(filter).toHaveCSS("outline-style", "solid");
  const clear = page.getByRole("button", { name: "Clear", exact: true });
  const search = page.getByRole("button", { name: "Search repositories" });
  await expect(search).toHaveCSS("outline-style", "none");
  await filter.press("Tab");
  await expect(clear).toBeFocused();
  await expect(clear).toHaveCSS("outline-style", "solid");
  await clear.press("Tab");
  await expect(search).toBeFocused();
  await expect(search).toHaveCSS("outline-style", "solid");
  await search.press("Enter");
  await expect(filter).toHaveValue("language:GO branch:main");
  await expect(names).toHaveText(["agentforge/api-gateway"]);
  await filter.fill("repo:agentforge/workflow-engine");
  await expect(names).toHaveText(["agentforge/workflow-engine"]);
  await filter.fill("agentforge branch:main");
  await expect(names).toHaveCount(2);

  const sort = page.getByRole("combobox", { name: "Sort repositories" });
  const detailed = page.getByRole("button", { name: "Detailed list" });
  const compact = page.getByRole("button", { name: "Compact list" });
  await expect(sort).toHaveCSS("color", "rgb(89, 99, 110)");
  await expect(detailed).toHaveAttribute("aria-pressed", "true");
  await expect(detailed).toHaveCSS("color", "rgb(89, 99, 110)");
  await expect(detailed).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.locator(".repo-catalog-controls").screenshot({ path: testInfo.outputPath("repository-filter-selected.png"), animations: "disabled", scale: "css" });

  const options = page.getByRole("listbox", { name: "Sort by" });
  const relevance = options.getByRole("option", { name: "Relevance" });
  await sort.click();
  await expect(relevance).toHaveAttribute("aria-selected", "true");
  await expect(relevance).toHaveCSS("outline-style", "none");
  await options.screenshot({ path: testInfo.outputPath("repository-sort-selected.png"), animations: "disabled" });
  await sort.click();
  await page.getByRole("button", { name: "Search repositories" }).click();
  await page.keyboard.press("Tab");
  await expect(sort).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(options.getByRole("option")).toHaveText([/Relevance/, /^Last commit$/, /^Name$/, /^Stars$/]);
  await expect(options.getByRole("option", { name: "Stars" })).toBeDisabled();
  await expect(relevance).toBeFocused();
  await expect(relevance).toHaveCSS("outline-style", "solid");
  await expect(relevance).toHaveCSS("color", "rgb(31, 35, 40)");
  await page.keyboard.press("ArrowDown");
  await expect(options.getByRole("option", { name: "Last commit" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(sort).toContainText("Last commit");
  await expect(names.first()).toHaveAccessibleName("agentforge/web-console");
  await sort.click();
  await page.keyboard.press("End");
  await expect(options.getByRole("option", { name: "Name", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(names.first()).toHaveAccessibleName("agentforge/api-gateway");
  await sort.click();
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();
  await expect(sort).toBeFocused();
  await compact.click();
  await expect(compact).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(detailed).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.getByRole("button", { name: "Save current view" }).click();
  const dialog = page.getByRole("dialog", { name: "Save current view" });
  await dialog.getByLabel("View name").fill("Main branches");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await clear.click();
  await expect(filter).toBeFocused();
  await expect(list.locator(".repo-catalog-name")).toHaveCount(3);
  await page.getByRole("button", { name: "Detailed list" }).click();
  await page.reload();
  const savedView = page.getByRole("button", { name: "Main branches", exact: true });
  const removeView = page.getByRole("button", { name: "Remove Main branches" });
  const savedRow = page.getByRole("listitem").filter({ has: savedView });
  await expect(savedRow).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const restBounds = await savedRow.boundingBox();
  await savedView.hover();
  await expect(savedRow).toHaveCSS("background-color", "rgba(129, 139, 152, 0.1)");
  await removeView.hover();
  await expect(savedRow).toHaveCSS("background-color", "rgba(129, 139, 152, 0.1)");
  expect(await savedRow.boundingBox()).toEqual(restBounds);
  await savedRow.screenshot({ path: testInfo.outputPath("repository-view-hover.png"), animations: "disabled" });
  await expect(removeView).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await savedView.click();
  await page.keyboard.press("Tab");
  await expect(removeView).toBeFocused();
  await expect(removeView).toHaveCSS("outline-style", "solid");
  await expect(filter).toHaveValue("agentforge branch:main");
  await expect(list.locator(".repo-catalog-name")).toHaveCount(2);
  await expect(compact).toHaveAttribute("aria-pressed", "true");
  await expect(sort).toContainText("Name");

  await page.setViewportSize({ width: 320, height: 760 });
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("navigation", { name: "Repository views" })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await sort.click();
  await expect(options).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: testInfo.outputPath("repositories-mobile.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.getByRole("button", { name: "Main branches", exact: true })).toBeVisible();
});

test("a repository owner can switch spaces, keep configuration, and create", async ({ page }, testInfo) => {
  await installApiMocks(page, { organizations: [
    { id: "org-demo", slug: "demo", name: "AgentForge Demo", role: "owner" },
    { id: "org-personal", slug: "taylor", name: "Taylor's Workspace", role: "owner", personal: true },
  ] });
  const catalog = "/orgs/demo/repositories";
  const newPage = `${catalog}/new`;
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(catalog);
  await page.getByRole("link", { name: "New repository", exact: true }).click();
  await expect(page).toHaveURL(newPage);
  await expect(page.getByRole("heading", { name: "Create a new repository" })).toBeVisible();
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(catalog);

  await page.goto(`${catalog}?register=1`);
  await expect(page).toHaveURL(`${newPage}?mode=register`);
  await expect(page.getByRole("heading", { name: "Register repository" })).toBeVisible();
  await expect(page.getByLabel("Default branch", { exact: true })).toHaveValue("main");
  await page.getByRole("link", { name: "Create a new repository" }).click();
  const general = page.getByRole("region", { name: "General" });
  const configuration = page.getByRole("region", { name: "Configuration" });
  const ownerTrigger = general.getByRole("button", { name: "AgentForge Demo", exact: true });
  const name = general.getByLabel("Repository name", { exact: true });
  const rail = await general.evaluate(section => {
    const fieldset = section.closest("fieldset")!;
    const line = getComputedStyle(fieldset, "::before");
    const lastSection = fieldset.lastElementChild!.getBoundingClientRect();
    const bounds = fieldset.getBoundingClientRect();
    const steps = Array.from(fieldset.querySelectorAll(".repo-create-step"), node => {
      const marker = node.getBoundingClientRect();
      const heading = node.parentElement!.getBoundingClientRect();
      return {
        number: node.textContent,
        center: marker.left + marker.width / 2,
        verticalOffset: marker.top + marker.height / 2 - (heading.top + heading.height / 2),
      };
    });
    return {
      steps,
      width: parseFloat(line.width),
      left: bounds.left + parseFloat(line.left),
      bottom: bounds.bottom - parseFloat(line.bottom),
      contentLeft: lastSection.left,
      contentBottom: lastSection.bottom,
    };
  });
  expect(rail.width).toBeGreaterThan(0);
  expect(rail.steps.map(step => step.number)).toEqual(["1", "2"]);
  for (const step of rail.steps) {
    expect(step.center).toBeCloseTo(rail.left + rail.width / 2, 0);
    expect(step.verticalOffset).toBeCloseTo(0, 0);
  }
  expect(rail.left + rail.width).toBeLessThan(rail.contentLeft);
  expect(rail.bottom).toBeCloseTo(rail.contentBottom, 0);
  await expect(page.getByRole("heading", { name: "Create a new repository" })).toHaveCSS("font-size", "20px");
  await expect(general.getByRole("heading", { name: "General", exact: true })).toHaveCSS("font-size", "16px");
  for (const control of [ownerTrigger, name]) {
    await expect(control).toHaveCSS("height", "32px");
    await expect(control).toHaveCSS("font-size", "14px");
  }
  await expect(general.locator(".repo-create-hint")).toHaveCSS("font-size", "12px");
  const submit = page.getByRole("button", { name: "Create repository", exact: true });
  await submit.click();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await name.fill("new-repository");
  await page.getByLabel("Description (optional)").fill("Created through the repository form");
  await page.getByRole("switch", { name: /Add a README/ }).press("Space");
  await page.getByRole("button", { name: "AgentForge Demo", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search owners" });
  await search.fill("Taylor");
  await expect(page.getByRole("option", { name: /Taylor Owner.*Personal account/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("repository-create-owner.png"), animations: "disabled" });
  await search.press("Enter");
  await expect(page.getByRole("button", { name: "Taylor Owner", exact: true })).toBeFocused();
  await expect(name).toHaveValue("new-repository");
  await expect(page.getByRole("switch", { name: /Add a README/ })).toBeChecked();
  const visibility = configuration.getByRole("button", { name: "Private", exact: true });
  await visibility.click();
  await expect(page.getByRole("option", { name: /Public.*unavailable/ })).toBeDisabled();
  const visibilityBounds = (await visibility.boundingBox())!;
  const optionsBounds = (await configuration.getByRole("listbox").boundingBox())!;
  expect(optionsBounds.x + optionsBounds.width).toBeCloseTo(visibilityBounds.x + visibilityBounds.width - 1, 0);
  await page.screenshot({ path: testInfo.outputPath("repository-create-visibility.png"), animations: "disabled" });
  await page.getByRole("listbox").press("Escape");
  await page.getByRole("button", { name: "No .gitignore", exact: true }).click();
  await page.getByRole("option", { name: "Node", exact: true }).click();
  await page.getByRole("button", { name: "No license", exact: true }).click();
  await page.getByRole("option", { name: "MIT", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("repository-create-desktop.png"), animations: "disabled", fullPage: true });

  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await visibility.click();
  const mobileOptions = (await configuration.getByRole("listbox").boundingBox())!;
  expect(mobileOptions.x).toBeGreaterThan(0);
  expect(mobileOptions.x + mobileOptions.width).toBeLessThan(320);
  await configuration.getByRole("listbox").press("Escape");
  await page.screenshot({ path: testInfo.outputPath("repository-create-mobile.png"), animations: "disabled", fullPage: true });
  const sent = page.waitForRequest(request => request.url().endsWith("/api/v1/organizations/org-personal/repositories") && request.method() === "POST");
  await submit.click();
  expect((await sent).postDataJSON()).toEqual({ slug: "taylor/new-repository", default_branch: "main", description: "Created through the repository form", initialize: { readme: true, gitignore: "node", license: "mit" } });
  await expect(page).toHaveURL("/orgs/taylor/repositories/taylor/new-repository");
});

test("registers existing repository visibility and fork metadata", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/new?mode=register");
  await page.getByLabel("Owner", { exact: true }).fill("team");
  await page.getByLabel("Repository name", { exact: true }).fill("new-repository");
  await page.getByRole("combobox", { name: "Visibility" }).click();
  await page.getByRole("option", { name: "Private repository" }).click();
  await page.getByRole("checkbox", { name: "Forked repository" }).check();
  const sent = page.waitForRequest(request => request.url().endsWith("/api/v1/organizations/org-demo/repositories") && request.method() === "POST");
  await page.getByRole("button", { name: "Register repository", exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({ slug: "team/new-repository", default_branch: "main", visibility: "private", fork: true });
  await expect(page).toHaveURL("/orgs/demo/repositories/team/new-repository");
});

test("a viewer cannot open the repository registration form", async ({ page }) => {
  await installApiMocks(page, { organizations: [{ id: "org-demo", slug: "demo", name: "AgentForge Demo", role: "viewer" }] });
  await page.goto("/orgs/demo/repositories");
  await expect(page.getByRole("heading", { name: "Repositories", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "New repository", exact: true })).toHaveCount(0);
  await page.goto("/orgs/demo/repositories/new");
  await expect(page.getByRole("alert").filter({ hasText: /owners and admins|owners and administrators/i })).toBeVisible();
  await expect(page.getByLabel("Repository name", { exact: true })).toHaveCount(0);
});

test("the flat repositories page is gone", async ({ page }) => {
  await page.goto("/repositories");

  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("repository code and commit details are independently navigable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/orgs/demo/repositories");
  await page.getByRole("link", { name: "easyhaloo/agentforge", exact: true }).click();
  await expect(page).toHaveURL(/\/orgs\/demo\/repositories\/easyhaloo\/agentforge$/);
  await expect(page.getByRole("link", { name: "README.md" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Register repository" })).toHaveCount(0);
  await page.getByRole("region", { name: "Files", exact: true }).getByRole("link", { name: "Commit history" }).click();
  await expect(page.getByRole("heading", { name: "Commit history" })).toBeVisible();
  await expect(page.getByRole("link", { name: "README.md", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Latest commit" }).click();
  await expect(page.getByRole("heading", { name: "Latest commit", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "README.md → README.md" })).toBeVisible();
  await expect(page.getByText("+after", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("commit-detail.png"), animations: "disabled" });
  await page.reload();
  await expect(page.getByText("+after", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to commits" }).click();
  await page.getByRole("link", { name: "Compare to current" }).click();
  await expect(page.getByRole("heading", { name: "Commit comparison" })).toBeVisible();
  await expect(page.getByText("+after", { exact: true })).toBeVisible();
});

test("a commit-pinned file permalink opens directly", async ({ page }) => {
  await page.goto("/orgs/demo/repositories?repository=easyhaloo%2Fagentforge&commit=" + "a".repeat(40) + "&path=README.md");
  await expect(page).toHaveURL(/\/repositories\/easyhaloo\/agentforge\?commit=/);
  await expect(page.getByRole("banner").locator(".topbar-repository").getByRole("link", { name: "agentforge", exact: true })).toBeVisible();
  await expect(page.getByText(/Pinned commit:/)).toContainText("aaaaaaaaaaaa");
  const copyPermalink = page.getByRole("button", { name: "Copy permalink" });
  await expect(copyPermalink).toBeEnabled();
  await expect(copyPermalink).toHaveText("");
  await expect(page.getByRole("heading", { name: "Hello" })).toBeVisible();
});

test("WebIDE guides an empty organization to its own repositories", async ({ page }) => {
  await page.route(/\/api\/v1\/organizations\/org-demo\/repositories(?:\?details=1)?$/, route => route.fulfill({ json: { items: [] } }));
  await page.goto("/orgs/demo/webide");
  await expect(page.getByText("No repositories registered yet.")).toBeVisible();
  await page.getByRole("link", { name: "Go to repositories" }).click();
  await expect(page).toHaveURL(/\/orgs\/demo\/repositories$/);
});

test("commit history groups and filters real API-shaped records and preserves the selected view", async ({ page, context }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge");
  const files = page.getByRole("region", { name: "Files", exact: true });
  await expect(files.getByRole("link", { name: "Latest commit" })).toBeVisible();
  await files.getByRole("link", { name: "Commit history" }).click();
  await expect(page.getByRole("heading", { name: /^Commits on / })).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath("commits.png"), animations: "disabled" });

  const author = page.getByRole("combobox", { name: "Filter by author" });
  await author.click();
  await page.getByRole("option", { name: "Initial Author" }).click();
  await expect(page.getByRole("link", { name: "Latest commit" })).toHaveCount(0);
  const date = page.getByRole("combobox", { name: "Filter by date" });
  await date.click();
  await page.getByRole("option", { name: "Nov 20, 2026" }).click();
  await expect(page.getByText("No commits found.")).toBeVisible();
  await date.click();
  await page.getByRole("option", { name: "Nov 17, 2026" }).click();

  await page.getByRole("link", { name: "Initial commit" }).click();
  await expect(page.getByText("+before", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to commits" }).click();
  await expect(author).toContainText("Initial Author");
  await expect(date).toContainText("Nov 17, 2026");
  await page.getByRole("button", { name: "Copy full SHA for bbbbbbb" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("b".repeat(40));
  const browseAtCommit = page.getByRole("link", { name: "Browse files at this commit" });
  await expect(browseAtCommit).toHaveAttribute("title", "Browse files at this commit");
  await browseAtCommit.click();
  await page.reload();
  await expect(page.getByText(/Pinned commit: bbbbbbbbbbbb/)).toBeVisible();
  await expect(files.getByRole("link", { name: "Initial commit" })).toBeVisible();
});
