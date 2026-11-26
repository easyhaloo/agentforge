# 组件规范（Components）

> 统一导入入口：`@/shared/ui`（源码位于 `apps/web/src/shared/ui/components/`）  
> 静态门禁：`apps/web/src/architecture/shared-ui-usage.test.ts`（禁止业务页面绕过共享组件编写原生 `<button>` / `<input>` / `<select>` / `<textarea>` / `<table>`）

## 1. 状态组件（State Components）

- **`StateLabel`**（已实现于 `primer.tsx`）：实心药丸状态徽标，支持 `status: "open" | "merged" | "closed" | "draft"` 与 `size: "small" | "medium"`（高 `22px` / `28px`，`--radius-full`）。
- **`CheckStatus` / `StatusDot`**：用于提交记录、PR 列表检查与 CI/CD 运行行，区分 `passed`（绿 `✓`）、`failed`（红 `✕`）、`running`（黄点/加载环）、`pending`（黄空心点）、`skipped`（灰）；列表内点击通过 `Popover` 展示明细，不打断当前页面上下文。
- **`Alert / Flash`**（`feedback.tsx`）：圆角 `6px`，使用各语义 `muted` 背景配 `border-muted` 边框，错误态 `role="alert"`，其余 `role="status"`。

## 2. 搜索栏与筛选栏组件（Search & Filter Bar）

### 2.1 全局命令搜索（Topbar Trigger + `CommandPalette`）
- **触发器**：位于 Topbar 右侧，宽 `260px`（`<= 960px` 为 `160px`，`<= 640px` 折叠为 `32px × 32px` 图标按钮），高 `32px`，圆角 `6px`，透明背景配 `1px solid var(--borderColor-default)` 与 `<kbd>/</kbd>`。
- **弹层**：按 `/` 或 `⌘K` / `Ctrl+K` 唤起，宽 `min(760px, calc(100vw - 24px))`，圆角 `12px`，支持 `org:` / `repo:` / `is:` 作用域前缀高亮（`--bgColor-accent-muted`）、`↑`/`↓` 选中（左侧 2px 蓝线）、`Enter` 跳转与 `ESC` 关闭并归还焦点。

### 2.2 列表语法筛选栏（`FilterBar`）
用于 Changesets、Issues、Repositories、Members 列表顶部（单行 `gap: 8px`，移动端自动换行）：
1. **组合筛选输入**：前置 `Filters ▾` 按钮（左圆角 `6px`）拼接语法输入框（`flex: 1`，右圆角 `6px`，如 `is:changeset is:open`），输入 `300ms` 防抖、`Enter` 立即查询。
2. **辅助按钮组**：`ButtonGroup`（如 `Labels` + `CounterLabel`、`Milestones` + `CounterLabel`）。
3. **主操作按钮**：右侧放置唯一绿色 `Button variant="primary"`（如 `New changeset`）。

## 3. Diff 状态组件（Diff & DiffStat）

- **`DiffStat`**：展示 `+<additions>`（`--fgColor-success`）与 `-<deletions>`（`--fgColor-danger`）及 **5 格比例方块**（每格 `8px × 8px`，圆角 `1px`，间距 `1px`；全零时 5 格灰，非零时按比例分配绿/红，有增删各自至少占 1 格）。
- **`FileStatusBadge`**：`16px × 16px` 圆角 `3px` 等宽字母框——`A`（Added 绿）、`M`（Modified 黄）、`D`（Deleted 红）、`R`（Renamed 蓝）。
- **`DiffViewer`**：包裹在 `BorderBox` 内，文件头固定展示折叠按钮、等宽文件路径、`DiffStat` 与 `Viewed` 勾选框（勾选后折叠代码体）；代码区强制使用双主题 Token（`--diff-add-bg` / `--diff-del-bg` / `--diff-hunk-bg`），等宽 `12px / 20px`，行号列宽 `44px`。

## 4. Label 与微组件规范

| 组件 | 尺寸与圆角 | 变体与规则 |
| :--- | :--- | :--- |
| **`Label`**（已实现） | 高 `20px`，`padding: 0 7px`，`12px`，`--radius-full` | `default` / `accent` / `success` / `done` / `attention` / `danger`；低饱和度浅底配语义边框 |
| **`CounterLabel`**（已实现） | 最小宽 `20px`，高 `20px`，`padding: 0 6px`，`12px`，`--radius-full` | `primary` / `secondary`；超出 `999` 展示 `999+` |
| **`BranchChip`**（已实现） | `padding: 1px 7px`，等宽 `12px`，`--radius-md` | 统一 `--bgColor-accent-muted` + `--fgColor-accent` |

## 5. 按钮规范（`Button` / `IconButton` / `ButtonGroup`）

- **4 种变体**：
  - `default`（默认最高频）：`--button-default-bg` + `1px solid --button-default-border` + `--fgColor-default`。
  - `primary`（每屏主区最多 1 个）：GitHub 绿 `--button-primary-bg` + `--fgColor-onEmphasis`。
  - `danger`：静默态为 Default 底配红色文字 `--button-danger-fg`，**仅 Hover 时转为实心红底白字**（`--button-danger-bg-hover`）。
  - `ghost / invisible`：透明无框，Hover 显示 `--control-bg-hover`。
- **3 种尺寸**：`small`（`28px` / `12px`）、`medium`（默认 `32px` / `14px`）、`large`（`40px` / `14px`），圆角统一 `6px`。
- **`ButtonGroup`**：相邻按钮 `margin-left: -1px` 合并中缝边框，仅首尾保留 `6px` 外圆角（如 `Watch | 14`、`Unified | Split`）。

## 6. 容器与导航原语（已实现于 `primer.tsx`）

- **`BorderBox`**（`BorderBox` / `BorderBoxHeader` / `BorderBoxRow`）：外框 `1px solid --borderColor-default` 圆角 `6px`，头栏 `--bgColor-muted`，行间 `--borderColor-muted` 弱分割线，支持 `hoverable` 与 `danger`（Danger Zone 红框）。
- **`UnderlineNav`**：高 `44px`，背景 `--bgColor-inset`，激活项 `font-weight: 600` 配 `2px` 珊瑚橙底条（`--underlineNav-borderColor-active`）与 `aria-current="page"`。
- **`ActionList`**（`ActionList` / `ActionListGroup` / `ActionListItem`）：分组侧栏导航与菜单，激活项带左侧 `4px` 蓝色圆角竖条与 `--bgColor-neutral-muted` 底色。
- **`Subhead`**：`24px` 标题 + 可选描述 + 右侧操作槽 + 底部 `--borderColor-muted` 分割线，支持 `danger` 变体。
