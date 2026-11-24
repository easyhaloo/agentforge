import { expect, test, type Page } from "@playwright/test";
import { demoOrganization, installApiMocks, labsOrganization } from "./support/api-mocks";
import { navigation, navigationToggle, openNavigation } from "./support/navigation";

const topbarTitle = (page: Page) => page.getByRole("banner").locator(".workspace-brand__page");
const pageHeading = (page: Page) => page.getByRole("main").locator(".page-heading h1");
const sidebarLink = (page: Page, name: string) => navigation(page).getByRole("link", { name, exact: true });
// The Changesets item carries a count badge inside the link, so match it by prefix.
const changesetsLink = (page: Page) => navigation(page).getByRole("link", { name: /^Changesets/ });
const pathOf = (page: Page) => { const { pathname, search, hash } = new URL(page.url()); return pathname + search + hash; };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

test("the workspace Topbar spaces the menu, brand and title on desktop and mobile", async ({ page }, testInfo) => {
  await installApiMocks(page);
  await page.goto("/projects");
  const header = page.getByRole("banner");
  const brand = header.getByRole("link", { name: "agentforge", exact: true });
  const title = topbarTitle(page);
  await expect(title).toHaveText("Projects");
  await expect(header.getByRole("link", { name: "All repositories" })).toBeVisible();

  for (const [width, menuGap, titleGap] of [[1280, 12, 16], [320, 4, 8]]) {
    await page.setViewportSize({ width, height: 800 });
    const menuBox = (await navigationToggle(page).boundingBox())!;
    const brandBox = (await brand.boundingBox())!;
    const titleBox = (await title.boundingBox())!;
    expect(menuBox).toMatchObject({ x: 12, width: 32, height: 32 });
    expect(brandBox).toMatchObject({ y: menuBox.y, width: 32, height: 32 });
    expect(brandBox.x - (menuBox.x + menuBox.width)).toBe(menuGap);
    expect(titleBox.x - (brandBox.x + brandBox.width)).toBe(titleGap);
    expect(titleBox.y + titleBox.height / 2).toBeCloseTo(menuBox.y + menuBox.height / 2);
    expect(await title.evaluate(element => element.scrollWidth)).toBe(Math.round(titleBox.width));
    expect(await header.evaluate(element => element.scrollWidth)).toBe(width);
    await header.screenshot({ path: testInfo.outputPath(`workspace-topbar-${width}.png`), scale: "css" });
  }
});

test("a deep link renders its page, survives a reload and follows Back and Forward", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/projects");
  await expect(topbarTitle(page)).toHaveText("Projects");
  await openNavigation(page);
  await expect(sidebarLink(page, "Projects")).toHaveAttribute("aria-current", "page");
  await expect(navigation(page).locator("[aria-current='page']")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "New project", exact: true })).toBeVisible();

  await page.reload();
  await expect(topbarTitle(page)).toHaveText("Projects");
  await openNavigation(page);
  await expect(sidebarLink(page, "Projects")).toHaveAttribute("aria-current", "page");

  await openNavigation(page);
  await sidebarLink(page, "Repositories").click();
  await expect(page).toHaveURL(/\/orgs\/demo\/repositories$/);
  await expect(pageHeading(page)).toHaveText("Repositories");
  await expect(page.getByRole("link", { name: "easyhaloo/agentforge", exact: true })).toBeVisible();
  await openNavigation(page);
  await sidebarLink(page, "Memory").click();
  await expect(page).toHaveURL(/\/memory$/);
  await expect(pageHeading(page)).toHaveText("Memory");

  await page.goBack();
  await expect(page).toHaveURL(/\/orgs\/demo\/repositories$/);
  await expect(pageHeading(page)).toHaveText("Repositories");
  await openNavigation(page);
  await expect(sidebarLink(page, "Repositories")).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(topbarTitle(page)).toHaveText("Projects");
  await page.goForward();
  await expect(page).toHaveURL(/\/orgs\/demo\/repositories$/);
  await expect(pageHeading(page)).toHaveText("Repositories");
});

const flatPages = [
  ["/", "Overview"],
  ["/projects", "Projects"],
  ["/workspaces", "Workspaces"],
  ["/self-healing", "Self-healing"],
  ["/memory", "Memory"],
  ["/security", "Security"],
  ["/governance", "Governance"],
  ["/usage", "Cost & Usage"],
  // /settings is excluded - it redirects to /settings/profile
  ["/dev/ui", "UI Components"],
] as const;

