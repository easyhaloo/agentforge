// Run against a local development workspace with a registered container/script@v1 runner.
// AF_SESSION is a Playwright storageState file for an owner. AF_EVIDENCE is an output directory.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const { AF_SESSION, AF_EVIDENCE, AF_ORIGIN = 'http://127.0.0.1:5173', AF_ORG } = process.env;
if (!AF_SESSION || !AF_EVIDENCE || !AF_ORG) throw new Error('Set AF_SESSION, AF_ORG and AF_EVIDENCE.');
if (!['localhost', '127.0.0.1'].includes(new URL(AF_ORIGIN).hostname)) throw new Error('Use a local development workspace.');
await mkdir(AF_EVIDENCE, { recursive: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ baseURL: AF_ORIGIN, storageState: AF_SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 960 } });
  await context.addInitScript(() => localStorage.setItem('agentforge-language', 'zh-CN'));
  const page = await context.newPage();
  const name = `release-check-${Date.now().toString(36)}`;
  const snapshot = file => page.screenshot({ path: join(AF_EVIDENCE, file) });
  await page.goto(`/orgs/${encodeURIComponent(AF_ORG)}/pipelines`);
  await page.locator('.heading-actions').getByRole('button', { name: '创建', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: '脚本与变量传递' }).check();
  await dialog.getByLabel('工作流名称').fill(name);
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await page.getByLabel('默认值', { exact: true }).fill('2.0.0');
  await page.getByRole('button', { name: '步骤 read-tag', exact: true }).click();
  await page.getByRole('textbox', { name: 'Shell 脚本', exact: true }).fill('set -eu\ntest "$AF_VAR_TAG" = "v2.4.7"\nprintf "Release %s\\n" "$AF_VAR_TAG"');
  await expect(page.getByRole('region', { name: '执行画布' })).toHaveCount(0);
  await snapshot('canvas.png');
  await page.getByRole('button', { name: '运行', exact: true }).click();
  const version = dialog.getByLabel('VERSION', { exact: true });
  await expect(version).toHaveValue('2.0.0');
  await version.fill('2.4.7');
  await snapshot('parameters.png');
  let starts = 0;
  page.on('request', r => { if (r.method() === 'POST' && /\/versions\/\d+\/runs$/.test(r.url())) starts++; });
  const started = page.waitForResponse(r => r.request().method() === 'POST' && /\/versions\/\d+\/runs$/.test(r.url()));
  await dialog.getByRole('button', { name: '发布并运行' }).click();
  const response = await started;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON()).toEqual({ VERSION: '2.4.7' });
  const receipt = await response.json();
  await expect(page).toHaveURL(url => url.pathname.endsWith(`/pipeline-runs/${receipt.id}`));
  const graph = page.getByRole('region', { name: '执行画布' });
  await expect(graph.locator('header [data-state]')).toHaveAttribute('data-state', 'succeeded', { timeout: 90000 });
  await page.reload();
  await expect(graph.locator('header [data-state]')).toHaveAttribute('data-state', 'succeeded');
  await expect(page.getByRole('region', { name: '流水线画布' })).toHaveCount(0);
  expect(starts).toBe(1);
  const run = await page.evaluate(async ({ org, id }) => {
    const result = await fetch(`/api/v1/organizations/${encodeURIComponent(org)}/pipeline-runs/${encodeURIComponent(id)}`);
    if (!result.ok) throw new Error(`Read run returned ${result.status}`);
    return result.json();
  }, { org: AF_ORG, id: receipt.id });
  expect(run.inputs).toMatchObject({ VERSION: '2.4.7' });
  await expect(page.locator('.wf-run-inputs')).toContainText('2.4.7');
  expect(run.stepStatuses).toMatchObject({ 'make-tag': 'succeeded', 'read-tag': 'succeeded' });
  await writeFile(join(AF_EVIDENCE, 'run.json'), JSON.stringify({ workflow: name, inputs: response.request().postDataJSON(), run }, null, 2));
  await graph.scrollIntoViewIfNeeded();
  await snapshot('execution.png');
  await page.getByRole('link', { name: '返回流水线列表' }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();
  await expect(page.locator('.heading-actions').getByRole('button', { name: '创建' })).toBeEnabled();
  await snapshot('list.png');
  console.log(`Verified ${name}, run ${run.id}, version ${run.version}, ${run.status}`);
} finally {
  await browser.close();
}
