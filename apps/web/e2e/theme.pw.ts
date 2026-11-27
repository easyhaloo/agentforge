import { expect, test } from "@playwright/test";
import { installApiMocks } from "./support/api-mocks";
import { openNavigation } from "./support/navigation";

test("settings and shell render the saved palette, and Auto follows the system", async ({ page }) => {
  await installApiMocks(page);
  let theme = "light";
  await page.route("**/api/v1/users/me/preferences", route => {
    if (route.request().method() === "PATCH") theme = route.request().postDataJSON().theme;
    return route.fulfill({ json: { theme, language: "en-US", timezone: "UTC" } });
  });
  const body = page.locator("body");
  const sidebar = page.locator(".settings-sidebar");
  const light = "rgb(255, 255, 255)";
  const dark = "rgb(13, 17, 23)";
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/settings/account");
  await expect(body).toHaveCSS("background-color", light);
  await expect(sidebar).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.getByRole("link", { name: "Appearance" }).click();
  await page.locator('[name=theme][value=auto]').check();
  await expect(body).toHaveCSS("background-color", dark);
  await expect(sidebar).toHaveCSS("background-color", "rgb(13, 17, 23)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(body).toHaveCSS("background-color", light);
  await page.locator('[name=theme][value=dark]').check();
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(body).toHaveCSS("background-color", light);
  await page.getByRole("link", { name: "Appearance" }).click();
  await page.locator('[name=theme][value=dark]').check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => theme).toBe("dark");
  await page.reload();
  await expect(body).toHaveCSS("background-color", dark);
  await expect(page.locator('[name=theme][value=dark]')).toBeChecked();
  await page.locator('[name=theme][value=light]').check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => theme).toBe("light");
  await page.emulateMedia({ colorScheme: "dark" });
  // A shell route can be interactive before its account request resolves.
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/me", async route => { await pending; await route.fallback(); });
  await page.goto("/projects");
  await page.getByRole("button", { name: "Search or jump to" }).click();
  const search = page.getByRole("combobox", { name: "Search or jump to" });
  await search.fill("changes");
  release();
  await expect(page.locator(".topbar")).toHaveCSS("background-color", "rgb(246, 248, 250)");
  await expect(search).toHaveValue("changes");
  await page.keyboard.press("Escape");
  await page.locator(".user-menu-trigger").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(body).toHaveCSS("background-color", dark);
});

test("the account language is saved through Appearance and applied across the workspace", async ({ page }) => {
  await installApiMocks(page);
  let language = "en-US";
  await page.route("**/api/v1/users/me/preferences", route => {
    if (route.request().method() === "PATCH") language = route.request().postDataJSON().language;
    return route.fulfill({ json: { theme: "auto", language, timezone: "UTC" } });
  });
  await page.goto("/orgs/demo/repositories");
  const header = page.getByRole("banner");
  await expect(header.getByTitle("Switch language")).toHaveCount(0);
  await openNavigation(page);
  const drawer = page.getByRole("dialog", { name: "Global navigation" });
  await expect(drawer.getByTitle("Switch language")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await header.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("dialog", { name: "User menu" }).getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: "Appearance", exact: true }).click();
  await page.getByRole("combobox", { name: "Language" }).click();
  await page.getByRole("option", { name: "简体中文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  expect(language).toBe("en-US");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => language).toBe("zh-CN");

  await page.evaluate(() => localStorage.removeItem("agentforge-language"));
  await page.goto("/orgs/demo/repositories");
  await expect(header.getByRole("link", { name: "全部仓库" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});
