# GitHub Files Changed 设计规范

> 基于 GitHub PR Files Changed 界面的逆向分析
> 
> 数据来源：原型代码分析 + GitHub 实际界面观察
> 
> 最后更新：2024

## 📋 目录

1. [布局参数](#1-布局参数)
2. [配色方案](#2-配色方案)
3. [动画规格](#3-动画规格)
4. [字体规格](#4-字体规格)
5. [图标系统](#5-图标系统)
6. [交互状态](#6-交互状态)

---

## 1. 布局参数

### 1.1 侧边栏尺寸

| 参数 | 值 | 状态 | 备注 |
|------|-----|------|------|
| 默认宽度 | `320px` | ✅ | 已在原型中实现 (line 112) |
| 最小宽度 | `200px` | ✅ | 拖拽调整时的下限 (line 113) |
| 最大宽度 | `600px` | ✅ | 拖拽调整时的上限 (line 114) |
| 过渡动画 | `width 0.2s` | ✅ | 展开/收起动画 (line 119) |

### 1.2 文件树缩进

| 元素 | 缩进值 | 状态 | 代码位置 |
|------|--------|------|----------|
| 目录内文件 | `20px` | ✅ | `padding-left: 20px` (line 224) |
| 文件项内边距 | `5px 8px` | ✅ | 上下5px，左右8px (line 236) |
| 目录头部内边距 | `6px 8px` | ✅ | (line 180) |

### 1.3 间距规范

| 元素 | 间距 | 状态 |
|------|------|------|
| 文件项之间 | `2px` | ✅ |
| 目录之间 | `4px` | ✅ |
| 图标与文字间距 | `6px` (目录), `8px` (文件) | ✅ |
| Chevron 宽度 | `12px × 12px` | ✅ |
| 文件状态图标 | `16px × 16px` | ✅ |

### 1.4 Diff 查看器布局

| 参数 | 值 | 状态 |
|------|-----|------|
| 统一模式列布局 | `40px 1fr` | ✅ |
| 分屏模式列布局 | `40px 40px 1fr` | ✅ |
| 行号宽度 | `40px` | ✅ |
| 行号内边距 | `2px 12px` | ✅ |
| 代码内容内边距 | `2px 12px` | ✅ |

---

## 2. 配色方案

### 2.1 深色主题基础色

| 变量名 | 色值 | 用途 | 状态 |
|--------|------|------|------|
| `--af-color-background` | `#090d16` | 最深背景 | ✅ |
| `--af-color-surface` | `#101725` | 次级表面 | ✅ |
| `--af-color-surface-raised` | `#141c2b` | 凸起表面 | ✅ |
| `--af-color-hover` | `#1b2638` | 悬停状态 | ✅ |
| `--af-color-border` | `#273248` | 边框色 | ✅ |

### 2.2 Diff 颜色（关键对比 GitHub）

#### 添加行

| 参数 | 原型值 | GitHub 实际值 | 状态 |
|------|--------|---------------|------|
| 背景色 | `#0d3a2e` | `#0d3a2e` | ✅ 匹配 |
| 文字色 | `#65c89b` | `#3fb950` | ⚠️ 偏差 |
| 行号背景 | `rgba(101, 200, 155, 0.1)` | - | ⚠️ 需验证 |

**建议调整：** 文字色应使用 `#3fb950` 以匹配 GitHub

#### 删除行

| 参数 | 原型值 | GitHub 实际值 | 状态 |
|------|--------|---------------|------|
| 背景色 | `#3d252f` | `#3d252f` | ✅ 匹配 |
| 文字色 | `#e28d98` | `#f85149` | ⚠️ 偏差 |
| 行号背景 | `rgba(226, 141, 152, 0.1)` | - | ⚠️ 需验证 |

**建议调整：** 文字色应使用 `#f85149` 以匹配 GitHub

#### 上下文行

| 参数 | 原型值 | 状态 |
|------|--------|------|
| 文字色 | `#98a3b8` (text-secondary) | ✅ |

### 2.3 文件状态指示器颜色

| 状态 | 色值 | SVG Fill | 状态 |
|------|------|----------|------|
| **Added** (新增) | `#3fb950` | 绿色 | ✅ GitHub 标准 |
| **Modified** (修改) | `#57606a` | 灰色 | ✅ GitHub 标准 |
| **Deleted** (删除) | `#f85149` | 红色 | ✅ GitHub 标准 |

**对比文件统计数字：**
- 原型使用 `#3fb950` (additions) 和 `#f85149` (deletions) ✅
- 与文件状态图标颜色一致 ✅

### 2.4 文本颜色层级

| 层级 | 变量名 | 色值 | 用途 |
|------|--------|------|------|
| 主文本 | `--af-color-text` | `#e8eaf2` | 文件名、代码 |
| 次级文本 | `--af-color-text-secondary` | `#98a3b8` | 统计数字 |
| 弱化文本 | `--af-color-text-muted` | `#69758c` | 行号、标题 |

### 2.5 选中状态

| 元素 | 背景色 | 文字色 | 状态 |
|------|--------|--------|------|
| 选中文件 | `rgba(175, 184, 193, 0.12)` | `#c5bcff` | ✅ |
| 选中文件 font-weight | - | `500` | ✅ |

---

## 3. 动画规格

### 3.1 过渡动画时长

| 交互元素 | 属性 | 时长 | 缓动函数 | 状态 |
|----------|------|------|----------|------|
| **Chevron 旋转** | `transform` | `0.15s` | 默认 (ease) | ✅ (line 199) |
| **目录 hover** | `background` | `0.12s` | 默认 | ✅ (line 186) |
| **文件 hover** | `background` | `0.12s` | 默认 | ✅ (line 242) |
| **按钮 hover** | `all` | `0.15s` | 默认 | ✅ (line 85, 152) |
| **侧边栏展开/收起** | `width` | `0.2s` | 默认 | ✅ (line 119) |
| **拖拽手柄 hover** | `background` | `0.15s` | 默认 | ✅ (line 321) |

### 3.2 旋转动画

```css
/* Chevron 初始状态 */
.directory-chevron {
  transform: rotate(0deg);
  transition: transform 0.15s;
}

/* 展开状态 */
.directory-header.expanded .directory-chevron {
  transform: rotate(90deg);
}
```

**状态：** ✅ 已正确实现

### 3.3 视觉反馈

| 交互 | 效果 | 状态 |
|------|------|------|
| 拖拽调整宽度时 | 手柄变为主题色 `--af-color-primary` | ✅ |
| 拖拽时全局光标 | `cursor: ew-resize` | ✅ |
| 拖拽时禁用文本选择 | `user-select: none` | ✅ |

---

## 4. 字体规格

### 4.1 代码字体栈

```css
font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', monospace;
```

**状态：** ✅ 标准等宽字体栈 (line 431)

**GitHub 实际字体栈对比：**
```css
/* GitHub 使用 */
font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
```

⚠️ **建议调整：** 使用 `ui-monospace` 作为首选，添加 `SFMono-Regular` 和 `Menlo`

### 4.2 UI 字体栈

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

**状态：** ✅ 系统字体栈 (line 35)

**GitHub 实际字体栈：**
```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
```

⚠️ **建议调整：** 添加 `"Noto Sans"`, `Helvetica`, `Arial` 后备字体

### 4.3 字号规格

| 元素 | 字号 | 行高 | 字重 | 状态 |
|------|------|------|------|------|
| **代码内容** | `11px` | `1.6` | `400` | ✅ (lines 432-433) |
| **文件名** | `12px` | `1.6` | `400` | ✅ (line 240) |
| **目录名** | `12px` | - | `600` | ✅ (line 183) |
| **侧边栏标题** | `10px` | - | `700` | ✅ (line 137) |
| **按钮文字** | `10px` | - | `600` | ✅ (line 150) |
| **文件统计** | `11px` | - | `400` | ✅ (line 288) |
| **Tab 标签** | `11px` | - | `600` | ✅ (line 82) |
| **Diff 文件头** | `11px` | - | `600` | ✅ (line 412) |
| **Hunk 标题** | `10px` | - | `400` | ✅ (line 491) |

### 4.4 特殊样式

| 元素 | 样式 | 值 | 状态 |
|------|------|-----|------|
| 侧边栏标题 | `text-transform` | `uppercase` | ✅ |
| 侧边栏标题 | `letter-spacing` | `0.6px` | ✅ |
| 文件名溢出 | `text-overflow` | `ellipsis` | ✅ |
| 文件名换行 | `white-space` | `nowrap` | ✅ |

---

## 5. 图标系统

### 5.1 文件状态图标 SVG

#### Modified（灰色文档图标）

```svg
<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16">
  <path fill="#57606a" d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z"></path>
</svg>
```

**状态：** ✅ GitHub 标准图标 (lines 700-704)

#### Added（绿色文档 + Plus）

```svg
<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16">
  <path fill="#3fb950" d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z"></path>
  <path fill="#3fb950" d="M6.5 7.25a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0V11h-1.5a.75.75 0 0 1 0-1.5h1.5V8a.75.75 0 0 1 .75-.75Z"></path>
</svg>
```

**状态：** ✅ GitHub 标准图标（双路径：文档 + plus 符号）(lines 692-696)

#### Deleted（红色文档 + Minus）

```svg
<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16">
  <path fill="#f85149" d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z"></path>
  <path fill="#f85149" d="M4.75 10a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1-.75-.75Z"></path>
</svg>
```

**状态：** ✅ GitHub 标准图标（双路径：文档 + minus 符号）(lines 707-711)

### 5.2 目录图标

```svg
<svg class="directory-icon" viewBox="0 0 16 16" fill="currentColor">
  <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"></path>
</svg>
```

**状态：** ✅ GitHub 标准文件夹图标 (line 735)
**颜色：** `#6ca0dc` (line 211)

### 5.3 Chevron 图标

**字符：** `▶` (U+25B6 Black Right-Pointing Triangle)

**状态：** ✅ 使用 Unicode 字符而非 SVG (line 733)

**尺寸：** `12px × 12px`

---

## 6. 交互状态

### 6.1 Hover 状态

| 元素 | 初始背景 | Hover 背景 | 状态 |
|------|----------|------------|------|
| 目录头部 | `transparent` | `#1b2638` | ✅ |
| 文件项 | `transparent` | `#1b2638` | ✅ |
| 按钮 | 根据类型 | `#1b2638` | ✅ |
| Tab | `transparent` | `#1b2638` | ✅ |

### 6.2 选中状态

| 元素 | 特征 | 值 | 状态 |
|------|------|-----|------|
| 文件项背景 | `rgba(175, 184, 193, 0.12)` | 半透明白色 | ✅ |
| 文件名颜色 | `#c5bcff` | 紫色调 | ✅ |
| 文件名字重 | `500` | 中等加粗 | ✅ |

### 6.3 激活状态（Tab）

```css
.changeset-tab.is-active {
  background: var(--af-color-surface-raised);
  border-color: var(--af-color-border);
  color: var(--af-color-primary);
}
```

**状态：** ✅ (lines 93-97)

### 6.4 用户选择控制

| 场景 | 属性 | 值 | 状态 |
|------|------|-----|------|
| 目录/文件项 | `user-select` | `none` | ✅ 防止拖拽选中文字 |
| 拖拽调整时 | `user-select` | `none` | ✅ 全局禁用 |
| 代码内容 | `user-select` | 默认 | ✅ 允许复制代码 |

---

## 7. 滚动条样式

### 7.1 Webkit 滚动条

```css
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  background: var(--af-color-background);  /* #090d16 */
}

::-webkit-scrollbar-thumb {
  background: var(--af-color-border);  /* #273248 */
  border-radius: 5px;
}

::-webkit-scrollbar-thumb:hover {
  background: #34405a;
}
```

**状态：** ✅ (lines 514-530)

---

## 8. 边框与圆角

### 8.1 圆角规格

| 元素 | 圆角值 | 状态 |
|------|--------|------|
| 主容器 | `12px` (上) / `12px` (下) | ✅ |
| 文件/目录项 | `5px` | ✅ |
| 按钮 | `5px` / `6px` | ✅ |
| Tab | `6px` | ✅ |
| Diff 文件块 | `6px` | ✅ |
| 视图模式切换 | `6px` (外) / `4px` (内) | ✅ |

### 8.2 边框规格

**标准边框：** `1px solid var(--af-color-border)` (#273248)

**应用位置：**
- 容器边框 ✅
- 侧边栏右边框 ✅
- Diff 头部下边框 ✅
- 行号右边框 ✅
- Hunk 上下边框 ✅

---

## 9. 对比总结

### ✅ 完全匹配 GitHub 的实现

1. **布局结构**：侧边栏宽度、文件树缩进、Diff 列布局
2. **文件状态图标**：SVG 路径数据与 GitHub 完全一致
3. **图标颜色**：Added (#3fb950), Deleted (#f85149), Modified (#57606a)
4. **动画时长**：Chevron 0.15s, Hover 0.12s
5. **代码字体**：等宽字体栈，11px / 1.6 行高
6. **交互状态**：Hover, 选中, 展开/收起逻辑

### ⚠️ 需要调整的参数

1. **Diff 文字颜色**
   - 添加行文字：`#65c89b` → 应为 `#3fb950`
   - 删除行文字：`#e28d98` → 应为 `#f85149`

2. **代码字体栈**
   - 当前：`'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', monospace`
   - 建议：`ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace`

3. **UI 字体栈**
   - 当前：`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
   - 建议：`-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif`

### ❌ 原型中缺失的功能

1. **文件查看状态跟踪**（viewed/unviewed 标记）
2. **文件过滤功能**（按状态筛选）
3. **跳转到文件功能**（快捷键导航）
4. **代码行评论功能**（inline comments）
5. **Split view 的真正实现**（当前是简化版）

---

## 10. 实施建议

### 立即调整（高优先级）

```css
/* 1. 修正 Diff 文字颜色 */
:root {
  --af-diff-add-text: #3fb950;    /* 从 #65c89b 改为 GitHub 标准 */
  --af-diff-del-text: #f85149;    /* 从 #e28d98 改为 GitHub 标准 */
}

/* 2. 更新代码字体栈 */
.diff-code {
  font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, 
               Liberation Mono, monospace;
}

/* 3. 更新 UI 字体栈 */
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", 
               Helvetica, Arial, sans-serif;
}
```

### 可选优化（中优先级）

1. 添加文件查看状态视觉指示器（复选框或眼睛图标）
2. 实现真正的 Split view（左右分栏显示 before/after）
3. 添加文件过滤控件（按 Added/Modified/Deleted 筛选）

### 未来增强（低优先级）

1. 键盘导航（j/k 上下移动，Enter 展开/收起）
2. 文件搜索框（快速定位文件）
3. 代码语法高亮（使用 Shiki 或 Prism）
4. 折叠长 diff（超过 N 行自动折叠）

---

## 附录：原型代码位置索引

| 规范项 | 代码行号 | 文件 |
|--------|----------|------|
| 侧边栏宽度 | 112-114 | index.html |
| 文件树缩进 | 224 | index.html |
| Chevron 旋转 | 199, 203-205 | index.html |
| Diff 颜色 | 21-24 | index.html (CSS 变量) |
| 文件状态 SVG | 688-721 | index.html |
| 代码字体 | 431-433 | index.html |
| Hover 动画 | 186, 242 | index.html |

---

**文档版本：** 1.0  
**分析者：** Claude (Sonnet 5.5)  
**分析日期：** 2024  
**原型路径：** `/Users/shenggangshu/llm/agentforge/docs/_archive/prototype/changeset-files-tab/index.html`