for (const [path, label] of flatPages) {
  test(`the flat page ${path} renders ${label} when opened directly`, async ({ page }) => {
    await installApiMocks(page);
    await page.goto(path);
    if (label === "Projects") {
      await expect(topbarTitle(page)).toHaveText(label);
      await expect(page.getByRole("main").locator(".page-heading")).toHaveCount(0);
      await expect(page.getByRole("searchbox", { name: "Search project name or number" })).toBeVisible();
    } else {
      await expect(pageHeading(page)).toHaveText(label);
    }
    await openNavigation(page);
    await expect(sidebarLink(page, label)).toHaveAttribute("aria-current", "page");
  });
}

for (const [kind, handle] of [["slug", "demo"], ["id", "org-demo"]] as const) {
  test(`/orgs/<${kind}>/changesets renders the organization's changesets`, async ({ page }) => {
    await installApiMocks(page);
    const listed = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/v1/organizations/org-demo/changesets" && request.method() === "GET");
    await page.goto(`/orgs/${handle}/changesets`);
    await listed;
    await expect(pageHeading(page)).toHaveText("Changesets");
    await expect(page.getByText("Browser test baseline")).toBeVisible();
    await openNavigation(page);
    await expect(changesetsLink(page)).toHaveAttribute("aria-current", "page");
    expect(pathOf(page)).toBe(`/orgs/${handle}/changesets`);
  });
}

test("/orgs/current is replaced by the canonical organization URL, keeping query and hash", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/orgs/current/changesets?filter=open#top");
  await expect(page.getByText("Browser test baseline")).toBeVisible();
  expect(pathOf(page)).toBe("/orgs/demo/changesets?filter=open#top");
});

test("a mixed-case /ORGS URL is served like /orgs and the current alias is still replaced", async ({ page }) => {
  await installApiMocks(page);
  await page.clock.install();
  await page.goto("/ORGS/current/changesets");
  await expect(page.getByText("Browser test baseline")).toBeVisible();
  await page.clock.fastForward(500); // Mounting the search field must not submit an empty filter.
  expect(pathOf(page)).toBe("/orgs/demo/changesets");
  await openNavigation(page);
  await expect(changesetsLink(page)).toHaveAttribute("aria-current", "page");
});

test("the current alias is replaced, not pushed, so Back never bounces through it", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await page.goto("/orgs/current/changesets");
  await expect(page).toHaveURL(/\/orgs\/demo\/changesets$/);
  await expect(pageHeading(page)).toHaveText("Changesets");

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(pageHeading(page)).toHaveText("Overview");

});

test("an unknown organization handle shows No active organization and names the handle", async ({ page }) => {
  await installApiMocks(page);
  for (const section of ["changesets", "settings"]) {
    await page.goto(`/orgs/nope/${section}`);
    await expect(page.getByRole("heading", { name: "No active organization" })).toBeVisible();
    await expect(page.getByText('No organization "nope" is available to this account.')).toBeVisible();
    await openNavigation(page);
    await expect(sidebarLink(page, "Overview")).toBeVisible();
  }
});

test("an organization whose own slug is the reserved current alias is addressed by its id", async ({ page }) => {
  const reserved = { id: "org-reserved", slug: "current", name: "Reserved Org", role: "owner" };
  await installApiMocks(page, { organizations: [reserved] });
  await page.goto("/orgs/current/changesets");
  await expect(page.getByText("scoped to Reserved Org")).toBeVisible();
  expect(pathOf(page)).toBe("/orgs/org-reserved/changesets");
});

test("signed out, protected URLs redirect to login", async ({ page }) => {
  await installApiMocks(page, { signedOut: true });
  for (const target of [
    "/?tab=activity#reviews",
    "/orgs/x/projects/new",
    "/orgs/x/changesets?status=in_review#changes",
    "/settings/profile?source=menu#avatar",
    "/orgs/x/pipelines/example/edit?tab=variables#build",
    "/orgs/x/pipeline-runs/example?step=build#logs",
  ]) {
    await page.goto(target);
    await expect(page).toHaveURL(`/login?${new URLSearchParams({ return: target })}`);
    await expect(page.getByRole("heading", { name: "Sign in to AgentForge" })).toBeVisible();
  }

  await page.goto("/projects");
  await expect(page).toHaveURL(`/login?${new URLSearchParams({ return: "/orgs/current/projects" })}`);
});

test("a session service failure stays on the requested page", async ({ page }) => {
  await installApiMocks(page);
  await page.route("**/api/v1/me", route => route.fulfill({ status: 503 }));
  for (const [target, message] of [
    ["/", "Unable to load account context"],
    ["/orgs/x/changesets", "Changeset service unavailable"],
    ["/settings/profile", "Unable to verify authentication"],
  ]) {
    await page.goto(target);
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(page).toHaveURL(target);
  }
});

