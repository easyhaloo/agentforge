import { expect, test, type Page } from "@playwright/test";
import { installApiMocks } from "./support/api-mocks";
import { selectOption } from "./support/select-option";
import type { Pipeline } from "../src/shared/api/pipelines";

async function openCreation(page: Page) {
  await page.locator(".heading-actions").getByRole("button", { name: "Create", exact: true }).click();
  return page.getByRole("dialog", { name: "Create pipeline" });
}

test("an owner creates, edits and publishes the saved workflow revision", async ({ page }) => {
  await installApiMocks(page);
  let pipeline: Pipeline | undefined;
  await page.route("**/api/v1/organizations/org-demo/pipelines**", async route => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: req.url().endsWith("/pipelines") ? { items: pipeline ? [pipeline] : [] } : pipeline });
    const body = req.postDataJSON();
    if (req.method() === "POST" && req.url().endsWith("/pipelines")) pipeline = { id: pipeline ? "second" : "p", status: "draft", revision: 1, version: 0, name: body.name, definition: body };
    else if (pipeline) {
      expect(body.revision).toBe(pipeline.revision);
      pipeline.revision++;
      if (req.method() === "PUT") { pipeline.definition = body.definition; pipeline.name = body.definition.name; }
      else { expect(req.url()).toMatch(/\/publish$/); pipeline.status = "published"; pipeline.version++; }
    }
    return route.fulfill({ json: pipeline });
  });
  await page.goto("/orgs/demo/pipelines");
  await (await openCreation(page)).getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Revision 1" })).toBeVisible();
  await page.getByLabel("Workflow name").fill("new-release");
  await expect(page.getByRole("button", { name: "Publish version" })).toBeDisabled();
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Publish version" }).click();
  await expect(page.getByRole("status").filter({ hasText: "published · Revision 3 · Published version 1" })).toBeVisible();
  expect(pipeline?.definition.name).toBe("new-release");
  await expect(page).toHaveURL(/\/pipelines\/p\/edit$/);
  await expect(page.locator(".shell, .topbar, footer")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", {name:"new-release"})).toBeVisible();
  await page.getByRole("link", {name:"Back to pipelines"}).click();
  await expect(page).toHaveURL(/\/orgs\/demo\/pipelines$/);
  await expect(page.getByRole("link", {name:"new-release"})).toHaveAttribute("href", "/orgs/demo/pipelines/p/edit");
  await expect(page.getByRole("region", {name:"Workflow graph"})).toHaveCount(0);
  const dialog = await openCreation(page);
  await expect(dialog.getByLabel("Workflow name")).toHaveValue("release");
  await dialog.getByLabel("Workflow name").fill("next");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Revision 1" })).toBeVisible();
  expect(pipeline?.id).toBe("second");
  expect(pipeline?.name).toBe("next");
});

