import { expect, test, type Page } from "@playwright/test";
import { demoOrganization, installApiMocks } from "./support/api-mocks";
import { selectOption } from "./support/select-option";

const repository = "easyhaloo/agentforge";
const codePath = `/orgs/demo/repositories/${repository}`;
const issuesPath = `${codePath}/issues`;
const apiPath = `/api/v1/organizations/${demoOrganization.id}/issues`;
const authentication = "Add user authentication";
const redirect = "Fix login redirect bug";
const documentation = "Update documentation";
const performance = "Improve performance";

function listRequest(page: Page) {
  return page.waitForRequest(request => request.method() === "GET" && new URL(request.url()).pathname === apiPath)
    .then(request => new URL(request.url()).searchParams);
}

function issueLinks(page: Page) {
  return page.getByRole("link", { name: /^(Add user authentication|Fix login redirect bug|Update documentation|Improve performance)$/ });
}

function closedFilter(page: Page) {
  return page.getByRole("button", { name: /^Closed issues\b/i });
}

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test("opens Issues from repository Code and lists open issues by default", async ({ page }) => {
  await page.goto(codePath);
  const requested = listRequest(page);
  await page.getByRole("link", { name: "Issues", exact: true }).click();

  await expect(page).toHaveURL(issuesPath);
  const params = await requested;
  expect(params.get("repository")).toBe(repository);
  expect(params.get("state")).toBe("open");
  expect(params.get("include_filter_options")).toBe("true");
  expect(params.get("limit")).toBe("30");
  expect(params.get("offset")).toBe("0");
  expect(params.has("page")).toBe(false);
  expect(params.has("per_page")).toBe(false);
  await expect(issueLinks(page)).toHaveText([performance, redirect, authentication]);
  await expect(page.getByRole("button", { name: /^Open issues\b/i })).toContainText("3");
  await expect(closedFilter(page)).toContainText("1");
});

test("the legacy repository Issues link opens the canonical list", async ({ page }) => {
  await page.goto("/orgs/demo/repositories/agentforge");
  await page.getByRole("link", { name: "Issues", exact: true }).click();

  await expect(page).toHaveURL("/orgs/demo/repositories/demo/agentforge/issues");
  await expect(page.getByText("No issues found matching your filters.")).toBeVisible();
});

