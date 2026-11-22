import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const origin = process.env.AGENTFORGE_TEST_ORIGIN;
test.use({ trace: "off", locale: "en-US", timezoneId: "UTC" });
test.skip(!origin, "Requires a running local stack with the API and database");

test("saved language and timezone apply on direct account navigation in a new browser", async ({ page, browser }) => {
  const base = new URL(origin!);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(base.hostname);
  const accountURL = new URL("/settings/account", base).href;
  const email = `settings-${randomUUID().slice(0, 8)}@example.test`;
  const password = randomUUID();
  await page.goto(new URL("/register", base).href);
  await page.locator('[name=email]').fill(email);
  await page.locator('[name=displayName]').fill("Account Preferences QA");
  await page.locator('[name=password]').fill(password);
  await page.locator('[name=confirmPassword]').fill(password);
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/orgs\/[^/]+\/changesets$/);

  await page.goto(new URL("/settings/appearance", base).href);
  await page.locator("#language").click();
  await page.getByRole("option", { name: "简体中文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.locator("#timezone").click();
  await page.getByRole("option", { name: /Asia\/Tokyo/ }).click();
  const saving = page.waitForResponse(response =>
    response.request().method() === "PATCH" && new URL(response.url()).pathname === "/api/v1/users/me/preferences"
  );
  await page.getByRole("main").locator('button[type=submit]').click();
  const saved = await saving;
  expect(saved.status()).toBe(200);
  expect(await saved.json()).toMatchObject({ language: "zh-CN", timezone: "Asia/Tokyo" });

  const fresh = await browser.newPage({ locale: "en-US", timezoneId: "UTC" });
  try {
    await fresh.goto(accountURL);
    await expect(fresh).toHaveURL(/\/login\?return=/);
    await expect(fresh.locator("html")).toHaveAttribute("lang", "en-US");
    await fresh.locator('[name=email]').fill(email);
    await fresh.locator('[name=password]').fill(password);
    await fresh.locator('button[type=submit]').click();
    await expect(fresh).toHaveURL(accountURL);

    const main = fresh.getByRole("main");
    await expect(main).toContainText(email);
    const time = main.locator("time");
    await expect.poll(() => time.evaluate(element => {
      const tokyoTime = new Date(element.getAttribute("datetime")!).toLocaleString(document.documentElement.lang, {
        dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo",
      });
      return element.textContent === tokyoTime;
    }), { message: "Account creation time should use Asia/Tokyo" }).toBe(true);
    await expect(fresh.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(main.getByRole("heading", { name: "账户", exact: true })).toBeVisible();

    await fresh.locator('aside a[href="/settings/appearance"]').click();
    await fresh.locator("#language").click();
    await fresh.getByRole("option", { name: "English" }).click();
    await expect(fresh.locator("html")).toHaveAttribute("lang", "en-US");
    await fresh.locator('aside a[href="/settings/account"]').click();
    await expect(fresh.locator("html")).toHaveAttribute("lang", "zh-CN");
  } finally {
    await fresh.close();
  }
});
