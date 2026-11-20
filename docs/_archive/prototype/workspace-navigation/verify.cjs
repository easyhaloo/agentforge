const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

async function verify(screenshotDir) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    const start = pathToFileURL(join(__dirname, 'index.html')).href;
    page.on('pageerror', error => errors.push(error.message));
    if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
    const shot = async name => {
      if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `${name}.png`), fullPage: true });
    };
    const heading = title => page.getByRole('heading', { level: 1, name: title, exact: true }).waitFor();
    const chooseLab = async () => {
      await page.getByLabel('切换组织').click();
      await page.getByRole('link', { name: '北辰实验室', exact: true }).click();
    };

    await page.goto(start);
    await heading('工作台');
    await shot('01-workspace');
    const workTabs = page.getByRole('navigation', { name: '待办筛选' });
    await workTabs.getByRole('link', { name: /我发起的/ }).click();
    await workTabs.locator('[aria-current="page"]').filter({ hasText: '我发起的' }).waitFor();
    assert.equal(new URL(page.url()).hash, '#/studio/home/mine');
    await page.getByRole('button', { name: '打开导航菜单' }).click();
    await page.getByRole('dialog', { name: '全局导航' }).waitFor();
    await shot('08-navigation-drawer');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: '全局导航' }).waitFor({ state: 'hidden' });
    await page.getByRole('link', { name: '查看评审待办' }).click();
    await heading('待我评审');
    await page.getByRole('link', { name: /接入组织级评审队列/ }).click();
    await heading('接入组织级评审队列');
    await page.getByRole('heading', { name: 'src/index.ts · 修订 3' }).waitFor();
    await shot('02-review');
    await chooseLab();
    await page.getByText('当前组织没有待你处理的评审。').waitFor();
    assert.equal(new URL(page.url()).hash, '#/lab/review');
    await shot('03-org-switch');
    await page.goBack();
    await heading('接入组织级评审队列');

    await page.getByRole('button', { name: '打开导航菜单' }).click();
    await page.getByRole('dialog').getByRole('link', { name: '代码仓库' }).click();
    await heading('代码仓库');
    await page.getByRole('link', { name: /agentforge 开发工作台/ }).click();
    await heading('agentforge');
    await shot('04-repository');
    const repoTabs = page.getByRole('navigation', { name: '仓库导航' });
    await repoTabs.getByRole('link', { name: '变更集' }).click();
    await page.getByRole('heading', { name: '仓库变更' }).waitFor();
    assert.equal(await page.getByRole('link', { name: /优化流水线参数校验/ }).count(), 0);
    await repoTabs.getByRole('link', { name: '流水线' }).click();
    await page.getByRole('link', { name: /主分支构建/ }).waitFor();
    assert.equal(await page.getByRole('link', { name: /预发部署/ }).count(), 0);
    await repoTabs.getByRole('link', { name: '代码', exact: true }).click();
    await page.getByRole('link', { name: /src\/index.ts 更新应用入口/ }).click();
    await heading('src/index.ts');
    const fileLink = page.url();
    assert.equal(new URL(fileLink).hash, '#/studio/repos/agentforge/file/8fa2c1d/src%2Findex.ts');
    await shot('05-file');
    await page.getByRole('link', { name: '在 WebIDE 中打开' }).click();
    await heading('WebIDE');
    assert.equal(new URL(page.url()).hash, '#/studio/repos/agentforge/ide/8fa2c1d/src%2Findex.ts');
    assert.match(await page.getByRole('textbox', { name: 'src/index.ts' }).inputValue(), /agentforge/);
    await shot('06-webide');
    await page.goBack();
    await heading('src/index.ts');
    await page.reload();
    await heading('src/index.ts');
    assert.equal(page.url(), fileLink);
    await chooseLab();
    await heading('代码仓库');
    assert.equal(new URL(page.url()).hash, '#/lab/repos');
    await page.getByRole('link', { name: /data-lab/ }).waitFor();
    await page.goto(start + '#/lab/repos/agentforge/ide/8fa2c1d/src%2Findex.ts');
    await heading('未找到该记录');

    await page.goto(start + '#/studio/home');
    await page.getByRole('link', { name: /主分支构建/ }).click();
    await heading('主分支构建');
    await page.getByText(/示例构建完成/).waitFor();
    await shot('07-run');
    await page.getByLabel('切换组织').click();
    await page.getByRole('link', { name: '组织设置' }).click();
    await heading('组织设置');
    await page.getByLabel('账户菜单').click();
    await page.getByRole('link', { name: '个人设置' }).click();
    await heading('个人设置');

    await page.getByRole('button', { name: '打开导航菜单' }).click();
    await page.getByRole('dialog', { name: '全局导航' }).getByRole('link', { name: '流水线' }).click();
    await heading('流水线');
    await shot('10-pipeline-list');
    await page.getByRole('button', { name: /创建流水线/ }).click();
    let modal = page.getByRole('dialog', { name: '创建流水线' });
    await modal.getByLabel('名称').fill('build-prototype');
    await modal.getByRole('button', { name: '创建', exact: true }).click();
    await heading('build-prototype');
    await page.getByRole('link', { name: /执行脚本/ }).click();
    await page.getByText('npm ci', { exact: false }).waitFor();
    await page.getByLabel('VERSION 默认值').fill('2.0.0');
    await shot('11-pipeline-editor');
    await page.getByRole('button', { name: '运行', exact: true }).click();
    modal = page.getByRole('dialog', { name: '运行流水线' });
    assert.equal(await modal.getByLabel('VERSION').inputValue(), '2.0.0');
    await modal.getByLabel('VERSION').fill('2.1.0');
    await shot('12-run-parameters');
    await modal.getByRole('button', { name: '开始运行' }).click();
    await page.getByText('2.1.0', { exact: false }).waitFor();
    assert.equal(new URL(page.url()).hash, '#/studio/pipelines/demo-1');
    await shot('13-run-detail');
    await page.getByRole('link', { name: '返回运行记录' }).click();
    await page.getByRole('link', { name: /build-prototype/ }).waitFor();
    await page.getByRole('link', { name: '流水线列表' }).click();
    await page.getByRole('link', { name: /build-prototype/ }).click();
    await page.getByLabel('运行时允许覆盖').uncheck();
    await page.getByRole('button', { name: '运行', exact: true }).click();
    await modal.getByText('2.0.0', { exact: true }).waitFor();
    assert.equal(await modal.getByRole('textbox').count(), 0);
    await modal.getByRole('button', { name: '取消' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(start + '#/studio/home');
    await heading('工作台');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    await shot('09-mobile');
    assert.deepEqual(errors, []);
    console.log('工作台、组织切换、评审、仓库、文件、WebIDE、流水线创建、参数联动、运行记录与设置导航验证通过');
  } finally {
    await browser.close();
  }
}

verify(process.argv[2]).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
