# GitHub UI 设计规范收口改造开发计划

> **状态**：T1–T4 实现及 T5 文档同步完成，最终回归有 1 项失败（见第 5 节）\
> **创建日期**：2026-11-28\
> **适用范围**：`apps/web` 前端样式、Diff/PR Files Changed 组件、遗留页面排版及前端规范文档\
> **协作约束**：遵循 [AGENTS.md](../../AGENTS.md)、[前端开发规范](../development/frontend.md)、[PR 前端规范](../development/pull-requests.md) 与 [开发协作规范](../development/agent-collaboration.md)

---

## 1. 背景与目标

基于当前仓库前端与设计规范的对照审计，AgentForge 的核心工作区壳（双主题 Primer Token、全局导航抽屉、Topbar 间距与 `repo:` 搜索弹窗、仓库目录与创建表单、组织设置、PR 列表/对比/详情、Projects 工作区）已高度对齐 GitHub / Primer 规范；但仍存在 **5 类未收口问题**：

1. **Diff 查看器硬编码深色**，在浅色主题下严重违和；
2. **共享组件与部分页面残留旧紫色焦点环、硬编码色值与字体覆写**；
3. **PR Files Changed 仅实现平铺文件索引与 Unified 视图**，缺少层级文件树、文件状态图标、每文件 `+/-` 统计、可折叠/可拖拽侧边栏与 Split View；
4. **老页面排版代差与遗留原型债务**：Changeset 等早期页面仍大量使用 8px–11px 极小字号，且遗留单段路由 `RepositoryDetailPage` 存在 195 处硬编码浅色 hex 与 162 处未定义 `--color-*` 变量；
5. **规范文档与现行代码存在漂移**（如导航抽屉组织选择器位置、登录页能力范围、归档规范的演进结论）。

### 总体验收目标

- 全站核心路径（含 Diff 查看器、共享组件弹层、设置页、流水线状态）在 **Light / Dark 双主题**下零硬编码色值断层，符合 WCAG 对比度；
- PR Files Changed 在保持现有行级评论、Revision 绑定、Shiki 高亮与无障碍能力不回退的前提下，补齐 GitHub 对齐的目录树、状态图标、统计、侧边栏收起/拖拽与 Split View；
- Changeset 详情/列表页排版收敛到 14px/12px Primer 体系，遗留 `RepositoryDetailPage` 补齐主题变量映射（或经确认后重定向下线），不破坏现有路由与测试；
- 规范文档与现行实现、E2E 断言完全一致；
- `npm test`、`npm run build` 及受影响模块的 Playwright E2E 测试全部通过。

---

## 2. 执行顺序与依赖关系

```text
T1（P0：Token 收口 + Diff 双主题 + 基础组件/设置页硬编码清理）
 ├─► T2（P1：PR Files Changed 树状索引、状态图标、侧边栏交互与 Split View）
 ├─► T3（P1：Changeset 早期页面排版收敛到 14px/12px Primer 基准）
 └─► T4（P1：遗留 RepositoryDetailPage 主题债务治理）
         │
         ▼
     T5（P2：前端规范与演进文档同步 + 全量 E2E 回归验收）
```

> **并行规则**（按 [开发协作规范](../development/agent-collaboration.md)）：
> - 先串行完成 **T1** 并验证通过，确保双主题 Diff Token 与基础组件焦点环成为统一基线；
> - **T2**、**T3**、**T4** 可写文件互不重叠时可按需串行或拆分独立工作树并行，最后统一由 **T5** 做文档同步与整站回归。

---

## 3. 分阶段任务单（Codex 派单规格）

### T1（P0）：双主题 Diff Token 与基础组件/页面硬编码色值收口

- **目标**：消除浅色模式下 `.repository-diff` 固定黑底问题，清零 `components.css` 遗留紫色焦点环与深色遮罩，将设置页/流水线状态/全局样式中的硬编码色值统一收敛至语义 CSS Token。
- **可写文件范围**：
  - `apps/web/src/shared/ui/theme/theme.css`
  - `apps/web/src/shared/ui/components/components.css`
  - `apps/web/src/styles/index.css`
  - `apps/web/src/pages/settings/settings.css`
  - `apps/web/src/pages/settings/preferences-settings.css`
  - `apps/web/src/pages/pipelines/pipeline-status.css`
  - `apps/web/e2e/theme.pw.ts`（补充浅/深双主题下 Diff 表面与焦点环断言）
