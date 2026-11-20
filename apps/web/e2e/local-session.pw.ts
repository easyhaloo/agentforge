import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Point at a disposable local make dev stack. Registration creates a user and organization.
const origin = process.env.AGENTFORGE_TEST_ORIGIN;
test.skip(!origin, "Requires a running local API and PostgreSQL");

test("local session returns to its repository, reads organization data and signs out", async ({ page }, testInfo) => {
  const base = new URL(origin!);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(base.hostname);
  const email = `${randomUUID()}@example.test`;
  const password = randomUUID();
  await page.goto(`${base.origin}/register`);
  await page.locator('[name=email]').fill(email);
  await page.locator('[name=displayName]').fill("Session QA");
  await page.locator('[name=password]').fill(password);
  await page.locator('[name=confirmPassword]').fill(password);
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/orgs\/(?!current\/)[^/]+\/changesets$/);
  await page.context().clearCookies();

  await page.goto(`${base.origin}/orgs/current/repositories?tab=list#catalog`);
  await expect(page.getByRole("heading", { name: "Sign in to view repositories" })).toBeVisible();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await page.locator('[name=email]').fill(email);
  await page.locator('[name=password]').fill(password);
  const repos = page.waitForResponse(r => r.url().includes('/api/v1/organizations/') && new URL(r.url()).pathname.endsWith('/repositories'));
  await page.locator('button[type=submit]').click();
  expect((await repos).status()).toBe(200);
  await expect(page).toHaveURL(/\/orgs\/(?!current\/)[^/]+\/repositories\?tab=list#catalog$/);
  const org = new URL(page.url()).pathname.split('/')[2];
  const status = (path: string, method = "GET") => page.evaluate(async ({ path, method }) =>
    (await fetch(`/api/v1/${path}`, { method })).status, { path, method });
  expect(await status(`organizations/${org}/changesets`)).toBe(200);
  expect(await status(`organizations/${randomUUID()}/repositories`)).toBe(401);
  expect(await status("auth/logout", "POST")).toBe(403);
  const workbenchRequests = [
    "/api/v1/me",
    `/api/v1/organizations/${org}/repositories`,
    `/api/v1/organizations/${org}/changesets?status=in_review&reviewer=me&limit=5&offset=0`,
    `/api/v1/organizations/${org}/pipelines`,
  ].map(endpoint => page.waitForResponse(response => response.url().endsWith(endpoint)));
  await page.goto(base.origin);
  for (const response of await Promise.all(workbenchRequests)) expect(response.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("region", { name: "Pipelines" }).getByRole("link", { name: "All pipelines" }).click();
  await page.locator(".heading-actions").getByRole("button", { name: "Create", exact: true }).click();
  const created = page.waitForResponse(response => response.url().endsWith(`/organizations/${org}/pipelines`) && response.request().method() === "POST");
  await page.getByRole("dialog", { name: "Create pipeline" }).getByRole("button", { name: "Create", exact: true }).click();
  const pipelineResponse = await created;
  expect(pipelineResponse.status()).toBe(201);
  const pipeline = await pipelineResponse.json();
  await expect(page).toHaveURL(new RegExp(`/pipelines/${pipeline.id}/edit$`));
  await page.goto(base.origin);
  await expect(page.getByRole("region", { name: "Pipelines" }).getByRole("link", { name: pipeline.name })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("workbench-real-api.png"), animations: "disabled" });

  const oldSession = await page.context().storageState();
  await page.getByRole('button', { name: /Session QA/ }).click();
  const logout = page.waitForResponse(r => r.url().endsWith('/api/v1/auth/logout'));
  await page.getByRole('button', { name: /Sign out|退出登录/i }).click();
  expect((await logout).status()).toBe(204);
  await page.reload();
  expect(await status("me")).toBe(401);
  // Revocation must also hold for a client retaining the original cookies.
  await page.context().addCookies(oldSession.cookies);
  expect(await status("me")).toBe(401);
});
