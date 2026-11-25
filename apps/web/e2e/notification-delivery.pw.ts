import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const origin = process.env.AGENTFORGE_TEST_ORIGIN;
const psql = process.env.AGENTFORGE_TEST_PSQL;
const mailbox = process.env.AGENTFORGE_TEST_MAILBOX;
test.skip(!origin || !psql || !mailbox, "Requires the real API, PostgreSQL and an isolated SES receiver");
test.use({ trace: "off", viewport: { width: 1440, height: 1000 } });

async function register(page: Page, name: string) {
  const password = randomUUID();
  await page.goto(`${origin}/register`);
  await page.locator('[name=email]').fill(`${randomUUID()}@example.test`);
  await page.locator('[name=displayName]').fill(name);
  await page.locator('[name=password]').fill(password);
  await page.locator('[name=confirmPassword]').fill(password);
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/orgs\/(?!current\/)[^/]+\/changesets$/);
  return page.evaluate(async () => (await fetch("/api/v1/me")).json() as Promise<{ user_id: string; organizations: { id: string }[] }>);
}

test("verify a notification email and configure repository delivery for issue activity", async ({ page, browser }, testInfo) => {
  test.setTimeout(75_000);
  const recipientContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "en-US" });
  try {
    const recipient = await recipientContext.newPage();
    const [owner, member] = [await register(page, "Delivery QA"), await register(recipient, "Notification Recipient")];
    const organizationID = owner.organizations[0].id;
    expect(organizationID).toMatch(/^[a-f0-9]{32}$/);
    expect(member.user_id).toMatch(/^[a-f0-9]{32}$/);
    const username = execFileSync(psql!, ["-XqAt", "-v", "ON_ERROR_STOP=1"], {
      input: `INSERT INTO organization_memberships (organization_id,user_id,role,status) VALUES ('${organizationID}','${member.user_id}','member','active');
        SELECT username FROM users WHERE id='${member.user_id}';`, encoding: "utf8",
    }).trim();
    expect(username).toMatch(/^member-\d+$/);

    const address = `notifications-${randomUUID().slice(0, 8)}@example.test`;
    const messages = async () => {
      const response = await fetch(`${mailbox}/${encodeURIComponent(address)}`);
      expect(response.ok).toBe(true);
      return await response.json() as { subject: string; body: string }[];
    };
    await recipient.goto(`${origin}/settings/notifications`);
    const participating = recipient.getByRole("checkbox", { name: "Email for participating activity" });
    const watching = recipient.getByRole("checkbox", { name: "Email for watched repository activity" });
    await expect(participating).toBeDisabled();
    await recipient.getByLabel("Email address").fill(address);
    const sendCode = recipient.getByRole("button", { name: "Send verification code" });
    const verifyEmail = recipient.getByRole("button", { name: "Verify email" });
    await expect(sendCode).toHaveClass(/\baf-button--primary\b/);
    await sendCode.click();
    await expect(verifyEmail).toHaveClass(/\baf-button--primary\b/);
    await expect(sendCode).toHaveClass(/\baf-button--secondary\b/);
    await recipient.mouse.move(0, 0);
    const primaryBackground = await verifyEmail.evaluate(button => getComputedStyle(button).backgroundColor);
    await expect(sendCode).not.toHaveCSS("background-color", primaryBackground);
    await recipient.screenshot({ path: testInfo.outputPath("notification-email-pending.png"), fullPage: true, animations: "disabled" });
    await recipient.setViewportSize({ width: 390, height: 844 });
    expect(await recipient.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await recipient.screenshot({ path: testInfo.outputPath("notification-email-pending-mobile.png"), fullPage: true, animations: "disabled" });
    await recipient.setViewportSize({ width: 1440, height: 1000 });
    await expect.poll(messages).toHaveLength(1);
    const [{ body }] = await messages();
    const code = body.match(/[a-f0-9]{48}/)?.[0];
    expect(code).toBeDefined();
    await recipient.getByLabel("Verification code").fill("0".repeat(48));
    await verifyEmail.click();
    await expect(recipient.getByRole("alert").filter({ hasText: "The code is invalid or expired." })).toBeVisible();
    await recipient.getByLabel("Verification code").fill(code!);
    await verifyEmail.click();
    await expect(recipient.getByText(`Verified address: ${address}`)).toBeVisible();
    await participating.click();
    await expect(participating).toBeChecked();
    await watching.click();
    await expect(watching).toBeChecked();
    await recipient.reload();
    await expect(participating).toBeChecked();
    await expect(watching).toBeChecked();
    await recipient.screenshot({ path: testInfo.outputPath("notification-email.png"), fullPage: true, animations: "disabled" });
    await recipient.setViewportSize({ width: 390, height: 844 });
    expect(await recipient.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await recipient.screenshot({ path: testInfo.outputPath("notification-email-mobile.png"), fullPage: true, animations: "disabled" });
    await recipient.setViewportSize({ width: 1440, height: 1000 });

    const orgPath = new URL(page.url()).pathname.replace(/\/changesets$/, "");
    await page.goto(`${origin}${orgPath}/repositories/new`);
    await page.getByLabel("Repository name", { exact: true }).fill("delivery-check");
    await page.getByRole("button", { name: "New repository", exact: true }).click();
    await expect(page).toHaveURL(/\/repositories\/[^/]+\/delivery-check$/);
    const repository = page.url();
    await recipient.goto(repository);
    await recipient.getByRole("button", { name: "Watch Issues", exact: true }).click();
    await expect(recipient.getByRole("button", { name: "Unwatch Issues", exact: true })).toBeEnabled();

    await page.getByRole("link", { name: "Settings", exact: true }).last().click();
    await page.getByRole("link", { name: "Webhooks", exact: true }).click();
    await expect(page).toHaveURL(`${repository}/settings/webhooks`);
    const webhooks = page.getByRole("region", { name: "Webhooks" });
    await webhooks.getByRole("button", { name: "Add webhook" }).click();
    await expect(webhooks.getByLabel("Payload URL")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("repository-webhook-form.png"), fullPage: true, animations: "disabled" });
    const endpoint = "https://receiver.example.invalid/agentforge";
    await webhooks.getByLabel("Payload URL").fill(endpoint);
    await webhooks.getByLabel("Signing secret").fill(randomBytes(24).toString("hex"));
    await webhooks.getByRole("checkbox", { name: "Issue comment created" }).check();
    await webhooks.getByRole("button", { name: "Save", exact: true }).click();
    await expect(webhooks.getByText(endpoint)).toBeVisible();
    await page.reload();
    await expect(webhooks.getByText(endpoint)).toBeVisible();
    await recipient.goto(`${repository}/settings`);
    await expect(recipient.getByRole("link", { name: "Webhooks", exact: true })).toHaveCount(0);
    await recipient.goto(`${repository}/settings/webhooks`);
    await expect(recipient.getByRole("alert")).toHaveText("Only organization owners and administrators can manage repository settings.");
    await expect(recipient.getByRole("button", { name: "Add webhook" })).toHaveCount(0);

    await page.goto(`${repository}/issues/new`);
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Check notification delivery");
    await page.getByRole("textbox", { name: "Description", exact: true }).fill(`Please check @${username}.`);
    await page.getByRole("button", { name: "New issue" }).click();
    await expect(page).toHaveURL(`${repository}/issues/1`);
    await page.getByRole("textbox", { name: "Comment text" }).fill("Comment for the delivery check.");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByRole("article").filter({ hasText: "Comment for the delivery check." })).toBeVisible();
    await expect.poll(async () => (await messages()).slice(1).map(message => message.subject.split(":")[0]).sort()).toEqual(["New comment", "New issue"]);
    for (const message of (await messages()).slice(1)) expect(message.body).toBe(`${repository}/issues/1`);

    await page.goto(`${repository}/settings/webhooks`);
    await webhooks.getByRole("button", { name: "Recent deliveries" }).click();
    // The browser exercise verifies failed delivery with a reserved receiver name. The Go integration
    // test separately asserts that a TLS receiver gets both signed events and their HTTP result.
    await expect.poll(async () => {
      const refresh = webhooks.getByRole("button", { name: "Refresh deliveries" });
      await refresh.click();
      await expect(refresh).toBeEnabled();
      return webhooks.getByText(/ · Failed/).count();
    }).toBe(2);
    await page.screenshot({ path: testInfo.outputPath("repository-webhooks.png"), fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath("repository-webhooks-mobile.png"), fullPage: true, animations: "disabled" });
    await webhooks.getByRole("button", { name: "Edit webhook" }).click();
    await expect(webhooks.getByLabel("Signing secret")).toHaveValue("");
    await webhooks.getByRole("checkbox", { name: "Active", exact: true }).uncheck();
    await webhooks.getByRole("button", { name: "Save", exact: true }).click();
    await expect(webhooks.getByText(/^Inactive/)).toBeVisible();
    const deleteWebhook = webhooks.getByRole("button", { name: "Delete", exact: true });
    const confirmation = page.getByRole("dialog", { name: "Delete webhook" });
    const confirmDelete = confirmation.getByRole("button", { name: "Delete webhook", exact: true });
    await expect(deleteWebhook).toHaveClass(/\baf-button--danger\b/);
    await deleteWebhook.press("Enter");
    await expect(confirmation.getByRole("button", { name: "Close dialog" })).toBeFocused();
    await expect(confirmDelete).toHaveClass(/\baf-button--danger\b/);
    await expect(confirmation.getByText("Delete this webhook and its delivery history?")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("webhook-delete-mobile.png"), animations: "disabled" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: testInfo.outputPath("webhook-delete.png"), animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(confirmation).toBeHidden();
    await expect(deleteWebhook).toBeFocused();
    await deleteWebhook.click();
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation).toBeHidden();
    await expect(webhooks.getByText(endpoint)).toBeVisible();
    await deleteWebhook.click();
    await confirmDelete.click();
    await expect(webhooks.getByText("No webhooks configured.")).toBeVisible();
    await expect(webhooks.getByRole("button", { name: "Add webhook" })).toBeFocused();
  } finally {
    await recipientContext.close();
  }
});
