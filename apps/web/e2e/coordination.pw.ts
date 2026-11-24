import { expect, test } from "@playwright/test";
import { installApiMocks, now, storedChangeset } from "./support/api-mocks";
import { openNavigation } from "./support/navigation";

const isChangesetList = (url: URL) => url.pathname.endsWith("/changesets");

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test("Review keeps the assignment filter and opens the review for the current revision", async ({ page }) => {
  const loaded = page.waitForRequest(request => isChangesetList(new URL(request.url())));
  await page.goto("/orgs/demo/review?limit=1&offset=1");
  expect(new URL((await loaded).url()).searchParams.get("reviewer")).toBe("me");

  await expect(page.getByRole("banner").getByText("Review", { exact: true })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.locator(".page-heading")).toHaveCount(0);
  await expect(main.getByRole("textbox", { name: "Search ID, title or repository" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Review Queue", level: 1 })).toBeVisible();
  const navigation = await openNavigation(page);
  await expect(navigation.getByRole("link", { name: "Review", exact: true })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "In review", exact: true }).click();
  await expect(page).toHaveURL(/status=in_review&limit=1&offset=0$/);
  await page.getByRole("link", { name: "Browser test baseline" }).click();
  await expect(page).toHaveURL(/\/changesets\/CS-E2E-01\/review$/);
});

test("Eval shows evaluation work for the active revision and the selected status", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const change = storedChangeset("CS-E2E-EVAL", "Check merge candidate", undefined, "evaluation_failed");
  change.changeset.revisions = [
    { id: "old", commit_sha: "old-commit" }, { id: "current", commit_sha: "current-commit" },
  ];
  change.changeset.evaluations = [
    { revision_id: "old", status: "passed", summary: "Outdated result", created_at: now },
    { revision_id: "current", status: "failed", summary: "Current check failed", created_at: now },
  ];
  await page.route(isChangesetList, route => {
    const status = new URL(route.request().url()).searchParams.get("status");
    const items = status === "evaluation_failed" ? [change] : [];
    return route.fulfill({ json: { items, total: items.length, limit: 20, offset: 0 } });
  });
  const loaded = page.waitForRequest(request => isChangesetList(new URL(request.url())));
  await page.goto("/orgs/demo/eval");
  expect(new URL((await loaded).url()).searchParams.get("status")).toBe("evaluation_pending");
  await expect(page.getByRole("banner").getByText("Eval", { exact: true })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.locator(".page-heading")).toHaveCount(0);
  await expect(main.getByRole("textbox", { name: "Search ID, title or repository" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Evaluation queue", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Evaluation failed", exact: true }).click();
  await expect(page.getByText("Current check failed")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(page.getByText("Outdated result")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Check merge candidate" })).toHaveAttribute("href", /\/changesets\/CS-E2E-EVAL\/evaluation$/);
});

test("Trails preserves change activity when membership audit is restricted", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/membership-audit?*", route => route.fulfill({ status: 403, json: {} }));
  await page.goto("/orgs/demo/trails");
  const trail = page.getByRole("list", { name: "Activity Trail" });
  await expect(trail.getByText("Changeset created").first()).toBeVisible();
  await page.getByRole("button", { name: "Include membership events" }).click();
  await expect(page.getByRole("alert")).toHaveText("You do not have permission to view membership events.");
  await expect(trail.getByRole("link", { name: "Browser test baseline" }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test("Self-healing shows a new revision awaiting its own evaluation", async ({ page }) => {
  await page.goto("/self-healing");
  await expect(page.getByText("Local demo. Uses sample data stored in this browser.")).toBeVisible();
  await expect(page.getByText("CS-2481 · Revision 3")).toBeVisible();
  await page.getByRole("button", { name: "Simulate repair" }).click();
  await expect(page.getByText("CS-2481 · Revision 4")).toBeVisible();
  await expect(page.locator(".self-healing").getByRole("status")).toHaveText("Awaiting evaluation");
  await page.getByRole("button", { name: "Simulate evaluation" }).click();
  await expect(page.locator(".self-healing").getByRole("status")).toHaveText("Passed");
});