test("visual authoring prevents dependency cycles and a run uses the selected published version", async ({ page }) => {
  await installApiMocks(page);
  let created: Pipeline | undefined;
  let snapshot = { status: "queued", stepStatuses: { approve: "queued", step1: "queued" } };
  await page.route("**/pipeline-runs/run-1", route => route.fulfill({json: {id:"run-1", version:1, ...snapshot}}));
  await page.route("**/api/v1/organizations/org-demo/pipelines**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/versions")) return route.fulfill({ json: { items: [2, 1].map(number => ({number, checksum:"a".repeat(64), publishedAt:new Date().toISOString(), definition: number === 1 ? created!.definition : { ...created!.definition, name:"second-version", parameters: [] }})) } });
    if (url.pathname.endsWith("/versions/1/runs")) {
      expect(route.request().postDataJSON()).toEqual({ attempts: 3 });
      return route.fulfill({ json: { id: "run-1", version: 1, status: "queued" } });
    }
    if (route.request().method() === "GET") return route.fulfill({ json: url.pathname.endsWith("/p") ? created : {items: []} });
    if (url.pathname.endsWith("/publish")) {
      created = { ...created!, revision:3,version:2,status:"published" };
    } else if (route.request().method() === "PUT") {
      const {definition} = route.request().postDataJSON();
      expect(definition.stages[1].jobs[0].id).toBe("checks");
      expect(definition.stages[1].jobs[0].steps[0].uses).toBe("container/check@v1");
      created = {...created!, revision:2, definition};
    } else {
      const definition = route.request().postDataJSON();
      created = { id:"p", name:definition.name, revision:1, version:0, status:"draft", definition };
    }
    return route.fulfill({ json: created });
  });
  await page.goto("/orgs/demo/pipelines");
  await (await openCreation(page)).getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByLabel("Workflow definition (JSON)")).toHaveCount(0);
  await page.getByRole("button", { name:"Add stage" }).click();
  await expect(page.getByLabel("Stage ID")).toHaveValue("stage1");
  await page.getByRole("button", { name: "Stage review", exact: true }).click();
  await expect(page.getByRole("checkbox", { name:"Depends on stage1" })).toBeDisabled();
  await page.getByRole("button", { name: "Workflow settings" }).click();
  await page.getByRole("button", { name: "Add parameter" }).click();
  await page.getByLabel("Parameter name").fill("attempts");
  await selectOption(page, page.getByLabel("Parameter type"), "integer");
  await selectOption(page, page.getByLabel("Run input"), "Enter on every run");
  await page.getByRole("button", { name: "Add parameter" }).click();
  await page.getByLabel("Parameter name").last().fill("enabled");
  await selectOption(page, page.getByLabel("Parameter type").last(), "boolean");
  await page.getByRole("button", { name: "Job job1", exact: true }).click();
  await page.getByLabel("Job ID").fill("checks");
  await page.getByRole("button", { name: "Step step1", exact: true }).press("Enter");
  await selectOption(page, page.getByLabel("Capability for step1"), /container/);
  await page.getByRole("button", { name:"Save draft" }).click();
  await page.getByRole("button", { name:"Publish version" }).click();
  const openRun = page.locator(".wf-editor-heading").getByRole("button", { name:"Run", exact: true });
  await openRun.click();
  await selectOption(page, page.getByRole("combobox", { name: "Published version", exact: true }), /^1 · /);
  await selectOption(page, page.getByRole("combobox", { name: "enabled", exact: true }), "true");
  await selectOption(page, page.getByRole("combobox", { name: "enabled", exact: true }), "Select a value");
  await expect(page.getByRole("button", { name:"Start run" })).toBeDisabled();
  await page.getByRole("spinbutton", { name: "attempts", exact: true }).fill("3");
  await page.getByRole("button", { name:"Start run" }).click();
  await expect(page.getByRole("status").filter({ hasText:"Run run-1 · Version 1 · queued" })).toBeVisible();
  const canvas = page.getByRole("region", { name: "Run graph" });
  await openRun.click();
  await expect(page.getByRole("combobox", { name: "Published version", exact: true })).toContainText("2 ·");
  await selectOption(page, page.getByRole("combobox", { name: "Published version", exact: true }), /^1 · /);
  await expect(page.getByRole("spinbutton", { name:"attempts" })).toHaveValue("");
  await page.getByRole("button", { name:"Cancel", exact:true }).click();
  await expect(canvas.locator("header")).not.toContainText("second-version");
  snapshot = {status:"running", stepStatuses:{approve:"waiting", step1:"queued"}};
  await expect(canvas.getByText("Waiting for approval").first()).toBeVisible();
  snapshot = {status:"failed", stepStatuses:{approve:"failed", step1:"cancelled"}};
  await expect(canvas.locator("header")).toContainText("Failed");
  await expect(canvas.locator(".wf-step").filter({hasText:"step1"})).toContainText("Cancelled");
});


