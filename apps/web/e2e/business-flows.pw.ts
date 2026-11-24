import { expect, test } from "@playwright/test";
import { installApiMocks } from "./support/api-mocks";
import { openNavigation } from "./support/navigation";
import { selectOption } from "./support/select-option";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await installApiMocks(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});

test("Overview lists pending reviews and passes the filters to Changesets", async ({ page }) => {
  const work = page.getByRole("region", { name: "Your work" });
  await expect(work.getByRole("link", { name: /Browser test baseline/ })).toBeVisible();
  await expect(work.getByText("Approved change")).toHaveCount(0);
  await work.getByRole("button", { name: "My recent changes" }).click();
  await expect(page).toHaveURL(/view=mine$/);
  await expect(work.getByRole("link", { name: /Approved change/ })).toBeVisible();
  await page.getByRole("link", { name: "Open review queue" }).click();
  await expect(page).toHaveURL(/reviewer=me&status=in_review$/);
  await expect(page.getByRole("main", { name: "Changesets" })).toBeVisible();
  await expect(page.getByText("Browser test baseline")).toBeVisible();
  await expect(page.getByText("Approved change")).toHaveCount(0);
});

test("Delivery creates a revision, evaluates it, approves and completes the merge flow", async ({ page }) => {
  await (await openNavigation(page)).getByRole("link", { name: "Self-healing", exact: true }).click();
  await page.getByText("Full delivery demo", { exact: true }).click();
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

test("the organization project directory searches by name and number", async ({ page }) => {
  await page.route("**/api/v1/organizations/org-demo/issue-projects", route => route.fulfill({ json: { items: [
    { id: "commerce", number: 9, name: "Commerce", layout: "board" },
    { id: "platform", number: 14, name: "Core Platform", layout: "table" },
  ] } }));
  await (await openNavigation(page)).getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL("/orgs/demo/projects");
  const search = page.getByRole("searchbox", { name: "Search project name or number" });
  const commerce = page.getByRole("link", { name: "Commerce", exact: true });
  const platform = page.getByRole("link", { name: "Core Platform", exact: true });
  await expect(commerce).toBeVisible();
  await expect(platform).toBeVisible();
  await search.fill("Commerce");
  await expect(commerce).toBeVisible();
  await expect(platform).toHaveCount(0);
  await search.fill("#14");
  await expect(platform).toHaveAttribute("href", "/orgs/demo/projects/14");
  await expect(commerce).toHaveCount(0);
});

test("Changesets loads organization records, searches and persists a new changeset", async ({ page }) => {
  await (await openNavigation(page)).getByRole("link", { name: /Changesets/ }).click();
  const baseline = page.getByRole("main").getByText("Browser test baseline").first();
  await expect(baseline).toBeVisible();
  await page.getByPlaceholder("Search ID, title or repository").fill("Browser test");
  await expect(baseline).toBeVisible();
  await page.getByPlaceholder("Search ID, title or repository").fill("");
  // The list carries a repository filter as well, so the create form's select is matched exactly.
  await selectOption(page, page.getByRole("combobox", { name: "Repository", exact: true }), /^easyhaloo\/agentforge \· main$/);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("E2E persisted changeset");
  const createResponse = page.waitForResponse((response) => response.url().includes("/api/v1/organizations/org-demo/changesets") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(page.getByRole("cell").getByText("E2E persisted changeset")).toBeVisible();
});

test("Organization role changes are sent to the API and reflected in the member table", async ({ page }) => {
  await page.getByRole("button", { name: /^User menu,/ }).click();
  await page.getByRole("dialog", { name: "User menu" }).getByRole("link", { name: "Organization settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AgentForge Demo" })).toBeVisible();
  const role = page.getByRole("combobox", { name: "Role for Alex Developer" });
  await selectOption(page, role, "Viewer");
  await expect(role.locator(".af-select-trigger__label")).toHaveText("Viewer");
});

test("Organization invitations can be created and displayed", async ({ page }) => {
  await page.getByRole("button", { name: /^User menu,/ }).click();
  await page.getByRole("dialog", { name: "User menu" }).getByRole("link", { name: "Organization settings", exact: true }).click();
  await page.getByRole("tab", { name: /Invitations/ }).click();
  await page.getByRole("textbox", { name: "Email address" }).fill("new-member@example.test");
  await selectOption(page, page.getByRole("combobox", { name: "Role" }), "Member");
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByText("Invitation created", { exact: true })).toBeVisible();
  await expect(page.getByText("new-member@example.test")).toBeVisible();
  await expect(page.getByText("https://agentforge.example.test/invite/e2e-token")).toBeVisible();
});

test("application shell remains usable at a mobile viewport", async ({ page }) => {
  await (await openNavigation(page)).getByRole("link", { name: "Projects", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("banner").getByText("Projects", { exact: true })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  await expect(page.getByRole("searchbox", { name: "Search project name or number" })).toBeVisible();
});
