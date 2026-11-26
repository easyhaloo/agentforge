# 状态规范（States）

> 设计原则：色彩只在状态变化时发声；所有状态必须同时具备图形与文字双重标识，禁止仅靠颜色传递信息。

## 1. 业务语义状态矩阵（Domain States）

| 状态分类 | 语义枚举 | 前景 Token | 浅底 Token | 实心强调 Token | 图标约定 | 适用场景 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **开放 / 通过** | `open` / `passed` / `healthy` | `--fgColor-success` | `--bgColor-success-muted` | `--bgColor-success-emphasis` | PR Open / `✓` | Open Changeset、CI 通过、健康实例 |
| **已合并 / 完成** | `merged` / `done` / `agent` | `--fgColor-done` | `--bgColor-done-muted` | `--bgColor-done-emphasis` | Git Merge / 紫色完成 | Merged Changeset、Agent 自动交付 |
| **关闭 / 失败 / 危险** | `closed` / `failed` / `error` | `--fgColor-danger` | `--bgColor-danger-muted` | `--bgColor-danger-emphasis` | PR Closed / `✕` | Closed Changeset、CI 失败、合并冲突 |
| **进行中 / 待审 / 警告** | `running` / `pending` / `warning` | `--fgColor-attention` | `--bgColor-attention-muted` | `--fgColor-attention` | 实心黄点 / 加载环 / `!` | Running 流水线、待确认邀请、需修改 |
| **草稿 / 跳过 / 归档** | `draft` / `skipped` / `archived` | `--fgColor-muted` | `--bgColor-neutral-muted` | `--bgColor-neutral-muted` | PR Draft / 斜杠圆 | Draft Changeset、Skipped Job、已归档仓库 |
| **信息 / 选中 / 聚焦** | `info` / `accent` / `selected` | `--fgColor-accent` | `--bgColor-accent-muted` | `--borderColor-accent-emphasis` | 信息图标 / 4px 蓝竖条 | 分支标签、提示横幅、聚焦轮廓 |

## 2. 控件交互状态矩阵（Interactive States）

所有可交互组件必须完整覆盖以下 8 种交互状态：

| 状态 | 视觉表现 | 规范约束 |
| :--- | :--- | :--- |
| **Rest（默认）** | 1px 清晰边界或透明幽灵态，无多余投影 | `--button-default-bg` / `--borderColor-default` |
| **Hover（悬停）** | 微弱底色阶梯变化，无位移缩放 | `--button-default-bg-hover` / `--control-bg-hover`；仅 `@media (hover: hover)` 生效 |
| **Active（按下）** | 边框与底色轻微加深 | `transition: background 80ms ease, border-color 80ms ease` |
| **Focus-visible（键盘聚焦）** | 统一 **2px 纯蓝轮廓**，禁止紫色光晕 | `outline: 2px solid var(--focus-outlineColor)`；输入框用 `inset 0 0 0 1px var(--focus-outlineColor)` |
| **Selected / Current（激活）** | `UnderlineNav` 用 2px 珊瑚橙底条；`ActionList` 用 4px 蓝色左竖条 + 中性底 + `font-weight: 600` | 必须同步 `aria-current="page"` 或 `aria-selected="true"` |
| **Disabled（禁用）** | `opacity: 0.5; cursor: not-allowed` | 保留原生 `disabled` 属性，不触发悬停底色 |
| **Loading（异步加载）** | 禁用重复提交，展示 12px–16px 旋转环 | 必须设置 `aria-busy="true"`，动词转为进行态 |
| **Error / Empty（错误与空态）** | 字段错误用 `--fgColor-danger` 边框 + `12px` 说明；列表空态使用共享 `Empty` 组件 | 字段必须绑定 `aria-invalid="true"` 与 `aria-describedby` |