test("the SSO entry is a full-page navigation to the backend, never a client route", async ({ page }) => {
  await installApiMocks(page, { signedOut: true });
  await page.route("**/auth/providers", (route) => route.fulfill({ json: { providers: [{ id: "oidc", login_url: "/auth/oidc/login" }] } }));
  await page.route("**/auth/oidc/login", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Identity provider</h1>" }));
  await page.goto("/orgs/x/changesets");
  await page.getByRole("link", { name: "SSO", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Identity provider" })).toBeVisible();
  expect(pathOf(page)).toBe("/auth/oidc/login");
});

test("a mixed-case organization URL selects its organization in personal settings", async ({ page }) => {
  await installApiMocks(page, { organizations: [demoOrganization, labsOrganization] });
  await page.goto("/Orgs/labs/settings");
  await expect(page.getByRole("heading", { name: "AgentForge Labs" })).toBeVisible();
  await page.getByRole("button", { name: /^User menu,/ }).click();
  await page.getByRole("dialog", { name: "User menu" }).getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Current organization" })).toContainText("AgentForge Labs");
});

test("signing out opens the login page", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/orgs/demo/settings");
  await expect(page.getByRole("heading", { name: "AgentForge Demo" })).toBeVisible();
  await page.locator(".user-menu-trigger").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { name: "Sign in to AgentForge" })).toBeVisible();
});

test("workspace pages load without a manual refresh action", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/workspaces");
  await expect(topbarTitle(page)).toHaveText("Workspaces");
  const refresh = page.getByRole("button", { name: "Refresh", exact: true });
  await expect(refresh).toHaveCount(0);

  await openNavigation(page);
  await changesetsLink(page).click();
  await expect(page.getByText("Browser test baseline")).toBeVisible();
  await expect(refresh).toHaveCount(0);
});

