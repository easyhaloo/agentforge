# GitHub UI 界面对齐检查清单

## 📋 概述

本文档记录 AgentForge Changeset 功能与 GitHub Pull Request 界面的设计对齐情况，基于 GitHub 实际界面的逆向分析。

## 🎯 核心对齐区域

### 1. Files Changed Tab（文件变更标签页）

#### ✅ 已完成（原型阶段）
- [x] 双栏布局（可调整宽度的侧边栏 + diff 查看器）
- [x] 文件树层次结构（文件夹可折叠/展开）
- [x] 文档形状的状态图标：
  - Modified: 灰色文档 `#57606a`
  - Added: 绿色文档+加号 `#3fb950`
  - Deleted: 红色文档+减号 `#f85149`
- [x] 统一/分屏 diff 视图切换
- [x] 行号双列显示（旧/新）
- [x] Hunk headers (`@@ -10,3 +10,4 @@`)
- [x] 文件变更统计（+/- 计数）
- [x] 可拖拽调整侧边栏宽度（200-600px）
- [x] Chevron 动画（文件夹展开/收起）
- [x] 深色主题配色方案

#### ❌ 待实现（生产环境）
- [ ] React 组件迁移（从 vanilla JS 原型）
- [ ] 后端 API 集成
- [ ] 路由配置更新
- [ ] 真实数据加载
- [ ] 语法高亮（超越基础 diff 着色）
- [ ] 性能优化（虚拟滚动、懒加载）

### 2. Tab 导航系统

#### GitHub 参考结构
```
Conversation | Commits | Checks | Files changed
```

#### AgentForge 当前结构
```typescript
["overview", "revisions", "evaluation", "review", "merge"]
// 缺少 "files" tab
```

#### 建议调整
```typescript
["overview", "revisions", "evaluation", "review", "files", "merge"]
//                                                    ^^^^^^ 添加到这里
```

**理由**：
- Files 应该在 merge 之前，作为最终审查步骤
- 位于 review 之后符合工作流逻辑（审查 → 查看文件 → 合并）

#### 样式对齐状态
- [x] 横向 tab 布局
- [x] 激活状态高亮（紫色 vs GitHub 的橙色）
- [x] Hover 状态
- [x] 圆角设计（GitHub 使用更方正的风格）
- [ ] 下划线指示器（GitHub 使用，AgentForge 使用背景色）

### 3. 文件状态可视化

#### GitHub 图标设计（已精确复刻）

**Modified（修改）**
```svg
<svg width="16" height="16" viewBox="0 0 16 16">
  <path fill="#57606a" d="M3 1.75C3 .784 3.784 0 4.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0113.25 16h-8.5A1.75 1.75 0 013 14.25V1.75z"/>
</svg>
```

**Added（新增）**
```svg
<!-- 绿色文档 + 加号叠加 -->
<path fill="#3fb950" d="[文档形状]"/>
<path fill="#3fb950" d="[加号形状]"/>
```

**Deleted（删除）**
```svg
<!-- 红色文档 + 减号叠加 -->
<path fill="#f85149" d="[文档形状]"/>
<path fill="#f85149" d="[减号形状]"/>
```

#### 实现位置
- 原型：`docs/_archive/prototype/changeset-files-tab/index.html` (line 200+)
- 生产版本待创建：`apps/web/src/pages/changesets/FileStatusIcon.tsx`

### 4. Diff 查看器

#### GitHub 配色方案（深色主题）

**添加行**
- 背景：`#1a4d2e`（GitHub）→ `#0d3a2e`（AgentForge 已对齐）
- 文字：`#56d364`（GitHub）→ `#65c89b`（AgentForge 已对齐）
- 行号背景：更深的绿色

**删除行**
- 背景：`#662f2d`（GitHub）→ `#3d252f`（AgentForge 已对齐）
- 文字：`#f97583`（GitHub）→ `#e28d98`（AgentForge 已对齐）
- 行号背景：更深的红色

**上下文行**
- 背景：`#0d1117`（GitHub）→ `#090d16`（AgentForge 背景色）
- 文字：`#8b949e`（GitHub）→ `#69758c`（AgentForge 已对齐）

#### Diff 视图模式

