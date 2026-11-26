# 布局与切换逻辑规范（Layout & Switching Logic）

> 参考标准：[GitHub Primer Migration & Layout](https://primer.style/product/primitives/migrating/)

## 1. 全局外壳与双层一体化顶栏

- **双层顶栏共享下沉画布**：`Topbar`（高 `56px`）与 `UnderlineNav` / `.repo-section-nav`（高 `44px`）统一采用 `--bgColor-inset` 背景。
- **边框合并规则**：当页面包含 `UnderlineNav` 时，Topbar 自动去掉底边框（`.topbar:has(+ .repo-section-nav) { border-bottom: 0 }`），由二级导航底部统一绘制 `1px solid var(--borderColor-default)`。
- **主内容容器**：常规业务页面统一 `max-width: 1280px; margin-inline: auto; padding: 24px 32px 48px`；仅全屏工具页（WebIDE、Pipeline Canvas）允许使用 `100%` 流式宽度。

## 2. 五大标准页面布局模板

| 布局模板 | 桌面端网格（`> 960px`） | 典型页面 | 关键约束 |
| :--- | :--- | :--- | :--- |
| **1. 单栏列表 / 详情** | `1fr`（`max-width: 1280px`） | Changesets、PR Diff、UI Showcase | 工具栏 + `BorderBox` 堆叠，区块间距 `16px–24px` |
| **2. 主内容 + 右侧信息栏** | `minmax(0, 1fr) 296px`，`gap: 24px` | Code 仓库页、PR 对话页 | 右栏放置 About / Topics / Releases / Languages，组间用 `--borderColor-muted` 分隔 |
| **3. 左侧快捷栏 + 主动态区** | `296px minmax(0, 1fr)`，`gap: 24px` | Overview（Home 总览页） | 左栏 Top Repositories 筛选 + Teams；主区 4 列 KPI + 36 周热力图 + 动态流 |
| **4. 左侧分组导航 + 主表单** | `256px minmax(0, 1fr)`，`gap: 28px` | Organization / Settings、CI/CD（左栏 `248px`） | 左栏 `ActionList` 分组导航；主区以 `Subhead` 开篇，表单最大宽 `540px` |
| **5. 独立聚焦布局（Focused）** | 居中单栏（`440px` 或 `1280px`） | 登录/注册页、独立向导 | 无全局左侧抽屉，聚焦单一主任务 |

## 3. 切换逻辑规范（Switching Logic）

### 3.1 主题切换逻辑
1. **原子切换**：写入 `<html data-theme="dark | dark-dimmed | light">`，全部样式通过 CSS 变量瞬时更新。
2. **预览态与持久化分离**：在 `AppearanceSettingsPage` 中点击主题预览卡先进入 `preview(draft)` 实时预览；点击 `Save` 后持久化至后端，未保存离开时 `useLayoutEffect` 自动回滚至 `saved`。
3. **跟随系统（`auto`）**：监听 `window.matchMedia("(prefers-color-scheme: dark)")` 动态切换 `dark` / `light`。

### 3.2 四级导航切换逻辑（职责单一、互不越界）
1. **Level 1 — 全局左侧抽屉（Overlay Drawer）**：由 Topbar 汉堡按钮唤起，负责跨产品域跳转；打开锁定 `body` 滚动，点击遮罩/`ESC`/跳转项自动关闭并将焦点交还触发器。
2. **Level 2 — 顶栏上下文面包屑与切换器**：负责切换 Organization / Repository，切换后回落至目标上下文的默认入口页（如仓库 `Code` 页）。
3. **Level 3 — 二级路由导航（`UnderlineNav`）**：负责仓库或组织内同级主视图切换，必须绑定 URL 路径并同步 `aria-current="page"` 与珊瑚橙底条。
4. **Level 4 — 页内局部切换（`ActionList` / `Tabs`）**：负责 Settings 子页、Workflows 列表或页内选项卡切换；`Tabs` 遵循 Roving Tabindex（`ArrowLeft` / `ArrowRight` / `Home` / `End` 循环并跳过禁用项）。

### 3.3 列表与 Diff 视图切换逻辑
- **列表状态切换（Open / Merged / Closed）**：保留当前搜索词与标签条件，同步更新 URL Query 并重置分页至第 1 页。
- **Diff 视图切换**：桌面端支持 `Unified` / `Split`，`<= 960px` 强制降级为 `Unified`；勾选单文件 `Viewed` 后折叠代码体并保留文件头。

## 4. 响应式断点与 Z-Index 层级契约

### 4.1 响应式断点（纯像素值，不嵌套 CSS 变量）
- **Desktop（`> 960px`）**：完整双栏布局，容器内边距 `24px 32px 48px`，顶栏搜索框 `260px`，KPI 4 列。
- **Tablet（`641px – 960px`）**：全部双栏布局折为单列，容器内边距 `16px`，KPI 折为 2 列，搜索框缩至 `160px`。
- **Mobile（`<= 640px`）**：搜索框折叠为 `32px × 32px` 图标按钮，仓库文件树隐藏提交摘要列，`UnderlineNav` 支持横向滚动。

### 4.2 Z-Index 分层矩阵
| 层级 | 值 / Token | 适用组件 |
| :--- | :--- | :--- |
| 下拉与轻浮层 | `--af-z-dropdown` (`5`) | Select 下拉、Popover、Tooltip |
| 吸顶导航 | `--af-z-sticky` (`6`) | Sticky Topbar、Diff 吸顶文件头 |
| 模态对话框 | `--af-z-overlay` (`10`) | Modal、ConfirmDialog |
| 全局侧滑抽屉 | `40`（遮罩）/ `50`（面板） | Global Overlay Drawer |
| 全局命令面板 | `60` | Command Palette |
| 全局轻提示 | `--af-z-toast` (`20` / 视口顶层 `70`) | NotificationProvider Toast |
