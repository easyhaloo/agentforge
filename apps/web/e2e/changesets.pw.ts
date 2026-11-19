import { expect, test, type Page } from "@playwright/test";
import { installApiMocks } from "./support/api-mocks";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await installApiMocks(page);
});

/** The query strings of the changeset list requests the page sent. */
const listSearches = (page: Page) => {
  const searches: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/changesets") && request.method() === "GET") searches.push(url.search);
  });
  return searches;
};

test("the changeset list keeps its filters in the URL and shows the rows the server sends", async ({ page }) => {
  const searches = listSearches(page);

  await page.goto("/orgs/demo/changesets?q=baseline");
  await expect(page.getByRole("cell").getByText("Browser test baseline")).toBeVisible();
  await expect(page.getByRole("cell").getByText("Unrelated change")).toHaveCount(0);
  expect(searches.at(-1)).toContain("q=baseline");
  expect(page.url()).toContain("q=baseline");
});

test("the search term is applied when the search settles, not on every keystroke", async ({ page }) => {
  const searches = listSearches(page);
  await page.goto("/orgs/demo/changesets");
  await expect(page.getByRole("cell").getByText("Browser test baseline")).toBeVisible();
  const before = searches.length;

  await page.getByPlaceholder("Search ID, title or repository").pressSequentially("ba", { delay: 20 });
  await page.waitForTimeout(800);

  expect(searches.length - before).toBe(1);
  expect(searches.at(-1)).toContain("q=ba");
});

test("the list asks the server for one page at a time", async ({ page }) => {
  const searches = listSearches(page);

  await page.goto("/orgs/demo/changesets?limit=1&offset=1");

  await expect(page.getByRole("cell").getByText("Unrelated change")).toBeVisible();
  await expect(page.getByRole("cell").getByText("Browser test baseline")).toHaveCount(0);
  expect(searches.at(-1)).toContain("limit=1");
  expect(searches.at(-1)).toContain("offset=1");
  await expect(page.getByText("3 items")).toBeVisible();
});

test("a page the server sends no row for says the filters matched nothing", async ({ page }) => {
  await page.goto("/orgs/demo/changesets?status=merged");

  await expect(page.getByText("No changesets match the filters.")).toBeVisible();
});

test("a changeset has its own detail page", async ({ page }) => {
  await page.goto("/orgs/demo/changesets");
  await page.getByRole("cell").getByText("Browser test baseline").click();

  await expect(page).toHaveURL(/\/orgs\/demo\/changesets\/CS-E2E-01$/);
  await expect(page.getByRole("heading", { name: "Browser test baseline" })).toBeVisible();
  // The list is not rendered next to it.
  await expect(page.getByRole("cell")).toHaveCount(0);
});

test("the audit trail shows the operations in words, not as the server's codes", async ({ page }) => {
  await page.goto("/orgs/demo/changesets/CS-E2E-04");
  await expect(page.getByText("Changeset created")).toBeVisible();
  await expect(page.getByText("Review decided \u00b7 Approved")).toBeVisible();
  // The server's own codes never reach the reader.
  await expect(page.getByText("review.decided")).toHaveCount(0);
});

test("every part of a changeset is a route with its own panel", async ({ page }) => {
  const tabs = page.getByRole("navigation", { name: "Changeset sections" });

  await page.goto("/orgs/demo/changesets/CS-E2E-01/review");
  await expect(tabs.getByRole("link", { name: "Review" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Assign review" })).toBeVisible();

  await page.goto("/orgs/demo/changesets/CS-E2E-01/merge");
  await expect(tabs.getByRole("link", { name: "Merge" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Merge target")).toBeVisible();
});

test("the detail page resolves a Git revision", async ({ page }) => {
  await page.goto("/orgs/demo/changesets/CS-E2E-03/revisions");
  await page.getByPlaceholder("branch, tag or commit SHA").fill("feature/one");
  const sent = page.waitForRequest((request) => request.url().endsWith("/changesets/CS-E2E-03/revisions") && request.method() === "POST");

  await page.getByRole("button", { name: "Add revision" }).click();

  expect((await sent).postDataJSON()).toEqual({ ref: "feature/one" });
  await expect(page.getByText("Evaluation pending")).toBeVisible();
});

test("the detail page runs the trusted evaluation", async ({ page }) => {
  await page.goto("/orgs/demo/changesets/CS-E2E-01/evaluation");
  const sent = page.waitForRequest((request) => request.url().endsWith("/changesets/CS-E2E-01/evaluations") && request.method() === "POST");

  await page.getByRole("button", { name: "Run evaluation" }).click();

  await sent;
  await expect(page.getByText("Review required")).toBeVisible();
});

test("the detail page assigns a review", async ({ page }) => {
  await page.goto("/orgs/demo/changesets/CS-E2E-01/review");
  await page.getByPlaceholder("reviewer user ID").fill("user-member");
  const sent = page.waitForRequest((request) => request.url().endsWith("/changesets/CS-E2E-01/reviews") && request.method() === "POST");

  await page.getByRole("button", { name: "Assign review" }).click();

  expect((await sent).postDataJSON()).toEqual({ reviewer_id: "user-member", comment: "" });
  await expect(page.getByText("Assigned to user-member")).toBeVisible();
});

test("the detail page decides the review assigned to the signed-in user", async ({ page }) => {
  await page.goto("/orgs/demo/changesets/CS-E2E-01/review");
  const sent = page.waitForRequest((request) => request.url().includes("/changesets/CS-E2E-01/reviews/rev-review-1/decision") && request.method() === "POST");

  await page.getByRole("button", { name: "Approve" }).click();

  expect((await sent).postDataJSON()).toEqual({ approved: true, comment: "" });
  await expect(page.getByText("Ready to merge")).toBeVisible();
});

test("the detail page merges the changeset", async ({ page }) => {
  await page.goto("/orgs/demo/changesets/CS-E2E-04/merge");
  await page.getByPlaceholder("main").fill("release");
  const sent = page.waitForRequest((request) => request.url().endsWith("/changesets/CS-E2E-04/merge") && request.method() === "POST");

  await page.getByRole("button", { name: "Merge changeset" }).click();

  expect((await sent).postDataJSON()).toEqual({ target_ref: "release" });
  await expect(page.getByText("Merged as")).toBeVisible();
});

test("a changeset that is ready to merge cannot be sent back for review, and says why", async ({ page }) => {
  await page.goto("/orgs/demo/changesets/CS-E2E-04/review");

  await expect(page.getByRole("button", { name: "Assign review" })).toBeDisabled();
  await expect(page.getByText("The current revision already has an approved review.")).toBeVisible();
});
