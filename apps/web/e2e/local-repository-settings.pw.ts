import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { selectOption } from "./support/select-option";

const origin = process.env.AGENTFORGE_TEST_ORIGIN;
test.skip(!origin || process.env.GIT_SMART_HTTP_ENABLED !== "1", "Requires a local API, PostgreSQL, and managed Git transport");
test.use({ trace: "off", screenshot: "off", actionTimeout: 8000, viewport: { width: 1440, height: 1000 } });

test("repository settings persist and update the native Git endpoint", async ({ page }, testInfo) => {
  test.slow();
  const base = new URL(origin!);
  expect(base.hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`${base.origin}/register`);
  const password = randomUUID();
  await page.locator('[name=email]').fill(`repo-settings-${randomUUID()}@example.test`);
  await page.locator('[name=displayName]').fill("Repository Settings QA");
  await page.locator('[name=password]').fill(password);
  await page.locator('[name=confirmPassword]').fill(password);
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/orgs\/(?!current\/)[^/]+\/changesets$/);
  const orgURL = page.url().replace(/\/changesets$/, "");
  const org = orgURL.split("/").at(-1)!;
  const repositoryURL = `${orgURL}/repositories/${org}/settings-example`;
  const capture = async (name: string) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`repo-settings-${name}.png`), animations: "disabled", fullPage: true });
  };
  await page.goto(`${orgURL}/repositories/new`);
  await page.getByLabel("Repository name", { exact: true }).fill("settings-example");
  await page.getByRole("switch", { name: /Add a README/ }).press("Space");
  await page.getByRole("button", { name: "Create repository", exact: true }).click();
  await expect(page).toHaveURL(repositoryURL);
  const repoNav = page.getByRole("navigation", { name: "Repository sections" });
  await expect(repoNav.getByRole("link", { name: "Branches", exact: true })).toHaveCount(0);
  await page.goto(`${repositoryURL}/issues/new`);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Preserve this issue while disabled");
  await page.getByRole("button", { name: "Create issue", exact: true }).click();
  await expect(page).toHaveURL(`${repositoryURL}/issues/1`);
  await repoNav.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(`${repositoryURL}/settings`);
  const content = page.locator(".repo-settings-content");
  const settingsNav = page.locator(".repo-settings-nav");
  await content.getByRole("textbox", { name: "Description", exact: true }).fill("Release engineering starter");
  await content.getByRole("checkbox", { name: "Template repository" }).check();
  await content.getByRole("checkbox", { name: "Limit branch and tag updates per push" }).check();
  await content.getByRole("spinbutton", { name: "Maximum updates per push" }).fill("2");
  await content.getByRole("button", { name: "Save", exact: true }).click();
  await expect(content.getByText("General settings saved.")).toBeVisible();
  await page.reload();
  await expect(content.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("Release engineering starter");
  await expect(content.getByRole("checkbox", { name: "Template repository" })).toBeChecked();
  const issuesToggle = content.getByRole("checkbox", { name: "Issues", exact: true });
  const issuesTab = repoNav.getByRole("link", { name: "Issues", exact: true });
  await expect(issuesToggle).toBeChecked();
  await issuesToggle.uncheck();
  await content.getByRole("button", { name: "Save", exact: true }).click();
  await expect(issuesTab).toHaveCount(0);
  await page.reload();
  await expect(issuesToggle).not.toBeChecked();
  await expect(issuesTab).toHaveCount(0);
  await capture("issues-disabled");
  await page.goto(`${repositoryURL}/issues/1`);
  await expect(page.getByRole("heading", { name: "Issues are disabled for this repository" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Preserve this issue while disabled" })).toHaveCount(0);
  await page.goto(`${repositoryURL}/issues/new`);
  await expect(page.getByRole("heading", { name: "Issues are disabled for this repository" })).toBeVisible();
  await page.goto(`${repositoryURL}/settings`);
  await issuesToggle.check();
  await content.getByRole("button", { name: "Save", exact: true }).click();
  await expect(issuesTab).toBeVisible();
  await issuesTab.click();
  await expect(page.getByRole("link", { name: "Preserve this issue while disabled" })).toBeVisible();
  await page.goto(`${repositoryURL}/settings`);
  await settingsNav.getByRole("link", { name: "Git access tokens" }).click();
  await content.getByRole("button", { name: "New Git access token" }).click();
  const dialog = page.getByRole("dialog", { name: "Clone" });
  const gitURL = await dialog.getByLabel("Clone URL").inputValue();
  expect(new URL(gitURL).origin).toBe(base.origin);
  await selectOption(page, dialog.getByRole("combobox", { name: "Credential access" }), "Clone and push");
  const issued = page.waitForResponse(response => response.url().endsWith("/git-credentials") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Generate credential" }).click();
  const response = await issued;
  expect(response.status()).toBe(201);
  const { token } = await response.json() as { token: string };
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(content.getByText("Clone, fetch, and push working branches")).toBeVisible();
  await capture("tokens");

  const folder = mkdtempSync(join(tmpdir(), "af-repo-settings-e2e-"));
  try {
    const askpass = join(folder, "askpass");
    writeFileSync(askpass, '#!/bin/sh\ncase "$1" in Username*) printf "git\\n";; *) printf "%s\\n" "$AF_TEST_GIT_TOKEN";; esac\n', { mode: 0o700 });
    const git = (directory: string, ...args: string[]) => spawnSync("git", ["-C", directory, ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: askpass, AF_TEST_GIT_TOKEN: token },
    });
    const checkedGit = (directory: string, ...args: string[]) => {
      const result = git(directory, ...args);
      expect(result.status, `Git ${args[0]}: ${result.stderr}`).toBe(0);
      return result.stdout;
    };
    const worktree = join(folder, "worktree");
    checkedGit(folder, "clone", "--quiet", gitURL, worktree);
    expect(git(worktree, "push", "origin", "HEAD:refs/heads/release", "HEAD:refs/tags/v0.1.0", "HEAD:refs/tags/v0.2.0").stderr)
      .toContain("push exceeds the repository limit of 2 branch and tag updates");
    expect(checkedGit(folder, "ls-remote", gitURL, "refs/heads/release", "refs/tags/*")).toBe("");
    checkedGit(worktree, "push", "--quiet", "origin", "HEAD:refs/heads/release", "HEAD:refs/tags/v0.1.0");

    await page.goto(`${repositoryURL}/branches`);
    await expect(page).toHaveURL(`${repositoryURL}/settings/branches`);
    await expect(settingsNav.getByRole("link", { name: "Branches", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(content.getByRole("link", { name: "release", exact: true })).toBeVisible();
    await settingsNav.getByRole("link", { name: "Tags", exact: true }).click();
    await expect(content.getByRole("link", { name: "v0.1.0", exact: true })).toBeVisible();
    const rules = content.getByRole("textbox", { name: "Protected name patterns" });
    const saveRules = async (value: string) => {
      await rules.fill(value);
      const patch = page.waitForResponse(response => response.url().endsWith("/settings") && response.request().method() === "PATCH");
      await content.getByRole("button", { name: "Save", exact: true }).click();
      expect((await patch).status()).toBe(200);
      await expect(rules).toHaveValue(value);
    };
    await saveRules("v*");
    await page.reload();
    await expect(rules).toHaveValue("v*");
    expect(git(worktree, "push", "origin", ":refs/tags/v0.1.0").stderr).toContain("direct pushes to refs/tags/v0.1.0 are prohibited");
    expect(git(worktree, "push", "origin", "HEAD:refs/tags/v0.2.0", "HEAD:refs/heads/allowed").stderr).toContain("direct pushes to refs/tags/v0.2.0 are prohibited");
    expect(checkedGit(folder, "ls-remote", gitURL, "refs/heads/allowed", "refs/tags/v0.2.0")).toBe("");
    checkedGit(worktree, "-c", "user.name=Settings QA", "-c", "user.email=qa@example.test", "commit", "--allow-empty", "-m", "New tag target");
    expect(git(worktree, "push", "origin", "+HEAD:refs/tags/v0.1.0").stderr).toContain("direct pushes to refs/tags/v0.1.0 are prohibited");
    await capture("tags");
    await settingsNav.getByRole("link", { name: "Branches", exact: true }).click();
    await expect(content.getByRole("heading", { name: "Branches", exact: true })).toBeVisible();
    await saveRules("protected/*");
    expect(git(worktree, "push", "origin", "HEAD:refs/heads/protected/next").stderr).toContain("direct pushes to refs/heads/protected/next are prohibited");
    await saveRules("stable/*");
    expect(git(worktree, "push", "origin", "HEAD:refs/tags/v0.2.0").stderr).toContain("direct pushes to refs/tags/v0.2.0 are prohibited");
    await settingsNav.getByRole("link", { name: "Tags", exact: true }).click();
    await expect(content.getByRole("heading", { name: "Tags", exact: true })).toBeVisible();
    await saveRules("");
    checkedGit(worktree, "push", "--quiet", "origin", "HEAD:refs/tags/v0.2.0");
    await settingsNav.getByRole("link", { name: "General", exact: true }).click();
    await content.getByRole("button", { name: "Change default branch" }).click();
    await selectOption(page, content.getByRole("combobox", { name: "New default branch" }), "release");
    await content.locator("section").filter({ has: page.getByRole("heading", { name: "Default branch" }) })
      .getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Change the default branch from main to release?");
    await capture("confirm-default");
    await page.getByRole("button", { name: "Update default branch" }).click();
    await expect(content.getByText("Default branch updated.")).toBeVisible();
    expect(checkedGit(folder, "ls-remote", "--symref", gitURL, "HEAD")).toContain("ref: refs/heads/release\tHEAD");
    expect(git(worktree, "push", "origin", ":refs/heads/release").stderr).toContain("direct updates to the default branch are prohibited");
    await page.reload();
    await expect(content.getByText("The default branch release is protected.", { exact: false })).toBeVisible();
    await capture("general");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await capture("mobile");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await settingsNav.getByRole("link", { name: "Branches", exact: true }).click();
    await expect(content.getByRole("link", { name: "release", exact: true }).locator("..")).toContainText("Default");
    await capture("branches");

    await settingsNav.getByRole("link", { name: "General", exact: true }).click();
    await content.getByRole("link", { name: "Use this template" }).click();
    await page.getByRole("checkbox", { name: "Include all branches" }).check();
    await page.getByLabel("Repository name", { exact: true }).fill("generated");
    await capture("template");
    await page.getByRole("button", { name: "Create repository", exact: true }).click();
    await expect(page).toHaveURL(`${orgURL}/repositories/${org}/generated`);
    await page.goto(`${orgURL}/repositories/${org}/generated/settings/branches`);
    await expect(content.getByRole("link", { name: "main", exact: true })).toBeVisible();
    await expect(content.getByRole("link", { name: "release", exact: true }).locator("..")).toContainText("Default");

    await settingsNav.getByRole("link", { name: "Actions", exact: true }).click();
    const availability = content.getByRole("combobox", { name: "Actions availability" });
    await expect(availability).toHaveText(/Enable Actions/);
    await selectOption(page, availability, "Disable Actions");
    await content.getByRole("button", { name: "Save", exact: true }).click();
    await expect(content.getByText("Actions settings saved.")).toBeVisible();
    await page.reload();
    await expect(availability).toHaveText(/Disable Actions/);
    await capture("actions");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await capture("actions-mobile");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await selectOption(page, availability, "Enable Actions");
    await content.getByRole("button", { name: "Save", exact: true }).click();
    await expect(content.getByText("Actions settings saved.")).toBeVisible();

    await page.goto(`${repositoryURL}/settings/rulesets`);
    const saveRulesets = async () => {
      await content.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(content.getByText("Rulesets saved.")).toBeVisible();
    };
    await content.getByRole("button", { name: "New ruleset" }).click();
    await content.getByRole("textbox", { name: "Ruleset name" }).fill("Release history");
    await content.getByRole("textbox", { name: "Include patterns" }).fill("shipping/**");
    await content.getByRole("textbox", { name: "Exclude patterns" }).fill("shipping/scratch/**");
    await content.getByRole("checkbox", { name: "Restrict deletion" }).check();
    await content.getByRole("checkbox", { name: "Block force pushes" }).check();
    await content.getByRole("button", { name: "Add name restriction" }).click();
    await selectOption(page, content.getByRole("combobox", { name: "Requirement" }), "Matches regex");
    await content.getByRole("textbox", { name: "Name pattern", exact: true }).fill("^shipping/[a-z]+/next$");
    await content.getByRole("textbox", { name: "Description (optional)" }).fill("Use a lowercase shipping region");
    await saveRulesets();
    await page.reload();
    await expect(content.getByText("Release history", { exact: true })).toBeVisible();
    await content.getByRole("button", { name: "Edit Release history" }).click();
    await expect(content.getByRole("textbox", { name: "Exclude patterns" })).toHaveValue("shipping/scratch/**");
    await expect(content.getByRole("textbox", { name: "Name pattern", exact: true })).toHaveValue("^shipping/[a-z]+/next$");
    await capture("rulesets-name-patterns");
    await capture("rulesets");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await capture("rulesets-mobile");
    await page.setViewportSize({ width: 1440, height: 1000 });

    const shipping = "refs/heads/shipping/eu/next";
    const scratch = "refs/heads/shipping/scratch/local";
    const wrongName = "refs/heads/shipping/EU/next";
    expect(git(worktree, "push", "origin", `HEAD:${wrongName}`).stderr).toContain("ref name does not match the required pattern");
    expect(checkedGit(folder, "ls-remote", gitURL, wrongName)).toBe("");
    checkedGit(worktree, "push", "origin", `HEAD:${shipping}`, `HEAD:${scratch}`);
    checkedGit(worktree, "-c", "user.name=Settings QA", "-c", "user.email=qa@example.test", "commit", "--allow-empty", "-m", "Fast-forward to a quarantined commit");
    checkedGit(worktree, "push", "origin", `HEAD:${shipping}`, `HEAD:${scratch}`);
    checkedGit(worktree, "push", "origin", `+HEAD^:${scratch}`);
    expect(git(worktree, "push", "origin", `+HEAD^:${shipping}`).stderr).toContain(`blocks non-fast-forward updates to ${shipping}`);
    expect(git(worktree, "push", "origin", `:${shipping}`, `:${scratch}`).stderr).toContain(`blocks deletion of ${shipping}`);
    expect(checkedGit(folder, "ls-remote", gitURL, scratch)).toContain(scratch);

    await content.getByRole("checkbox", { name: "Require a pull request before merging" }).check();
    await capture("rulesets-require-pull-request");
    await saveRulesets();
    checkedGit(worktree, "-c", "user.name=Settings QA", "-c", "user.email=qa@example.test", "commit", "--allow-empty", "-m", "Try a direct update");
    const blockedUpdate = git(worktree, "push", "origin", `HEAD:${shipping}`);
    expect(blockedUpdate.stderr).toContain(`requires a pull request to update ${shipping}`);
    const previousSHA = checkedGit(worktree, "rev-parse", "HEAD^").trim();
    expect(checkedGit(folder, "ls-remote", gitURL, shipping).trim()).toBe(`${previousSHA}\t${shipping}`);
    checkedGit(worktree, "push", "origin", `HEAD:${scratch}`);

    const tagRule = {
      name: "Release tags", target: "tag", enforcement: "active",
      conditions: { ref_name: { include: ["refs/tags/locked-*"], exclude: [] } },
      rules: [
        { type: "update", parameters: { update_allows_fetch_and_merge: false } },
        { type: "tag_name_pattern", parameters: { operator: "ends_with", pattern: "-draft", negate: true } },
      ],
    };
    async function importRuleset(value: object) {
      const picker = page.waitForEvent("filechooser");
      await content.getByRole("button", { name: "Import JSON" }).click();
      await (await picker).setFiles({
        name: "ruleset.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)),
      });
    }
    const importedPR = "refs/heads/imported-pr";
    await importRuleset({
      name: "Imported pull request rule", target: "branch", enforcement: "active", bypass_actors: [],
      conditions: { ref_name: { include: [importedPR], exclude: [] } },
      rules: [{ type: "pull_request", parameters: {
        required_approving_review_count: 1, dismiss_stale_reviews_on_push: true, require_code_owner_review: false,
        require_last_push_approval: false, required_review_thread_resolution: false,
        allowed_merge_methods: ["merge", "squash", "rebase"], required_reviewers: [],
        require_extra_approval_for_unattributed_changes: false,
      } }],
    });
    await expect(content.getByRole("checkbox", { name: "Require a pull request before merging" })).toBeChecked();
    await capture("rulesets-import-pull-request");
    await saveRulesets();
    checkedGit(worktree, "push", "origin", `HEAD^:${importedPR}`);
    expect(git(worktree, "push", "origin", `HEAD:${importedPR}`).stderr).toContain(`requires a pull request to update ${importedPR}`);
    expect(checkedGit(folder, "ls-remote", gitURL, importedPR).trim()).toBe(`${previousSHA}\t${importedPR}`);

    await importRuleset({ ...tagRule, rules: [{ type: "required_signatures" }] });
    await expect(content.getByRole("alert")).toContainText("Choose a supported ruleset JSON file");
    await expect(content.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await importRuleset(tagRule);
    await expect(content.getByRole("textbox", { name: "Ruleset name" })).toHaveValue("Release tags");
    await expect(content.getByRole("textbox", { name: "Include patterns" })).toHaveValue("locked-*");
    await expect(content.getByRole("checkbox", { name: "Restrict updates" })).toBeChecked();
    await expect(content.getByRole("button", { name: "Export Release tags as JSON" })).toHaveCount(0);
    await capture("rulesets-import");
    await saveRulesets();
    const download = page.waitForEvent("download");
    await content.getByRole("button", { name: "Export Release tags as JSON" }).click();
    const exported = await download;
    expect(exported.suggestedFilename()).toBe("ruleset-Release-tags.json");
    expect(JSON.parse(readFileSync((await exported.path())!, "utf8"))).toMatchObject({
      name: "Release tags", target: "tag", enforcement: "active",
      conditions: { ref_name: { include: ["locked-*"], exclude: [] } },
      rules: [{ type: "update" }, tagRule.rules[1]],
    });
    expect(git(worktree, "push", "origin", "HEAD:refs/tags/locked-draft").stderr).toContain("ref name does not match the required pattern");
    const lockedTag = "refs/tags/locked-release";
    checkedGit(worktree, "push", "origin", `HEAD:${lockedTag}`);
    expect(git(worktree, "push", "origin", `+HEAD^:${lockedTag}`).stderr).toContain(`blocks updates to ${lockedTag}`);
    await content.getByRole("button", { name: "Edit Release tags" }).click();
    await content.getByRole("checkbox", { name: "Restrict creation" }).check();
    await saveRulesets();
    expect(git(worktree, "push", "origin", "HEAD:refs/tags/locked-next", "HEAD:refs/heads/ordinary").stderr).toContain("blocks creation of refs/tags/locked-next");
    expect(checkedGit(folder, "ls-remote", gitURL, "refs/heads/ordinary", "refs/tags/locked-next")).toBe("");
    await content.getByRole("button", { name: "Edit Release tags" }).click();
    await content.getByRole("checkbox", { name: "Enable ruleset" }).uncheck();
    await saveRulesets();
    checkedGit(worktree, "push", "origin", "HEAD:refs/tags/locked-next");

    await content.getByRole("button", { name: "New ruleset" }).click();
    await content.getByRole("textbox", { name: "Ruleset name" }).fill("Default branch queue");
    await content.getByRole("textbox", { name: "Include patterns" }).fill("~ALL");
    await content.getByRole("checkbox", { name: "Require merge queue" }).check();
    await content.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(content.getByRole("alert")).toContainText("Use ~DEFAULT_BRANCH as the only include pattern");
    await content.getByRole("textbox", { name: "Include patterns" }).fill("~DEFAULT_BRANCH");
    await capture("rulesets-merge-queue");
    await saveRulesets();
    const release = "refs/heads/release";
    const releaseBeforeQueue = checkedGit(folder, "ls-remote", gitURL, release);
    expect(git(worktree, "push", "origin", `HEAD:${release}`).stderr).toContain("direct updates to the default branch are prohibited");
    expect(checkedGit(folder, "ls-remote", gitURL, release)).toBe(releaseBeforeQueue);

    await page.goto(`${repositoryURL}/settings/git-tokens`);
    await content.getByRole("button", { name: "Revoke credential" }).click();
    await expect(content.getByText("No active Git tokens.")).toBeVisible();
    expect(git(folder, "ls-remote", gitURL).status).not.toBe(0);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