**Unified View（统一视图）**
- [x] 单列显示
- [x] 添加行显示绿色 `+` 前缀
- [x] 删除行显示红色 `-` 前缀
- [x] 上下文行无前缀

**Split View（分屏视图）**
- [x] 左右双列布局（原型已实现简化版）
- [ ] 真正的并排旧版/新版对比（生产版待实现）
- [ ] 行对齐算法（处理不等长变更）

### 5. 文件树交互

#### GitHub 交互模式
1. **点击文件** → 右侧显示 diff
2. **点击文件夹** → 展开/收起子项
3. **选中状态** → 浅灰色背景高亮
4. **Hover 状态** → 轻微背景色变化
5. **Chevron 动画** → 90度旋转（展开时）

#### AgentForge 实现状态
- [x] 所有交互已在原型中实现
- [ ] React 事件处理待迁移
- [ ] 键盘导航待添加（↑↓ 方向键）

### 6. 侧边栏功能

#### GitHub 特性
- 可调整宽度（拖拽中间分隔线）
- 可完全折叠（"Hide files" 按钮）
- 显示文件变更统计
- 显示总计（X files changed, +Y −Z）

#### AgentForge 实现状态
- [x] 拖拽调整宽度（200-600px 限制）
- [x] 折叠/展开按钮
- [x] 文件级统计（每个文件的 +/−）
- [x] 总计显示
- [ ] 折叠状态持久化（localStorage）
- [ ] 宽度设置持久化

### 7. WebIDE 集成

#### 当前实现
```typescript
// apps/web/src/pages/changesets/ChangesetDetailPage.tsx
<WebIDELink handle={handle} changeset={changeset} revision={revision}/>
```

位置：
- ✅ Overview tab（变更集概览）
- ✅ Review tab（审查页面）
- ❌ Files tab（待添加）

#### 建议增强
在 Files tab 中为每个文件添加快捷操作：
```typescript
<FileTreeItem>
  {file.path}
  <button onClick={() => openInWebIDE(file.path, file.line)}>
    <Code2 size={12}/>
  </button>
</FileTreeItem>
```

### 8. 响应式设计

#### GitHub 适配策略
- **桌面（≥1280px）**：完整双栏布局
- **平板（768-1279px）**：缩小侧边栏，保持双栏
- **手机（<768px）**：折叠侧边栏为抽屉，单栏显示

#### AgentForge 计划
- [x] 桌面版原型（1024px+）
- [ ] 平板响应式（CSS media queries）
- [ ] 移动端抽屉组件

## 🎨 设计系统细节对比

### 字体

| 元素 | GitHub | AgentForge |
|------|--------|------------|
| 代码 | `ui-monospace, SFMono-Regular` | `SF Mono, Monaco, Cascadia Code` |
| 大小 | `12px` | `11-12px` |
| 行高 | `20px (1.67)` | `1.6` |

### 间距

| 元素 | GitHub | AgentForge |
|------|--------|------------|
| 文件项垂直间距 | `2px` | `2px` ✓ |
| 文件缩进 | `16px` | `20px` |
| 文件夹缩进 | `8px` | `0px`（文件夹与根平齐）|

### 圆角

| 元素 | GitHub | AgentForge |
|------|--------|------------|
| 按钮 | `6px` | `6px` ✓ |
| 卡片容器 | `12px` | `12px` ✓ |
| Tab 标签 | `6px` | `6px` ✓ |

### 过渡动画

| 元素 | GitHub | AgentForge |
|------|--------|------------|
| Hover 状态 | `0.1s ease` | `0.15s` |
| Chevron 旋转 | `0.2s` | `0.15s` |
| 侧边栏拖拽 | 即时 | 即时 ✓ |

## 🚀 实施路线图

### Phase 1: 基础集成（P0 - 立即）
- [ ] 添加 `"files"` 到 `changesetTabs` 数组
- [ ] 创建路由 `/orgs/:org/changesets/:id/files`
- [ ] 创建 `ChangesetFilesTab.tsx` 组件骨架
- [ ] 实现后端 API：`GET /api/orgs/:orgID/changesets/:changesetID/files`

**预估工作量**：2-3 天

