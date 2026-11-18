import { expect, test, type Page } from "@playwright/test";
import { demoOrganization, installApiMocks, labsOrganization } from "./support/api-mocks";

const pageHeading = (page: Page) => page.getByRole("main").locator(".page-heading h1");
const sidebarLink = (page: Page, name: string) => page.locator(".sidebar").getByRole("link", { name, exact: true });
// The Changesets item carries a count badge inside the link, so match it by prefix.
const changesetsLink = (page: Page) => page.locator(".sidebar").getByRole("link", { name: /^Changesets/ });
const selectedOrganizationName = (page: Page) => page.locator(".sidebar .org-switch__select b");
const pathOf = (page: Page) => { const { pathname, search, hash } = new URL(page.url()); return pathname + search + hash; };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

test("a deep link renders its page, survives a reload and follows Back and Forward", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/projects");
  await expect(pageHeading(page)).toHaveText("Projects");
  await expect(sidebarLink(page, "Projects")).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".sidebar [aria-current='page']")).toHaveCount(1);
  await expect(page.getByRole("table").getByText("Core Platform", { exact: true })).toBeVisible();

  await page.reload();
  await expect(pageHeading(page)).toHaveText("Projects");
  await expect(sidebarLink(page, "Projects")).toHaveAttribute("aria-current", "page");

  await sidebarLink(page, "Repositories").click();
  await expect(page).toHaveURL(/\/orgs\/demo\/repositories$/);
  await expect(pageHeading(page)).toHaveText("Repositories");
  await expect(page.getByRole("cell").getByText("easyhaloo/agentforge")).toBeVisible();
  await sidebarLink(page, "Memory").click();
  await expect(page).toHaveURL(/\/memory$/);
  await expect(pageHeading(page)).toHaveText("Memory");

  await page.goBack();
  await expect(page).toHaveURL(/\/orgs\/demo\/repositories$/);
  await expect(pageHeading(page)).toHaveText("Repositories");
  await expect(sidebarLink(page, "Repositories")).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(pageHeading(page)).toHaveText("Projects");
  await page.goForward();
  await expect(page).toHaveURL(/\/orgs\/demo\/repositories$/);
  await expect(pageHeading(page)).toHaveText("Repositories");
});

const flatPages = [
  ["/", "Overview"],
  ["/projects", "Projects"],
  ["/workspaces", "Workspaces"],
  ["/stacks", "Stacks"],
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
    await expect(pageHeading(page)).toHaveText(label);
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
  await page.goto("/ORGS/current/changesets");
  await expect(page.getByText("Browser test baseline")).toBeVisible();
  expect(pathOf(page)).toBe("/orgs/demo/changesets");
  await expect(changesetsLink(page)).toHaveAttribute("aria-current", "page");
});

test("switching organization works on a mixed-case /Orgs URL", async ({ page }) => {
  await installApiMocks(page, { organizations: [demoOrganization, labsOrganization] });
  await page.goto("/Orgs/demo/settings");
  await expect(page.getByRole("heading", { name: "AgentForge Demo" })).toBeVisible();
  await page.getByRole("combobox", { name: "Select organization" }).selectOption("org-labs");
  await expect(page).toHaveURL(/\/orgs\/labs\/settings$/);
  await expect(page.getByRole("heading", { name: "AgentForge Labs" })).toBeVisible();
});

test("the current alias is replaced, not pushed, so Back never bounces through it", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await page.locator(".table-panel").getByRole("button", { name: "View all" }).click();
  await expect(page).toHaveURL(/\/orgs\/demo\/changesets$/);
  await expect(pageHeading(page)).toHaveText("Changesets");

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(pageHeading(page)).toHaveText("Overview");

  await page.locator(".activity-panel").getByRole("button", { name: "View all" }).click();
  await expect(page).toHaveURL(/\/orgs\/demo\/trails$/);
  await expect(pageHeading(page)).toHaveText("Trails");
});

