import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import { selectOption } from "./support/select-option";

const origin = process.env.AGENTFORGE_TEST_ORIGIN;
const gitRoot = process.env.GIT_REPOSITORY_ROOT ?? join(process.env.RUN_DIR ?? "/tmp/agentforge-dev", "git");
test.skip(!origin, "Requires the local API, PostgreSQL, and dev stack Git root");

test("reviews an updated pull request and merges only its verified revision", async ({ page }, testInfo) => {
  const base = new URL(origin!);
  const capture = async (name: string) => {
    const path = testInfo.outputPath(`pull-request-${name}.png`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path, animations: "disabled", fullPage: true, style: ".af-notification-viewport { visibility: hidden; }" });
    await testInfo.attach(`Pull request ${name}`, { path, contentType: "image/png" });
  };
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(base.hostname);
  const register = async (browserPage: typeof page, displayName: string) => {
    await browserPage.goto(`${base.origin}/register`);
    const password = randomUUID();
    await browserPage.locator('[name=email]').fill(`pulls-${randomUUID()}@example.test`);
    await browserPage.locator('[name=displayName]').fill(displayName);
    await browserPage.locator('[name=password]').fill(password);
    await browserPage.locator('[name=confirmPassword]').fill(password);
    await browserPage.locator('button[type=submit]').click();
    await expect(browserPage).toHaveURL(/\/orgs\/(?!current\/)[^/]+\/changesets$/);
    return browserPage.evaluate(async () => {
      const response = await fetch("/api/v1/me", { credentials: "include" });
      if (!response.ok) throw new Error(`Account lookup failed (${response.status})`);
      return await response.json() as { user_id: string; organizations: Array<{ id: string }> };
    });
  };
  const reviewerContext = await page.context().browser()!.newContext({ locale: "en-US" });
  const reviewer = await reviewerContext.newPage();
  const [account, reviewerAccount] = await Promise.all([register(page, "Pull Request QA"), register(reviewer, "Pull Request Reviewer")]);
  const orgPath = new URL(page.url()).pathname.replace(/\/changesets$/, "");
  const orgID = account.organizations[0].id;
  expect(orgID).toMatch(/^[a-zA-Z0-9_-]+$/);
  expect(reviewerAccount.user_id).toMatch(/^[a-zA-Z0-9_-]+$/);
  // Local authentication does not support the OIDC invitation flow. Seed only the membership.
  execFileSync("docker", ["compose", "exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1",
    "-U", process.env.DB_USER ?? "agentforge", "-d", process.env.DB_NAME ?? "agentforge",
    "-v", `org=${orgID}`, "-v", `reviewer=${reviewerAccount.user_id}`], {
    input: "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES (:'org', :'reviewer', 'member');\n",
  });

  const ownerDir = join(gitRoot, orgID, "pulls-qa");
  mkdirSync(ownerDir, { recursive: true });
  const repositoryDir = mkdtempSync(join(ownerDir, "repo-"));
  const repository = `pulls-qa/${basename(repositoryDir)}`;
  const otherRepositoryDir = mkdtempSync(join(ownerDir, "repo-"));
  const otherRepository = `pulls-qa/${basename(otherRepositoryDir)}`;
  const gitAt = (directory: string, ...args: string[]) => execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  }).trim();
  const git = (...args: string[]) => gitAt(repositoryDir, ...args);
  const commit = (contents: string, subject: string) => {
    writeFileSync(join(repositoryDir, "README.md"), contents);
    git("add", "README.md");
    git("-c", "user.name=Pull Request QA", "-c", "user.email=pulls@example.test", "commit", "--quiet", "-m", subject);
    return git("rev-parse", "HEAD");
  };

  try {
    git("init", "--quiet", "--initial-branch=main", "--template=");
    const target = commit("# Documentation\n", "Seed repository");
    git("branch", "release");
    git("switch", "--quiet", "-c", "feature/docs");
    const firstHead = commit("# Documentation\n\nFirst revision.\n", "Add revision notes");
    git("switch", "--quiet", "main");

    gitAt(otherRepositoryDir, "init", "--quiet", "--initial-branch=main", "--template=");
    gitAt(otherRepositoryDir, "-c", "user.name=Pull Request QA", "-c", "user.email=pulls@example.test",
      "commit", "--quiet", "--allow-empty", "-m", "Seed second repository");
    for (const directory of [otherRepositoryDir, repositoryDir]) {
      await page.goto(`${base.origin}${orgPath}/repositories/new`);
      await page.getByRole("link", { name: "Register an existing repository" }).click();
      await page.getByLabel("Owner", { exact: true }).fill("pulls-qa");
      await page.getByLabel("Repository name", { exact: true }).fill(basename(directory));
      await page.getByRole("button", { name: "Register repository", exact: true }).click();
      await expect(page).toHaveURL(`${base.origin}${orgPath}/repositories/pulls-qa/${basename(directory)}`);
    }
    await page.getByRole("link", { name: "Pull requests", exact: true }).click();
    const pullsPath = `${orgPath}/repositories/${repository}/pulls`;
    await expect(page).toHaveURL(`${base.origin}${pullsPath}`);
    await page.getByRole("link", { name: "New pull request" }).click();
    await expect(page).toHaveURL(`${base.origin}${pullsPath}/new`);
    await selectOption(page, page.getByRole("combobox", { name: "Base branch", exact: true }), "release");
    await selectOption(page, page.getByRole("combobox", { name: "Compare branch", exact: true }), "feature/docs");
    await expect(page.getByText("Add revision notes", { exact: true })).toBeVisible();
    await expect(page.getByText(/First revision\./).first()).toBeVisible();
    await capture("compare");
    const title = "Document the verification workflow";
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByLabel("Description", { exact: true }).fill("A real pull request from the Git test repository.");
    await page.getByRole("checkbox", { name: "Create as draft" }).check();
    const created = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/changesets"));
    await page.getByRole("button", { name: "Create draft pull request" }).click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(201);
    const { changeset } = await createdResponse.json() as { changeset: { id: string; title: string; revisions: { id: string; commit_sha: string }[] } };
    expect(changeset.title).toBe(title);
    expect(changeset.revisions[0].commit_sha).toBe(firstHead);
    const detail = `${base.origin}${pullsPath}/${changeset.id}`;
    await expect(page).toHaveURL(detail);
    await expect(page.getByRole("heading", { name: new RegExp(title) })).toBeVisible();
    await expect(page.getByText("feature/docs", { exact: true }).first()).toBeVisible();
    const conversationTab = page.getByRole("tab", { name: /Conversation/ });
    const commitsTab = page.getByRole("tab", { name: /Commits/ });
    const checksTab = page.getByRole("tab", { name: /Checks/ });
    const filesTab = page.getByRole("tab", { name: /Files changed/ });
    await expect(conversationTab).toHaveAccessibleName("Conversation 0");
    await expect(commitsTab).toHaveAccessibleName("Commits 1");
    await expect(checksTab).toHaveAccessibleName("Checks 0");
    await expect(filesTab).toHaveAccessibleName("Files changed 1");
    await expect(conversationTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveAccessibleName("Conversation 0");
    await expect(conversationTab).toHaveCSS("font-size", "14px");
    await expect(conversationTab.locator("svg")).toHaveCSS("width", "18px");
    expect(await conversationTab.evaluate(tab => getComputedStyle(tab).boxShadow)).not.toBe(await commitsTab.evaluate(tab => getComputedStyle(tab).boxShadow));
    const post = (path: string, body: object) => page.evaluate(async ({ path, body }) => {
      const token = document.cookie.split("; ").find(entry => entry.startsWith("__Host-agentforge_csrf="))?.split("=")[1] ?? "";
      const response = await fetch(path, {
        method: "POST", credentials: "include", body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(token) },
      });
      return { status: response.status, detail: (await response.json() as { detail?: string }).detail };
    }, { path: `/api/v1/organizations/${orgID}/changesets/${changeset.id}/${path}`, body });
    const merge = page.getByRole("button", { name: "Merge pull request", exact: true });
    await expect(merge.filter({ visible: true }).and(page.locator(":enabled"))).toHaveCount(0);
    expect(await post("merge", { target_ref: "release" })).toEqual({ status: 422, detail: "draft pull request cannot be approved or merged" });
    await page.getByRole("button", { name: "Ready for review" }).click();
    await expect(page.getByRole("button", { name: "Convert to draft" })).toBeVisible();

    await page.getByPlaceholder("Leave a comment").fill("Verified the proposal locally.");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByText("Verified the proposal locally.", { exact: true })).toBeVisible();
    await expect(conversationTab).toHaveAccessibleName("Conversation 1");
    await capture("conversation");
    await conversationTab.focus();
    await conversationTab.press("ArrowRight");
    await expect(page).toHaveURL(`${detail}/commits`);
    await expect(commitsTab).toBeFocused();
    await expect(commitsTab).toHaveAttribute("aria-selected", "true");
    await page.goBack();
    await expect(conversationTab).toHaveAttribute("aria-selected", "true");
    await page.goForward();
    await expect(commitsTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveAccessibleName("Commits 1");
    await expect(page.getByText("Add revision notes", { exact: true })).toBeVisible();
    await capture("commits");
    await filesTab.click();
    await expect(page).toHaveURL(`${detail}/files`);
    await expect(page.getByText(/First revision\./).first()).toBeVisible();
    await page.getByRole("button", { name: /Add a comment to this line/i }).last().click();
    await page.getByPlaceholder("Leave a comment").fill("Consider documenting the second revision too.");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByText("Consider documenting the second revision too.", { exact: true })).toBeVisible();
    await expect(conversationTab).toHaveAccessibleName("Conversation 2");
    await capture("files");

    await page.getByRole("tab", { name: /Conversation/ }).click();
    await page.getByRole("button", { name: "Close pull request" }).click();
    const reopen = page.getByRole("button", { name: "Reopen pull request" });
    await expect(reopen).toBeVisible();
    expect(await post("merge", { target_ref: "release" })).toEqual({ status: 422, detail: "closed pull request cannot be approved or merged" });
    await page.reload();
    await expect(reopen).toBeVisible();
    await expect(page.getByText("Verified the proposal locally.", { exact: true })).toBeVisible();
    await page.goto(`${base.origin}${pullsPath}`);
    await expect(page.getByText("No open pull requests.")).toBeVisible();
    await page.getByRole("button", { name: "Closed", exact: true }).click();
    await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
    const search = page.getByRole("textbox", { name: "Search pull requests..." });
    await search.fill("no-such-pull-request");
    await expect(page.getByText("No closed pull requests.")).toBeVisible();
    await search.fill("verification");
    await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
    await capture("list");
    const otherPulls = `${base.origin}${orgPath}/repositories/${otherRepository}/pulls`;
    await page.goto(`${otherPulls}?state=closed`);
    await expect(page.getByText("No closed pull requests.")).toBeVisible();
    await page.goto(`${otherPulls}/${changeset.id}`);
    await expect(page.getByRole("alert")).toBeVisible();
    await page.goto(detail);
    await reopen.click();
    await expect(page.getByRole("button", { name: "Close pull request" })).toBeVisible();

    const waitForWrite = (browserPage: typeof page, suffix: RegExp) => browserPage.waitForResponse(response =>
      response.request().method() === "POST" && suffix.test(new URL(response.url()).pathname));
    const verifyAndApprove = async () => {
      const conversationURL = page.url();
      await page.getByRole("tab", { name: /Checks/ }).click();
      const evaluation = waitForWrite(page, /\/evaluations$/);
      await page.getByRole("button", { name: /Run (checks|evaluation)/i }).click();
      expect((await evaluation).ok()).toBeTruthy();
      await expect(checksTab).toHaveAccessibleName("Checks 1");
      await expect(page.getByText("All checks passed", { exact: true })).toBeVisible();
      await capture("checks");
      await conversationTab.click();
      await selectOption(page, page.getByRole("combobox", { name: "Reviewers" }), "Pull Request Reviewer");
      const assignment = waitForWrite(page, /\/reviews$/);
      await page.getByRole("button", { name: /Assign review/i }).click();
      expect((await assignment).ok()).toBeTruthy();
      await reviewer.goto(conversationURL);
      const decision = waitForWrite(reviewer, /\/reviews\/[^/]+\/decision$/);
      await reviewer.getByRole("button", { name: "Approve", exact: true }).click();
      expect((await decision).ok()).toBeTruthy();
      await page.reload();
      await expect(merge).toBeEnabled();
    };
    await verifyAndApprove();
    git("switch", "--quiet", "feature/docs");
    const secondHead = commit("# Documentation\n\nFirst revision.\nSecond revision.\n", "Clarify revision notes");
    git("switch", "--quiet", "main");
    await page.getByRole("button", { name: /Refresh (revision|source branch)|Update revision/i }).click();
    await expect(merge.filter({ visible: true }).and(page.locator(":enabled"))).toHaveCount(0);
    await expect(page.getByText("This comment was made on an older revision", { exact: true })).toBeVisible();
    await expect(checksTab).toHaveAccessibleName("Checks 0");
    await expect(commitsTab).toHaveAccessibleName("Commits 2");
    await expect(page.getByText("Revision 2", { exact: true })).toBeVisible();
    expect(await post("pull-request/comments", { body: "Outdated", revision_id: changeset.revisions[0].id, path: "README.md", side: "right", line: 3 })).toEqual({ status: 409, detail: "The inline comment revision is not current" });
    expect(await post("merge", { target_ref: "release" })).toEqual({ status: 409, detail: "a passed evaluation is required" });
    await verifyAndApprove();

    await merge.click();
    await page.getByRole("dialog").getByRole("button", { name: "Merge pull request" }).click();
    await expect(page.getByText("Merged", { exact: true }).first()).toBeVisible();
    const mergedHead = git("rev-parse", "refs/heads/release");
    expect(git("rev-parse", "refs/heads/main")).toBe(target);
    expect(mergedHead).not.toBe(secondHead);
    expect(git("show", "-s", "--format=%P", mergedHead).split(" ")).toEqual([target, secondHead]);
    expect(git("show", "refs/heads/release:README.md")).toContain("Second revision.");
    await page.reload();
    await expect(page.getByText("Merged", { exact: true }).first()).toBeVisible();
    await capture("merged");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(conversationTab).toHaveAttribute("aria-selected", "true");
    await filesTab.click();
    await expect(filesTab).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await conversationTab.click();
    await capture("mobile");
  } finally {
    await reviewerContext.close();
    rmSync(repositoryDir, { recursive: true, force: true });
    rmSync(otherRepositoryDir, { recursive: true, force: true });
  }
});