### Phase 2: 组件迁移（P0 - 立即）
- [ ] 创建 `FilesTreeSidebar.tsx`
- [ ] 创建 `FileTreeItem.tsx` 和 `FileTreeDirectory.tsx`
- [ ] 创建 `DiffViewer.tsx`
- [ ] 迁移所有 CSS 到 `changeset-files.css`
- [ ] 实现 `useResizableSidebar` hook
- [ ] 实现 `useFileDiff` hook

**预估工作量**：3-4 天

### Phase 3: 数据集成（P1 - 短期）
- [ ] 连接 API 获取文件列表
- [ ] 实现文件 diff 内容加载
- [ ] 错误处理和加载状态
- [ ] 添加 i18n 翻译键

**预估工作量**：2 天

### Phase 4: 增强功能（P1 - 短期）
- [ ] 添加语法高亮（`react-syntax-highlighter`）
- [ ] 实现虚拟滚动（大文件树性能优化）
- [ ] 添加键盘导航（↑↓ 方向键）
- [ ] 持久化侧边栏宽度/折叠状态

**预估工作量**：3-4 天

### Phase 5: 高级特性（P2 - 长期）
- [ ] 文件搜索/过滤功能
- [ ] 展开/折叠未变更代码区域
- [ ] 每个文件的 "Open in WebIDE" 快捷按钮
- [ ] 代码注释功能（如需要 code review）
- [ ] 响应式设计（平板/移动端）

**预估工作量**：5-7 天

## 📊 对齐度评分

| 类别 | 对齐度 | 说明 |
|------|--------|------|
| **视觉设计** | 95% | 原型已精确复刻 GitHub 的视觉风格 |
| **交互模式** | 90% | 所有核心交互已在原型中实现 |
| **功能完整性** | 40% | 原型完成，但未集成到生产环境 |
| **性能优化** | 0% | 生产环境功能尚未实现 |
| **响应式设计** | 60% | 仅桌面版完成 |
| **可访问性** | 70% | 基础结构支持，需补充 ARIA 标签 |

**总体对齐度**：**65%**

主要差距在于**功能集成**，而非设计本身。

## 🔍 关键发现

### 已精确复刻的元素
1. ✅ 文档形状状态图标（从 GitHub Primer 设计系统提取）
2. ✅ Diff 配色方案（深色主题）
3. ✅ 双栏布局和可调整侧边栏
4. ✅ 文件树层次结构和交互

### 需要微调的元素
1. ⚠️ Tab 导航：GitHub 使用下划线指示器，AgentForge 使用背景色
2. ⚠️ 文件缩进：GitHub 16px vs AgentForge 20px
3. ⚠️ 动画速度：GitHub 稍快（0.1s vs 0.15s）

### 完全缺失的功能
1. ❌ 真正的 Split View（并排旧版/新版对比）
2. ❌ 语法高亮（当前仅基础 diff 着色）
3. ❌ 文件搜索/过滤
4. ❌ 折叠未变更代码区域
5. ❌ 代码注释功能

## 📝 实施建议

### 立即行动（本周）
1. 创建 `ChangesetFilesTab` 组件
2. 更新路由配置
3. 实现基础后端 API

### 短期目标（2周内）
1. 完成组件迁移
2. 集成真实数据
3. 添加语法高亮

### 长期规划（1个月）
1. 性能优化
2. 响应式设计
3. 高级功能（搜索、注释）

## 🔗 相关文件

- **原型**：`docs/_archive/prototype/changeset-files-tab/index.html`
- **原型文档**：`docs/_archive/prototype/changeset-files-tab/README.md`
- **路由配置**：`apps/web/src/shared/routing/paths.ts`
- **页面组件**：`apps/web/src/pages/changesets/ChangesetDetailPage.tsx`
- **WebIDE 集成**：`apps/web/src/pages/changesets/ChangesetDetailPage.tsx:27-39`

## 📧 决策点

需要团队确认：
1. ✅ 是否使用 GitHub 完全相同的配色（已确认：使用 AgentForge 紫色主题）
2. ❓ Split View 是否实现真正的并排对比（简化版 vs 完整版）
3. ❓ 是否需要代码注释功能
4. ❓ 是否需要"标记为已查看"功能（原型 v1.2 已移除）
5. ❓ 文件树是否需要文件类型图标

---

**文档版本**：1.0  
**最后更新**：2024  
**对齐目标**：GitHub Pull Request Files Changed 页面  
**当前状态**：原型完成，待生产集成