test("switches to closed issues while retaining both state counts", async ({ page }) => {
  await page.goto(issuesPath);
  await expect(issueLinks(page)).toHaveCount(3);

  const requested = listRequest(page);
  await closedFilter(page).click();

  expect((await requested).get("state")).toBe("closed");
  await expect(issueLinks(page)).toHaveText([documentation]);
  await expect(page.getByRole("button", { name: /^Open issues\b/i })).toContainText("3");
  await expect(closedFilter(page)).toContainText("1");
  await expect(closedFilter(page)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("combobox", { name: "Filter by label" }).click();
  await expect(page.getByRole("option", { name: "bug", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "documentation", exact: true })).toBeVisible();
  await page.reload();
  await expect(issueLinks(page)).toHaveText([documentation]);
});

for (const { label, param, matches } of [
  { label: "Assigned to me", param: "assignee", matches: [performance, authentication] },
  { label: "Created by me", param: "created_by", matches: [authentication, documentation] },
]) {
  test(`filters issues with ${label}`, async ({ page }) => {
    await page.goto(issuesPath);
    await expect(issueLinks(page)).toHaveCount(3);

    const requested = listRequest(page);
    const filter = page.getByRole("button", { name: label, exact: true });
    await filter.click();

    const params = await requested;
    expect(params.get(param)).toBe("user-owner");
    expect(params.has("state")).toBe(false);
    await expect(filter).toHaveAttribute("aria-pressed", "true");
    await expect(issueLinks(page)).toHaveText(matches);
  });
}

for (const { label, option, param, matches } of [
  { label: "Filter by author", option: "user-member", param: "created_by", matches: [performance, redirect] },
  { label: "Filter by assignee", option: "user-owner", param: "assignee", matches: [performance, authentication] },
  { label: "Filter by label", option: "bug", param: "labels", matches: [redirect] },
]) {
  test(`${label} sends the selected value and narrows the list`, async ({ page }) => {
    await page.goto(issuesPath);
    await expect(issueLinks(page)).toHaveCount(3);

    const requested = listRequest(page);
    await selectOption(page, page.getByRole("combobox", { name: label }), option);

    const params = await requested;
    expect(params.get(param)).toBe(option);
    expect(params.get("state")).toBe("open");
    await expect(issueLinks(page)).toHaveText(matches);
  });
}

test("searches title, description and number and displays a genuine empty state", async ({ page }) => {
  await page.goto(issuesPath);
  await expect(issueLinks(page)).toHaveCount(3);
  const search = page.getByPlaceholder("Search issues...");

  for (const { query, matches } of [
    { query: "authentication", matches: [authentication] },
    { query: "wrong page", matches: [redirect] },
    { query: "#4", matches: [performance] },
    { query: "no matching issue", matches: [] },
  ]) {
    const requested = listRequest(page);
    await search.fill(query);

    expect((await requested).get("q")).toBe(query);
    if (matches.length) await expect(issueLinks(page)).toHaveText(matches);
  }
  await expect(page.getByText("No issues found matching your filters.")).toBeVisible();
  await expect(issueLinks(page)).toHaveCount(0);
});

for (const { label, sort, direction, matches } of [
  { label: "Newest", sort: "created", direction: "desc", matches: [redirect, authentication, performance] },
  { label: "Oldest", sort: "created", direction: "asc", matches: [performance, authentication, redirect] },
  { label: "Most commented", sort: "comments", direction: "desc", matches: [performance, authentication, redirect] },
]) {
  test(`orders issues by ${label}`, async ({ page }) => {
    await page.goto(issuesPath);
    await expect(issueLinks(page)).toHaveText([performance, redirect, authentication]);

    const requested = listRequest(page);
    await selectOption(page, page.getByRole("combobox", { name: "Sort by" }), label);

    const params = await requested;
    expect(params.get("sort")).toBe(sort);
    expect(params.get("direction")).toBe(direction);
    await expect(issueLinks(page)).toHaveText(matches);
  });
}

test("displays issue metadata and opens details through the title link", async ({ page }) => {
  await page.goto(issuesPath);
  const link = page.getByRole("link", { name: performance, exact: true });
  const results = page.getByRole("region", { name: "Issue results" });
  const row = results.getByRole("listitem").filter({ has: link });
  await expect(results.getByRole("button", { name: /^Open issues\b/i })).toBeVisible();
  await expect(results.getByRole("combobox", { name: "Sort by" })).toBeVisible();

  await expect(row.getByText("#4", { exact: true })).toBeVisible();
  await expect(row.getByText("enhancement", { exact: true })).toBeVisible();
  await expect(row.getByText("user-member", { exact: true })).toBeVisible();
  await expect(row.getByText("user-owner +1", { exact: true })).toBeVisible();
  await expect(row.getByText("8", { exact: true })).toBeVisible();
  await expect(page.getByText("Showing 3 of 3 issues", { exact: true })).toBeVisible();
  await expect(link).toHaveAttribute("href", `${issuesPath}/4`);
  await link.click();
  await expect(page).toHaveURL(`${issuesPath}/4`);
  await expect(page.getByRole("heading", { name: /Improve performance/ })).toBeVisible();
  await expect(page.getByText("Database queries are slow and need optimization.")).toBeVisible();
});

test("keeps the issue list and description usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(issuesPath);
  await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New issue", exact: true })).toBeVisible();
  const link = page.getByRole("link", { name: performance, exact: true });
  await expect(link).toBeVisible();
  const horizontalOverflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await expect.poll(horizontalOverflow).toBe(0);

  await link.click();
  await expect(page.getByRole("region", { name: "Description" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Assignees" })).toBeVisible();
  await expect.poll(horizontalOverflow).toBe(0);
});
