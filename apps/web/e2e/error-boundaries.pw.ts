import { expect, test, type Page } from "@playwright/test";
import { navigationToggle } from "./support/navigation";
import { installApiMocks } from "./support/api-mocks";

// These tests use e2e-error-harness.html: the real route table plus a route that throws while rendering.
const harness = (scenario: "page" | "app") => `/e2e-error-harness.html?scenario=${scenario}`;
const visibleText = (page: Page) => page.locator("body").innerText();
const errorLog = (page: Page) => {
  const entries: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") entries.push(message.text()); });
  return entries;
};

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test("a page that fails to render leaves the shell in place with a friendly message and no error details", async ({ page }) => {
  const logged = errorLog(page);
  await page.goto(harness("page"));

  await expect(navigationToggle(page)).toBeVisible();
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  const text = await visibleText(page);
  expect(text).not.toContain("KABOOM");
  expect(text).not.toContain("Explode");
  expect(text).not.toContain("Unexpected Application Error");
  expect(logged.some((entry) => entry.includes("AgentForge route error") && entry.includes("KABOOM"))).toBe(true);

  await page.getByRole("link", { name: "Go to Overview" }).click();
  await expect(page.getByRole("main").locator(".page-heading h1")).toHaveText("Overview");
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
});

test("an error thrown by the root layout itself falls back to a minimal page with a way to reload", async ({ page }) => {
  const logged = errorLog(page);
  await page.goto(harness("app"));

  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  await expect(navigationToggle(page)).toHaveCount(0);
  const text = await visibleText(page);
  expect(text).not.toContain("KABOOM");
  expect(text).not.toContain("Explode");
  expect(text).not.toContain("Unexpected Application Error");
  expect(logged.some((entry) => entry.includes("AgentForge route error") && entry.includes("KABOOM"))).toBe(true);
  await expect(page.getByRole("link", { name: "Reload AgentForge" })).toHaveAttribute("href", "/");
});