test("a template can be configured directly on the canvas without a JSON editor", async ({ page }) => {
  await installApiMocks(page);
  let posts = 0;
  let pipeline: Pipeline;
  await page.route("**/api/v1/organizations/org-demo/pipelines/p", route => route.fulfill({json:pipeline}));
  await page.route("**/api/v1/organizations/org-demo/pipelines", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: {items: []} });
    const definition = route.request().postDataJSON();
    if (++posts === 1) return route.fulfill({ status: 409, json: {} });
    pipeline = {id:"p",name:definition.name,definition,status:"draft",revision:1,version:0};
    return route.fulfill({status:201, json:pipeline});
  });
  await page.goto("/orgs/demo/pipelines");
  await expect(page.getByText("No pipelines yet")).toBeVisible();
  const dialog = await openCreation(page);
  await dialog.getByRole("button", {name:"Cancel"}).click();
  expect(posts).toBe(0);
  await openCreation(page);
  await dialog.getByRole("radio", { name:"Check then approve" }).check();
  await dialog.getByRole("button", { name:"Create", exact:true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name:"Create", exact:true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Workflow name")).toHaveValue("check-and-approve");
  await expect(page.getByRole("button", { name: "Edit JSON" })).toHaveCount(0);
  await expect(page.getByLabel("Workflow definition (JSON)")).toHaveCount(0);
  await page.getByRole("button", { name: "Step check", exact: true }).click();
  await page.getByLabel("Step ID").fill("lint");
  await expect(page.getByRole("button", { name: "Step lint", exact: true })).toBeVisible();
  const canvas = page.getByRole("region", {name:"Workflow graph"});
  expect(await canvas.evaluate(el => window.innerHeight - el.getBoundingClientRect().bottom)).toBeLessThan(32);
  await page.getByRole("link", {name:"Back to pipelines"}).click();
  const discard = page.getByRole("dialog", {name:"Discard unsaved changes?"});
  await discard.getByRole("button", {name:"Cancel"}).click();
  await expect(page.getByLabel("Step ID")).toHaveValue("lint");
  await page.goBack();
  await discard.getByRole("button", {name:"Confirm"}).click();
  await expect(page).toHaveURL(/\/orgs\/demo\/pipelines$/);
});

test("queue promotion is offered only for the ready head", async ({ page }) => {
  await installApiMocks(page);
  const definition = { apiVersion: "agentforge/v1", name: "checks", stages: [], parameters: [] };
  const pipeline = { id: "checks", name: "checks", status: "published", version: 1, revision: 2, definition };
  await page.route("**/api/v1/organizations/org-demo/pipelines**", route => {
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith("/versions") ? { items: [{ number: 1, checksum: "abc", definition }] }
      : path.endsWith("/checks") ? pipeline : { items: [pipeline] };
    return route.fulfill({ json });
  });
  const entries = ["first", "second"].map((source, i) => ({ id: i + 1, repository: "team/repo", target: "main", source, sourceSHA: String(i).repeat(40), status: "ready", runId: source, candidateSHA: String(i + 1).repeat(40) }));
  await page.route("**/org-demo/merge-queue?*", route => route.fulfill({ json: { items: entries } }));
  await page.route("**/pipeline-runs/first/promote", route => {
    expect(route.request().postDataJSON()).toEqual({candidateSHA: entries[0].candidateSHA});
    entries.splice(0); return route.fulfill({ json: { promotedSHA: "1".repeat(40) } });
  });
  await page.goto("/orgs/demo/pipelines");
  await page.getByRole("link", {name:"checks",exact:true}).click();
  await page.getByText("Merge queue", { exact: true }).click();
  await page.getByLabel("Registered repository").fill("team/repo");
  await page.getByRole("button", { name: "Refresh queue" }).click();
  await expect(page.getByRole("button", { name: "Promote candidate" })).toHaveCount(1);
  await page.getByRole("listitem").filter({ hasText: "first" }).getByRole("button", { name: "Promote candidate" }).click();
  await expect(page.getByText("The queue is empty.")).toBeVisible();
});


