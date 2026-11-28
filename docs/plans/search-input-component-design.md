# 配置化 SearchInput 组件设计与接入方案

## 1. 目标

扩展现有 `apps/web/src/shared/ui/components/index.tsx` 中的 `SearchInput` 组件，使其在**完全向后兼容**现有 `value / onChange / onSearch / debounceMs` API 的前提下，通过配置支持以下 4 种视觉与交互模式：

1. **标准搜索框（模式 1：`Search repositories`）**：左侧搜索图标 + 输入框 + 聚焦描边 + 输入后显示清除按钮。
2. **全局触发器（模式 2：`Type / to search`）**：不可直接打字的按钮形态，展示内嵌 `<kbd>/</kbd>` 提示，点击或按快捷键触发 `onTrigger`。
3. **带右侧快捷键角标的输入框（模式 3：`Go to file` + `T`）**：支持直接输入；输入为空时右侧显示 `<kbd>T</kbd>`（支持可选全局快捷键自动聚焦），输入非空时切换为清除按钮。
4. **限定符高亮 + 拼接提交按钮（模式 4：`is:pr state:open`）**：支持 `key:value` 语法中 `value` 部分的浅蓝背景高亮、实心圆形清除按钮、以及输入框右侧无缝拼接的独立搜索提交按钮。

---

## 2. 组件 API 与类型定义

在 `apps/web/src/shared/ui/components/index.tsx` 中扩展 `SearchInputProps`（严格 TypeScript，禁止 `any`）：

```tsx
export type SearchMode = "input" | "trigger";

export interface SearchShortcutConfig {
  /** 快捷键字符，例如 "/" 或 "T" */
  key: string;
  /**
   * 角标位置：
   * - inline-hint: 嵌入提示文案中（如 Type [/] to search）
   * - trailing: 显示在输入框右侧（如 Go to file ... [T]）
   */
  placement?: "inline-hint" | "trailing";
  /** 是否注册全局 keydown 监听（自动忽略 input/textarea/select/contenteditable/dialog 及 IME 组字状态） */
  globalListen?: boolean;
  /** 触发快捷键时的自定义回调；未传时 input 模式默认聚焦输入框，trigger 模式默认调用 onTrigger */
  onShortcut?: () => void;
}

export interface SearchQualifierConfig {
  /** 是否开启 key:value 限定符高亮 */
  enabled: boolean;
  /** 可选白名单，不传则高亮所有匹配 (?:^|\s)([a-zA-Z0-9_-]+):(\S+) 的 value */
  allowedKeys?: readonly string[];
}

export interface SearchInputProps {
  /** 模式：input（默认） | trigger（全局搜索触发器） */
  mode?: SearchMode;
  value?: string;
  onChange?: (value: string) => void;
  onSearch?: (value: string) => void;
  /** trigger 模式下点击或按快捷键时触发 */
  onTrigger?: () => void;

  placeholder?: string;
  /** trigger 模式下用于拼装 "Type [/] to search" */
  triggerHint?: {
    prefix?: string;
    suffix?: string;
  };

  /** 是否显示左侧搜索图标，默认 true；mode="input" 且 submitButton=true 时通常可设为 false */
  leadingIcon?: boolean;
  /** 快捷键提示与监听配置 */
  shortcut?: SearchShortcutConfig;
  /** 限定符语法高亮配置 */
  qualifiers?: SearchQualifierConfig;

  /** 是否显示清除按钮，默认 true */
  clearable?: boolean;
  /** 清除按钮样式：plain（默认 ×） | filled（实心圆 ×） */
  clearButtonStyle?: "plain" | "filled";
  /** 是否在右侧拼接独立搜索提交按钮 */
  submitButton?: boolean;

  debounceMs?: number;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}
```

---

## 3. 核心交互与实现细节

### 3.1 `trigger` 模式
- 当 `mode="trigger"` 时，渲染为 `<button type="button" className="af-search af-search--trigger ...">`（保留 `aria-haspopup="dialog"` 与 `aria-keyshortcuts` 属性，便于 `Topbar` 复用）。
- 当提供 `triggerHint` 与 `shortcut` 时，内部按 `leadingIcon` + `triggerHint.prefix` + `<kbd className="af-search__kbd">{shortcut.key}</kbd>` + `triggerHint.suffix` 渲染。

