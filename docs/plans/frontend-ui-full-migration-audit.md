# AgentForge 前端共享 UI 全量迁移审计与验收基线

> 状态：审计基线已建立，迁移进行中  
> 基线分支：`main`  
> 基线提交：`9f25cd8216d944d92582e72ca2adf2c6df6984d5`  
> 审计日期：2026-11-17  
> 范围：`apps/web/src`

## 1. 目标与边界

本专项的目标是完成 `apps/web` 全部产品 UI 对共享组件体系的迁移，而不是继续以单个组件完成作为终点。所有页面和业务交互必须通过 `apps/web/src/shared/ui` 的公共出口复用通用 UI 能力。

迁移不得改变业务状态、API 契约、路由、权限、数据语义或现有交互结果；不得以删除功能、降低可访问性或仅替换 CSS 类名冒充迁移完成。允许业务专属结构保留原生 HTML，但通用按钮、输入、选择、弹层、反馈和数据展示必须复用共享组件。

明确排除：Go 后端、API/领域模型重构、产品视觉重做、无关依赖升级，以及 Cloudflare 生产部署验证工作流。Cloudflare 生产部署验证不得重新加入 CI。

## 2. 仓库基线盘点

基线审计最初提交 `9f25cd8216d944d92582e72ca2adf2c6df6984d5` 的 `apps/web/src` 为 82 个文件；在 PR #52、#53、#54 合并后的当前 `main`（`ab9b3358f396bc822f00f3ce875ce7a2b656cca9`）复盘为：

- 84 个源文件：28 个 TSX、48 个 TS、3 个 CSS，其余为其他源码/声明文件。统计范围为 `apps/web/src` 下全部 blob 文件；共享 UI 实现文件包含在源文件总数中，页面 TSX 审计时单独排除 `shared/ui`。
- 共享 UI 位于 `src/shared/ui`，已有 Button、Input、Select、TextArea、PasswordInput、NumberInput、Checkbox、RadioGroup、Switch、Form、FormItem、DatePicker、DateRangePicker、SearchInput、AsyncSelect、Modal、Drawer、ConfirmDialog、Popover、DataTable、Alert、Empty、Loading、Skeleton、NotificationProvider 等能力。
- 已完成的页面迁移包括 CreateChangesetDialog、CommandPalette、Overview RecentChangesets/SelectedChangesetPanel、资源列表与 Inspector、DeliveryWorkspace 的主要输入和操作、反馈组件等。
- 前端脚本提供 `npm run build`（含 TypeScript 检查和 Vite build）及 `npm run test`（Vitest）。

## 3. 全量迁移矩阵

| 区域 | 主要文件 | 基线判断 | 后续工作 |
|---|---|---|---|
| 应用壳与导航 | `app/App.tsx`、`app/components/PageHeader.tsx`、`Sidebar.tsx`、`Topbar.tsx`、`Toast.tsx` | PR #52 已迁移头部/侧栏/顶栏操作；PR #53 已统一通知并移除 Toast；认证状态 Retry、组织选择和账户操作继续由 PR #57 补齐 | 以 PR #57 为当前实现，核验键盘、无障碍和组织切换行为 |
| 应用弹层 | `CreateChangesetDialog.tsx`、`CommandPalette.tsx` | 已迁移到 Modal/Input/Button | 回归焦点、键盘和关闭行为 |
| Overview | `pages/overview/ui/*` | 部分已迁移；RecentChangesets 和 SelectedChangesetPanel 已使用共享组件 | 审计 ActivityFeed、Metrics、Chart、页面级操作和表格；消除旧实现 |
| 旧 Overview 实现 | `features/overview/OverviewPage.tsx` | 与 `pages/overview/ui/OverviewPage.tsx` 存在重复实现迹象，当前 App 使用 pages 入口 | 确认引用关系；删除无用重复代码或统一到正式页面，避免双重维护 |
| Delivery | `features/delivery/DeliveryFlow.tsx`、`features/delivery/ui/*` | Workspace 的输入和操作已部分共享化，展示子组件以业务结构为主 | 审计页面级动作、空态、确认交互、按钮和样式；保留工作流规则 |
| Resources | `pages/resources/ResourceWorkspacePage.tsx`、`pages/resources/ui/*` | ResourceListPanel、ResourceInspector 使用 Input/Select/DataTable/Button/Empty | 检查创建表单、关闭交互、筛选工具栏、状态反馈和键盘行为 |
| UI Showcase | `pages/ui-showcase/index.tsx` | 已集中展示共享组件 | 将其作为组件能力与交互回归基线，补齐缺失场景 |
| 共享 UI | `shared/ui/components/*`、`shared/ui/theme/*` | 基础组件和主题已建立 | 核验 API 一致性、焦点管理、键盘操作、可访问性、测试覆盖和文档限制 |
| 样式系统 | `styles/index.css`、`shared/ui/components/components.css`、`shared/ui/theme/theme.css` | 全局样式仍含历史业务控件样式与页面级覆盖 | 清理已废弃控件样式；保留业务布局样式；禁止通过 CSS 伪造共享组件迁移 |

## 4. 必须执行的静态审计

迁移实施期间，对以下模式进行全仓扫描并逐项归类：

