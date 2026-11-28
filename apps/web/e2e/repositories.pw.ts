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

test("repository Projects opens the linked directory and creates in the same tab", async ({ page }) => {
  const repository = "easyhaloo/agentforge";
  const path = `/orgs/demo/repositories/${repository}`;
  await page.route(/\/api\/v1\/organizations\/org-demo\/issue-projects\?linked_repository=/, route => {
    expect(new URL(route.request().url()).searchParams.get("linked_repository")).toBe(repository);
    return route.fulfill({ json: { items: [{ id: "project-1", number: 1, name: "Release backlog", layout: "table", version: 1 }] } });
  });
  await page.goto(path);
  const tab = page.getByRole("navigation", { name: "Repository sections" }).getByRole("link", { name: "Projects", exact: true });
  await tab.click();
  await expect(page).toHaveURL(`${path}/projects`);
  await expect(tab).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Release backlog" })).toHaveAttribute("href", "/orgs/demo/projects/1");

  await page.getByRole("link", { name: "New project", exact: true }).click();
  await expect(page).toHaveURL(`/orgs/demo/projects/new?${new URLSearchParams({ repository, return: "repository" })}`);
  await expect(page.getByRole("heading", { name: "New project", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Repository sections" })).toHaveCount(0);
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(`${path}/projects`);
  await expect(tab).toHaveAttribute("aria-current", "page");
});

test("rejects number-only names and displays the workspace name for new repositories", async ({ page }, testInfo) => {
  const id = "1e123caae752c71a2bdcee9a4d658ce6";
  const catalog = `/orgs/${id}/repositories`;
  const create = `${catalog}/new`;
  const repo = `${catalog}/${id}/2fa-service`;
  await installApiMocks(page, { organizations: [
    { id, slug: "", name: "Delivery Workspace", role: "owner", personal: true },
  ] });
  await page.route(`**/api/v1/organizations/${id}/repositories/${id}/2fa-service/refs`, route => route.fulfill({
    json: { repository: `${id}/2fa-service`, default_branch: "main", items: [] },
  }));
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(create);
  const name = page.getByRole("textbox", { name: "Repository name" });
  const submit = page.getByRole("button", { name: "New repository", exact: true });
  await name.fill("12345678");
  await submit.click();
  await expect(page).toHaveURL(create);
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(/at least one letter/i)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("repository-name-validation.png"), animations: "disabled" });

  await name.fill("2fa-service");
  await submit.click();
  await expect(page).toHaveURL(repo);
  const banner = page.getByRole("banner");
  await expect(banner.locator(".topbar-repository__owner")).toHaveText("Delivery Workspace");
  await expect(banner.getByRole("link", { name: "2fa-service", exact: true })).toHaveAttribute("href", repo);
  await page.screenshot({ path: testInfo.outputPath("repository-readable-header.png"), animations: "disabled" });

  await page.goto(catalog);
  await page.getByRole("textbox", { name: "Find a repository…" }).fill("Delivery Workspace");
  await expect(page.getByRole("link", { name: "Delivery Workspace/2fa-service", exact: true })).toHaveAttribute("href", repo);
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
  await expect(adminAccess).toHaveCSS("background-color", "rgba(129, 139, 152, 0.12)");
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
  await expect(savedRow).toHaveCSS("background-color", "rgba(129, 139, 152, 0.12)");
  await removeView.hover();
  await expect(savedRow).toHaveCSS("background-color", "rgba(129, 139, 152, 0.12)");
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
  await expect(page.getByRole("heading", { name: "New repository" })).toBeVisible();
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(catalog);

  await page.goto(`${catalog}?register=1`);
  await expect(page).toHaveURL(`${newPage}?mode=register`);
  await expect(page.getByRole("heading", { name: "Register repository" })).toBeVisible();
  await expect(page.getByLabel("Default branch", { exact: true })).toHaveValue("main");
  await page.getByRole("link", { name: "New repository" }).click();
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
  await expect(page.getByRole("heading", { name: "New repository" })).toHaveCSS("font-size", "20px");
  await expect(general.getByRole("heading", { name: "General", exact: true })).toHaveCSS("font-size", "16px");
  for (const control of [ownerTrigger, name]) {
    await expect(control).toHaveCSS("height", "32px");
    await expect(control).toHaveCSS("font-size", "14px");
  }
  await expect(general.locator(".repo-create-hint")).toHaveCSS("font-size", "12px");
  const submit = page.getByRole("button", { name: "New repository", exact: true });
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

  await expect(page.getByRole("main", { name: "Page not found" })).toContainText("Nothing is served at /repositories.");
});

test("repository code and commit details are independently navigable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/orgs/demo/repositories");
  await page.getByRole("link", { name: "easyhaloo/agentforge", exact: true }).click();
  await expect(page).toHaveURL(/\/orgs\/demo\/repositories\/easyhaloo\/agentforge$/);
  await expect(page.getByRole("link", { name: "README.md" })).toBeVisible();
  await expect(page.getByRole("main").getByText("easyhaloo/agentforge", { exact: true })).toHaveCount(0);
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
  await expect(page.getByRole("link", { name: /Back to commits/ })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("navigation", { name: "Repository sections" }).getByRole("link", { name: "Code", exact: true }).click();
  await page.getByRole("region", { name: "Files", exact: true }).getByRole("link", { name: "Commit history" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
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
  await expect(page.getByRole("link", { name: "Back to ref" })).toHaveCount(0);
  await page.getByRole("button", { name: "main", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Switch branch or tag" });
  await picker.getByRole("button", { name: "main Default", exact: true }).click();
  await expect(page).toHaveURL(/ref=refs%2Fheads%2Fmain&path=README\.md$/);
  await expect(page.getByText(/Pinned commit:/)).toHaveCount(0);
});

test("file preview shows a responsive tree for the pinned commit", async ({ page }, testInfo) => {
  const repository = "easyhaloo/agentforge";
  const commit = "a".repeat(40);
  await page.route(`**/repositories/${repository}/watch`, route => route.fulfill({ json: { watching: false } }));
  const entry = (path: string, kind: "tree" | "file") => ({
    path, name: path.split("/").at(-1), kind, mode: kind === "tree" ? "040000" : "100644", sha: commit,
  });
  await page.route(/\/repositories\/easyhaloo\/agentforge\/tree\?/, route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get("ref")).toBe(commit);
    const path = params.get("path") ?? "";
    const items = path === "src" ? [entry("src/index.html", "file")]
      : [entry("src", "tree"), entry("README.md", "file")];
    return route.fulfill({ json: { repository, commit_sha: params.get("ref"), path, items } });
  });
  await page.route(/\/repositories\/easyhaloo\/agentforge\/blob\?/, route => {
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: { repository, commit_sha: params.get("ref"), blob_sha: commit,
      path: params.get("path"), encoding: "utf-8", content: params.get("path") === "README.md" ? "# Hello\n" : "<!doctype html>\n<html lang=\"en\">\n  <title>AgentForge</title>\n</html>\n" } });
  });
  await page.route(/\/repositories\/easyhaloo\/agentforge\/(file-history|blame)\?/, route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get("ref")).toBe(commit);
    expect(params.get("path")).toBe("src/index.html");
    return route.fulfill({ json: { items: [] } });
  });

  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/orgs/demo/repositories/${repository}?commit=${commit}&path=src%2Findex.html`);
  const tree = page.getByRole("navigation", { name: "Repository file tree" });
  const folder = tree.getByRole("button", { name: "src" });
  const file = tree.getByRole("link", { name: "index.html" });
  const rootFile = tree.getByRole("link", { name: "README.md" });
  await expect(folder).toHaveAttribute("aria-expanded", "true");
  await expect(file).toHaveAttribute("aria-current", "true");
  await expect(tree.locator("../..")).toHaveCSS("width", "320px");
  await expect(file).toHaveCSS("width", "288px");
  await expect(file).toHaveCSS("height", "32px");
  await expect(folder).toHaveCSS("height", "32px");
  await expect(file).toHaveCSS("font-size", "14px");
  await expect(file).toHaveCSS("font-weight", "400");
  await expect(file.locator("svg")).toHaveCSS("width", "16px");
  await expect(file).toHaveCSS("background-color", "rgba(129, 139, 152, 0.15)");
  await expect(file.locator("svg")).toHaveCSS("color", "rgb(89, 99, 110)");
  await expect(folder.locator("svg").first()).toHaveCSS("width", "12px");
  const folderIcon = folder.locator(".file-tree-folder-icon");
  await expect(folderIcon).toHaveCSS("fill", "rgb(84, 174, 255)");
  const openFolderPath = await folderIcon.locator("path").getAttribute("d");
  expect((await file.boundingBox())!.x).toBe((await rootFile.boundingBox())!.x);
  expect((await file.locator("svg").boundingBox())!.x - (await rootFile.locator("svg").boundingBox())!.x).toBe(8);
  await folder.hover();
  await expect(folder).toHaveCSS("background-color", "rgba(129, 139, 152, 0.12)");
  const preview = page.getByRole("region", { name: "src/index.html" });
  const source = preview.locator(".repository-source");
  const pathBar = page.getByRole("navigation", { name: "Repository path" }).locator("..");
  const webIDE = pathBar.getByRole("link", { name: "Open in WebIDE" });
  await expect(webIDE).toHaveAttribute("href", new RegExp(`commit=${commit}&path=src%2Findex\\.html$`));
  const copyPermalink = pathBar.getByRole("button", { name: "Copy permalink" });
  const moreActions = pathBar.getByRole("button", { name: "Additional options" });
  await expect(copyPermalink).toHaveCSS("width", "32px");
  for (const button of [copyPermalink, moreActions]) {
    const icon = button.locator("svg");
    await expect(icon).toHaveCSS("width", "16px");
    await expect(icon).toHaveCSS("height", "16px");
  }
  await expect(source).toHaveAttribute("data-highlight-engine", "shiki");
  const token = source.locator(".repository-code__shiki-token").first();
  const lightTokenColor = await token.evaluate(element => getComputedStyle(element).color);
  const railBounds = (await tree.locator("../..").boundingBox())!;
  const sectionNavBounds = (await page.getByRole("navigation", { name: "Repository sections" }).boundingBox())!;
  const pathBounds = (await pathBar.boundingBox())!;
  const titleBounds = (await page.getByRole("heading", { name: "Files", exact: true }).boundingBox())!;
  const sourceBounds = (await source.boundingBox())!;
  expect(railBounds.x).toBe(0);
  expect(railBounds.y).toBe(sectionNavBounds.y + sectionNavBounds.height);
  expect(pathBounds.x - railBounds.width).toBe(16);
  expect(1440 - (pathBounds.x + pathBounds.width)).toBe(16);
  expect(pathBounds.y).toBe(titleBounds.y);
  expect(pathBounds.height).toBe(32);
  expect(sourceBounds.x).toBe(pathBounds.x);
  expect(sourceBounds.y - pathBounds.y).toBeLessThanOrEqual(110);
  await page.screenshot({ path: testInfo.outputPath("file-tree-desktop.png"), animations: "disabled" });
  await folder.focus();
  await page.keyboard.press("Enter");
  await expect(file).toBeHidden();
  await expect(folder).toHaveCSS("outline-style", "solid");
  await expect(folderIcon.locator("path")).not.toHaveAttribute("d", openFolderPath!);
  await page.keyboard.press("Enter");
  await expect(file).toBeVisible();

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(token).not.toHaveCSS("color", lightTokenColor);
  await expect(folderIcon).toHaveCSS("fill", "rgb(145, 152, 161)");
  await expect(file).toHaveCSS("background-color", "rgba(101, 108, 118, 0.2)");
  await page.setViewportSize({ width: 320, height: 844 });
  const toggle = page.getByRole("button", { name: "Files", exact: true });
  await expect(tree).toBeHidden();
  await expect(toggle).toHaveCSS("height", "32px");
  await expect(pathBar.getByRole("link", { name: "Open in WebIDE" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: testInfo.outputPath("file-preview-narrow.png"), animations: "disabled" });
  for (const button of [copyPermalink, moreActions]) {
    const icon = button.locator("svg");
    await expect(icon).toHaveCSS("width", "16px");
    await expect(icon).toHaveCSS("height", "16px");
  }
  await moreActions.click();
  const options = page.getByRole("dialog", { name: "Additional options" });
  await expect(options.getByRole("button", { name: "Watch Issues" })).toBeFocused();
  await expect(options.getByRole("button", { name: "Clone" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();
  await expect(moreActions).toBeFocused();
  await toggle.click();
  await expect(file).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: testInfo.outputPath("file-tree-narrow.png"), animations: "disabled" });
  await preview.getByRole("button", { name: "File history" }).click();
  await expect(preview.getByRole("region", { name: "File history" })).toBeVisible();
  await preview.getByRole("button", { name: "Blame" }).click();
  await expect(preview.getByRole("region", { name: "File blame" })).toBeVisible();
  await rootFile.click();
  await expect(page).toHaveURL(new RegExp(`commit=${commit}&path=README\\.md$`));
  await expect(rootFile).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("heading", { name: "Hello" })).toBeVisible();
});

test("the file reference picker searches branches and tags while retaining the file path", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge?path=README.md");

  const trigger = page.getByRole("button", { name: "main", exact: true });
  const picker = page.getByRole("dialog", { name: "Switch branch or tag" });
  const search = picker.getByRole("searchbox", { name: "Search branches and tags" });
  await trigger.press("Enter");
  await expect(search).toBeFocused();
  await expect(picker.getByRole("button", { name: "main Default" })).toHaveAttribute("aria-current", "true");
  await page.screenshot({ path: testInfo.outputPath("reference-picker-desktop.png"), animations: "disabled" });
  await search.fill("missing");
  await expect(picker.getByRole("status")).toHaveText("No matching branches or tags.");
  await search.press("Escape");
  await expect(picker).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect(search).toHaveValue("");
  await search.fill("RELE");
  await expect(picker.getByRole("button", { name: "main Default" })).toBeHidden();
  await picker.getByRole("button", { name: "release", exact: true }).click();
  await expect(page).toHaveURL(/ref=refs%2Fheads%2Frelease&path=README\.md$/);
  await expect(page.getByRole("heading", { name: "Hello" })).toBeVisible();

  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await page.getByRole("button", { name: "release", exact: true }).click();
  const branches = picker.getByRole("tab", { name: "Branches" });
  const tags = picker.getByRole("tab", { name: "Tags" });
  await branches.press("ArrowRight");
  await expect(tags).toBeFocused();
  await expect(tags).toHaveAttribute("aria-selected", "true");
  await search.fill("0.1");
  await expect(picker.getByRole("button", { name: "v0.1.0", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: testInfo.outputPath("reference-picker-narrow.png"), animations: "disabled" });
  await picker.getByRole("button", { name: "v0.1.0", exact: true }).click();
  await expect(page).toHaveURL(/ref=refs%2Ftags%2Fv0\.1\.0&path=README\.md$/);
  const files = page.getByRole("button", { name: "Files", exact: true });
  await expect(files).toHaveAttribute("aria-expanded", "false");
  await files.click();
  await expect(page.getByRole("button", { name: "v0.1.0", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hello" })).toBeVisible();
});

test("repository home Go to file filters the file list with a T shortcut", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge");
  const files = page.getByRole("region", { name: "Files", exact: true });
  const readme = files.getByRole("link", { name: "README.md", exact: true });
  const controls = page.locator(".repo-file-controls");
  const searchBox = controls.locator(".af-search");
  const search = controls.getByRole("textbox", { name: "Go to file" });
  const sort = controls.getByRole("combobox", { name: "Sort files" });
  await expect(readme).toBeVisible();
  await expect(searchBox).toHaveCSS("height", "32px");
  await expect(sort).toHaveCSS("height", "32px");
  expect((await searchBox.boundingBox())?.y).toBe((await sort.boundingBox())?.y);
  await expect(search).toHaveCSS("font-size", "14px");
  await expect(controls.getByText("T", { exact: true })).toBeVisible();
  await page.keyboard.press("t");
  await expect(search).toBeFocused();
  await search.fill("missing");
  await expect(readme).toHaveCount(0);
  await controls.getByRole("button", { name: "Clear search" }).click();
  await expect(readme).toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 });
  expect((await searchBox.boundingBox())?.y).toBe((await sort.boundingBox())?.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test("file toolbar aligns its controls and Go to file filters the tree on desktop and mobile", async ({ page }) => {
  const repository = "easyhaloo/agentforge";
  const commit = "a".repeat(40);
  const path = `/orgs/demo/repositories/${repository}`;
  await page.route(`**/repositories/${repository}/tree?*`, route => {
    const folder = new URL(route.request().url()).searchParams.get("path") ?? "";
    const items = folder === "docs"
      ? ["README.md", "guide.md"].map(name => ({ name, path: `docs/${name}`, kind: "file", sha: commit }))
      : [{ name: "docs", path: "docs", kind: "tree", sha: commit }];
    return route.fulfill({ json: { repository, commit_sha: commit, path: folder, items } });
  });
  await page.route(`**/repositories/${repository}/blob?*`, route => route.fulfill({ json: {
    repository, commit_sha: commit, blob_sha: commit, encoding: "utf-8",
    path: new URL(route.request().url()).searchParams.get("path"), content: "# Folder guide\n",
  } }));
  const fileURL = `${path}?commit=${commit}&path=docs%2FREADME.md`;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fileURL);

  const branch = page.getByRole("button", { name: "main", exact: true });
  const create = page.getByRole("button", { name: "Create", exact: true });
  const searchTrigger = page.getByRole("button", { name: "Go to file", exact: true });
  const searchBox = page.locator(".repo-file-nav-toolbar + .repo-file-nav-search");
  const search = searchBox.getByRole("textbox", { name: "Go to file" });
  const shortcut = searchBox.getByText("T", { exact: true });
  const tree = page.getByRole("navigation", { name: "Repository file tree" });
  await expect(search).toBeVisible();
  await expect(search).toHaveCSS("font-size", "14px");
  await expect(searchBox.locator(".af-search")).toHaveCSS("height", "32px");
  await expect(shortcut).toBeVisible();
  await expect(branch).toHaveCSS("font-size", "14px");
  await expect(branch).toHaveCSS("height", "32px");
  for (const action of [create, searchTrigger]) {
    await expect(action).toHaveCSS("height", "32px");
    await expect(action).toHaveCSS("width", "32px");
    await expect(action.locator("svg")).toHaveCSS("width", "16px");
    expect((await action.boundingBox())?.y).toBe((await branch.boundingBox())?.y);
  }
  await create.press("Enter");
  const workspace = page.getByRole("link", { name: "New workspace" });
  await expect(workspace).toBeFocused();
  await expect(workspace).toHaveAttribute("href", `/orgs/demo/webide/${repository}`);
  await workspace.press("Escape");
  await expect(create).toBeFocused();
  await create.click();
  await workspace.click();
  await expect(page.getByRole("heading", { name: "Workspace WebIDE" })).toBeVisible();

  await page.goto(fileURL);
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(search).toBeHidden();
  await page.keyboard.press("t");
  await expect(search).toBeFocused();
  await expect(page.getByRole("button", { name: "Files", exact: true })).toHaveAttribute("aria-expanded", "true");
  await searchTrigger.press("Enter");
  await expect(search).toBeFocused();
  await expect(shortcut).toBeVisible();
  await expect(tree.getByRole("link")).toHaveCount(2);
  await search.fill("missing");
  await expect(tree.getByRole("status")).toHaveText("No files match “missing”.");
  await expect(shortcut).toBeHidden();
  await searchBox.getByRole("button", { name: "Clear search" }).click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(shortcut).toBeVisible();
  await expect(tree.getByRole("link")).toHaveCount(2);
  await search.fill("GUI");
  await expect(tree.getByRole("link")).toHaveCount(1);
  const box = await searchBox.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 320).toBe(true);
  const guide = tree.getByRole("link", { name: "guide.md" });
  await guide.click();
  await expect(page).toHaveURL(`${path}?commit=${commit}&path=docs%2Fguide.md`);
  await expect(guide).toHaveAttribute("aria-current", "true");
  await expect(search).toBeVisible();
  await expect(page.getByRole("heading", { name: "Folder guide" })).toBeVisible();
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
  await expect(page.getByRole("link", { name: "Back to commits" })).toHaveCount(0);
  await page.goBack();
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
