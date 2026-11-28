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

test("read-only viewers can read issues but cannot open either creation entry point", async ({ page }) => {
  await installApiMocks(page, { organizations: [{ ...demoOrganization, role: "viewer" }] });
  await page.goto(issuesPath);
  await expect(issueLinks(page)).toHaveCount(3);
  await expect(page.getByRole("link", { name: "New issue", exact: true })).toHaveCount(0);

  for (const path of ["/new", "/new/choose", "/new?template=bug.md"]) {
    await page.goto(`${issuesPath}${path}`);
    await expect(page.getByRole("alert")).toHaveText("Your organization role does not allow you to create issues.");
    await expect(page.getByRole("button", { name: "New issue", exact: true })).toHaveCount(0);
    await page.getByRole("navigation", { name: "Repository sections" }).getByRole("link", { name: "Issues", exact: true }).click();
    await expect(page).toHaveURL(issuesPath);
  }
});

test("a writer can select a maintainers-only blank issue", async ({ page }) => {
  await installApiMocks(page, { organizations: [{ ...demoOrganization, role: "member" }] });
  const config = ".github/ISSUE_TEMPLATE/config.yml";
  await page.route("**/repositories/easyhaloo/agentforge/tree?*", route => {
    const path = new URL(route.request().url()).searchParams.get("path") ?? "";
    const next = path === "" ? ".github" : path === ".github" ? ".github/ISSUE_TEMPLATE" : config;
    return route.fulfill({ json: { commit_sha: "a".repeat(40), items: [{
      name: next.split("/").at(-1), path: next, kind: next === config ? "file" : "tree",
    }] } });
  });
  await page.route("**/repositories/easyhaloo/agentforge/blob?*", route => route.fulfill({ json: {
    content: "blank_issues_enabled: false\ncontact_links:\n  - name: Support\n    about: Ask a question\n    url: https://example.test/support\n",
  } }));

  await page.goto(issuesPath);
  await page.getByRole("link", { name: "New issue", exact: true }).click();
  await expect(page.getByText("Maintainers only", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Blank issue", exact: true }).click();
  await expect(page).toHaveURL(`${issuesPath}/new`);
  await expect(page.getByRole("button", { name: "New issue", exact: true })).toBeVisible();
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

test("keeps highlighted qualifiers aligned and submits them from the search button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(issuesPath);
  await expect(issueLinks(page)).toHaveCount(3);
  const search = page.getByPlaceholder("Search issues...");
  const mirror = page.locator(".af-search__highlight");
  const query = `${"word ".repeat(24)}state:open`;
  await search.fill(query);
  await search.press("End");
  await expect(mirror.locator("mark")).toHaveText("open");
  await expect.poll(() => search.evaluate(input => input.scrollLeft)).toBeGreaterThan(0);
  await expect.poll(() => search.evaluate(input =>
    input.scrollLeft - (input.previousElementSibling?.scrollLeft ?? 0),
  )).toBe(0);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(query);
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
  await expect(page.getByRole("link", { name: "New issue", exact: true })).toBeVisible();
  const link = page.getByRole("link", { name: performance, exact: true });
  await expect(link).toBeVisible();
  const horizontalOverflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await expect.poll(horizontalOverflow).toBe(0);

  await link.click();
  await expect(page.getByRole("region", { name: "Description" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Assignees" })).toBeVisible();
  await expect.poll(horizontalOverflow).toBe(0);
});

test("previews GitHub Markdown and strips unsafe HTML on a narrow dark screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${issuesPath}/new`);
  const title = page.getByRole("textbox", { name: "Title" });
  const description = page.getByRole("textbox", { name: "Description" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await title.pressSequentially("x".repeat(501));
  await expect(title).toHaveValue("x".repeat(500));
  await description.fill("Selected text");
  await description.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(description).toHaveValue("**Selected text**");
  await expect(description).toBeFocused();
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(description).toHaveValue("Selected text");

  await description.fill("First item\nSecond item");
  await description.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Numbered list" }).click();
  await expect(description).toHaveValue("1. First item\n2. Second item");
  await page.getByRole("button", { name: "Numbered list" }).click();
  await expect(description).toHaveValue("First item\nSecond item");

  await description.fill("Reference guide");
  await description.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await page.keyboard.insertText("https://example.test/guide");
  await expect(description).toHaveValue("[Reference guide](https://example.test/guide)");

  await description.fill("first line\nsecond line");
  await description.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(description).toHaveValue("```\nfirst line\nsecond line\n```");

  // Exercise the toolbar's direct-value fallback and ensure it cannot exceed maxlength.
  await page.evaluate(() => { document.execCommand = () => false; });
  await description.fill("Fallback text");
  await description.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(description).toHaveValue("**Fallback text**");
  const maxBody = "x".repeat(65536);
  await description.fill(maxBody);
  await description.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect.poll(() => description.inputValue().then((value) => value === maxBody)).toBe(true);

  const markdown = [
    "**Selected text**",
    "",
    "First line",
    "Second line :rocket:",
    "",
    "> [!NOTE]",
    "> Read this before publishing.",
    "",
    "<details>",
    "<summary>More information</summary>",
    "",
    "- Hidden until expanded",
    "",
    "</details>",
    "",
    "<div data-qa-raw-html>Raw HTML</div>",
    "",
    "<script>javascriptShouldNotExecute()</script>",
    "",
    "[Blocked URL](javascript:void%280%29)",
    "",
    "Footnote reference[^test].",
    "",
    "[^test]: Footnote content.",
    "",
    "```text", "line".repeat(250), "```",
  ].join("\n");
  await description.fill(markdown);
  const write = page.getByRole("tab", { name: "Write" });
  const preview = page.getByRole("tab", { name: "Preview" });
  await write.press("ArrowRight");
  await expect(preview).toBeFocused();
  const panel = page.getByRole("tabpanel", { name: "Preview" });
  await expect(panel.locator("strong")).toHaveText("Selected text");
  await expect(panel.locator("[data-qa-raw-html]")).toHaveCount(0);
  await expect(panel.locator("script, a[href^='javascript:']")).toHaveCount(0);
  await expect(panel.locator("p:has(> br)").filter({ hasText: "First line" })).toHaveText(/First line\s*Second line 🚀/);
  await expect(panel.getByText("Note", { exact: true })).toBeVisible();
  await expect(panel.getByText("Read this before publishing.", { exact: true })).toBeVisible();
  const foldedText = panel.getByText("Hidden until expanded", { exact: true });
  await expect(foldedText).toBeHidden();
  await panel.getByText("More information", { exact: true }).click();
  await expect(foldedText).toBeVisible();
  const footnoteLink = panel.locator("a[data-footnote-ref]");
  const backLink = panel.locator("a[data-footnote-backref]");
  await expect(footnoteLink).toHaveAttribute("href", "#user-content-fn-test");
  await expect(panel.locator("#user-content-fn-test")).toContainText("Footnote content.");
  await expect(backLink).toHaveAttribute("href", "#user-content-fnref-test");
  await expect(footnoteLink).toHaveAttribute("id", "user-content-fnref-test");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await preview.press("Home");
  await expect(description).toHaveValue(markdown);
  await page.getByRole("link", { name: "Issues", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(description).toHaveValue(markdown);
});

test("slash commands insert Markdown blocks and preserve the surrounding draft", async ({ page }) => {
  await page.goto(`${issuesPath}/new`);
  const body = page.getByRole("textbox", { name: "Description", exact: true });
  await body.fill("before\n\n");
  await body.press("/");
  const commands = page.getByRole("listbox", { name: "Slash commands" });
  await commands.getByRole("option", { name: "Alerts", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "Alerts" }).getByRole("option")).toHaveCount(5);
  await body.press("Escape");
  await expect(commands).toBeVisible();
  await body.press("Enter");
  await page.getByRole("option", { name: "Warning", exact: true }).click();
  await expect(body).toHaveValue("before\n\n> [!WARNING]\n> Alert text\n\n");
  await expect(body).toBeFocused();

  await body.pressSequentially("/table");
  await body.press("Tab");
  await expect(page.getByRole("listbox", { name: "Table" }).getByRole("option")).toHaveCount(5);
  await body.press("ArrowUp");
  await body.press("Enter");
  await expect(body).toHaveValue(/Column 1.*Column 5/);
  await body.pressSequentially("/code");
  await body.press("Enter");
  await body.pressSequentially("/details");
  await body.press("Enter");
  await expect(body).toHaveValue(/<summary>Details<\/summary>/);
  await body.press("ControlOrMeta+z");
  await expect(body).toHaveValue(/\/details$/);
  await body.press("ControlOrMeta+Shift+z");
  await expect(body).toHaveValue(/<summary>Details<\/summary>/);
  await body.pressSequentially("after");

  await page.getByRole("tab", { name: "Preview" }).click();
  const preview = page.getByRole("tabpanel", { name: "Preview" });
  await expect(preview.getByText("Warning", { exact: true })).toBeVisible();
  await expect(preview.locator("table thead th")).toHaveText(["Column 1", "Column 2", "Column 3", "Column 4", "Column 5"]);
  await expect(preview.locator("pre code")).toBeAttached();
  await preview.getByText("Details", { exact: true }).click();
  await expect(preview.getByText("Add details here", { exact: true })).toBeVisible();
  await expect(preview.getByText("before", { exact: true })).toBeVisible();
  await expect(preview.getByText("after", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Write" }).click();
  await body.fill("https://example.com/path");
  await expect(commands).toBeHidden();
  await body.pressSequentially("\n/unknown");
  await body.press("Enter");
  await expect(body).toHaveValue("https://example.com/path\n/unknown\n");

  const full = `${"a".repeat(65_530)}\n/code`;
  await body.fill(full);
  await expect(commands).toBeVisible();
  await body.press("Enter");
  await expect(body).toHaveValue(full);
  await expect(commands).toBeHidden();
});

test("the template command reports empty and failed lookups without rewriting the description", async ({ page }) => {
  let available = false;
  await page.route("**/repositories/easyhaloo/agentforge/tree?*", route => available
    ? route.fulfill({ json: { commit_sha: "a".repeat(40), items: [] } })
    : route.fulfill({ status: 503 }));
  await page.goto(`${issuesPath}/new`);
  const body = page.getByRole("textbox", { name: "Description", exact: true });
  await body.fill("Existing text\n\n");
  await body.pressSequentially("/template");
  await body.press("Enter");
  await expect(page.getByText("Suggestions are temporarily unavailable.", { exact: true })).toBeVisible();
  await body.press("Escape");
  available = true;
  await body.press("Enter");
  await expect(page.getByText("No suggestions found.", { exact: true })).toBeVisible();
  await body.press("Escape");
  await body.press("Escape");
  await expect(body).toHaveValue("Existing text\n\n/template");
});