- **UI 与 Token 设计要求**：
  1. 在 `theme.css` 的 `:root`（dark）与 `:root[data-theme="light"]` 中新增语义 Token：
     - 遮罩层：`--af-color-backdrop`（dark: `rgb(5 8 16 / 68%)`，light: `rgb(31 35 40 / 32%)`）、`--af-color-focus-ring`（`color-mix(in srgb, var(--af-color-primary) 28%, transparent)`）；
     - Diff 语义色（参考 GitHub Primer Dark/Light）：
       - `--af-diff-surface`、`--af-diff-header-bg`、`--af-diff-hunk-bg`、`--af-diff-hunk-text`
       - `--af-diff-add-bg`（dark: `#0d3a2e` / light: `#dafbe1`）、`--af-diff-add-gutter-bg`、`--af-diff-add-text`（dark: `#3fb950` / light: `#116329`）
       - `--af-diff-del-bg`（dark: `#3d252f` / light: `#ffebe9`）、`--af-diff-del-gutter-bg`、`--af-diff-del-text`（dark: `#f85149` / light: `#cf222e`）
  2. 替换 `styles/index.css` 中 `.repository-diff*`（L491–L505）全部硬编码 hex 为上述 Diff Token；清理 L1 中的旧紫色阴影 `#7466ee35`、`#7566e533` 与 L34 硬编码深色遮罩 `#090d16b8`。
  3. 替换 `components.css` 中的 5 处 `#8171ed25` / `#8171ed60` 为 `var(--af-color-focus-ring)`，替换 `.af-modal-backdrop` / `.af-drawer-backdrop` 硬编码背景为 `var(--af-color-backdrop)`；修复 `.af-switch__track > span` 未选中时滑块与轨道同色（`var(--af-color-surface-raised)`）导致低对比度的问题（滑块改用 `var(--af-color-surface)` + 细边框）。
  4. 替换 `settings.css`（L62、L109–L112）与 `preferences-settings.css`（L16–L19）中硬编码的 `#1f6feb`、`#1f883d`、`#1b7836`、`#1a7f37` 为 `--af-color-primary`、`--af-color-action`、`--af-color-action-hover`；移除 `settings.css` L15 的独立 `font-family` 覆写，继承全局字体栈（保留 `.theme-preview svg` 主题预览缩略图内部的固定示例配色）。
  5. 检查 `pipeline-status.css`（L5–L7），在确保浅色对比度满足要求前提下复用 `--af-color-success` / `--af-color-danger` / `--af-color-warning`。
- **验收标准**：
  - `components.css`、`styles/index.css` 中不再出现 `#8171ed`、`#7466ee`、`#7566e5`、`#0c1421` 等遗留硬编码色；
  - Light 与 Dark 模式下查看仓库 Compare / PR Files Diff 时，背景、Hunk 头、增删行、行号均跟随主题切换且对比度清晰；
  - 单元测试、构建与 `theme.pw.ts` 全部通过。
- **验证命令**：
  ```bash
  cd apps/web && npm test && npm run build
  cd apps/web && npx playwright test e2e/theme.pw.ts e2e/shared-ui.pw.ts
  ```

---

### T2（P1）：PR Files Changed 对齐 GitHub 交互与 Split View

