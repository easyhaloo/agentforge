# 颜色与主题规范（Colors & Themes）

> Token 定义源文件：`apps/web/src/shared/ui/theme/theme.css`、`apps/web/src/shared/ui/theme/tokens.ts`  
> 参考标准：[GitHub Primer Primitives](https://primer.style/product/primitives/)

## 1. 主题模式

通过根元素 `<html data-theme="dark | dark-dimmed | light">` 原子切换全部 CSS Custom Properties：

- **`dark`（默认）**：高对比深色，适合长时间代码阅读。
- **`dark-dimmed`**：柔和低对比深色，减轻夜间视觉疲劳。
- **`light`**：高明度浅色，适合明亮办公环境。
- **`auto`**：跟随系统 `prefers-color-scheme`，自动映射到 `dark` 或 `light`。

## 2. 4 层画布与中性前景（Canvas & Foreground）

| 语义角色 | CSS Variable | Dark Default | Dark Dimmed | Light Default | 用途 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 下沉画布 | `--bgColor-inset` | `#010409` | `#1c2128` | `#f6f8fa` | 全局 Topbar、仓库二级 `UnderlineNav` 底色 |
| 主画布 | `--bgColor-default` | `#0d1117` | `#22272e` | `#ffffff` | 页面主背景、`BorderBox` 主体、输入框底色 |
| 次级画布 | `--bgColor-muted` | `#151b23` | `#2d333b` | `#f6f8fa` | `BorderBoxHeader`、表头、代码块、行悬停底色 |
| 浮层画布 | `--bgColor-overlay` | `#151b23` | `#2d333b` | `#ffffff` | Drawer、Modal、Command Palette、Popover |
| 中性交互底 | `--bgColor-neutral-muted` | `rgba(101, 108, 118, 0.2)` | `rgba(99, 110, 123, 0.25)` | `rgba(129, 139, 152, 0.12)` | `ActionList` 激活项、中性状态底 |
| 主文字 | `--fgColor-default` | `#f0f6fc` | `#cdd9e5` | `#1f2328` | 标题、正文、默认按钮文字 |
| 次要文字 | `--fgColor-muted` | `#9198a1` | `#768390` | `#59636e` | 元信息、时间戳、提交摘要、默认图标 |
| 反白文字 | `--fgColor-onEmphasis` | `#ffffff` | `#ffffff` | `#ffffff` | Primary 按钮、`StateLabel` 实心徽标文字 |

## 3. 2 级边框与 GitHub 特征色

| 语义角色 | CSS Variable | Dark Default | Dark Dimmed | Light Default | 用途 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 默认边框 | `--borderColor-default` | `#3d444d` | `#444c56` | `#d1d9e0` | 卡片外框、输入框、按钮、顶栏底线 |
| 弱分割线 | `--borderColor-muted` | `rgba(61, 68, 77, 0.7)` | `rgba(68, 76, 86, 0.7)` | `rgba(209, 217, 224, 0.7)` | 列表行内分割线、`Subhead` 底线、分组线 |
| 导航激活条 | `--underlineNav-borderColor-active` | `#f78166` | `#ec775c` | `#fd8c73` | GitHub 标志性珊瑚橙 `UnderlineNav` 激活底条 |
| 焦点轮廓 | `--focus-outlineColor` | `#1f6feb` | `#316dca` | `#0969da` | 全部可交互元素的 2px 纯蓝聚焦环 |
| 计数底色 | `--counter-bg` | `rgba(101, 108, 118, 0.25)` | `rgba(99, 110, 123, 0.35)` | `rgba(129, 139, 152, 0.18)` | `CounterLabel` 药丸底色 |

## 4. 语义状态色组

| 语义 | 前景 (`--fgColor-*`) | 浅底 (`--bgColor-*-muted`) | 浅框 (`--borderColor-*-muted`) | 实心强调 (`--bgColor-*-emphasis`) |
| :--- | :--- | :--- | :--- | :--- |
| **Accent** | Dark `#4493f8` / Light `#0969da` | `rgba(56,139,253,.12)` / `#ddf4ff` | `rgba(56,139,253,.4)` / `rgba(84,174,255,.4)` | `--borderColor-accent-emphasis` (`#1f6feb` / `#0969da`) |
| **Success** | Dark `#3fb950` / Light `#1a7f37` | `rgba(46,160,67,.15)` / `#dafbe1` | `rgba(46,160,67,.4)` / `rgba(74,194,107,.4)` | `#238636` / `#1f883d` |
| **Done** | Dark `#ab7df8` / Light `#8250df` | `rgba(163,113,247,.15)` / `#fbefff` | `rgba(163,113,247,.4)` / `rgba(194,151,255,.4)` | `#8957e5` / `#8250df` |
| **Attention** | Dark `#d29922` / Light `#9a6700` | `rgba(187,128,9,.15)` / `#fff8c5` | `rgba(187,128,9,.4)` / `rgba(212,167,44,.4)` | — |
| **Danger** | Dark `#f85149` / Light `#d1242f` | `rgba(248,81,73,.15)` / `#ffebe9` | `rgba(248,81,73,.4)` / `rgba(255,129,130,.4)` | `#da3633` / `#cf222e` |

## 5. 专用色组（按钮、Diff、热力图与阴影）

- **按钮专用**：`--button-default-bg` / `--button-default-bg-hover` / `--button-default-border`、`--button-primary-bg` / `--button-primary-bg-hover`、`--button-danger-fg` / `--button-danger-bg-hover`、`--control-bg-hover`。
- **双主题 Diff**：`--diff-add-bg`、`--diff-add-num-bg`、`--diff-del-bg`、`--diff-del-num-bg`、`--diff-hunk-bg`（禁止在业务 CSS 中写死深色背景）。
- **交付热力图**：`--contrib-0` 至 `--contrib-4` 五档绿色阶梯。
- **浮层阴影与遮罩**：`--shadow-overlay`、`--shadow-dialog`、`--backdrop-bg`。

## 6. 编码红线

- 禁止在 `theme.css` 之外编写任何硬编码十六进制色值（如 `#1f2328`、`#ffffff`、`#8171ed25`）。
- 新代码一律使用 Primer 语义变量（`--bgColor-*`、`--fgColor-*`、`--borderColor-*`），不再新增对旧 `--af-color-*` 或 `--color-*` 别名的引用。
