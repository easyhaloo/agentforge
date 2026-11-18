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