test("canvas lays out forward references, independent roots and an implicit dependency", async ({ page }) => {
  await installApiMocks(page);
  const stages = [{id:"join", dependsOn:["build","test"]}, {id:"deploy"}, {id:"build",dependsOn:[]}, {id:"test",dependsOn:[]}];
  const definition = { apiVersion: "agentforge.dev/v1", name: "layout", stages: stages.map(s => ({ ...s, jobs: [{ id: `job-${s.id}`, steps: [{ id: `step-${s.id}`, uses: "control/approval@v1" }] }] })) };
  const pipeline = { id: "layout", name: definition.name, definition, status: "archived", version: 0, revision: 1 };
  await page.route("**/api/v1/organizations/org-demo/pipelines", route => route.fulfill({ json: { items: [pipeline] } }));
  await page.route("**/pipelines/layout", route => route.fulfill({ json: pipeline }));
  await page.goto("/orgs/demo/pipelines");
  await page.getByRole("link", {name:"layout",exact:true}).click();
  await expect(page.getByLabel("Workflow definition (JSON)")).toHaveCount(0);
  const canvas = page.getByRole("region", {name:"Workflow graph"});
  await expect(canvas.locator(".wf-column").first().locator("summary strong")).toHaveText(["build","test"]);
  await expect(canvas.locator(".wf-column").last().locator("summary strong")).toHaveText("deploy");
  await expect(canvas.locator("path[marker-end]")).toHaveCount(3);
  await canvas.locator("summary").first().press("Enter");
  await expect(canvas.locator("details").first().locator(".wf-body")).toBeHidden();
});

