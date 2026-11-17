# AgentForge 前端共享 UI 全量迁移审计与验收基线

> 状态：业务页面共享 UI 迁移已合并；进入 CSS 清理与最终验收
> 当前主分支基线：`0d05609f66f1ca018ed9d35c4476c1df15f8d054`  
> 审计日期：2026-11-17  
> 范围：`apps/web/src`

## 1. 目标与边界

完成 `apps/web` 全部产品页面对 `apps/web/src/shared/ui` 公共组件体系的迁移。目标不是逐个替换标签，而是统一控件、反馈、弹层和数据展示的实现，同时保留业务状态、API 契约、路由、权限、表单提交和数据语义。

允许业务专属结构保留原生 HTML；通用按钮、输入、选择、表单、弹层、反馈及数据表格必须复用共享组件。共享 UI 内部可以使用原生 HTML 实现底层控件，这属于组件实现，不属于业务页面绕过共享组件。

明确排除：Go 后端、API/领域模型重构、产品视觉重做、无关依赖升级，以及 Cloudflare 生产部署验证工作流。Cloudflare 生产部署验证不得重新加入仓库 CI。

## 2. 当前仓库盘点

当前 `main` 基线 `0d05609f66f1ca018ed9d35c4476c1df15f8d054` 的 `apps/web/src` 包含 86 个文件：

- 33 个 TSX、49 个 TS、3 个 CSS、1 个 Markdown 文件。
- 其中 28 个产品/应用页面 TSX 位于 `shared/ui` 之外；共享 UI 组件和共享 UI 测试另行统计。
- 共享 UI 已包含 Button、Input、Select、TextArea、PasswordInput、NumberInput、Checkbox、RadioGroup、Switch、Form、FormItem、DatePicker、DateRangePicker、SearchInput、AsyncSelect、Modal、Drawer、ConfirmDialog、Popover、DataTable、Alert、Empty、Loading、Skeleton 和 NotificationProvider。

## 3. 全量迁移矩阵

| 区域 | 文件范围 | 当前结果 | 仍需验收 |
|---|---|---|---|
| 应用壳与导航 | `app/App.tsx`、`PageHeader`、`Sidebar`、`Topbar` | PR #52 已迁移通用按钮；PR #53 已统一通知；PR #59 已补齐账户 Retry、组织选择和最新账户操作 | 组织切换、登出、快捷键和导航回归 |
| 应用弹层 | `CommandPalette.tsx`、`CreateChangesetDialog.tsx` | 已使用共享 Modal、Input、Button | 焦点、ESC、遮罩和导航回归 |
| Overview | `pages/overview/ui/*` | 页面级原生交互控件扫描无命中；旧重复 Overview 实现已由 PR #54 删除 | 搜索、筛选、空态和数据展示回归 |
| Delivery | `features/delivery/*` | 页面级原生交互控件扫描无命中；主要操作使用共享 UI | 工作流状态、审批、合并和证据状态回归 |
| Resources | `pages/resources/*` | 页面级原生交互控件扫描无命中；列表、Inspector 使用共享 UI | 筛选、导出、本地持久化和详情交互回归 |
| Changesets | `pages/changesets/ChangesetsPage.tsx` | PR #59 已迁移创建、搜索、刷新及输入控件 | 表单校验、搜索和 API 状态回归 |
| Organization | `pages/organization/OrganizationManagementPage.tsx` | PR #59 已迁移成员/邀请操作、角色选择及表单；成员移除改用 ConfirmDialog；成员/邀请表格改用 DataTable，管理页标签切换改用共享 Tabs | 角色权限、邀请、撤销、成员移除和错误态回归 |
| UI Showcase | `pages/ui-showcase/index.tsx` | 共享组件演示入口 | 对照真实业务用法检查组件 API |
| 共享 UI | `shared/ui/components/*`、`shared/ui/theme/*` | 已补充基础组件渲染契约测试；Tabs 提供方向键/Home/End 键盘切换；Organization 表格迁移 DataTable；Popover 增加外部点击关闭、Escape 和焦点返回；ConfirmDialog 危险操作使用 danger 按钮 | 浏览器级焦点、键盘、遮罩和交互测试 |
| 样式系统 | `styles/index.css`、`shared/ui/components/components.css`、`shared/ui/theme/theme.css` | 页面控件已复用共享组件；保留业务布局/视觉类 | 清理确认无引用的历史规则，不破坏登录链接和业务布局 |

## 4. 自动化迁移门禁

新增 `src/architecture/shared-ui-usage.test.ts`，对 `shared/ui` 之外的全部 TSX 文件执行静态约束：

1. 禁止业务页面直接写原生 `<button>`、`<input>`、`<select>`、`<textarea>`、`<table>`。
2. 禁止业务页面调用 `window.confirm/alert/prompt`。
3. 禁止在共享 UI 之外自建 `role="dialog"`、`role="tablist"` 或 `modal-backdrop`。
4. 业务页面应通过 `@/shared/ui`（或对应相对公共出口）使用共享控件。

