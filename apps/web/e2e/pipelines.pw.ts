import { expect, test } from "@playwright/test";
import { installApiMocks } from "./support/api-mocks";
import type { Pipeline } from "../src/shared/api/pipelines";

test("an owner creates, edits and publishes the saved workflow revision", async ({ page }) => {
  await installApiMocks(page);
  let pipeline: Pipeline | undefined;
  await page.route("**/api/v1/organizations/org-demo/pipelines**", async route => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: { items: [] } });
    const body = req.postDataJSON();
    if (!pipeline) pipeline = { id: "p", status: "draft", revision: 1, version: 0, name: body.name, definition: body };
    else {
      expect(body.revision).toBe(pipeline.revision);
      pipeline.revision++;
      if (req.method() === "PUT") { pipeline.definition = body.definition; pipeline.name = body.definition.name; }
      else { expect(req.url()).toMatch(/\/publish$/); pipeline.status = "published"; pipeline.version++; }
    }
    return route.fulfill({ json: pipeline });
  });
  await page.goto("/orgs/demo/pipelines");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Revision 1" })).toBeVisible();
  const editor = page.getByLabel("Workflow definition (JSON)");
  const def = JSON.parse(await editor.inputValue());
  await editor.fill(JSON.stringify({ ...def, name: "new-release" }));
  await expect(page.getByRole("button", { name: "Publish version" })).toBeDisabled();
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Publish version" }).click();
  await expect(page.getByRole("status").filter({ hasText: "published · Revision 3 · Published version 1" })).toBeVisible();
  expect(pipeline?.definition.name).toBe("new-release");
});

test("visual authoring prevents dependency cycles and a run uses the selected published version", async ({ page }) => {
  await installApiMocks(page);
  let created: Pipeline | undefined;
  await page.route("**/api/v1/organizations/org-demo/pipelines**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/versions")) return route.fulfill({ json: { items: [2, 1].map(number => ({number, checksum:"a".repeat(64), publishedAt:new Date().toISOString(), definition: number === 1 ? created!.definition : { ...created!.definition, parameters: [] }})) } });
    if (url.pathname.endsWith("/versions/1/runs")) {
      expect(route.request().postDataJSON()).toEqual({ attempts: 3 });
      return route.fulfill({ json: { id: "run-1", version: 1, status: "queued" } });
    }
    if (route.request().method() === "GET") return route.fulfill({ json: { items: [] } });
    if (url.pathname.endsWith("/publish")) {
      created = { ...created!, revision:3,version:2,status:"published" };
    } else {
      const definition = route.request().postDataJSON();
      expect(definition.stages[1].jobs[0].steps[0].uses).toBe("container/check@v1");
      created = { id:"p", name:definition.name, revision:1, version:0, status:"draft", definition };
    }
    return route.fulfill({ json: created });
  });
  await page.goto("/orgs/demo/pipelines");
  await page.getByRole("button", { name:"Visual editor" }).click();
  await page.getByRole("button", { name:"Add stage" }).click();
  await expect(page.getByRole("checkbox", { name:"Depends on stage1" })).toBeDisabled();
  await page.getByRole("button", { name: "Add parameter" }).click();
  await page.getByLabel("Parameter name").fill("attempts");
  await page.getByLabel("Parameter type").selectOption("integer");
  await page.getByRole("button", { name: "Add parameter" }).click();
  await page.getByLabel("Parameter name").last().fill("enabled");
  await page.getByLabel("Parameter type").last().selectOption("boolean");
  await page.getByLabel("Capability for step1").selectOption("container/check@v1");
  await page.getByRole("button", { name:"Create draft" }).click();
  await page.getByRole("button", { name:"Publish version" }).click();
  await page.getByRole("button", { name:"View published versions" }).click();
  await page.getByRole("combobox", { name: "Published version", exact: true }).selectOption("1");
  await page.getByRole("combobox", { name: "enabled", exact: true }).selectOption("true");
  await page.getByRole("combobox", { name: "enabled", exact: true }).selectOption("");
  await page.getByRole("spinbutton", { name: "attempts", exact: true }).fill("3");
  await page.getByRole("button", { name:"Start run" }).click();
  await expect(page.getByRole("status").filter({ hasText:"Run run-1 · Version 1 · queued" })).toBeVisible();
});


test("a template opens in the editor and malformed dependencies leave the JSON intact", async ({ page }) => {
  await installApiMocks(page);
  await page.route("**/pipelines", route => route.request().resourceType() === "document" ? route.continue() : route.fulfill({ json: { items: [] } }));
  await page.goto("/orgs/demo/pipelines");
  await page.getByLabel("Workflow template").selectOption("check");
  await expect(page.getByLabel("Workflow name")).toHaveValue("check-and-approve");
  await page.getByRole("button", { name: "Edit JSON" }).click();
  const editor = page.getByLabel("Workflow definition (JSON)");
  const definition = JSON.parse(await editor.inputValue());
  definition.stages[0].dependsOn = "review";
  const invalid = JSON.stringify(definition);
  await editor.fill(invalid);
  await page.getByRole("button", { name: "Visual editor" }).click();
  await expect(page.getByRole("alert")).toContainText("Fix the workflow JSON");
  await expect(editor).toHaveValue(invalid);
});