- **目标**：在 `PullRequestFilesTab` 与 `RepositoryDiffViewer` 中补齐 GitHub Files Changed 核心体验，同时严格保留现有 Revision 锚定、行内评论、解决/重开对话、Shiki 语法高亮与静态 UI 门禁约束。
- **依赖**：T1（依赖双主题 Diff Token）。
- **可写文件范围**：
  - `apps/web/src/pages/repositories/repositoryDiff.ts`
  - `apps/web/src/pages/repositories/repositoryDiff.test.ts`
  - `apps/web/src/pages/repositories/RepositoryDiffViewer.tsx`
  - `apps/web/src/pages/repositories/RepositoryDiffViewer.test.tsx`
  - `apps/web/src/pages/pulls/PullRequestFilesTab.tsx`
  - `apps/web/src/pages/pulls/PullRequestFileTree.tsx`（新增，纯组件）
  - `apps/web/src/pages/pulls/pulls.css`
  - `apps/web/src/locales/en-US/pulls.json`
  - `apps/web/src/locales/zh-CN/pulls.json`
  - `apps/web/src/pages/pulls/PullRequestDetailPage.test.tsx`
  - `apps/web/e2e/repository-pulls.pw.ts`（或 `e2e/local-pull-requests.pw.ts`）
- **功能与 UI 设计要求**：
  1. **Diff 解析元数据扩展**（`repositoryDiff.ts`）：
     - 为 `RepositoryDiffFile` 增加向后兼容字段：`status: "added" | "modified" | "deleted" | "renamed"`、`additions: number`、`deletions: number`；
     - 解析 `new file mode` / `--- /dev/null`（added）、`deleted file mode` / `+++ /dev/null`（deleted）、`rename from` / `rename to`（renamed），其余默认 `modified`；按 hunk 中 `add`/`remove` 行自动汇总 `additions`/`deletions`。
  2. **层级文件树与状态图标**（`PullRequestFileTree.tsx`）：
     - 将文件路径聚合为可展开/折叠目录树（默认全部展开；支持单目录路径压缩或逐级缩进 `16px`）；
     - 文件状态使用 GitHub Primer 风格 16×16 语义图标或 Lucide 对应语义图标（Added `--af-color-success`、Deleted `--af-color-danger`、Modified `--af-color-text-secondary`、Renamed `--af-color-warning`），同时具备 `aria-label` 或屏幕阅读器可见状态文案；
     - 每项显示文件名（截断 `ellipsis` + `title` 完整路径）及 `+N / -M` 变更统计；顶部展示总计（`X files, +Y -Z`），保留现有路径过滤输入框与空过滤状态提示；
     - 保持选中高亮与平滑滚动跳转至右侧对应文件 patch。
  3. **可收起与可拖拽调整宽度的侧边栏**：
     - 桌面端默认宽度 `280px`（拖拽范围 `200px`–`480px`），通过 `usePersistentState` 持久化宽度与折叠状态（键名遵循 `agentforge:pulls:filesSidebar*`）；
     - 顶部工具栏提供“隐藏/显示文件树”按钮（复用现有 `pulls:files.hideFiles` / `pulls:files.showFiles`）、“全部折叠 / 全部展开”按钮（复用现有 `pulls:files.collapseAll` / `pulls:files.expandAll`）以及“Unified / Split”视图切换；
     - 窄屏（`<= 760px`）自动切回堆叠布局并强制回退至 Unified 视图，避免水平溢出。
  4. **真正的 Split View（双栏对比）**（`RepositoryDiffViewer.tsx`）：
     - 支持 `viewMode?: "unified" | "split"`（默认 `"unified"`，不破坏仓库 Compare 页现有调用方）；
     - Split 模式下将连续的 `remove` 与 `add` 块按行成对对齐，左右列分别显示旧行号/旧代码与新行号/新代码，空缺侧渲染占位背景；
     - 行级评论触发按钮（`lineControl`）与行内讨论（`lineDiscussion`）在 Unified 与 Split 两种模式下均可正常锚定到正确的 `side: "left" | "right"` 与 `line`，且绝不修改旧 Revision 拒绝评论的服务端不变量。
  5. **共享 UI 门禁与 i18n**：
     - 严禁在 TSX 中手写原生 `<button>` / `<input>` / `<select>` / `<textarea>` / `<table>`（通过 `shared-ui-usage.test.ts`）；
     - 新增键（`files.viewMode`、`files.unified`、`files.split`、`files.resizeSidebar`、`files.status.{added,modified,deleted,renamed}` 等）同步写入 `en-US/pulls.json` 与 `zh-CN/pulls.json`（通过 `i18n-keys.test.ts` 与 `locales.test.ts`）。
