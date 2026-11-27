# 图标体系规范（Icons）

> 依赖库：`lucide-react`（当前主图标库）与 `app/components/TopbarIcon.tsx`（Octicon 轮廓对齐）

## 1. 尺寸与描边基准

| 场景 | 尺寸 | 描边（Lucide） | 对齐规则 |
| :--- | :--- | :--- | :--- |
| 默认正文 / 导航 / 按钮 / 列表行 | `16px × 16px` | `strokeWidth={1.75}` | 与 `14px / 20px` 文本垂直居中，图标与文字间距固定 `8px`（紧凑按钮内 `6px`） |
| 紧凑微图标（徽标、下拉箭头、内联状态） | `12px × 12px` | `strokeWidth={2}` | 仅用于 `StateLabel`、`Label`、排序箭头或展开折叠指示器 |
| 空态 / 独立引导插画图标 | `24px–32px` | `strokeWidth={1.5}` | 仅用于 `Empty`、授权空态等独立占位容器 |

## 2. 图标颜色语义

- **默认态**：统一使用 `--fgColor-muted`，避免图标喧宾夺主抢夺标题视觉重心。
- **激活态 / 悬停态**：在激活的 `UnderlineNav`、`ActionListItem` 或悬停图标按钮中切换为 `--fgColor-default`。
- **实心强调容器内**：在 Primary 按钮或 `StateLabel` 内继承 `--fgColor-onEmphasis`。
- **语义状态图标**：严格绑定业务状态色——Open/Pass 用 `--fgColor-success`，Merged/Agent 用 `--fgColor-done`，Closed/Fail/Danger 用 `--fgColor-danger`，Running/Warning 用 `--fgColor-attention`。

## 3. GitHub 核心领域图标语义映射

同一业务概念全站必须使用唯一固定图标，禁止同一页面或不同页面混用多个隐喻：

| 业务概念 | GitHub Octicon 基准 | AgentForge 对应使用 |
| :--- | :--- | :--- |
| 仓库（Repository） | `repo` / `lock`（私有） | `TopbarIcon("repo")` / `BookMarked` / `Lock` |
| 代码 / 分支 / 提交 | `code` / `git-branch` / `git-commit` | `Code2` / `GitBranch` / `GitCommitHorizontal` |
| Changeset / PR | `git-pull-request` / `git-merge` / `git-pull-request-closed` / `git-pull-request-draft` | `TopbarIcon("git-pull-request")` / `GitPullRequest` / `GitMerge` |
| Issue（议题） | `issue-opened` / `issue-closed` | `TopbarIcon("issue-opened")` / `CircleDot` / `CheckCircle2` |
| CI / CD 流水线 | `play` / `check` / `x` | `PlayCircle` / `Check` / `X` |
| 文件树目录与文件 | `file-directory-fill` / `file` | 目录实心柔和蓝/灰，文件线性 `--fgColor-muted` |
| 全局搜索 / 设置 | `search` / `gear` / `three-bars` | `Search` / `Settings` / `Menu` |

## 4. 无障碍与禁止事项

- **装饰性图标**（旁边已有明确可见文字）：必须添加 `aria-hidden="true"`，防止屏幕阅读器重复播报。
- **纯图标按钮（`IconButton`）**：按钮本身必须提供本地化的 `aria-label` 与 `title`（或 Tooltip），图标设 `aria-hidden="true"`。
- **禁止 Emoji 替代功能图标**：除用户 Markdown 正文或 Reaction 场景外，UI 控件与导航栏禁止使用原生 Emoji 替代矢量图标。
