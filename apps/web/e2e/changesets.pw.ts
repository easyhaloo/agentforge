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
