# AgentForge 前端基础组件体系

> 状态：方案基线（2026-11-17）  
> 适用范围：`apps/web`  
> 分支：`feat/frontend-ui-foundation`

## 1. 背景与目标

AgentForge 前端基于 React 19、TypeScript、Vite。基础组件建设采用“成熟组件库提供交互与无障碍能力，AgentForge 统一封装 API、主题和业务约束”的策略，避免重复实现弹层、键盘交互、日期运算、表格排序等复杂能力。

目标：
- 统一视觉、交互、尺寸、状态和 API；
- 业务页面只从统一入口导入组件，不直接依赖底层 UI 库；
- 表单校验、异步检索、表格状态和弹窗行为有明确约定；
- 组件具备类型约束、可测试性和渐进扩展能力。

## 2. 技术选型

### 2.1 基线

采用 **React + 原生 HTML 表单/交互能力作为第一层基础引擎**，由 AgentForge 在 `shared/ui` 中统一封装 API、主题和交互约束。日期输入使用浏览器原生 `input[type=date]`，组件值和 API 边界统一使用 `YYYY-MM-DD` 字符串。复杂日期、虚拟表格、富文本等能力只有在明确需求出现后再引入专用依赖。

理由：
1. AgentForge 属于管理控制台型产品，表单、筛选、表格、弹窗密集；
2. 现有产品已有成熟的深色视觉样式，原生控件可降低迁移成本并保持轻量；
3. React 负责组件组合和状态，浏览器原生控件提供基础输入、日期和表单能力；
4. 通过 `shared/ui` 隔离底层实现，复杂控件未来可按需替换为专用组件引擎。

不在业务页面直接使用 Ant Design 原始组件。新增 UI 依赖统一从 `apps/web/src/shared/ui` 暴露。现有 lucide-react 可继续用于业务图标；不重复引入另一套图标系统，底层组件默认图标按主题规范统一。

## 3. 组件分层

```
apps/web/src/shared/
  ui/
    components/       # 基础组件封装
    hooks/            # 可复用交互 hooks
    theme/            # Design Tokens、ConfigProvider
    utils/            # UI 层格式化与辅助方法
    index.ts          # 唯一公共导出入口
  lib/                # 非 UI 基础设施（如已有约定则沿用）
```

依赖方向：`pages/features -> shared/ui -> React / browser primitives`。禁止 `shared/ui` 依赖 `features/domain/pages`；业务模块不得绕过封装层自行实现重复的基础交互。

## 4. 组件目录与范围

### 4.1 基础展示与反馈
- Button：主次/危险/文字按钮、加载、禁用；
- IconButton：图标按钮，必须提供 tooltip/aria-label；
- Tag、Badge：状态标签；
- Tooltip、Popover：提示与轻量浮层；
- Alert、Empty、Skeleton、Spin：反馈和加载；
- Divider、Card、Typography：基础布局与文字。

### 4.2 表单与输入
- Input、TextArea：统一尺寸、清除、字数限制、前后缀；
- PasswordInput：密码显隐；
- NumberInput：精度、范围；
- Select：单选/多选、远程选项、清除、搜索；
- DatePicker、DateRangePicker：日期/日期范围；
- Checkbox、Radio、Switch：布尔与枚举；
- Form、FormItem：统一校验、错误展示、布局；
- SearchInput：输入防抖、清除、提交/回车行为；
- AsyncSelect：远程检索、加载、空态、错误态、取消过期请求。

### 4.3 反馈与覆盖层
- Modal：确认/取消、异步提交 loading、关闭保护；
- Drawer：详情与编辑侧栏；
- ConfirmDialog：危险操作二次确认；
- Message/Notification：全局轻提示；
- Dropdown：操作菜单。

### 4.4 数据展示
- DataTable：统一分页、排序、筛选、加载、空态、行选择；
- TableToolbar：搜索、筛选、刷新、列设置等工具栏；
- Pagination：服务端分页优先；
- Descriptions：只读详情；
- Statistic：指标展示；
- Tree：层级数据。

### 4.5 业务组合组件（后续）
- FilterBar：组合多个筛选条件；
- SearchForm：检索表单；
- CRUDPage：列表/详情/新增编辑页面骨架；
- JsonViewer、CodeEditor：按具体业务需求引入，不纳入第一批。

## 5. 统一交互约定

### 5.1 通用
- 尺寸默认 `middle`；表格密集场景允许 `small`，主操作表单默认 `middle`；
- 所有异步操作必须有 loading、错误反馈和防重复提交；
- 禁用态、只读态、错误态必须视觉可区分；
- 表单字段必须有 label；必填、帮助文本、错误信息位置统一；
- 组件支持受控模式；必要时允许 defaultValue 非受控模式；
- 弹层支持键盘操作、焦点管理、Esc 关闭（危险流程可显式禁止）和合理的焦点返回。

