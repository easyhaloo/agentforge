import { generateKeyPairSync, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// This test creates its own account and exercises the same-origin API and database.
const origin = process.env.AGENTFORGE_TEST_ORIGIN;
test.use({ trace: "off", locale: "zh-CN", viewport: { width: 1440, height: 1000 } });
test.skip(!origin, "Requires a running local make dev stack");

test("personal settings load real account data and persist edits", async ({ page, browser }, testInfo) => {
  const base = new URL(origin!);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(base.hostname);
  const email = `settings-${randomUUID().slice(0, 8)}@example.test`;
  const password = randomUUID();
  await page.goto(`${base.origin}/register`);
  await page.locator('[name=email]').fill(email);
  await page.locator('[name=displayName]').fill("Settings QA");
  await page.locator('[name=password]').fill(password);
  await page.locator('[name=confirmPassword]').fill(password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/orgs\/[^/]+\/changesets$/);

  const main = page.getByRole("main");
  const visit = (section: string) => page.locator(`aside a[href="/settings/${section}"]`).click();
  const screenshot = async (section: string) => {
    await page.screenshot({ path: testInfo.outputPath(`${section}.png`), animations: "disabled", fullPage: true });
  };
  const recordSettingsPage = async (section: string) => {
    await expect(page.locator(`aside a[href="/settings/${section}"]`)).toHaveAttribute("aria-current", "page");
    await screenshot(section);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), section).toBeLessThanOrEqual(390);
    await screenshot(`${section}-mobile`);
    await page.setViewportSize({ width: 1440, height: 1000 });
  };
  const save = async (endpoint: string, method = "PATCH", expected = 200, reload = true) => {
    const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/users/me/${endpoint}` && r.request().method() === method);
    await main.locator('button[type=submit]').click();
    expect((await response).status()).toBe(expected);
    if (reload) await page.reload();
  };

  await page.locator(".user-menu-trigger").click();
  await page.getByRole("dialog").getByRole("link", { name: /^(Settings|设置)$/ }).click();
  await expect(page.locator('[name=display_name]')).toHaveValue("Settings QA");
  const sidebar = page.getByRole("complementary");
  await expect(sidebar.getByRole("link").first()).toHaveAttribute("href", "/settings/profile");
  await expect(sidebar).not.toContainText("Settings QA");
  await expect(sidebar).not.toContainText(email);
  await page.locator('[name=bio]').fill("Settings regression");
  await page.locator('[name=location]').fill("Shanghai");
  await page.locator('[name=display_name]').fill("Updated QA");
  await save("profile", "PATCH", 200, false);
  await page.locator(".user-menu-trigger").click();
  await expect(page.locator(".user-menu-header__name")).toHaveText("Updated QA");
  await screenshot("profile-menu");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator('[name=bio]')).toHaveValue("Settings regression");
  await expect(page.locator('[name=location]')).toHaveValue("Shanghai");
  const picture = main.locator("figure");
  const form = main.locator("form");
  expect((await picture.boundingBox())!.x).toBeGreaterThan((await form.boundingBox())!.x + (await form.boundingBox())!.width);
  await screenshot("profile");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect((await picture.boundingBox())!.y).toBeLessThan((await form.boundingBox())!.y);
  await screenshot("profile-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await visit("account");
  await expect(main).toContainText(email);
  await recordSettingsPage("account");
  await main.getByRole("link", { name: /编辑公开资料|Edit public profile/ }).click();
  await expect(main.locator('[name=display_name]')).toHaveValue("Updated QA");

  await visit("appearance");
  const light = page.locator('[name=theme][value=light]');
  const dark = page.locator('[name=theme][value=dark]');
  const background = () => main.evaluate(el => getComputedStyle(el.closest(".settings-layout")!).backgroundColor);
  await dark.check();
  const darkBackground = await background();
  await screenshot("appearance-dark");
  await light.check();
  await expect.poll(background).not.toBe(darkBackground);
  await page.locator("#language").click();
  await page.getByRole("option", { name: "简体中文" }).click();
  await save("preferences");
  await expect(light).toBeChecked();
  await expect(page.locator("#language")).toContainText("简体中文");
  await recordSettingsPage("appearance");

  await visit("notifications");
  await page.reload();
  await expect.poll(background).not.toBe(darkBackground);
  const participating = page.locator("#inbox_participating");
  await expect(participating).toBeChecked();
  await participating.click();
  await expect(participating).not.toBeChecked();
  await page.reload();
  await expect(participating).toBeVisible();
  await expect(participating).not.toBeChecked();
  await expect(page.locator("#inbox_watching")).toBeChecked();
  await recordSettingsPage("notifications");
  await visit("agents");
  const concise = page.locator('[name=output_verbosity][value=concise]');
  await concise.check();
  await save("agent-preferences");
  await expect(concise).toBeChecked();
  await screenshot("agents");

  await visit("authentication");
  await expect(main).toContainText(email);
  const newPassword = randomUUID();
  await main.getByRole("button", { name: /更改密码|Change password/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('[name=current-password]').fill(password);
  await dialog.locator('[name=new-password]').fill(newPassword);
  await dialog.locator('[name=confirm-password]').fill(newPassword);
  const changed = page.waitForResponse(r => new URL(r.url()).pathname === "/api/v1/me/password");
  await dialog.getByRole("button", { name: /更改密码|Change password/i }).click();
  expect((await changed).status()).toBe(204);
  await expect(main.getByRole("status")).toBeVisible();
  await recordSettingsPage("authentication");
  const other = await browser.newContext();
  try {
    const logIn = await other.newPage();
    await logIn.goto(`${base.origin}/login`);
    await logIn.locator('[name=email]').fill(email);
    await logIn.locator('[name=password]').fill(newPassword);
    await logIn.locator('button[type=submit]').click();
    await logIn.waitForURL(/\/orgs\/[^/]+\/changesets$/);
    await visit("sessions");
    const revoke = /撤销会话|Revoke session/i;
    await main.getByRole("button", { name: revoke, exact: true }).click();
    await dialog.getByRole("button", { name: revoke, exact: true }).click();
    await expect(main.getByRole("button", { name: revoke, exact: true })).toHaveCount(0);
    await expect.poll(() => logIn.evaluate(async () => (await fetch("/api/v1/me")).status)).toBe(401);
  } finally {
    await other.close();
  }
  await expect(main.getByRole("heading", { name: /Current session|当前会话/i })).toBeVisible();
  await recordSettingsPage("sessions");
  await visit("keys");
  await main.getByRole("button", { name: /Add (?:SSH )?key|添加 SSH 密钥/i }).click();
  // Generate a fresh OpenSSH Ed25519 public key for the globally unique fingerprint.
  const { publicKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  const record = Buffer.concat([Buffer.from("\0\0\0\x0bssh-ed25519\0\0\0\x20", "binary"), raw]);
  await main.locator('[name=title]').fill("Browser QA");
  await main.locator('[name=public_key]').fill(`ssh-ed25519 ${record.toString("base64")}`);
  await save("ssh-keys", "POST", 201);
  await expect(main.getByText("Browser QA", { exact: true })).toBeVisible();
  await recordSettingsPage("keys");

  // An unavailable list must show an error, then recover on manual retry.
  const keysURL = "**/api/v1/users/me/ssh-keys";
  await page.route(keysURL, route => route.fulfill({ status: 503 }));
  await page.reload();
  await expect(main.getByRole("alert")).toBeVisible();
  await expect(main).not.toContainText(/No SSH keys yet|暂无 SSH 密钥/i);
  await screenshot("keys-unavailable");
  await page.unroute(keysURL);
  await main.getByRole("button", { name: /重试|Retry/i }).click();
  await expect(main.getByText("Browser QA", { exact: true })).toBeVisible();
  const deleteKey = /删除密钥|Delete key/i;
  await main.getByRole("button", { name: deleteKey }).click();
  await dialog.getByRole("button", { name: deleteKey }).click();
  await expect(main.getByText("Browser QA", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(main.getByText(/暂无 SSH 密钥|尚无 SSH 密钥|没有 SSH 密钥|No SSH keys/i).first()).toBeVisible();
  await expect(page.getByText("当前组织", { exact: true })).toBeVisible();
  await expect(page.getByText("Updated QA · 个人工作区", { exact: true })).toBeVisible();
  await screenshot("keys-deleted");
  // The settings sidebar now also carries an "Organizations" entry, so the
  // organization link in the context block must be scoped to avoid ambiguity.
  await page.getByRole("link", { name: /^(Organization|组织)$/ }).first().click();
  await expect(page).toHaveURL(/\/orgs\/[^/]+\/settings$/);
});
