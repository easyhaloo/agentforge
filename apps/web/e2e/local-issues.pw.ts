import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";

const origin = process.env.AGENTFORGE_TEST_ORIGIN;
const gitRoot = process.env.GIT_REPOSITORY_ROOT ?? join(process.env.RUN_DIR ?? "/tmp/agentforge-dev", "git");
test.skip(!origin, "Requires a local API, PostgreSQL, and the dev stack Git root");

test("creates and closes a repository issue and preserves its state after reload", async ({ page }, testInfo) => {
  const base = new URL(origin!);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(base.hostname);
  const password = randomUUID();
  await page.goto(`${base.origin}/register`);
  await page.locator('[name=email]').fill(`issues-${randomUUID()}@example.test`);
  await page.locator('[name=displayName]').fill("Issues QA");
  await page.locator('[name=password]').fill(password);
  await page.locator('[name=confirmPassword]').fill(password);
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/orgs\/(?!current\/)[^/]+\/changesets$/);
  const organizationPath = new URL(page.url()).pathname.replace(/\/changesets$/, "");
  // Use Chromium's same-origin session cookies, as the app does.
  const me = await page.evaluate(async () => {
    const response = await fetch("/api/v1/me", { credentials: "include" });
    return {
      status: response.status,
      account: await response.json() as { organizations: Array<{ id: string }> },
    };
  });
  expect(me.status).toBe(200);
  const { organizations } = me.account;
  expect(organizations).toHaveLength(1);
  const orgID = organizations[0].id;
  expect(orgID).toMatch(/^[a-zA-Z0-9_-]+$/);

  // The registration API verifies a real default branch under the tenant's configured Git root.
  const ownerDir = join(gitRoot, orgID, "issues-qa");
  mkdirSync(ownerDir, { recursive: true });
  const gitDir = mkdtempSync(join(ownerDir, "repo-"));
  const repository = `issues-qa/${basename(gitDir)}`;
  try {
    const git = (...args: string[]) => execFileSync("git", ["-C", gitDir, ...args], {
      env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });
    git("init", "--quiet", "--initial-branch=main", "--template=");
    writeFileSync(join(gitDir, "README.md"), "# Issues QA\n");
    git("add", "README.md");
    git("-c", "user.name=Issues QA", "-c", "user.email=issues@example.test", "commit", "--quiet", "-m", "Seed repository");

    const repositoriesAPI = `/api/v1/organizations/${orgID}/repositories`;
    const issuesAPI = `/api/v1/organizations/${orgID}/issues`;
    const issuesPath = `${organizationPath}/repositories/${repository}/issues`;
    const apiResponse = (path: string, method: string) => page.waitForResponse(response =>
      new URL(response.url()).pathname === path && response.request().method() === method,
    );

    await page.goto(`${base.origin}${organizationPath}/repositories`);
    await page.getByRole("button", { name: "Register repository" }).click();
    const register = page.getByRole("dialog", { name: "Register repository" });
    await register.getByLabel("Repository slug").fill(repository);
    const registered = apiResponse(repositoriesAPI, "POST");
    await register.getByRole("button", { name: "Register", exact: true }).click();
    expect((await registered).status()).toBe(201);
    await page.getByRole("link", { name: repository, exact: true }).click();
    await expect(page).toHaveURL(`${base.origin}${organizationPath}/repositories/${repository}`);
    await page.getByRole("link", { name: "Issues", exact: true }).click();
    await expect(page).toHaveURL(`${base.origin}${issuesPath}`);
    await expect(page.getByText("No issues found matching your filters.")).toBeVisible();

    const title = "Preserve issue state after reload";
    const description = "Verify this issue is stored by the real API.";
    await page.getByRole("button", { name: "New issue", exact: true }).click();
    const create = page.getByRole("dialog", { name: "Create issue" });
    await create.getByLabel("Title").fill(title);
    await create.getByLabel("Description").fill(description);
    const created = apiResponse(issuesAPI, "POST");
    await create.getByRole("button", { name: "Create issue", exact: true }).click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(201);
    const issue = await createdResponse.json() as { number: number; repository: string; state: string };
    expect(issue).toMatchObject({ number: 1, repository, state: "open" });
    const detailAPI = `${issuesAPI}/${issue.number}`;
    await expect(page).toHaveURL(`${base.origin}${issuesPath}/${issue.number}`);
    await expect(page.getByRole("heading", { name: new RegExp(title) })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Issue", exact: true })).toHaveCount(0);
    await expect(page.getByText(description, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Close issue", exact: true }).click();
    const closed = apiResponse(`${detailAPI}/close`, "POST");
    await page.getByRole("dialog", { name: "Close issue" }).getByRole("button", { name: "Close issue", exact: true }).click();
    const closedResponse = await closed;
    expect(closedResponse.status()).toBe(200);
    expect(closedResponse.request().postDataJSON()).toEqual({ reason: "completed" });
    const reopen = page.getByRole("button", { name: "Reopen issue", exact: true });
    await expect(reopen).toBeVisible();

    const reloaded = apiResponse(detailAPI, "GET");
    await page.reload();
    const reloadedResponse = await reloaded;
    expect(reloadedResponse.status()).toBe(200);
    expect(await reloadedResponse.json()).toMatchObject({ number: issue.number, title, state: "closed", state_reason: "completed" });
    await expect(reopen).toBeVisible();
    const closedScreenshot = testInfo.outputPath("issue-closed-real-api.png");
    await page.screenshot({ path: closedScreenshot, animations: "disabled", fullPage: true });
    await testInfo.attach("Closed issue after reload", { path: closedScreenshot, contentType: "image/png" });

    await page.getByRole("link", { name: "Back to issues", exact: true }).click();
    await expect(page).toHaveURL(`${base.origin}${issuesPath}`);
    await expect(page.getByText("No issues found matching your filters.")).toBeVisible();
    await page.getByRole("button", { name: /^Closed issues\b/i }).click();
    const closedIssue = page.getByRole("link", { name: title, exact: true });
    await expect(closedIssue).toBeVisible();
    await expect(closedIssue).toHaveAttribute("href", `${issuesPath}/${issue.number}`);
    const closedListScreenshot = testInfo.outputPath("issues-closed-list-real-api.png");
    await page.screenshot({ path: closedListScreenshot, animations: "disabled" });
    await testInfo.attach("Issue in the Closed list", { path: closedListScreenshot, contentType: "image/png" });
  } finally {
    rmSync(gitDir, { recursive: true, force: true });
  }
});
