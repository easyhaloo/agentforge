import { expect, test } from "@playwright/test";
import { installApiMocks } from "./support/api-mocks";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await installApiMocks(page);
});

test("the organization has its own repositories page", async ({ page }) => {
  await page.goto("/orgs/demo/repositories");

  await expect(page.getByRole("heading", { name: "Repositories", exact: true })).toBeVisible();
  await expect(page.getByRole("cell").getByText("easyhaloo/agentforge")).toBeVisible();
});

test("an owner registers a repository on that page", async ({ page }) => {
  await page.goto("/orgs/demo/repositories");
  await page.getByLabel("Repository slug").fill("team/new-repository");
  const sent = page.waitForRequest((request) => request.url().endsWith("/api/v1/organizations/org-demo/repositories") && request.method() === "POST");

  await page.getByRole("button", { name: "Register" }).click();

  expect((await sent).postDataJSON()).toEqual({ slug: "team/new-repository", default_branch: "main" });
  await expect(page.getByRole("cell").getByText("team/new-repository")).toBeVisible();
});

test("the flat repositories page is gone", async ({ page }) => {
  await page.goto("/repositories");

  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});


test("repository preview browses a pinned commit and compares history", async ({ page }) => {
  await page.goto("/orgs/demo/repositories");
  await page.getByRole("cell").getByText("easyhaloo/agentforge").click();
  await expect(page.getByText(/Pinned commit:/)).toContainText("aaaaaaaaaaaa");
  await expect(page.getByRole("button", { name: "README.md" })).toBeVisible();
  await page.getByRole("button", { name: "Compare to current" }).click();
  await expect(page.getByRole("heading", { name: "Commit comparison" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "README.md → README.md" })).toBeVisible();
  await expect(page.getByText("+after", { exact: true })).toBeVisible();
});


test("a commit-pinned file permalink opens directly", async ({ page }) => {
  await page.goto("/orgs/demo/repositories?repository=easyhaloo%2Fagentforge&commit=" + "a".repeat(40) + "&path=README.md");
  await expect(page.getByRole("heading", { name: "Repository preview" })).toBeVisible();
  await expect(page.getByText(/Pinned commit:/)).toContainText("aaaaaaaaaaaa");
  await expect(page.getByRole("button", { name: "Copy permalink" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Hello" })).toBeVisible();
});

test("WebIDE guides an empty organization to its own repositories", async ({ page }) => {
  await page.route("**/api/v1/organizations/org-demo/repositories", route => route.fulfill({ json: { items: [] } }));
  await page.goto("/orgs/demo/webide");
  await expect(page.getByText("No repositories registered yet.")).toBeVisible();
  await page.getByRole("link", { name: "Go to repositories" }).click();
  await expect(page).toHaveURL(/\/orgs\/demo\/repositories$/);
});


test("repository browsing does not load Monaco or its workers", async ({ page }) => {
  const monacoRequests: string[] = [];
  page.on("request", request => {
    const url = request.url();
    if (/MonacoEditorAdapter|monacoWorkers|monaco-editor|editor\.worker|ts\.worker/.test(url)) {
      monacoRequests.push(url);
    }
  });

  await page.goto("/orgs/demo/repositories");
  await page.getByRole("cell").getByText("easyhaloo/agentforge").click();
  await expect(page.getByRole("heading", { name: "Repository preview" })).toBeVisible();
  await expect.poll(() => monacoRequests).toEqual([]);
  const loadedResources = await page.evaluate(() => performance.getEntriesByType("resource").map(entry => entry.name));
  expect(loadedResources.filter(url => /MonacoEditorAdapter|monaco-editor|editor\.worker|ts\.worker/i.test(url))).toEqual([]);
});