- **验收标准**：
  - `repositoryDiff.test.ts` 覆盖 added / deleted / renamed / modified 状态与 `+/-` 统计；
  - `RepositoryDiffViewer.test.tsx` 覆盖 Unified 与 Split 渲染、行号映射、XSS 转义与 Shiki 高亮；
  - `PullRequestFilesTab` 在 1280px 桌面端与 390px 移动端、深浅双主题下无横向溢出，键盘可操作文件树、视图切换与行级评论，取消评论后焦点返回触发按钮。
- **验证命令**：
  ```bash
  cd apps/web && npm test && npm run build
  cd apps/web && npx playwright test e2e/repository-pulls.pw.ts
  ```

---

### T3（P1）：Changeset 与早期页面排版收敛至 Primer 14px/12px 基准

- **目标**：消除 [index.css](../../apps/web/src/styles/index.css) 中 Changeset 详情/列表页的 8px–11px 极小字号与旧式间距，使其与 PR / 组织设置 / 仓库目录的 14px 正文、12px 辅助信息、32px 标准控件高度保持统一。
- **依赖**：T1。
- **可写文件范围**：
  - `apps/web/src/styles/index.css`（仅限 `.changeset-*`、`.changesets-*` 相关段落及共享卡片头）
  - `apps/web/src/pages/changesets/ChangesetDetailPage.tsx`（仅在需要语义结构微调时改动，不改变任何交付不变量或 API 契约）
  - `apps/web/e2e/changesets.pw.ts`
- **UI 规格**：
  - `.changeset-tabs a`：字号从 `10px` 提升至 `14px`、最小高度 `40px`、激活态保留 2px `--af-color-primary` 下划线与 `font-weight: 600`；
  - `.changeset-detail` 标题与正文：标题 `20px`（`font-weight: 600`），副标题/正文 `14px`，提示文本（`.changeset-hint`）与审计时间戳 `12px`，步骤条 `.changeset-steps` `12px`；
  - `.changesets-list`、`.changeset-create`、`.changeset-workflow` 控件统一使用 `32px–34px` 高度与 `14px` 字号，表格表头 `12px`、单元格 `14px`；
  - 窄屏（`<= 760px` / `320px`）无横向溢出，保留所有已有按钮禁用态与服务端状态文案。
- **验收标准**：
  - Changeset 列表与详情 5 个子路由（Overview / Revisions / Evaluation / Review / Merge）在深浅双主题与 390px 窄屏下无视觉断层与溢出；
  - `changesets.pw.ts` 与 `ChangesetsPage.test.tsx` 全部通过。
- **验证命令**：
  ```bash
  cd apps/web && npm test && npm run build
  cd apps/web && npx playwright test e2e/changesets.pw.ts e2e/coordination.pw.ts
  ```

---

### T4（P1）：遗留 `RepositoryDetailPage` 主题债务治理

- **目标**：消除 [RepositoryDetailPage.css](../../apps/web/src/pages/repositories/RepositoryDetailPage.css) 中 195 处硬编码浅色 hex 与 162 处未定义 `--color-*` 变量导致的暗黑主题失效问题，同时保持兼容性。
- **依赖**：T1。
- **执行策略（优先方案 A，不破坏现有单段路由契约）**：
  - **方案 A（推荐，最小风险、零破坏性变更）**：
    - 在 `RepositoryDetailPage.css` 的 `.repository-detail-page` 作用域内将 `--color-canvas-default`、`--color-canvas-subtle`、`--color-border-default`、`--color-border-muted`、`--color-fg-default`、`--color-fg-muted`、`--color-accent-fg`、`--color-accent-subtle`、`--color-success-fg`、`--color-danger-fg`、`--color-done-fg` 等 Primer 别名全部映射到 `--af-color-*` 语义 Token；
    - 清理该文件中未包裹变量的裸 hex 色值，使其完整响应 Light / Dark 双主题；
    - 同步替换 `RepositoryDetailPage.tsx` 头部中违反 `frontend.md` L421（"Prefer existing Lucide icons over emoji"）的硬编码 emoji（`⭐`、`🔀`、`👁️`）为 Lucide 图标（`Star`、`GitFork`、`Eye`），确保 `RepositoryDetailPage.test.tsx` 与 `routes.test.ts` 全绿。
  - **方案 B（可选架构清理，需用户显式确认）**：将遗留单段路由 `/orgs/:org/repositories/:repositorySlug` 重定向至规范路由 `/orgs/:org/repositories/:org/:repositorySlug`，并删除旧页面与更新 ADR-008。*在未获用户确认前默认采用方案 A。*