1. 原生 `<button>`：通用动作改用 Button/IconButton；仅保留需要特殊语义或原生表单行为且共享组件无法表达的情况，并记录理由。
2. 原生 `<input>`、`<select>`、`<textarea>`：通用表单输入改用 Input、Select、TextArea 等共享组件。
3. 手写 backdrop/dialog/drawer/popover：统一使用 Modal、Drawer、ConfirmDialog、Popover。
4. 自定义 toast/notification：统一使用 NotificationProvider/useNotification，移除重复的定时器和状态管理。
5. 自定义空态、加载态、错误反馈：统一使用 Empty、Loading、Skeleton、Alert。
6. 重复表格、分页、筛选和列操作：统一使用 DataTable 及其工具栏能力。
7. 页面级重复 CSS：删除已无引用的旧控件规则，不删除业务布局和视觉结构所需样式。
8. 直接绕过 `@/shared/ui` 的基础控件导入：统一导入入口。

每个例外必须在 PR 描述或本文件中说明语义理由，不能简单把扫描命中数归零作为唯一目标。

## 5. 迁移执行批次

| 批次 | 范围 | 交付与验收 |
|---|---|---|
| A | 审计基线与规则 | 本文档进入仓库；确认范围、例外和验收口径 |
| B | 应用壳、导航、全局通知 | 页面头部、侧栏、顶栏、通知统一共享组件；键盘/导航行为不变 |
| C | Overview 全量页面 | 页面操作、筛选、空态、数据展示统一；清理重复旧实现 |
| D | Delivery 全量页面 | 所有通用交互复用共享 UI；工作流状态和合并门禁语义不变 |
| E | Resources 全量页面 | 表单、筛选、详情面板、反馈统一；本地持久化和 CSV 导出不变 |
| F | 共享 UI 能力补齐 | 对迁移中发现的缺口补齐可访问性、焦点、键盘行为和测试 |
| G | 样式清理与全仓回归 | 移除过时规则；完成静态扫描、TypeScript、测试、构建和交互验收 |

批次可在同一专项中连续推进；代码提交仍应保持可审查、可回滚，并通过 PR 与仓库 CI 门禁进入 main。

## 6. 验收门槛

- [ ] 32 个 TSX 文件均完成 UI 迁移审计并标注结果。
- [ ] 所有通用按钮、输入、选择、弹层、反馈和表格均使用共享 UI。
- [ ] 任何保留原生控件的例外均有明确的语义理由。
- [ ] 不存在重复的旧页面实现；未使用的旧实现已删除或明确标记为有意保留。
- [ ] Modal/Drawer/Popover 的 Escape、遮罩、焦点进入/返回和键盘操作符合组件约定。
- [ ] 通知、错误、加载和空态行为一致。
- [ ] 页面业务逻辑、导航、数据导出、持久化、权限和状态转换无回归。
- [ ] 共享 UI 文档、Showcase 与自动化测试覆盖迁移后的真实用法。
- [ ] `npm run build` 与 `npm run test` 通过，GitHub Required CI 全部通过。
- [ ] CI 中不包含 Cloudflare 生产部署验证工作流。
- [ ] 所有专项 PR 已合并，并生成最终差异清单和验收报告。

## 7. 当前已知风险与待核验项

- `features/overview/OverviewPage.tsx` 与正式 `pages/overview/ui` 页面有明显重复，必须先确认依赖引用后再处置。
- `App.tsx` 仍自行维护 Toast 定时器；应迁移到统一通知上下文，注意通知堆叠、自动关闭和 Escape 快捷键不能相互干扰。
- 应用壳的 PageHeader、Sidebar、Topbar 仍包含原生按钮。
- `styles/index.css` 仍有历史 `.modal`、`.command-modal`、`.button` 等规则；需基于实际引用清理，不能盲目删除。
- Showcase 目前是组件演示，不等于页面交互测试；必须补充真实组件行为的自动化验证。

## 8. 进度记录

| 日期 | 事项 | 状态 |
|---|---|---|
| 2026-11-17 | 确认 PR #49 CommandPalette 迁移已合并，CI 成功 | 完成 |
| 2026-11-17 | 完成 `apps/web/src` 文件盘点并建立 82 文件/32 TSX 审计基线 | 完成 |
| 2026-11-17 | 全量迁移矩阵、静态审计规则和验收门槛 | 已合并（PR #51） |
| 2026-11-17 | 应用壳按钮迁移与通知统一 | 已合并（PR #52、#53） |\n| 2026-11-17 | Overview 重复实现清理 | 已合并（PR #54） |\n| 2026-11-17 | 全仓 TSX 控件扫描：28 个 TSX 文件；非共享 UI 页面中，剩余通用原生按钮/输入/选择器集中在 App、Changesets、Organization | 扫描完成，PR #57 正在处理 |\n| 2026-11-17 | 当前业务控件迁移：App、Sidebar、PageHeader、Topbar、Changesets、Organization | PR #57 已提交，待 CI 验证 |\n| 待执行 | 共享 UI 内部组件、Modal/Drawer/Popover 行为和可访问性专项测试 | 未开始 |
| 待执行 | Overview/Delivery/Resources 交互行为、重复样式和例外项复核 | 未开始 |
| 待执行 | 样式清理、测试补齐与全仓验收 | 未开始 |
