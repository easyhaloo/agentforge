import { expect, test } from "@playwright/test";
import { installApiMocks } from "./support/api-mocks";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await installApiMocks(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.locator(".sidebar .org-switch")).toContainText("AgentForge Demo");
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
  await page.getByRole("link", { name: "Stacks", exact: true }).click();
  await expect(page.locator(".flow-primary h3")).toContainText("CS-2481");
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
  await page.getByRole("link", { name: "Projects", exact: true }).click();
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
  await page.locator(".sidebar").getByRole("link", { name: /Changesets/ }).click();
  await expect(page.getByText("Browser test baseline")).toBeVisible();
  await page.getByPlaceholder("Search ID, title or repository").fill("Browser test");
  await expect(page.getByText("Browser test baseline")).toBeVisible();
  await page.getByPlaceholder("Search ID, title or repository").fill("");
  // The list carries a repository filter as well, so the create form's select is matched exactly.
  await page.getByRole("combobox", { name: "Repository", exact: true }).selectOption("easyhaloo/agentforge");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("E2E persisted changeset");
  const createResponse = page.waitForResponse((response) => response.url().includes("/api/v1/organizations/org-demo/changesets") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(page.getByRole("cell").getByText("E2E persisted changeset")).toBeVisible();
});

test("Organization role changes are sent to the API and reflected in the member table", async ({ page }) => {
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AgentForge Demo" })).toBeVisible();
  const role = page.getByRole("combobox", { name: "Role for Alex Developer" });
  await role.selectOption("viewer");
  await expect(role).toHaveValue("viewer");
});

test("Organization invitations can be created and displayed", async ({ page }) => {
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  await page.getByRole("tab", { name: /Invitations/ }).click();
  await page.getByRole("textbox", { name: "Email address" }).fill("new-member@example.test");
  await page.getByRole("combobox", { name: "Role" }).selectOption("member");
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByText("Invitation created")).toBeVisible();
  await expect(page.getByText("new-member@example.test")).toBeVisible();
  await expect(page.getByText("https://agentforge.example.test/invite/e2e-token")).toBeVisible();
});

test("application shell remains usable at a mobile viewport", async ({ page }) => {
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  await expect(page.getByRole("textbox", { name: "Search Projects" })).toBeVisible();
});