- **可写文件范围**：
  - `apps/web/src/pages/repositories/RepositoryDetailPage.css`
  - `apps/web/src/pages/repositories/RepositoryDetailPage.tsx`
  - `apps/web/src/pages/repositories/RepositoryDetailPage.test.tsx`（按需更新图标断言）
- **验收标准**：
  - `RepositoryDetailPage.css` 中不再存在绕过 `--af-color-*` 的硬编码主题色；
  - 暗黑模式下 `.repository-detail-page` 表面、边框、文字均正确切换为深色 Primer 色板；
  - `RepositoryDetailPage.test.tsx`、`routes.test.ts`、`npm run build` 全绿。
- **验证命令**：
  ```bash
  cd apps/web && npm test && npm run build
  ```

---

### T5（P2）：规范文档同步与全量回归验收

- **目标**：消除规范文档与现行实现之间的反向漂移，明确历史文档状态，并执行整站单元测试、生产构建与关键 E2E 回归。
- **依赖**：T1、T2、T3、T4。
- **可写文件范围**：
  - `docs/development/frontend.md`
  - `docs/development/pull-requests.md`
  - `docs/product/repository-detail-page.md`（仅在顶部补充“当前实现状态说明”注记，严格保留历史正文，不删减原内容）
  - `docs/plans/login-page-design.md`（仅在顶部补充“当前实现演进说明”注记，保留历史正文）
  - `docs/plans/github-ui-alignment-remediation.md`（更新各任务执行状态与验证结果）
- **文档更新要点**（严守“不精简历史文档未修改部分”原则）：
  1. 更新 `docs/development/frontend.md` L456：移除过时的“在 ≤720px 抽屉内显示组织选择器”描述，改为准确反映当前架构（组织切换位于个人设置页 `SettingsLayout`，与 `workbench.pw.ts` 断言一致）；补充双主题 Diff Token 与基础组件焦点环约定；
  2. 更新 `docs/development/pull-requests.md`：补充 T2 落地后的 Files Changed 目录树、状态图标、侧边栏折叠/拖拽与 Split View 行为规范；
  3. 在 `docs/product/repository-detail-page.md` 与 `docs/plans/login-page-design.md` 顶部以注记说明真实路由/认证能力的演进现状，完整保留原文。
- **最终回归验收命令**：
  ```bash
  cd apps/web && npm test && npm run build
  cd apps/web && npx playwright test e2e/theme.pw.ts e2e/workbench.pw.ts e2e/routing.pw.ts e2e/topbar-search.pw.ts e2e/organization-settings.pw.ts e2e/repositories.pw.ts e2e/repository-pulls.pw.ts e2e/changesets.pw.ts
  ```

---

## 4. 使用 `agent-orchestrator` 驱动 Codex 的执行流程

前置条件：宿主机需已存在 `~/.config/agent-orchestrator/config.json`（可通过 `agent-orchestrator --setup` 初始化，且 `/Users/shenggangshu/llm/agentforge` 在允许目录内）。

