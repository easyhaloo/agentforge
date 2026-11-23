import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { expect, test, type Page } from "@playwright/test";
import { demoOrganization, installApiMocks, now } from "./support/api-mocks";
import { selectOption } from "./support/select-option";
import type { Pipeline, WorkflowTrigger } from "../src/shared/api/pipelines";

const repository = "easyhaloo/agentforge";
const pagePath = `/orgs/demo/repositories/${repository}/actions`;
const apiPath = `**/api/v1/organizations/org-demo/repositories/${repository}/actions`;

test("repository Actions creates and runs a workflow and preserves history filters", async ({ page }, testInfo) => {
  await installApiMocks(page);
  let workflow: Pipeline | undefined;
  let ran = false;
  let mixed = false;
  let waitingForApproval = false;
  let triggers: WorkflowTrigger[] = [];
  let httpError = true;
  const run = { id: "ci-run", pipeline_id: "ci", pipeline: "repository-ci", status: "succeeded", version: 1,
    created_at: now, completed_at: "2026-11-17T09:00:43Z", event: "manual", branch: "main", actor: "Demo Owner", actor_id: "user-owner" };
  await page.route(`${apiPath}/workflows`, route => route.fulfill({ json: { items: workflow ? [workflow] : [] } }));
  await page.route(url => url.pathname === `/api/v1/organizations/org-demo/repositories/${repository}/actions`, route => {
    if (httpError) return route.fulfill({ status: 500 });
    const filters = new URL(route.request().url()).searchParams;
    const items = !ran ? [] : [run, ...(mixed ? [
      { ...run, id: "ci-failed", status: "failed" },
      { ...run, id: "ci-running", status: "running", completed_at: undefined },
      { ...run, id: "ci-queued", status: "queued", completed_at: undefined },
    ] : [])];
    const matches = (item: typeof items[number]) => (!filters.has("workflow") || filters.get("workflow") === item.pipeline_id) &&
      (!filters.has("status") || filters.get("status") === item.status) &&
      (!filters.has("q") || item.pipeline.includes(filters.get("q")!));
    return route.fulfill({ json: { items: items.filter(matches), has_more: false } });
  });
  await page.route("**/api/v1/organizations/org-demo/pipelines**", route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/triggers")) {
      if (request.method() === "GET") return route.fulfill({ json: { items: triggers } });
      const binding = request.postDataJSON();
      expect(binding).toEqual({ kind: "schedule", version: 1, everySeconds: 120 });
      triggers = [{ id: "schedule-1", ...binding }];
      return route.fulfill({ status: 201, json: triggers[0] });
    }
    if (url.pathname.endsWith("/triggers/schedule-1") && request.method() === "DELETE") {
      triggers = [];
      return route.fulfill({ status: 204 });
    }
    if (url.pathname.endsWith("/pipelines") && request.method() === "POST") {
      expect(url.searchParams.get("repository")).toBe(repository);
      const definition = request.postDataJSON();
      workflow = { id: "ci", name: definition.name, repository, revision: 1, status: "draft", version: 0, definition };
    } else if (url.pathname.endsWith("/publish") && workflow) {
      workflow = { ...workflow, revision: 2, status: "published", version: 1 };
    } else if (url.pathname.endsWith("/versions")) {
      return route.fulfill({ json: { items: [{ number: 1, checksum: "a".repeat(64), definition: workflow!.definition, publishedAt: now }] } });
    } else if (url.pathname.endsWith("/versions/1/runs")) {
      expect(request.postDataJSON()).toEqual({});
      ran = true;
      return route.fulfill({ status: 201, json: { id: run.id } });
    }
    return route.fulfill({ json: workflow ?? { items: [] } });
  });
  const runDetails = { id: run.id, actorId: run.actor_id, repository, pipelineId: "ci", version: 1, status: "succeeded", stepStatuses: { check: "succeeded", approve: "succeeded" }, inputs: {}, createdAt: now };
  const rerun = { ...runDetails, id: "ci-rerun", status: "queued", trigger: { kind: "rerun", runId: run.id } };
  await page.route("**/pipeline-runs/ci-run", route => route.fulfill({ json: runDetails }));
  await page.route("**/pipeline-runs/ci-run/events", route => route.fulfill({
    contentType: "text/event-stream",
    body: 'id: 1\ndata: {"seq":1,"kind":"log","stepId":"check","message":"Finished check"}\n\nid: 2\ndata: {"seq":2,"kind":"succeeded"}\n\n',
  }));
  await page.route("**/pipeline-runs/ci-run/objects?after=0", route => route.fulfill({ json: [
    { id: 1, provenance: { step: "check", name: "build.txt", attempt: 1 }, expiresAt: "2099-01-01T00:00:00Z" },
    { id: 2, provenance: { step: "check", name: "old.txt", attempt: 1 }, expiresAt: "2000-01-01T00:00:00Z" },
  ] }));
  await page.route(/\/pipeline-runs\/ci-(running|failed)\/objects\?after=0$/, route => route.fulfill({ json: [] }));
  await page.route("**/pipeline-runs/ci-running", route => route.fulfill({
    json: { ...runDetails, id: "ci-running", status: "running", stepStatuses: waitingForApproval ? { check: "succeeded", approve: "waiting" } : { check: "leased", approve: "queued" } },
  }));
  await page.route("**/pipeline-runs/ci-failed", route => route.fulfill({
    json: { ...runDetails, id: "ci-failed", status: "failed", stepStatuses: { check: "failed", approve: "cancelled" } },
  }));
  await page.route("**/pipeline-runs/ci-failed/events", route => route.fulfill({
    contentType: "text/event-stream",
    body: 'id: 1\ndata: {"seq":1,"kind":"log","stepId":"check","message":"Release validation failed"}\n\nid: 2\ndata: {"seq":2,"kind":"failed"}\n\n',
  }));
  await page.route("**/pipeline-runs/ci-rerun", route => route.fulfill({ json: rerun }));
  await page.route("**/pipeline-runs/ci-run/rerun", route => {
    expect(route.request().method()).toBe("POST");
    return route.fulfill({ status: 201, json: rerun });
  });
  const capture = (name: string) => page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  await page.goto(pagePath);
  const error = page.getByRole("alert").filter({ has: page.getByRole("button", { name: "Refresh" }) });
  await expect(error).toBeVisible();
  httpError = false;
  await error.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("heading", { name: /no .*runs/i })).toBeVisible();
  const actionsIcon = page.getByRole("link", { name: "Actions", exact: true }).locator("svg");
  await expect(actionsIcon).toHaveAttribute("viewBox", "0 0 16 16");
  await expect(actionsIcon).toHaveAttribute("fill", "currentColor");
  await expect(actionsIcon).toHaveAttribute("aria-hidden", "true");
  await expect(actionsIcon.locator("path")).toHaveAttribute("d", /^M8 0a8 8 0 1 1/);
  await capture("actions-empty");
  await page.locator(".repo-actions-rail").getByRole("button", { name: "New workflow" }).click();
  const create = page.getByRole("dialog", { name: "Create pipeline" });
  await create.getByRole("radio", { name: "Check then approve" }).check();
  await create.getByLabel("Workflow name").fill("repository-ci");
  await capture("actions-template");
  await create.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/pipelines\/ci\/edit\?.*fromRepository=/);
  await page.getByRole("button", { name: "Publish version" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Published version 1" })).toBeVisible();
  await capture("actions-workflow-config");
  await page.getByRole("link", { name: "Back to Actions" }).click();
  await expect(page).toHaveURL(`${pagePath}?workflow=ci`);
  await page.getByRole("button", { name: "Triggers" }).click();
  const triggerDialog = page.getByRole("dialog", { name: "Triggers" });
  await selectOption(page, triggerDialog.getByRole("combobox", { name: "Event" }), "Schedule");
  await triggerDialog.getByLabel("Interval in minutes").fill("2");
  await triggerDialog.getByRole("button", { name: "Enable trigger" }).click();
  await expect(triggerDialog.getByText("Schedule · Version 1 · Every 2 min")).toBeVisible();
  await capture("actions-trigger");
  await triggerDialog.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(triggerDialog.getByText("No automatic triggers enabled.")).toBeVisible();
  await triggerDialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Run workflow" }).click();
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page).toHaveURL(/\/pipeline-runs\/ci-run\?/);
  await page.reload();
  await expect(page.getByRole("region", { name: "Run graph" })).toBeVisible();
  const titleStatus = page.locator("h1 .pipeline-status-icon");
  await expect(titleStatus).toHaveAttribute("data-state", "succeeded");
  await capture("actions-run-summary");
  await expect(page.getByText(/old\.txt.*Expired/)).toBeVisible();
  const artifact = page.getByRole("link", { name: /build\.txt/ });
  await expect(artifact).toHaveAttribute("download", "build.txt");
  await expect(artifact).toHaveAttribute("href", /\/pipeline-runs\/ci-run\/objects\/1$/);
  await page.getByRole("region", { name: "Run graph" }).getByRole("link", { name: "Job checks" }).click();
  const checks = page.getByRole("region", { name: "Job checks" });
  await checks.locator("summary").click();
  await expect(checks.getByText("Finished check")).toBeVisible();
  await expect(checks.locator("summary .pipeline-status-icon")).toHaveAttribute("data-state", "succeeded");
  const logSearch = checks.getByRole("searchbox", { name: "Search logs" });
  await logSearch.fill("unmatched");
  await expect(checks.getByText("No log lines match your search.")).toBeVisible();
  await logSearch.fill("FINISHED");
  await expect(checks.getByText("Finished check")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Actions" })).toHaveAttribute("href", `${pagePath}?workflow=ci`);
  await page.screenshot({ path: testInfo.outputPath("actions-job.png"), fullPage: true });
  await page.getByRole("button", { name: "Re-run workflow" }).click();
  await page.getByRole("dialog", { name: "Re-run workflow" }).getByRole("button", { name: "Re-run workflow" }).click();
  await expect(page).toHaveURL(/\/pipeline-runs\/ci-rerun\?/);
  await page.getByRole("link", { name: "View original run" }).click();
  await expect(page).toHaveURL(/\/pipeline-runs\/ci-run\?/);
  await page.getByRole("link", { name: "Back to Actions" }).click();
  const result = page.locator(".repo-actions-run");
  await expect(result).toContainText("Demo Owner");
  await expect(result).toContainText("43s");
  await selectOption(page, page.getByRole("combobox", { name: "Status", exact: true }), "Failed");
  await expect(page.getByRole("heading", { name: "No runs match these filters" })).toBeVisible();
  await capture("actions-no-filter-matches");
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(`${pagePath}?workflow=ci`);
  await expect(result).toBeVisible();
  await page.getByRole("searchbox", { name: "Search workflow runs" }).fill("repository-ci");
  await page.getByRole("searchbox", { name: "Search workflow runs" }).press("Enter");
  await expect(page).toHaveURL(`${pagePath}?workflow=ci&q=repository-ci`);
  await expect(result).toBeVisible();
  mixed = true;
  await page.reload();
  await expect(result).toHaveCount(4);
  for (const [label, state, color] of [
    ["Succeeded", "succeeded", "rgb(26, 127, 55)"],
    ["Failed", "failed", "rgb(209, 36, 47)"],
    ["Running", "running", "rgb(154, 103, 0)"],
  ]) {
    const icon = result.getByRole("img", { name: label, exact: true }).locator("svg");
    await expect(icon).toHaveAttribute("data-state", state);
    await expect(icon).toHaveCSS("color", color);
  }
  await expect(result.getByRole("img", { name: "Queued", exact: true })).toBeVisible();
  await capture("actions-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(result).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await capture("actions-mobile");
  await page.setViewportSize({ width: 1440, height: 900 });

  await result.filter({ has: page.getByRole("img", { name: "Running", exact: true }) }).getByRole("link").click();
  await expect(titleStatus).toHaveAttribute("data-state", "running");
  await expect(titleStatus).toHaveCSS("animation-name", "pipeline-status-spin");
  await expect(page.getByRole("navigation", { name: "Run navigation" }).getByRole("link", { name: /checks.*Running/ })).toBeVisible();
  const emptyArtifacts = page.getByRole("region", { name: "Artifacts" }).getByText("No artifacts are available for this run yet.");
  await expect(emptyArtifacts).toBeVisible();
  await capture("actions-in-progress");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(titleStatus).toHaveCSS("animation-name", "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  waitingForApproval = true;
  await expect(page.getByRole("button", { name: "Review approve" })).toBeVisible();
  await capture("actions-waiting-approval");
  await page.getByRole("link", { name: "Back to Actions" }).click();
  await selectOption(page, page.getByRole("combobox", { name: "Status", exact: true }), "Failed");
  await expect(result).toHaveCount(1);
  await result.getByRole("link").click();
  await expect(titleStatus).toHaveAttribute("data-state", "failed");
  await expect(page.getByRole("navigation", { name: "Run navigation" }).getByRole("link", { name: /checks.*Failed/ })).toBeVisible();
  await expect(emptyArtifacts).toBeVisible();
  await capture("actions-failed-summary");
  await page.getByRole("region", { name: "Run graph" }).getByRole("link", { name: "Job checks" }).click();
  await expect(checks.locator("details")).toHaveAttribute("open", "");
  await expect(checks.locator("summary .pipeline-status-icon")).toHaveAttribute("data-state", "failed");
  await logSearch.fill("validation");
  await expect(checks.getByText("Release validation failed", { exact: true })).toBeVisible();
  await capture("actions-failed-log");
  await page.getByRole("link", { name: "Back to Actions" }).click();
  await expect(page).toHaveURL(/status=failed/);
  await expect(result).toHaveCount(1);
});

test("a viewer can browse Actions without workflow write controls", async ({ page }) => {
  await installApiMocks(page, { organizations: [{ ...demoOrganization, role: "viewer" }] });
  await page.route(`${apiPath}/workflows`, route => route.fulfill({ json: { items: [
    { id: "ci", name: "read-only CI", repository, status: "published", revision: 2, version: 1 },
  ] } }));
  await page.route(`${apiPath}?**`, route => route.fulfill({ json: { items: [], has_more: false } }));
  await page.route("**/pipelines/ci/triggers", route => route.fulfill({ json: { items: [
    { id: "existing", kind: "changeset_revision", version: 1 },
  ] } }));
  await page.goto(`${pagePath}?workflow=ci`);
  await expect(page.getByRole("heading", { name: "read-only CI" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New workflow" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run workflow" })).toHaveCount(0);
  await page.getByRole("button", { name: "Triggers" }).click();
  const triggers = page.getByRole("dialog", { name: "Triggers" });
  await expect(triggers.getByText("Changeset revision · Version 1")).toBeVisible();
  await expect(triggers.getByRole("button", { name: /^(Enable trigger|Disable)$/ })).toHaveCount(0);
});

const liveOrigin = process.env.AGENTFORGE_TEST_ORIGIN;

async function openLiveRepositoryActions(page: Page) {
  const origin = new URL(liveOrigin!);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(origin.hostname);
  await page.goto(`${origin.origin}/register`);
  const password = randomUUID();
  await page.locator('[name=email]').fill(`actions-${randomUUID()}@example.test`);
  await page.locator('[name=displayName]').fill("Actions QA");
  await page.locator('[name=password]').fill(password);
  await page.locator('[name=confirmPassword]').fill(password);
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/orgs\/[^/]+\/changesets$/);
  const orgPath = new URL(page.url()).pathname.replace(/\/changesets$/, "");
  await page.goto(`${origin.origin}${orgPath}/repositories/new`);
  await page.getByLabel("Repository name", { exact: true }).fill("actions-qa");
  await page.getByRole("switch", { name: /Add a README/ }).press("Space");
  await page.getByRole("button", { name: "Create repository", exact: true }).click();
  await expect(page).toHaveURL(/\/repositories\/[^/]+\/actions-qa$/);
  await page.getByRole("link", { name: "Actions", exact: true }).click();
}

test("repository Actions persists a published workflow and its runs through the real API", async ({ page }) => {
  test.skip(!liveOrigin, "Requires a local API with PostgreSQL and Git");
  await openLiveRepositoryActions(page);
  await page.locator(".repo-actions-rail").getByRole("button", { name: "New workflow" }).click();
  await page.getByLabel("Workflow name").fill("live-ci");
  await page.getByRole("dialog").getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("button", { name: "Publish version" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Published version 1" })).toBeVisible();
  await page.getByRole("link", { name: "Back to Actions" }).click();
  await page.getByRole("button", { name: "Run workflow" }).click();
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page).toHaveURL(/\/pipeline-runs\/[^?]+\?/);
  await page.getByRole("button", { name: "Cancel run" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel run" }).click();
  await page.getByRole("button", { name: "Re-run workflow" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Re-run workflow" }).click();
  await expect(page.getByRole("link", { name: "View original run" })).toBeVisible();
  await page.getByRole("link", { name: "Back to Actions" }).click();
  await page.reload();
  await expect(page.locator(".repo-actions-run")).toHaveCount(2);
  await selectOption(page, page.getByRole("combobox", { name: "Event", exact: true }), "Re-run");
  await expect(page.locator(".repo-actions-run")).toHaveCount(1);
  await expect(page.locator(".repo-actions-run")).toContainText("live-ci");
  await page.getByRole("button", { name: "Disable workflow" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Disable workflow" }).click();
  await expect(page.getByRole("button", { name: "Enable workflow" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Disabled · Published version 1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run workflow" })).toHaveCount(0);
  await expect(page.locator(".repo-actions-run")).toHaveCount(1);
  await page.getByRole("button", { name: "Enable workflow" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Enable workflow" }).click();
  await expect(page.getByRole("button", { name: "Run workflow" })).toBeVisible();
});

// Run against an isolated local stack with the worker built from ./cmd/pipeline-worker.
test("repository Actions shows real runner states, workflow inputs, and step logs", async ({ page }, testInfo) => {
  const workerPath = process.env.AGENTFORGE_TEST_PIPELINE_WORKER;
  test.skip(!liveOrigin || !workerPath, "Requires a local API, a pipeline worker binary, and a preloaded script image");
  test.setTimeout(90_000);
  await openLiveRepositoryActions(page);
  const { organizations: [org] } = await page.evaluate(async () => {
    const me = await fetch("/api/v1/me");
    if (!me.ok) throw new Error(`Could not load test organization: ${me.status}`);
    return me.json();
  });
  const capture = (name: string) => page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  await expect(page.getByRole("heading", { name: "No workflow runs are linked to this repository yet." })).toBeVisible();
  await capture("01-empty");

  async function createWorkflow(name: string, template: string) {
    await page.locator(".repo-actions-rail").getByRole("button", { name: "New workflow" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Workflow name").fill(name);
    await dialog.getByRole("radio", { name: template, exact: true }).check();
    return dialog;
  }

  const create = await createWorkflow("release-ci", "Scripts and variables");
  await capture("02-template");
  await create.getByRole("button", { name: "Create", exact: true }).click();
  const producer = page.getByRole("button", { name: "Step make-tag", exact: true });
  const shell = page.getByRole("textbox", { name: "Shell script", exact: true });
  const script = `if [ "$AF_PARAM_VERSION" = invalid ]; then\n  printf 'Release validation failed\\n'\n  exit 2\nfi\nprintf 'TAG=v%s\\n' "$AF_PARAM_VERSION" >> "$FLOW_ENV"`;
  await producer.click();
  await shell.fill(script);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Revision 2" })).toBeVisible();
  await page.reload();
  await producer.click();
  await expect(shell).toHaveValue(script);
  await expect(page.getByRole("textbox", { name: "Variable name 1" })).toHaveValue("TAG");
  await capture("03-workflow-config");
  const publish = async () => {
    await page.getByRole("button", { name: "Publish version" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Published version 1" })).toBeVisible();
    await page.getByRole("link", { name: "Back to Actions" }).click();
  };
  await publish();
  await page.getByRole("button", { name: "Triggers" }).click();
  const triggers = page.getByRole("dialog", { name: "Triggers" });
  await selectOption(page, triggers.getByRole("combobox", { name: "Event" }), "Schedule");
  await triggers.getByLabel("Interval in minutes").fill("60");
  await triggers.getByRole("button", { name: "Enable trigger" }).click();
  await expect(triggers.getByText(/Schedule · Version 1 · Every 60 min/)).toBeVisible();
  await capture("04-trigger");
  await triggers.getByRole("button", { name: "Close", exact: true }).click();

  const runState = (status: RegExp) => page.getByRole("status").filter({ hasText: status });
  async function startRun(version?: string) {
    await page.getByRole("button", { name: "Run workflow" }).click();
    if (version) await page.getByRole("textbox", { name: "VERSION", exact: true }).fill(version);
    await page.getByRole("button", { name: "Start run" }).click();
    await expect(page.getByRole("region", { name: "Run graph" })).toBeVisible();
  }
  await startRun("2.4.0");
  await expect(runState(/Version 1 · queued/i)).toBeVisible();
  await capture("05-queued");

  const env = { ...process.env, PIPELINE_RUNNER_TOKEN: randomBytes(32).toString("hex") };
  execFileSync(workerPath!, ["register", org.id, "container/script@v1", "control/approval@v1"], { env });
  const worker = spawn(workerPath!, [], { env, stdio: ["ignore", "ignore", "inherit"] });
  try {
    await expect(runState(/Version 1 · Succeeded/)).toBeVisible({ timeout: 20_000 });
    await capture("06-succeeded");
    await page.getByRole("region", { name: "Run graph" }).getByRole("link", { name: "Job publish" }).click();
    await page.getByRole("searchbox", { name: "Search logs" }).fill("Release v2.4.0");
    await expect(page.getByText("Release v2.4.0", { exact: true })).toBeVisible();
    await capture("07-success-log");
    await page.getByRole("link", { name: "Back to Actions" }).click();
    await startRun("invalid");
    await expect(runState(/Version 1 · Failed/)).toBeVisible({ timeout: 20_000 });
    const failedRun = page.url();
    await page.getByRole("region", { name: "Run graph" }).getByRole("link", { name: "Job package" }).click();
    await expect(page.getByRole("region", { name: "Job package" }).locator("details")).toHaveAttribute("open", "");
    await page.getByRole("searchbox", { name: "Search logs" }).fill("validation");
    await expect(page.getByText("Release validation failed", { exact: true })).toBeVisible();
    await capture("08-failed-log");
    await page.getByRole("button", { name: "Re-run workflow" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Re-run workflow" }).click();
    await expect(page.getByRole("link", { name: "View original run" })).toHaveAttribute("href", new URL(failedRun).pathname + new URL(failedRun).search);
    await expect(runState(/Version 1 · Failed/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("definition").filter({ hasText: "invalid" })).toBeVisible();
    await capture("09-rerun");
    await page.getByRole("link", { name: "Back to Actions" }).click();

    const approval = await createWorkflow("deploy-approval", "Manual approval");
    await approval.getByRole("button", { name: "Create", exact: true }).click();
    await publish();
    await startRun();
    const review = page.getByRole("button", { name: "Review approve" });
    await expect(review).toBeVisible({ timeout: 20_000 });
    await expect(runState(/Version 1 · Running/)).toBeVisible();
    await capture("10-waiting-approval");
    await page.getByRole("link", { name: "Back to Actions" }).click();
    await page.getByRole("link", { name: "All workflows", exact: true }).click();
    const rows = page.locator(".repo-actions-run");
    await expect(rows).toHaveCount(4);
    await expect(rows.getByRole("img", { name: "Failed", exact: true })).toHaveCount(2);
    await expect(rows.getByRole("img", { name: "Succeeded", exact: true })).toHaveCount(1);
    await expect(rows.getByRole("img", { name: "Running", exact: true })).toHaveCount(1);
    await capture("11-run-list");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await capture("12-mobile");
    await page.setViewportSize({ width: 1440, height: 900 });
    await selectOption(page, page.getByRole("combobox", { name: "Status", exact: true }), "Failed");
    await expect(rows).toHaveCount(2);
    await capture("13-filtered");
    await rows.first().getByRole("link").click();
    await page.getByRole("link", { name: "Back to Actions" }).click();
    await expect(page).toHaveURL(/status=failed/);
    await expect(rows).toHaveCount(2);
    await selectOption(page, page.getByRole("combobox", { name: "Status", exact: true }), "Timed out");
    await expect(page.getByRole("heading", { name: "No runs match these filters" })).toBeVisible();
    await capture("14-no-filter-matches");
  } finally {
    if (worker.exitCode === null && worker.signalCode === null) {
      const exited = once(worker, "exit");
      worker.kill();
      await exited;
    }
  }
});
