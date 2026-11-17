# AgentForge UI 基础组件实施计划

关联设计：`docs/architecture/frontend-ui-component-system.md`  
目标分支：`feat/frontend-ui-foundation`

## 任务拆分

| ID | 任务 | 交付物 | 验收 |
|---|---|---|---|
| UI-001 | 核对 React/浏览器原生能力与现有依赖，保持 lockfile 一致 | 技术基线记录 | npm ci、build |
| UI-002 | 建立 UIThemeProvider、CSS Token 与 UI 公共出口 | shared/ui/theme、index.ts | 应用启动且主题生效 |
| UI-003 | 封装 Button、Input、TextArea、Select | 基础输入组件 | Props 类型与交互测试 |
| UI-004 | 封装 DatePicker、DateRangePicker | 日期组件 | API 日期格式转换测试 |
| UI-005 | 封装 Modal、Drawer、ConfirmDialog | 弹层组件 | Promise 提交、loading、防重复测试 |
| UI-006 | 封装 SearchInput、AsyncSelect | 检索组件 | 防抖、取消/忽略过期请求测试 |
| UI-007 | 封装 Form、FormItem | 表单组件 | 校验、错误态、布局测试 |
| UI-008 | 封装 DataTable、Pagination、TableToolbar | 数据展示组件 | 服务端分页、排序、筛选测试 |
| UI-009 | 建设 UI Showcase | 组件展示页面 | 覆盖默认、禁用、加载、错误、空状态 |
| UI-010 | CI 与文档验收 | 测试与使用文档 | typecheck、test、build 通过 |

## 当前进展（2026-11-17）

- 已完成 UIThemeProvider、Design Tokens 与公共导出入口。
- 已实现 Button、Input、Select、DatePicker、DateRangePicker、Modal、SearchInput、Form、FormItem、DataTable。
- 已补充 Drawer、ConfirmDialog、Popover、AsyncSelect；DataTable 支持本地排序、受控行选择与分页回调。
- 已加入 UI Components 导航入口和交互式 Showcase 页面。
- 后续继续补齐自动化交互测试、完整 Drawer 焦点管理、表格列筛选/虚拟滚动与业务页面迁移。

## 执行策略

1. 按 UI-001 到 UI-002 完成技术基线和主题基础，不提前迁移业务页面。
2. 按 UI-003 到 UI-007 完成第一批通用组件。
3. 完成 UI-008 数据组件，明确服务端交互协议。
4. 建设 Showcase 和测试，再逐步迁移既有页面。
5. 每个阶段独立提交，CI 通过后再合并；不绕过仓库合并门禁。

## 质量约束

- 禁止业务页面直接 import antd。
- 禁止组件封装层依赖业务模块。
- 组件 Props 必须有 TypeScript 类型。
- 异步交互必须覆盖 loading、失败和重复提交。
- 日期传输统一使用明确的字符串格式，不传递浏览器事件对象或日期库实例。
- 表格必须使用稳定 rowKey，默认服务端分页。
- 不因组件建设顺带改动无关页面或部署配置。
