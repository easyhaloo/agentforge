# 排版、圆角与尺寸规范（Typography, Radius & Sizing）

> 参考标准：[Primer Typography](https://primer.style/product/getting-started/foundations/typography/)、[Primer Size](https://primer.style/product/primitives/size/)

## 1. 字体栈（Font Families）

- **无衬线正文（`--font-sans`）**：
  ```css
  -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"
  ```
- **等宽代码与标识符（`--font-mono`）**：
  ```css
  ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace
  ```
  适用场景：Commit SHA、分支名（`BranchChip`）、文件路径、代码预览与 Diff、快捷键 `<kbd>`、数值等宽列。

## 2. 字阶规范（Type Scale）

全站遵循 4px 行高网格，**严格禁止任何小于 `12px` 的字号**（彻底消除历史遗留的 `7px–11px` 样式）：

| 层级 | 字号 | 行高 | 字重 | 典型用途 |
| :--- | :--- | :--- | :--- | :--- |
| Title Large | `24px` (`1.5rem`) | `32px` | `600`（Settings `Subhead` 为 `400`） | 页面主标题、README H1、`Subhead` |
| Title Medium | `20px` (`1.25rem`) | `28px` | `600` | 仓库标题、Overview Home 标题、Workflow 标题 |
| Title Small | `16px` (`1rem`) | `24px` | `600` | 侧栏分组标题（About / Releases / Languages）、弹窗标题 |
| Body Medium（默认） | `14px` (`0.875rem`) | `20px` | `400` / `500` / `600` | 全局正文、列表行、按钮、输入框、导航项 |
| Body Small / Caption | `12px` (`0.75rem`) | `16px` | `400` / `500` / `600` | 元信息、时间戳、`Label`、`CounterLabel`、Diff 代码、表单错误与提示 |

## 3. 圆角规范（Border Radius）

全站严格收敛为 4 个圆角档位，禁止随意混用 `4px`、`5px`、`7px`、`8px`、`10px`：

| Token | 值 | 适用组件 |
| :--- | :--- | :--- |
| `--radius-sm` | `3px` | 热力图格子、文件状态徽标（`FileStatusBadge`）、行内高亮 |
| `--radius-md` | `6px` | **默认圆角**：按钮、输入框、下拉框、`BorderBox`、`Flash`、`ActionList` 项、`BranchChip` |
| `--radius-lg` | `12px` | Modal、Command Palette、左侧全局 Drawer 露出侧边 |
| `--radius-full` | `9999px` | `Label`、`StateLabel`、`CounterLabel`、Avatar、Switch、状态圆点 |

## 4. 控件高度与间距网格（Control Height & Spacing）

| 维度 | Token | 值 | 适用范围 |
| :--- | :--- | :--- | :--- |
| 小号控件 | `--control-sm` | `28px` | 紧凑工具栏按钮（Watch / Fork / Star）、表格行内操作 |
| 中号控件（默认） | `--control-md` | `32px` | 标准按钮、输入框、Select、搜索框、顶栏图标按钮 |
| 大号控件 | `--control-lg` | `40px` | 登录/注册主按钮、大号表单项 |
| 间距步进 | 4px 网格 | `4 / 8 / 12 / 16 / 20 / 24 / 32px` | 优先使用容器 `padding` 与 Flex/Grid `gap`，减少跨组件 `margin` 泄漏 |