### 3.2 `input` 模式与 `trailing` 快捷键
- 当 `mode="input"`（默认）：
  - 若 `shortcut?.placement === "trailing"` 且当前 `value === ""`，右侧渲染 `<kbd className="af-search__kbd">{shortcut.key}</kbd>`。
  - 当 `value !== ""` 且 `clearable !== false` 时，右侧渲染清除按钮（`plain` 或 `filled` 样式）；点击清除后调用 `onChange?.("")`、`onSearch?.("")` 并恢复输入框焦点。
  - 若 `shortcut?.globalListen` 为 `true`，注册全局 `keydown` 监听（忽略 `defaultPrevented`、`isComposing`、`repeat`、带修饰键以及焦点在 `input, textarea, select, [contenteditable], [role="textbox"], [role="dialog"], [aria-expanded="true"]` 内的事件），命中后聚焦 `inputRef`（或触发 `onShortcut`）。

### 3.3 Qualifier 语法高亮（`qualifiers.enabled`）
- 采用**底层镜像高亮层 + 顶层透明文字 `<input>`** 方案：
  - 顶层 `<input>` 设置透明文字颜色（`color: transparent; caret-color: var(--af-color-text);`），保留原生光标、文本选区与中文 IME 组字能力。
  - 底层镜像层 `<div className="af-search__highlight" aria-hidden="true">` 与 `<input>` 保持完全一致的字体、字号、行高、内边距，并在 `onScroll` / `value` 变化时同步 `scrollLeft`。
  - 仅在非 IME 组字状态（`!isComposing`）下高亮 `key:value` 中的 `value` 部分（使用 `<mark className="af-search__token">` 和 `--af-color-primary-subtle` 浅蓝背景）；组字期间保持常规文字显示。

### 3.4 右侧拼接搜索按钮（`submitButton`）
- 当 `submitButton` 为 `true` 时，外层使用 `.af-search-group` 包裹：输入框容器右侧圆角设为 `0`，紧接一个 `<button type="button" className="af-search__submit">`（右侧圆角与输入框一致，显示搜索图标），点击立即执行 `submitImmediately()`。

### 3.5 i18n 与无障碍
- `en-US` 与 `zh-CN` 的 `common.json` 中补充 `components.submitSearch`（如 `"Search"` / `"搜索"`）等必要翻译键，禁止硬编码 UI 文案。
- 所有交互按钮均需具备清晰的 `aria-label`。

---

## 4. 已有 UI 接入清单

1. **[Topbar.tsx](file:///Users/shenggangshu/llm/agentforge/apps/web/src/app/components/Topbar.tsx)**：
   - 将顶部搜索按钮迁移为 `<SearchInput mode="trigger" ... />`（保留 `className="searchbox"` 或兼容样式，保持 `CommandPalette` 唤起行为与现有测试通过）。
2. **[RepositorySwitcher.tsx](file:///Users/shenggangshu/llm/agentforge/apps/web/src/app/components/RepositorySwitcher.tsx)**：
   - 将仓库过滤 `<Input />` 替换为 `<SearchInput debounceMs={0} placeholder={search} ariaLabel={search} ... />`，呈现模式 1（`Search repositories`）。
3. **[PullRequestListPage.tsx](file:///Users/shenggangshu/llm/agentforge/apps/web/src/pages/pulls/PullRequestListPage.tsx)** 与 **[RepositoryIssues.tsx](file:///Users/shenggangshu/llm/agentforge/apps/web/src/pages/repositories/RepositoryIssues.tsx)**：
   - 接入增强后的 `SearchInput` 配置：`qualifiers={{ enabled: true }}`、`clearButtonStyle="filled"`、`submitButton`（保持各自原有的 URL 查询参数同步和 IME 逻辑不变）。
4. **[ui-showcase/index.tsx](file:///Users/shenggangshu/llm/agentforge/apps/web/src/pages/ui-showcase/index.tsx)**：
   - 在 Search 展示卡片中补充 4 种配置模式的交互示例，方便在浏览器中直观验收。

---

## 5. 验收与测试要求

- 在 `apps/web/src/shared/ui/components/components.test.tsx`（或现有 UI 测试文件）中为 `SearchInput` 补充单元测试，覆盖：
  1. 默认输入与防抖 / Enter 立即提交 / 清除聚焦；
  2. `mode="trigger"` 渲染 `<button>`、点击及 `/` 快捷键触发 `onTrigger`；
  3. `shortcut={{ key: "T", placement: "trailing", globalListen: true }}` 空值显示 `<kbd>T</kbd>`、输入后切换清除按钮、全局按 `T` 聚焦输入框；
  4. `qualifiers={{ enabled: true }}` 对 `is:pr state:open` 渲染高亮 token；
  5. `submitButton` 点击立即触发 `onSearch`。
- 运行 `npm test` 与 `npm run build` 全部通过。
