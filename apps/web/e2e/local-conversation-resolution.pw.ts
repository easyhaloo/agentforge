import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "@playwright/test";
import { selectOption } from "./support/select-option";

const origin = process.env.AGENTFORGE_TEST_ORIGIN;
const gitRoot = process.env.GIT_REPOSITORY_ROOT ?? join(process.env.RUN_DIR ?? "/tmp/agentforge-dev", "git");
test.skip(!origin, "Requires the local API, PostgreSQL, and dev stack Git root");

test("saves conversation resolution rules and reopens an outdated inline conversation", async ({ page }, testInfo) => {
  test.slow();
  const base = new URL(origin!);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(base.hostname);
  await page.goto(`${base.origin}/register`);
  const password = randomUUID();
  await page.locator('[name=email]').fill(`conversations-${randomUUID()}@example.test`);
  await page.locator('[name=displayName]').fill("Conversation QA");
  await page.locator('[name=password]').fill(password);
  await page.locator('[name=confirmPassword]').fill(password);
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/orgs\/(?!current\/)[^/]+\/changesets$/);
  const orgPath = new URL(page.url()).pathname.replace(/\/changesets$/, "");
  const account = await page.evaluate(async () => {
    const response = await fetch("/api/v1/me", { credentials: "include" });
    if (!response.ok) throw new Error(`Account lookup failed (${response.status})`);
    return await response.json() as { organizations: { id: string }[] };
  });
  const owner = "conversation-qa";
  const ownerDir = join(gitRoot, account.organizations[0].id, owner);
  mkdirSync(ownerDir, { recursive: true });
  const bare = mkdtempSync(join(ownerDir, "repo-"));
  const checkout = mkdtempSync(join(tmpdir(), "af-conversation-checkout-"));
  const repoName = basename(bare);
  const repository = `${base.origin}${orgPath}/repositories/${owner}/${repoName}`;
  const git = (...args: string[]) => execFileSync("git", ["-C", checkout, ...args], {
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  });
  const commit = (contents: string, subject: string) => {
    writeFileSync(join(checkout, "README.md"), contents);
    git("add", "README.md");
    git("-c", "user.name=Conversation QA", "-c", "user.email=conversation@example.test", "commit", "--quiet", "-m", subject);
  };

  try {
    git("init", "--quiet", "--initial-branch=main", "--template=");
    commit("# Documentation\n", "Seed repository");
    git("switch", "--quiet", "-c", "topic");
    commit("# Documentation\n\nProposed change.\n", "Update documentation");
    git("switch", "--quiet", "main");
    git("clone", "--quiet", "--bare", "--template=", checkout, bare);
    await page.goto(`${base.origin}${orgPath}/repositories/new`);
    await page.getByRole("link", { name: "Register an existing repository" }).click();
    await page.getByLabel("Owner", { exact: true }).fill(owner);
    await page.getByLabel("Repository name", { exact: true }).fill(repoName);
    await page.getByRole("button", { name: "Register repository", exact: true }).click();
    await expect(page).toHaveURL(repository);

    await page.goto(`${repository}/settings/rulesets`);
    await page.getByRole("button", { name: "New ruleset" }).click();
    await page.getByRole("textbox", { name: "Ruleset name" }).fill("Resolve review conversations");
    await page.getByRole("textbox", { name: "Include patterns" }).fill("main");
    await page.getByRole("checkbox", { name: "Require a pull request before merging" }).check();
    const rule = page.getByRole("checkbox", { name: "Require conversation resolution before merging" });
    await rule.check();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Rulesets saved.")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Edit Resolve review conversations" }).click();
    await expect(rule).toBeChecked();
    await rule.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("conversation-resolution-ruleset.png"), animations: "disabled" });

    await page.goto(`${repository}/pulls/new`);
    await selectOption(page, page.getByRole("combobox", { name: "Compare branch", exact: true }), "topic");
    await expect(page.getByText("Update documentation", { exact: true })).toBeVisible();
    await page.getByLabel("Title", { exact: true }).fill("Review this documentation");
    await page.getByRole("button", { name: "Create pull request", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review this documentation", exact: true })).toBeVisible();
    const files = page.getByRole("tab", { name: /Files changed/ });
    const conversation = page.getByRole("tab", { name: /Conversation/ });
    await files.click();
    await page.getByRole("button", { name: /Add a comment to this line/i }).last().click();
    await page.getByPlaceholder("Leave a comment").fill("Clarify the proposed change.");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByText("Unresolved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Resolve conversation" }).click();
    await expect(page.getByText(/Resolved by Conversation QA on/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("conversation-resolution-files.png"), animations: "disabled" });

    await conversation.click();
    git("switch", "--quiet", "topic");
    commit("# Documentation\n\nA clearer change.\n", "Clarify documentation");
    git("push", "--quiet", bare, "HEAD:refs/heads/topic");
    await page.getByRole("button", { name: "Update revision" }).click();
    await expect(page.getByText("This comment was made on an older revision", { exact: true })).toBeVisible();
    await expect(page.getByText(/Resolved by Conversation QA on/)).toBeVisible();
    await page.getByRole("button", { name: "Reopen conversation" }).click();
    await expect(page.getByText("Unresolved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Clarify the proposed change.", { exact: true })).toBeVisible();
    await expect(page.getByText("This comment was made on an older revision", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resolve conversation" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("conversation-resolution-outdated.png"), animations: "disabled" });
  } finally {
    rmSync(checkout, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  }
});