test("脚本模板在独立画布上保存脚本和输出变量", async ({ page }, testInfo) => {
  await installApiMocks(page);
  await page.addInitScript(() => localStorage.setItem("agentforge-language", "zh-CN"));
  let pipeline: Pipeline;
  await page.route("**/api/v1/organizations/org-demo/pipelines**", route => {
    const req = route.request();
    if (req.method() === "POST") {
      const definition = req.postDataJSON();
      pipeline = { id: "script", name: definition.name, definition, status: "draft", revision: 1, version: 0 };
    } else if (req.method() === "PUT") {
      pipeline.definition = req.postDataJSON().definition;
      pipeline.revision++;
    }
    return route.fulfill({ json: req.url().endsWith("/pipelines") && req.method() === "GET" ? { items: [] } : pipeline });
  });
  await page.goto("/orgs/demo/pipelines");
  await page.locator(".heading-actions").getByRole("button", { name: "创建", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建流水线" });
  await dialog.getByRole("radio", { name: "脚本与变量传递" }).check();
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page).toHaveURL(/\/pipelines\/script\/edit$/);
  const producer = page.getByRole("button", { name: "步骤 make-tag", exact: true });
  const script = `printf 'TAG=v%s\\n' "$AF_PARAM_VERSION" >> "$FLOW_ENV"\nprintf 'CHANNEL=stable\\n' >> "$FLOW_ENV"`;
  await producer.click();
  await page.getByRole("textbox", { name: "Shell 脚本", exact: true }).fill(script);
  const addVariable = page.getByRole("button", { name: "添加变量" });
  const variables = page.getByRole("group", { name: "输出变量" });
  const second = variables.getByRole("textbox", { name: "变量名 2" });
  await addVariable.click();
  await second.fill("TAG");
  await expect(page.getByRole("button", { name: "保存草稿" })).toBeDisabled();
  await second.fill("CHANNEL");
  await addVariable.click();
  await variables.getByRole("button", { name: "删除变量 3" }).click();
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByRole("status").filter({ hasText: "修订 2" })).toBeVisible();
  await page.reload();
  await producer.click();
  await expect(page.getByRole("textbox", { name: "Shell 脚本", exact: true })).toHaveValue(script);
  await expect(variables.getByRole("textbox")).toHaveCount(2);
  await expect(variables.getByRole("textbox", { name: "变量名 1" })).toHaveValue("TAG");
  await expect(second).toHaveValue("CHANNEL");
  await page.screenshot({ path: testInfo.outputPath("output-variable-form.png"), fullPage: true });
  await page.getByRole("button", { name: "步骤 read-tag", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Shell 脚本", exact: true })).toHaveValue(/\$AF_VAR_TAG/);
  await page.screenshot({ path: testInfo.outputPath("script-consumer.png") });
  await producer.click();
  await selectOption(page, page.getByLabel("make-tag 的能力"), "人工审批");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByRole("status").filter({ hasText: "修订 3" })).toBeVisible();
  expect(pipeline!.definition.stages[0].jobs[0].steps[0]).toEqual({ id: "make-tag", uses: "control/approval@v1" });
});

test("画布参数联动运行弹窗并按所选版本执行", async ({ page }, testInfo) => {
  await installApiMocks(page);
  await page.addInitScript(() => localStorage.setItem("agentforge-language", "zh-CN"));
  const definition = { apiVersion: "agentforge.dev/v1", name: "script-release", stages: [{ id: "build", jobs: [{ id: "package", steps: [{ id: "make-tag", uses: "container/script@v1", script: 'echo "$AF_PARAM_VERSION"' }] }] }],
    parameters: [{ name: "VERSION", type: "string", default: "1.0.0", override: true }, { name: "ENV", type: "string", default: "staging" }, { name: "CHANNEL", type: "choice", choices: ["stable", "beta"], required: true, override: true }] };
  let pipeline = { id: "script", name: definition.name, definition, version: 1, revision: 2, status: "published" };
  const versions = [{ number: 1, checksum: "edede3e783b8", definition }];
  await page.route("**/pipelines/script/draft", route => {
    const body = route.request().postDataJSON();
    expect(body.revision).toBe(2);
    pipeline = { ...pipeline, definition: body.definition, revision: 3, status: "draft" };
    return route.fulfill({ json: pipeline });
  });
  await page.route("**/pipelines/script/publish", route => {
    expect(route.request().postDataJSON()).toEqual({ revision: 3 });
    pipeline = { ...pipeline, revision: 4, version: 2, status: "published" };
    versions.push({ number: 2, checksum: "713f2e20be18", definition: pipeline.definition });
    return route.fulfill({ json: pipeline });
  });
  const receipt = { id: "run-2", version: 2, status: "queued" };
  let attempts = 0;
  await page.route("**/pipelines/script/versions/2/runs", route => {
    expect(route.request().postDataJSON()).toEqual({ RELEASE: "2.4.7", CHANNEL: "beta" });
    return ++attempts === 1 ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: receipt });
  });
  await page.route("**/pipeline-runs/run-2", route => route.fulfill({ json: receipt }));
  await page.route("**/pipelines/script", route => route.fulfill({ json: pipeline }));
  await page.route("**/pipelines/script/versions", route => route.fulfill({ json: {items: versions} }));
  await page.goto("/orgs/demo/pipelines/script/edit");
  const launch = page.locator(".wf-editor-heading").getByRole("button", { name: "运行", exact: true });
  const settings = page.getByRole("group", { name: "参数 VERSION", exact: true });
  await settings.getByLabel("默认值", { exact: true }).fill("2.0.0");
  await settings.getByLabel("参数名称").fill("RELEASE");
  await page.screenshot({ path: testInfo.outputPath("linked-config.png") });
  await launch.click();
  const dialog = page.getByRole("dialog", { name: "运行流水线" });
  const config = dialog.getByLabel("配置版本");
  await expect(dialog.getByLabel("RELEASE", { exact: true })).toHaveValue("2.0.0");
  await expect(dialog.getByLabel("VERSION", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("ENV", { exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "发布并运行" })).toBeDisabled();
  await selectOption(page, config, /^1 · /);
  await expect(dialog.getByLabel("VERSION", { exact: true })).toHaveValue("1.0.0");
  await expect(dialog.getByLabel("RELEASE", { exact: true })).toHaveCount(0);
  await selectOption(page, config, "当前画布（待发布）");
  await selectOption(page, dialog.getByLabel("CHANNEL"), "beta");
  await page.screenshot({ path: testInfo.outputPath("linked-draft.png") });
  await dialog.getByLabel("RELEASE", { exact: true }).fill("2.4.7");
  await dialog.getByRole("button", { name: "发布并运行" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("已发布版本")).toContainText("2 ·");
  await expect(dialog.getByLabel("RELEASE", { exact: true })).toHaveValue("2.4.7");
  await dialog.getByRole("button", { name: "开始运行" }).click();
  await expect(page.getByRole("status").filter({ hasText: "运行 run-2 · 版本 2" })).toBeVisible();
  expect(versions).toHaveLength(2);
  await launch.click();
  await expect(dialog.getByLabel("RELEASE", { exact: true })).toHaveValue("2.0.0");
  await expect(dialog.getByRole("button", { name: "开始运行" })).toBeDisabled();
});