test("an unknown organization handle shows No active organization and names the handle", async ({ page }) => {
  await installApiMocks(page);
  for (const section of ["changesets", "settings"]) {
    await page.goto(`/orgs/nope/${section}`);
    await expect(page.getByRole("heading", { name: "No active organization" })).toBeVisible();
    await expect(page.getByText('No organization "nope" is available to this account.')).toBeVisible();
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

test("signed out, organization pages ask for SSO while flat pages still render", async ({ page }) => {
  await installApiMocks(page, { signedOut: true });
  await page.goto("/orgs/x/changesets");
  await expect(page.getByRole("heading", { name: "Sign in to view changesets" })).toBeVisible();
  const sso = page.getByRole("link", { name: "Continue with SSO" });
  await expect(sso).toHaveAttribute("href", "/auth/oidc/login");

  await sidebarLink(page, "Projects").click();
  await expect(pageHeading(page)).toHaveText("Projects");
  await page.goto("/projects");
  await expect(pageHeading(page)).toHaveText("Projects");
});

test("the SSO entry is a full-page navigation to the backend, never a client route", async ({ page }) => {
  await installApiMocks(page, { signedOut: true });
  await page.route("**/auth/oidc/login", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Identity provider</h1>" }));
  await page.goto("/orgs/x/changesets");
  await page.getByRole("link", { name: "Continue with SSO" }).click();
  await expect(page.getByRole("heading", { name: "Identity provider" })).toBeVisible();
  expect(pathOf(page)).toBe("/auth/oidc/login");
});

test("switching organization keeps the sub-path and the choice survives leaving the organization pages", async ({ page }) => {
  await installApiMocks(page, { organizations: [demoOrganization, labsOrganization] });
  await page.goto("/orgs/demo/settings");
  await expect(page.getByRole("heading", { name: "AgentForge Demo" })).toBeVisible();
  await expect(selectedOrganizationName(page)).toHaveText("AgentForge Demo");

  await page.getByRole("combobox", { name: "Select organization" }).selectOption("org-labs");
  await expect(page).toHaveURL(/\/orgs\/labs\/settings$/);
  await expect(page.getByRole("heading", { name: "AgentForge Labs" })).toBeVisible();
  await expect(selectedOrganizationName(page)).toHaveText("AgentForge Labs");

  await sidebarLink(page, "Projects").click();
  await expect(pageHeading(page)).toHaveText("Projects");
  await expect(selectedOrganizationName(page)).toHaveText("AgentForge Labs");
  await expect(changesetsLink(page)).toHaveAttribute("href", "/orgs/labs/changesets");

  await page.getByRole("combobox", { name: "Select organization" }).selectOption("org-demo");
  await expect(page).toHaveURL(/\/projects$/);
  await expect(selectedOrganizationName(page)).toHaveText("AgentForge Demo");
  await expect(changesetsLink(page)).toHaveAttribute("href", "/orgs/demo/changesets");
});

test("signing out lands on / and the sidebar shows the signed-out state", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/orgs/demo/settings");
  await expect(page.getByRole("heading", { name: "AgentForge Demo" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(pageHeading(page)).toHaveText("Overview");
  await expect(page.getByText("You have signed out.")).toBeVisible();
  await expect(selectedOrganizationName(page)).toHaveText("No organization");
  await expect(page.locator(".sidebar .profile")).toContainText("Not signed in");
});

test("Refresh only simulates a refresh on mock pages and reloads the account on organization pages", async ({ page }) => {
  let accountLoads = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/v1/me") accountLoads += 1; });
  await installApiMocks(page);
  await page.goto("/projects");
  await expect(selectedOrganizationName(page)).toHaveText("AgentForge Demo");
  const loadsOnEntry = accountLoads;

  await page.locator(".page-heading").getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Demo data refreshed.")).toBeVisible();
  expect(accountLoads).toBe(loadsOnEntry);

  await changesetsLink(page).click();
  await expect(page.getByText("Browser test baseline")).toBeVisible();
  await page.locator(".page-heading").getByRole("button", { name: "Refresh" }).click();
  await expect.poll(() => accountLoads).toBe(loadsOnEntry + 1);
  await expect(page.getByText("Browser test baseline")).toBeVisible();
});

test("an unknown path renders the not-found state inside the shell and highlights no sidebar item", async ({ page }) => {
  await installApiMocks(page);
  // The last three sit below a real page: a prefix match would keep that page's sidebar item highlighted.
  for (const path of ["/nope", "/orgs/demo/nope", "/orgs/demo", "/projects/extra", "/dev/ui/x", "/orgs/demo/changesets/x/extra"]) {
    await page.goto(path);
    await expect(pageHeading(page)).toHaveText("Page not found");
    await expect(page.getByText(`Nothing is served at ${path}.`)).toBeVisible();
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(sidebarLink(page, "Overview")).toBeVisible();
    await expect(page.locator(".sidebar [aria-current='page']")).toHaveCount(0);
  }
  await page.getByRole("link", { name: "Go to Overview" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(pageHeading(page)).toHaveText("Overview");
});

test("a trailing slash is canonicalized, so the page and its highlighted sidebar item agree", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/projects/?q=1#top");
  await expect(pageHeading(page)).toHaveText("Projects");
  await expect(sidebarLink(page, "Projects")).toHaveAttribute("aria-current", "page");
  expect(pathOf(page)).toBe("/projects?q=1#top");
});

test("Ctrl+K opens the command palette and selecting a page navigates by URL", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await expect(selectedOrganizationName(page)).toHaveText("AgentForge Demo");
  const dialog = page.getByRole("dialog", { name: "Jump to a page" });
  const search = dialog.getByRole("textbox", { name: "Search pages" });

  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await search.fill("Projects");
  await dialog.getByRole("button", { name: /Projects/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(pageHeading(page)).toHaveText("Projects");

  await page.keyboard.press("Control+k");
  await search.fill("Changesets");
  await dialog.getByRole("button", { name: /Changesets/ }).click();
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
  await sidebarLink(page, "Projects").click();
  await expect(pageHeading(page)).toHaveText("Projects");
  const dialog = page.getByRole("dialog", { name: "Jump to a page" });

  await page.keyboard.press("Control+k");
  await dialog.getByRole("textbox", { name: "Search pages" }).fill("Projects");
  await dialog.getByRole("button", { name: /Projects/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(pageHeading(page)).toHaveText("Overview");
});

test("signing out while already on / does not add a history entry", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await expect(selectedOrganizationName(page)).toHaveText("AgentForge Demo");
  const entries = () => page.evaluate(() => history.length);
  const before = await entries();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("You have signed out.")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(await entries()).toBe(before);
});
