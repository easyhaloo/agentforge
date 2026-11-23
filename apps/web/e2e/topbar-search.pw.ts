import { expect, test } from "@playwright/test";
import { demoOrganization, installApiMocks, labsOrganization } from "./support/api-mocks";
import { selectOption } from "./support/select-option";

const repository = "easyhaloo/agentforge";
const codePath = `/orgs/demo/repositories/${repository}`;
const issueTitle = "Update documentation";
const searchLabel = "Search or jump to";

test("opens by shortcut, restores focus, and jumps to a repository with the keyboard", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/orgs/org-demo/repositories");
  const trigger = page.getByRole("button", { name: searchLabel });
  const panel = page.getByRole("dialog", { name: searchLabel });
  const search = panel.getByRole("combobox", { name: searchLabel });

  await trigger.focus();
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await search.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await search.fill("easyhaloo/agentforge");
  const match = panel.getByRole("option", { name: repository });
  await expect(match).toBeVisible();
  await search.press("ArrowDown");
  await expect(match).toHaveAttribute("aria-selected", "true");
  await search.press("Enter");
  await expect(page).toHaveURL(`/orgs/org-demo/repositories/${repository}`);
});

test("searches scoped issues and keeps closed results after opening the result list and refreshing", async ({ page }) => {
  await installApiMocks(page);
  await page.goto(codePath);
  await page.getByRole("button", { name: searchLabel }).click();
  const panel = page.getByRole("dialog", { name: searchLabel });
  const search = panel.getByRole("combobox", { name: searchLabel });
  const workspace = panel.getByRole("option", { name: "Search in this workspace" });
  const issueRequest = (url: URL) => url.pathname === `/api/v1/organizations/${demoOrganization.id}/issues` && url.searchParams.get("q") === "documentation";
  await expect(search).toHaveValue(`repo:${repository} `);
  await expect(search).toBeFocused();
  await expect(panel.getByRole("option", { name: `repo:${repository} Search in this repository` })).toBeVisible();
  const scoped = page.waitForRequest(request => issueRequest(new URL(request.url())));
  await search.press("End");
  await search.pressSequentially("documentation");
  expect(new URL((await scoped).url()).searchParams.get("repository")).toBe(repository);
  await expect(panel.getByRole("option", { name: new RegExp(issueTitle) })).toBeVisible();

  const unscoped = page.waitForRequest(request => issueRequest(new URL(request.url())));
  await workspace.click();
  expect(new URL((await unscoped).url()).searchParams.has("repository")).toBe(false);
  await expect(search).toBeFocused();
  await panel.getByRole("option", { name: "View all matching issues" }).click();
  await expect(page).toHaveURL("/orgs/demo/issues?q=documentation&state=all");
  await page.reload();
  await expect(page.getByPlaceholder("Search issues...")).toHaveValue("documentation");
  await expect(page.getByRole("link", { name: issueTitle })).toBeVisible();

  await page.getByRole("button", { name: searchLabel }).click();
  await expect(panel.getByRole("group", { name: "Recent searches" }).getByRole("option", { name: "documentation" })).toBeVisible();
});

test("completes a repo qualifier, clears it, and opens a scoped result with Enter", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/orgs/demo/repositories");
  await page.getByRole("button", { name: searchLabel }).click();
  const panel = page.getByRole("dialog", { name: searchLabel });
  const search = panel.getByRole("combobox", { name: searchLabel });

  await search.fill("repo:easyhaloo/agent");
  await expect(panel.getByRole("option", { name: `repo:${repository} Use this repository` })).toBeVisible();
  await search.press("Enter");
  await expect(search).toHaveValue(`repo:${repository} `);
  const clear = panel.getByRole("button", { name: "Clear search" });
  const field = panel.locator(".command-palette__search");
  await expect(field).toHaveCSS("outline-style", "solid");
  await search.press("Tab");
  await expect(clear).toBeFocused();
  await expect(clear).toHaveCSS("outline-style", "solid");
  await expect(clear).toHaveCSS("width", "28px");
  await expect(clear).toHaveCSS("height", "28px");
  await expect(field).toHaveCSS("outline-style", "none");
  await clear.press("Space");
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(clear).toBeHidden();

  await search.fill("documentation");
  await clear.click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();

  await search.fill(`documentation repo:${repository}`);
  await expect(panel.getByRole("option", { name: new RegExp(issueTitle) })).toBeVisible();
  await search.press("Enter");
  await expect(page).toHaveURL(`${codePath}/issues/3`);
});

