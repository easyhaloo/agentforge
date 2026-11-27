# AgentForge 前端设计系统规范（GitHub Primer 基准）

> 状态：规范基线（2026-11-26）  
> 适用范围：`apps/web/src`（`shared/ui` 与全部业务页面）  
> 参考标准：[GitHub Primer Design System](https://primer.style/product/primitives/)  
> 交互原型：`tmp/github-ui-prototype/index.html`

## 目录索引

本设计系统按职责拆分为 6 份独立专题规范，开发与评审时按需查阅：

| 模块 | 文档路径 | 涵盖内容 |
| :--- | :--- | :--- |
| **颜色与主题** | [colors.md](colors.md) | 4 层画布、2 级边框、语义色组、按钮/Diff/热力图 Token、Dark / Dark Dimmed / Light 三套配色与历史变量映射 |
| **排版与尺寸** | [typography.md](typography.md) | 字体栈、字阶规范（严格 `>= 12px`）、圆角（`3/6/12/9999px`）、控件高度（`28/32/40px`）与 4px 间距网格 |
| **图标体系** | [icons.md](icons.md) | 图标尺寸、颜色语义、`lucide-react` 与 GitHub Octicons 语义映射表、无障碍与禁用规则 |
| **状态规范** | [states.md](states.md) | 业务语义状态矩阵（Open / Merged / Closed / Draft / Running 等）与 8 种控件交互状态规范 |
| **组件规范** | [components.md](components.md) | 状态组件、搜索栏/筛选栏、Diff 与 DiffStat、Label/Counter/BranchChip、Button 族、BorderBox、UnderlineNav、ActionList、Subhead |
| **布局与切换** | [layout.md](layout.md) | 全局外壳、主题切换逻辑、4 级导航切换、5 大标准页面骨架、响应式断点与 Z-Index 层级契约 |

## 核心设计原则

1. **扁平克制、层级分明**：依靠 4 层画布与 2 级边框建立视觉层次，禁止装饰性渐变、发光阴影和旧紫色聚焦光晕。
2. **开发者工具信息密度**：正文基准 `14px / 20px`，默认控件高 `32px`，默认圆角 `6px`，严格禁止任何小于 `12px` 的字号。
3. **零硬编码、原生多主题**：除 `shared/ui/theme/theme.css` 外禁止硬编码十六进制色值，所有组件与代码 Diff 必须原生适配 Dark、Dark Dimmed 与 Light。
4. **共享组件唯一入口**：通用控件与 Primer 原语均沉淀在 `apps/web/src/shared/ui`，业务页面通过 `@/shared/ui` 导入并接受 `shared-ui-usage.test.ts` 静态门禁约束。