### 5.2 Modal / Drawer
- API 使用 `open`、`onCancel`、`onOk`，不再使用旧式 visible；
- `onOk` 支持 Promise；Promise pending 时确认按钮 loading，避免重复提交；
- 关闭保护通过 `confirmLoading` / `beforeClose` 约定实现；
- 简单确认优先使用 ConfirmDialog，不在页面内手写遮罩层。

### 5.3 SearchInput / AsyncSelect
- SearchInput 支持 `value`、`onChange`、`onSearch`、`debounceMs`；
- 默认不在每次键入时立即请求；防抖时间可配置；
- AsyncSelect 的加载函数接收 keyword、分页/游标和 AbortSignal；
- 新检索发起时取消旧请求或忽略过期结果；显示 loading、empty、error 状态；
- 搜索输入与已选值分离，避免用户输入过程覆盖已提交筛选值。

### 5.4 DatePicker
- 展示和交互使用 Day.js；
- API/持久化边界使用 ISO 字符串或明确格式，禁止把 Day.js 实例直接发送给后端；
- 日期范围的起止边界、时区语义由调用方明确；
- 默认日期格式按产品统一配置，业务不得自行拼接日期字符串。

### 5.5 DataTable
- 默认服务端分页、排序和筛选；客户端模式必须显式声明；
- 统一 `rowKey`，禁止依赖数组 index；
- 支持 loading、empty、error、rowSelection、scroll、density；
- 分页状态统一为 `page`、`pageSize`、`total`；
- 排序/筛选通过类型化回调向业务层传递，不在组件内部发请求；
- 列定义使用类型安全的列配置；操作列有统一宽度和固定策略；
- 大数据量场景评估虚拟滚动，不默认引入复杂实现。

## 6. 设计 Token

通过 `UIThemeProvider`、Design Tokens 和 CSS Custom Properties 集中管理，不允许页面级随意覆盖全局主题。

首批 Token 类别：
- 色彩：primary、success、warning、error、info、text、muted、border、surface、background；
- 圆角：small、default、large；
- 间距：4/8/12/16/20/24/32；
- 字体：font family、font size、line height、weight；
- 控件：controlHeightSM/MD/LG；
- 弹层：z-index 层级和阴影；
- 断点：移动端、平板、桌面。

初始值先适配现有 AgentForge 页面，不在本方案中擅自重做整站视觉；通过实际页面验收后再微调。

## 7. 导入与编码规范

```tsx
import { Button, DataTable, DatePicker, Form, Input, Modal, SearchInput, Select } from "@/shared/ui";
```

- 业务模块必须从 `@/shared/ui` 导入基础组件，不得重复实现通用控件；
- 统一组件优先导出具名组件和明确 Props 类型；
- Props 继承底层类型时，显式省略不兼容属性；
- 组件内部不处理业务 API、不读取业务 store；
- 组件文档至少包含用途、Props、事件、示例和边界行为。

## 8. 实施顺序

### Phase 0：基线与主题
- 核对现有样式、依赖和页面约束；
- 核对依赖与 lockfile，避免无必要的 UI 依赖；
- 建立 UIThemeProvider、CSS Design Tokens 和 shared/ui 入口；
- 增加组件约束与目录规范。

### Phase 1：第一批高频组件
- Button、Input、TextArea、Select；
- DatePicker、DateRangePicker；
- Modal、Drawer、ConfirmDialog；
- SearchInput、Form/FormItem。

### Phase 2：数据组件
- DataTable、Pagination、TableToolbar；
- Tag/Badge、Tooltip、Popover、Empty、Spin、Skeleton；
- 统一异步状态和服务端分页协议。

### Phase 3：组件展示与迁移
- 建立 UI Showcase 页面，覆盖默认/禁用/加载/错误/空态；
- 将现有页面逐步迁移到 shared/ui；
- 增加单元测试、交互测试和视觉回归；
- 在 CI 中执行 typecheck、test、build。

## 9. 验收标准

- 页面业务代码不直接依赖 antd；
- 所有首批组件有明确 TypeScript Props；
- Modal 异步确认、SearchInput 防抖、AsyncSelect 过期请求处理、DatePicker API 日期转换、DataTable 服务端分页均有测试；
- UI Showcase 可独立查看组件状态和用法；
- `npm run build`、`npm test` 通过；
- 不破坏现有页面路由和布局。

## 10. 当前决策

| 项目 | 决策 |
|---|---|
| 前端框架 | React 19 + TypeScript + Vite |
| 基础组件引擎 | React + 原生 HTML 控件（复杂组件按需选型） |
| 日期适配 | 原生 date input，值为 YYYY-MM-DD 字符串 |
| 组件封装目录 | `apps/web/src/shared/ui` |
| 业务导入入口 | `@/shared/ui` |
| 表格策略 | 服务端分页/排序/筛选优先 |
| 主题策略 | UIThemeProvider + CSS Custom Properties |
| 建设方式 | 分阶段落地，先基础组件后业务迁移 |