test("uses the workspace organization without offering a switch inside search", async ({ page }) => {
  await installApiMocks(page, { organizations: [demoOrganization, labsOrganization] });
  await page.addInitScript(() => localStorage.setItem('agentforge-search:["user-owner","org-demo"]', '["known query"]'));
  await page.route(`**/api/v1/organizations/${labsOrganization.id}/repositories`, route => route.fulfill({ json: { items: [] } }));
  await page.goto("/orgs/demo/repositories");
  const trigger = page.getByRole("button", { name: searchLabel });
  const panel = page.getByRole("dialog", { name: searchLabel });
  const search = panel.getByRole("combobox", { name: searchLabel });

  await trigger.click();
  await expect(panel.getByRole("combobox")).toHaveCount(1);
  await expect(panel.getByRole("option", { name: "known query" })).toBeVisible();
  await expect(panel.getByRole("option", { name: repository })).toBeVisible();
  await search.fill("documentation");
  await expect(panel.getByRole("option", { name: new RegExp(issueTitle) })).toBeVisible();
  await search.press("Escape");

  await selectOption(page, page.getByRole("combobox", { name: "Select organization" }), labsOrganization.name);
  await expect(page).toHaveURL("/orgs/labs/repositories");
  await trigger.click();
  await expect(panel.getByRole("combobox")).toHaveCount(1);
  await expect(panel.getByRole("option", { name: "known query" })).toHaveCount(0);
  const inaccessibleRequests: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/issues") && url.searchParams.get("q") === "inaccessible") inaccessibleRequests.push(url.href);
  });
  await page.clock.install();
  await search.fill(`repo:${repository} inaccessible`);
  await expect(panel.getByText("No accessible repository matches this qualifier.")).toBeVisible();
  await search.press("Enter");
  await page.clock.runFor(350);
  await expect(panel).toBeVisible();
  expect(inaccessibleRequests).toEqual([]);

  await search.fill(repository);
  await expect(panel.getByText("No matching pages, repositories or issues.")).toBeVisible();
  await search.fill("documentation");
  await expect(panel.getByText("No matching pages, repositories or issues.")).toBeVisible();
  await search.press("Enter");
  await expect(page).toHaveURL("/orgs/labs/changesets?q=documentation");
});

test("keeps the narrow panel in view and waits for IME composition before searching", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await installApiMocks(page);
  await page.goto(codePath);
  await page.getByRole("button", { name: searchLabel }).click();
  const panel = page.getByRole("dialog", { name: searchLabel });
  const search = panel.getByRole("combobox", { name: searchLabel });
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  await search.dispatchEvent("compositionstart");
  await search.fill("文档");
  await search.press("Enter");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("option", { name: "Search changesets" })).toHaveCount(0);
  await search.dispatchEvent("compositionend");
  await expect(panel.getByRole("option", { name: "Search changesets" })).toBeVisible();
});

test("retries failed issue previews and opens the issue directly", async ({ page }) => {
  await installApiMocks(page);
  await page.route(
    url => url.pathname === `/api/v1/organizations/${demoOrganization.id}/issues` && url.searchParams.get("q") === "documentation",
    route => route.fulfill({ status: 503, json: { title: "Unavailable" } }),
    { times: 1 },
  );
  await page.goto("/orgs/demo/repositories");
  await page.getByRole("button", { name: searchLabel }).click();
  const panel = page.getByRole("dialog", { name: searchLabel });
  const search = panel.getByRole("combobox", { name: searchLabel });
  await search.fill("documentation");
  await expect(panel.getByText("Issues could not be loaded.")).toBeVisible();
  await panel.getByRole("button", { name: "Retry" }).click();
  await expect(search).toBeFocused();
  await expect(panel.getByRole("option", { name: new RegExp(issueTitle) })).toBeVisible();
  await search.press("Enter");
  await expect(page).toHaveURL(`${codePath}/issues/3`);
  await expect(page.getByRole("heading", { name: new RegExp(issueTitle) })).toBeVisible();
});
