import { expect, test, type Page } from "@playwright/test";

const organization = { id: "org-demo", name: "AgentForge Demo", role: "owner" };
const now = "2026-11-17T09:00:00.000Z";
const storedChangeset = (id: string, title: string, repository = "easyhaloo/agentforge") => ({
  changeset: {
    id, created_by: "user-owner", repository, title, revisions: [], evaluations: [],
    evidence: [], reviews: [], audit: [],
  },
  version: 1, created_at: now, updated_at: now,
});

async function installApiMocks(page: Page) {
  let members = [{
    user_id: "user-member", display_name: "Alex Developer", email: "alex@example.test",
    role: "member", status: "active", created_at: now, updated_at: now,
  }];
  let invitations: Array<Record<string, unknown>> = [];
  let changesets = [storedChangeset("CS-E2E-01", "Browser test baseline")];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({
      status, contentType: "application/json", body: JSON.stringify(body),
    });
    if (path === "/api/v1/me" && method === "GET") {
      return json({ user_id: "user-owner", display_name: "Taylor Owner", email: "owner@example.test", organizations: [organization] });
    }
    if (path.endsWith("/members") && method === "GET") {
      return json({ items: members, limit: 100, offset: 0 });
    }
    if (path.endsWith("/members/user-member") && method === "PATCH") {
      const update = request.postDataJSON() as { role?: string; status?: string };
      members = members.map((member) => member.user_id === "user-member" ? { ...member, ...update, updated_at: now } : member);
      return json(members[0]);
    }
    if (path.endsWith("/invitations") && method === "GET") {
      return json({ items: invitations, limit: 100, offset: 0 });
    }
    if (path.endsWith("/invitations") && method === "POST") {
      const body = request.postDataJSON() as { email: string; role: string };
      const invitation = {
        id: "invite-e2e-01", email: body.email, role: body.role, status: "pending",
        invited_by: "user-owner", expires_at: "2026-11-24T09:00:00.000Z", created_at: now,
      };
      invitations = [invitation, ...invitations];
      return json({ invitation, invitation_url: "https://agentforge.example.test/invite/e2e-token", token: "e2e-token" }, 201);
    }
    if (path.endsWith("/membership-audit") && method === "GET") {
      return json({ items: [], limit: 100, offset: 0 });
    }
    if (path.endsWith("/changesets") && method === "GET") {
      return json({ items: changesets, limit: 100, offset: 0 });
    }
    if (path.endsWith("/changesets") && method === "POST") {
      const body = request.postDataJSON() as { repository: string; title: string };
      const created = storedChangeset("CS-E2E-02", body.title, body.repository);
      changesets = [created, ...changesets];
      return json(created, 201);
    }
    return json({ title: "Unexpected test API request", detail: method + " " + path }, 404);
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await installApiMocks(page);
  await page.goto("/e2e-app-harness.html");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});

test("Overview search, status filtering, selection and navigation work together", async ({ page }) => {
  await page.getByRole("textbox", { name: "Search overview changesets" }).fill("CS-2481");
  await expect(page.getByText("CS-2481", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter changesets by status" }).selectOption("Ready for review");
  await expect(page.getByText("CS-2481", { exact: true })).toBeVisible();
  await page.locator(".table-panel").getByRole("button", { name: "View all" }).click();
  await expect(page.getByRole("main").locator(".page-heading h1")).toHaveText("Changesets");
});

test("Delivery creates a revision, evaluates it, approves and completes the merge flow", async ({ page }) => {
  await page.getByRole("button", { name: "Eval", exact: true }).click();
  await expect(page.getByRole("heading", { name: /CS-2481/ })).toBeVisible();
  await page.getByRole("button", { name: "New revision" }).click();
  await expect(page.getByText("r4", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run Eval" }).click();
  await page.getByRole("button", { name: "Approve revision" }).click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Merge & complete Trail" }).click();
  await expect(page.getByText("Delivered", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByText(/Trail TRL-042 completed/)).toBeVisible();
});

test("Resources supports search, status filtering, inspection and creation", async ({ page }) => {
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Search Projects" }).fill("Commerce");
  await expect(page.getByText("Commerce", { exact: false }).first()).toBeVisible();
  await page.getByRole("combobox", { name: "Filter by status" }).selectOption("At risk");
  await expect(page.getByText("Commerce", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("textbox", { name: "New Projects name" }).fill("E2E Project");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: "E2E Project" })).toBeVisible();
  await expect(page.getByRole("main").getByText(/created locally/)).toBeVisible();
});

test("Changesets loads organization records, searches and persists a new changeset", async ({ page }) => {
  await page.locator(".sidebar").getByRole("button", { name: /Changesets/ }).click();
  await expect(page.getByText("Browser test baseline")).toBeVisible();
  await page.getByRole("textbox", { name: "Search changesets" }).fill("Browser test");
  await expect(page.getByText("Browser test baseline")).toBeVisible();
  await page.getByRole("textbox", { name: "Search changesets" }).fill("");
  await page.getByRole("textbox", { name: "Repository" }).fill("easyhaloo/agentforge");
  await page.getByRole("textbox", { name: "Title" }).fill("E2E persisted changeset");
  const createResponse = page.waitForResponse((response) => response.url().includes("/api/v1/organizations/org-demo/changesets") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create changeset", exact: true }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(page.getByRole("cell").getByText("E2E persisted changeset")).toBeVisible();
});

test("Organization role changes are sent to the API and reflected in the member table", async ({ page }) => {
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AgentForge Demo" })).toBeVisible();
  const role = page.getByRole("combobox", { name: "Role for Alex Developer" });
  await role.selectOption("viewer");
  await expect(role).toHaveValue("viewer");
});

test("Organization invitations can be created and displayed", async ({ page }) => {
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  await page.getByRole("tab", { name: /Invitations/ }).click();
  await page.getByRole("textbox", { name: "Email address" }).fill("new-member@example.test");
  await page.getByRole("combobox", { name: "Role" }).selectOption("member");
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByText("Invitation created")).toBeVisible();
  await expect(page.getByText("new-member@example.test")).toBeVisible();
  await expect(page.getByText("https://agentforge.example.test/invite/e2e-token")).toBeVisible();
});

test("application shell remains usable at a mobile viewport", async ({ page }) => {
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  await expect(page.getByRole("textbox", { name: "Search Projects" })).toBeVisible();
});
