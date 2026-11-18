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
  await expect(page.getByText(/diff --git a\/README.md/)).toBeVisible();
});


test("a commit-pinned file permalink opens directly", async ({ page }) => {
  await page.goto("/orgs/demo/repositories?repository=easyhaloo%2Fagentforge&commit=" + "a".repeat(40) + "&path=README.md");
  await expect(page.getByRole("heading", { name: "Repository preview" })).toBeVisible();
  await expect(page.getByText(/Pinned commit:/)).toContainText("aaaaaaaaaaaa");
  await expect(page.getByRole("button", { name: "Copy permalink" })).toBeEnabled();
  await expect(page.getByText("# Hello")).toBeVisible();
});