test("an unknown path renders the not-found state inside the shell and highlights no sidebar item", async ({ page }) => {
  await installApiMocks(page);
  // The last three sit below a real page: a prefix match would keep that page's sidebar item highlighted.
  for (const path of ["/nope", "/orgs/demo/nope", "/orgs/demo", "/projects/extra", "/dev/ui/x", "/orgs/demo/changesets/x/extra"]) {
    await page.goto(path);
    await expect(pageHeading(page)).toHaveText("Page not found");
    await expect(page.getByText(`Nothing is served at ${path}.`)).toBeVisible();
    await openNavigation(page);
    await expect(sidebarLink(page, "Overview")).toBeVisible();
    await expect(navigation(page).locator("[aria-current='page']")).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await page.getByRole("link", { name: "Go to Overview" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(pageHeading(page)).toHaveText("Overview");
});

test("a trailing slash is canonicalized, so the page and its highlighted sidebar item agree", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/projects/?q=1#top");
  await expect(topbarTitle(page)).toHaveText("Projects");
  await openNavigation(page);
  await expect(sidebarLink(page, "Projects")).toHaveAttribute("aria-current", "page");
  expect(pathOf(page)).toBe("/orgs/demo/projects?q=1#top");
});

test("Ctrl+K opens the command palette and selecting a page navigates by URL", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "Search or jump to" });
  const search = dialog.getByRole("combobox", { name: "Search or jump to" });

  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await search.fill("Projects");
  await dialog.getByRole("option", { name: "Projects", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(topbarTitle(page)).toHaveText("Projects");

  await page.keyboard.press("Control+k");
  await search.fill("Changesets");
  await dialog.getByRole("option", { name: "Changesets", exact: true }).click();
  await expect(page).toHaveURL(/\/orgs\/demo\/changesets$/);
  await expect(page.getByText("Browser test baseline")).toBeVisible();

  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("selecting the page you are already on in the palette does not add a history entry", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await openNavigation(page);
  await sidebarLink(page, "Projects").click();
  await expect(topbarTitle(page)).toHaveText("Projects");
  const dialog = page.getByRole("dialog", { name: "Search or jump to" });

  await page.keyboard.press("Control+k");
  await dialog.getByRole("combobox", { name: "Search or jump to" }).fill("Projects");
  await dialog.getByRole("option", { name: "Projects", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(pageHeading(page)).toHaveText("Overview");
});

test("signing out while already on / does not add a history entry", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  const entries = () => page.evaluate(() => history.length);
  const before = await entries();

  await page.locator(".user-menu-trigger").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
  expect(await entries()).toBe(before);
});

test("the Topbar switches repositories within the current section", async ({ page }) => {
  await installApiMocks(page);
  await page.route("**/api/v1/organizations/org-demo/repositories", route => route.fulfill({ json: {
    items: [
      { slug: "easyhaloo/agentforge", visibility: "public" },
      { slug: "easyhaloo/a-long-repository-for-topbar-testing", visibility: "private" },
      { slug: "team/fork", visibility: "public", fork: true },
    ],
  } }));
  await page.route("**/api/v1/organizations/org-demo/repositories/*/*/actions?*", route => route.fulfill({ json: { items: [] } }));
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/actions");

  const header = page.getByRole("banner");
  const toggle = header.getByRole("button", { name: "Switch repository" });
  const menu = header.getByRole("dialog", { name: "Switch repository" });
  await expect(header.getByRole("link", { name: "agentforge", exact: true }).filter({ hasText: "agentforge" })).toBeVisible();
  await expect(header.getByRole("link", { name: "agentforge", exact: true }).filter({ has: page.locator("svg") })).toHaveAttribute("href", "/");
  await toggle.click();
  const search = menu.getByRole("textbox", { name: "Search repositories" });
  await expect(search).toBeFocused();
  const selected = menu.locator('[aria-current="true"]');
  await expect(selected).toContainText("agentforge");
  const icons = await Promise.all(["Public", "Private", "Forked"].map(type =>
    menu.getByRole("img", { name: `${type} repository` }).locator("path").first().getAttribute("d")));
  expect(new Set(icons).size).toBe(3);
  await expect(selected.getByRole("img", { name: "Public repository" })).toBeVisible();
  await search.fill("missing-repo");
  await expect(menu.getByRole("status")).toHaveText("No matching repositories");
  await search.press("Escape");
  await expect(toggle).toBeFocused();

  await page.setViewportSize({ width: 375, height: 812 });
  await toggle.click();
  await search.fill("LONG-REPOSITORY");
  await menu.getByRole("link", { name: "a-long-repository-for-topbar-testing" }).click();
  await expect(page).toHaveURL(/\/easyhaloo\/a-long-repository-for-topbar-testing\/actions$/);
  await expect(menu).toBeHidden();
  const repo = header.getByRole("link", { name: "a-long-repository-for-topbar-testing" });
  await expect(repo).toHaveAttribute("href", "/orgs/demo/repositories/easyhaloo/a-long-repository-for-topbar-testing");
  expect(await header.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(375);
});

test("the Topbar shortcuts open organization-wide lists and preserve issue repository links", async ({ page }, testInfo) => {
  await installApiMocks(page);
  await page.route("**/api/v1/organizations/org-demo/repositories/*/*/actions?*", route => route.fulfill({ json: { items: [] } }));
  await page.setViewportSize({ width: 320, height: 750 });
  await page.goto("/orgs/demo/repositories/easyhaloo/agentforge/actions");
  const created = await page.evaluate(async () => {
    const response = await fetch("/api/v1/organizations/org-demo/issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repository: "team/other-repo", title: "Cross-repository issue", body: "From another repository" }),
    });
    return response.status;
  });
  expect(created).toBe(201);
  const header = page.getByRole("banner");
  const shortcuts = header.locator(".topbar-shortcuts").getByRole("link");
  const names = ["All issues", "All pull requests", "All repositories"];
  for (const [index, name] of names.entries()) {
    await expect(shortcuts.nth(index)).toHaveAccessibleName(name);
    await expect(shortcuts.nth(index)).toBeInViewport({ ratio: 1 });
  }
  await expect(header.getByRole("button", { name: "Switch repository" })).toBeInViewport({ ratio: 1 });
  const repoName = header.getByRole("link", { name: "agentforge", exact: true }).filter({ hasText: "agentforge" });
  expect(await repoName.evaluate(element => element.clientWidth)).toBeGreaterThanOrEqual(await repoName.evaluate(element => element.scrollWidth));
  expect(await header.evaluate(element => element.scrollWidth)).toBe(320);
  await page.screenshot({ path: testInfo.outputPath("topbar-mobile.png"), animations: "disabled" });

  await header.getByRole("link", { name: names[0] }).click();
  await expect(page).toHaveURL("/orgs/demo/issues");
  await expect(page.getByRole("link", { name: "Add user authentication" })).toBeVisible();
  const issue = page.getByRole("link", { name: "Cross-repository issue" });
  await expect(issue).toHaveAttribute("href", "/orgs/demo/repositories/team/other-repo/issues/1");
  await issue.click();
  await expect(page).toHaveURL("/orgs/demo/repositories/team/other-repo/issues/1");
  await header.getByRole("link", { name: names[1] }).click();
  await expect(page).toHaveURL("/orgs/demo/changesets");
  await header.getByRole("link", { name: names[2] }).click();
  await expect(page).toHaveURL("/orgs/demo/repositories");
});