### 省 Token 编排约束（Codex 与 Claude Code 通用，强制）
1. **单命令聚合并行**：多个互不冲突的独立 worktree 任务（无论派给 `@codex` 还是 `@claude`）通过同一 shell 批处理并发执行并 `wait` 汇聚，全部结束后只触发 **1 次**主控唤醒，避免 N 个任务唤醒 N 次。
2. **过滤旋转进度帧**：对 `agent-orchestrator`（`@codex` / `@claude`）输出剥离 `\r` 和 `[codex|claude|...] thinking...` 动画行，只回显最后 ≤30 行精简结果（完整原始日志落盘），避免 30KB+ 无效文本进入对话历史反复计费，并要求子代理交付摘要 ≤15 行。
3. **长超时阈值**：后台调用设置 `NotificationTimeoutSeconds >= 1800`（30 分钟），避免正常运行的 Codex / Claude Code 任务在中途触发定时提醒空转消耗主控 Token。
4. **worktree 隔离**：并行写任务使用独立 `git worktree` 并软链 `apps/web/node_modules`，零文件冲突且免重复安装依赖；单测仅跑定向用例，最终合并后再统一执行全量构建与 E2E。
5. **审查同样交由 Codex**：合并改动后通过 `@codex` 独立执行 `git diff` 审查与修复闭环。

按以下节奏逐批派发给 Codex（每批完成后由 Codex 审查 `git diff` 并复验测试与构建，再推进下一批）：

1. **派发 T1**：
   ```bash
   agent-orchestrator --prompt "@codex 请阅读 AGENTS.md、docs/development/frontend.md 与 docs/plans/github-ui-alignment-remediation.md 中的任务单 T1，在当前仓库完成 T1 的全部实现与测试，运行 npm test、npm run build 及 theme/shared-ui E2E 后汇报真实 diff 与验证结果。"
   ```
2. **派发 T2**：
   ```bash
   agent-orchestrator --prompt "@codex 请阅读 docs/development/pull-requests.md 与 docs/plans/github-ui-alignment-remediation.md 中的任务单 T2，完成 PR Files Changed 的目录树、状态图标、可折叠/拖拽侧栏与 Split View，补齐 en-US/zh-CN i18n 与单测/E2E，并汇报验证结果。"
   ```
3. **派发 T3 & T4**（依次执行或确认范围无重叠后执行）：
   ```bash
   agent-orchestrator --prompt "@codex 请按 docs/plans/github-ui-alignment-remediation.md 中的任务单 T3 与 T4（采用方案 A）完成 Changeset 排版收敛与 RepositoryDetailPage 主题变量映射，运行全量单测、构建与 changesets E2E 后汇报结果。"
   ```
4. **派发 T5**：
   ```bash
   agent-orchestrator --prompt "@codex 请按 docs/plans/github-ui-alignment-remediation.md 中的任务单 T5 同步前端规范与演进注记（不精简历史正文），并执行最终单元测试、生产构建与关键 Playwright E2E 回归，汇总验收报告。"
   ```

---

## 5. 执行进度追踪

| 任务单 | 优先级 | 状态 | 负责方 | 验收结果 |
| --- | --- | --- | --- | --- |
| T1：双主题 Diff Token 与硬编码色值收口 | P0 | 实现完成，回归有失败 | Codex | `theme.pw.ts` 5/5 通过。仓库排序选项的鼠标焦点样式断言失败。 |
| T2：PR Files Changed 树状索引与 Split View | P1 | 实现完成 | Codex | `PullRequestDetailPage.test.tsx` 6/6、`repository-pulls.pw.ts` 3/3 通过。`theme.pw.ts` 覆盖 Split 与窄屏 Unified。 |
| T3：Changeset 早期页面排版收敛 | P1 | 实现完成 | Codex | `ChangesetsPage.test.tsx` 4/4、`changesets.pw.ts` 14/14 通过。`theme.pw.ts` 覆盖双主题窄屏。 |
| T4：遗留 RepositoryDetailPage 主题治理 | P1 | 实现完成（方案 A） | Codex | `RepositoryDetailPage.test.tsx` 59/59、`routes.test.ts` 15/15 通过。`theme.pw.ts` 覆盖遗留路由的双主题窄屏。 |
| T5：规范文档同步与全量回归验收 | P2 | 文档完成，定向回归通过 | Codex | `npm test` 53 个文件、414/414 项通过，`npm run build` 通过。`repositories.pw.ts` 12/12、`theme.pw.ts` 5/5、`shared-ui.pw.ts` 11/11，共 28/28 项通过。仓库排序用例已验证鼠标打开菜单时无轮廓，键盘打开时保留轮廓。原 8 个文件的全量回归尚待复跑。 |