共享 UI 实现内部允许原生控件，避免把“组件内部实现”误判为业务绕过。新增业务页面若直接使用原生交互控件，测试会失败。

## 5. 迁移执行批次

| 批次 | 范围 | 状态 |
|---|---|---|
| A | 审计基线、矩阵、例外和验收规则 | 已合并（PR #51） |
| B | 应用壳基础按钮和全局通知 | 已合并（PR #52、#53） |
| C | Overview 重复实现清理 | 已合并（PR #54） |
| D | 应用壳账户控件、Changesets、Organization 控件迁移 | 已合并（PR #59） |
| E | Modal、Drawer、ConfirmDialog、Popover 能力与测试 | 已合并（PR #59）：静态契约测试、Tabs 键盘导航单元测试及 Popover/ConfirmDialog 改进 |
| F | 全仓原生控件/浏览器对话框扫描门禁 | 已合并（PR #59） |
| G | 样式清理、业务交互回归和最终验收 | 进行中 |

## 6. 验收门槛

- [x] 28 个产品/应用页面 TSX 已完成静态交互控件审计。
- [x] 迁移分支中，业务页面不再直接实现原生按钮、输入、选择和文本域。
- [x] 业务页面不再使用浏览器原生确认/提示框，也不再自行实现 Dialog。
- [x] Overview 重复旧页面已删除；应用通知已统一。
- [x] 共享 UI 基础控件、Tabs、Modal、Drawer、ConfirmDialog、Popover、DataTable、反馈和通知已有渲染契约测试。
- [x] Popover 支持外部点击关闭、Escape 关闭和 Escape 后焦点返回；ConfirmDialog 危险操作使用 danger 样式。
- [x] 最新 PR #59 的 `npm test`、`npm run build` 和 GitHub `ci-gate` 均通过。
- [x] PR #59 已合并到 main。
- [ ] 真实浏览器中验证 Modal/Drawer/Popover 的焦点、键盘、遮罩和移动端行为。
- [ ] 完成 Overview、Delivery、Resources、Changesets、Organization 的业务回归。
- [x] 已清理无引用的 Modal、CommandPalette、Toast 历史样式；保留登录链接和业务布局样式。
- [ ] 对其余业务 CSS 完成更全面的引用核验和浏览器视觉回归。
- [ ] 所有专项 PR 合并，形成最终差异清单和验收报告。

## 7. 风险与明确例外

- `DataTable`、`Input`、`Select` 等共享组件内部使用原生 HTML 是预期实现，不属于页面迁移缺口。
- `styles/index.css` 的 `.button` 仍用于登录导航链接等非按钮语义元素；`.nav-item`、`.profile`、`.searchbox` 等类名用于业务布局和共享 Button 的页面级视觉，不应仅因类名存在就盲目删除。
- 新增共享 UI 测试使用 React 服务端静态渲染，验证结构和无障碍属性；它不等同于真实浏览器交互测试。当前项目未引入额外 DOM 测试依赖，浏览器级回归仍列为最终验收项。
- Popover 当前支持 Tab 自然焦点顺序，不承诺完整的菜单式方向键导航。
- Cloudflare Workers Builds 是仓库外部集成检查，不等同于 `.github/workflows/ci.yml` 的 `ci-gate`；不得为通过外部生产部署检查而重新引入 Cloudflare 生产部署验证流水线。

## 8. 进度记录

| 日期 | 事项 | 状态 |
|---|---|---|
| 2026-11-17 | CommandPalette 迁移 | 已合并（PR #49） |
| 2026-11-17 | 全量迁移审计基线 | 已合并（PR #51） |
| 2026-11-17 | 应用壳按钮迁移 | 已合并（PR #52） |
| 2026-11-17 | 全局通知统一 | 已合并（PR #53） |
| 2026-11-17 | Overview 重复实现清理 | 已合并（PR #54） |
| 2026-11-17 | Changesets、Organization、账户控件和组织选择迁移 | 已合并（PR #59，GitHub Actions run #212 全部通过） |
| 2026-11-17 | 共享 UI 契约测试、Popover 焦点/关闭改进、ConfirmDialog danger 变体、Tabs 键盘交互 | 已合并（PR #59，48 tests、build、ci-gate 全部通过） |
| 2026-11-17 | 全仓共享 UI 静态门禁 | 已合并（PR #59） |
| 2026-11-17 | PR #59 全量控件迁移、组件能力和静态门禁 | 已合并；48 tests、build、ci-gate 通过 |
| 2026-11-17 | 清理已弃用 Modal/CommandPalette/Toast 样式 | PR #63，CI 通过，待合并 |
| 待执行 | 浏览器级交互回归和最终验收 | 进行中 |
