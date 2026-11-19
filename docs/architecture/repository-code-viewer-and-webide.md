# Repository code viewer and WebIDE architecture

- Status: Accepted
- Decision date: 2026-11-19
- Scope: repository source browsing, code navigation, diff presentation, and browser-based editing.

## Context

The current repository source viewer is a small, hand-written regular-expression tokenizer embedded in `RepositorySourceViewer.tsx`. It recognizes a limited keyword set and a few token shapes; it is not a language grammar implementation. Language detection is an extension lookup in the same component. The WebIDE is currently a safe, changeset-aware text editor built on a shared textarea component. It already has commit-pinned reads, optimistic concurrency, dirty-buffer protection, and Changeset-only write-back.

These are separate product surfaces with different requirements:

- A repository viewer must render quickly, remain readable for large files, support stable line anchors, and work well in read-only contexts.
- A WebIDE must provide editing, language services, keyboard interaction, diagnostics, and extension points.
- Diff rendering has its own old/new line mapping and must not be coupled to either editor.
- Markdown preview remains a separately secured renderer; it must not be routed through a code highlighter.

## Decision

### 1. Repository source viewer: Shiki tokenization

Adopt Shiki (TextMate grammar-based highlighting) as the target syntax-highlighting engine for repository source files.

- Use Shiki's token API and render tokens as React text nodes/spans. Do not inject arbitrary HTML returned by a highlighter.
- Keep a small, explicit language registry and filename rules, with extension, basename, and shebang matching. The registry is the UI equivalent of a Linguist-style language mapping; do not treat Linguist itself as a browser renderer.
- Unknown, unsupported, binary, or oversized files fall back to plain text or a metadata/download state.
- Keep line numbers, active-line styling, copy, and `#Lx` anchors in AgentForge-owned React components.
- Initialize the highlighter once, load grammars on demand, and avoid eagerly importing every language grammar.
- Preserve a plain-text first paint. Highlight asynchronously and progressively for large files; establish measured size/line thresholds before enabling expensive tokenization. Use worker-based tokenization only if profiling demonstrates main-thread contention and the chosen Shiki build can be safely hosted in a worker.
- Theme colors must come from shared design tokens/CSS variables so light and dark themes remain consistent.

### 2. WebIDE: Monaco Editor

Adopt Monaco Editor as the target WebIDE editor, loaded lazily on the WebIDE route.

- Monaco is the editing surface, not the repository read-only viewer.
- Keep the existing Changeset-only save API, commit/blob SHA optimistic concurrency, dirty-buffer lifecycle, conflict preservation, and permission checks as the authoritative write boundary.
- Do not enable writes against arbitrary branches or the repository default branch.
- Configure language support from the same shared language registry used by the repository viewer.
- Expose a narrow AgentForge editor adapter for file content, language, read-only state, active line, diagnostics, save, and disposal. Avoid coupling page state to Monaco internals.
- The first adapter contract is now in `apps/web/src/shared/code/EditorAdapter.tsx`; its current TextArea implementation is transitional and preserves the existing controlled-buffer and save lifecycle. Monaco remains a follow-up adapter, not part of this initial seam.
- Add WebIDE capabilities incrementally: model lifecycle, language services, diagnostics, formatting, then extension APIs. An extension must not gain credentials or bypass backend authorization.

### 3. Diff viewer: independent renderer

Keep unified diff parsing and rendering independent from Shiki and Monaco. Preserve old/new line numbers, hunk boundaries, add/remove/context states, and text-only rendering. Syntax highlighting inside diffs may be added later as an optional token decoration layer, but it must not alter diff parsing or line mapping.

### 4. Markdown: separate secure renderer

Continue using the bounded Markdown renderer and its existing URL, image, and repository-root protections. Do not use Shiki as a Markdown renderer and do not allow raw HTML to become executable markup.

### 5. Shared language metadata, separate rendering engines

Create a shared language metadata module for extension/basename/shebang detection, display labels, and mappings to Shiki and Monaco language IDs. Viewer and editor consume the same metadata but retain independent rendering and lifecycle implementations.

## Why this choice

- GitHub's public Linguist project demonstrates the value of a maintained language-identification and grammar-mapping layer; Linguist is not itself the source-viewer UI.
- GitLab's public source-viewer engineering notes describe a dedicated blob viewer with asynchronous highlighting, progressive rendering, and lazy processing. This is a better model for repository browsing than mounting a full IDE editor for every file.
- Monaco provides a more complete browser IDE foundation than a lightweight syntax-highlighting component. The cost is larger bundles and more memory, so it must be route-lazy and isolated to WebIDE.
- Shiki offers TextMate-compatible grammar quality for read-only source rendering while keeping the DOM and line navigation under AgentForge control.

## Non-goals

- Reproducing GitHub or GitLab internals exactly.
- Treating public documentation as proof of Yunxiao's undisclosed highlighting library.
- Adding Tree-sitter to the first syntax-highlighting migration. Tree-sitter is a later structural-navigation capability for definitions/references, not a prerequisite for colored source text.
- Adding GitHub-specific provider dependencies or changing the native Git repository model.
- Enabling production deployment as part of this work.

## Delivery plan

1. **Architecture baseline**: document the decision, add shared language metadata and tests, and preserve current viewer behavior.
2. **Repository viewer migration**: Shiki tokenization is now wired into the existing viewer contract. The viewer paints escaped plaintext immediately, initializes one shared highlighter lazily, loads the detected grammar on demand, and renders themed tokens as React text nodes/spans. Unknown languages and files above the 256 KiB / 10,000-line guard remain plaintext. Unit coverage exercises real TypeScript tokenization, source-as-text safety, line anchors, active lines, and fallback behavior. Follow-up validation remains required in CI.
3. **WebIDE foundation**: add Monaco as a lazy-loaded route dependency behind an adapter; preserve the current save lifecycle and add browser tests for dirty state, discard, save, conflict, deep links, and keyboard shortcuts.
4. **Navigation and diagnostics**: add Tree-sitter-backed structural navigation only after language-service requirements and performance budgets are measured.
5. **Performance gates**: track initial route bundle, viewer time-to-first-text, highlight completion, large-file memory, editor startup, and worker/main-thread cost in CI or repeatable benchmark scripts.

## Acceptance criteria

- Repository source browsing never requires Monaco to load.
- WebIDE never writes outside the selected unmerged Changeset branch.
- Syntax tokens are rendered as escaped React text, not unsanitized HTML.
- Unsupported languages and oversized files remain usable through plain-text fallback.
- Line anchors and active-line deep links remain stable across viewer and editor.
- Markdown and diff safety invariants remain unchanged.
- Viewer and WebIDE share language metadata but not editor instances or mutable model state.

## Reference material

- GitHub Linguist: https://github.com/github-linguist/linguist
- GitHub Code Navigation: https://github.com/github/code-navigation
- GitLab blob syntax highlighting: https://docs.gitlab.com/development/fe_guide/source_code/blob_syntax_highlighting/
- GitLab source viewer: https://docs.gitlab.com/development/fe_guide/source_code/source_viewer/
- GitLab source editor: https://docs.gitlab.com/development/fe_guide/source_editor/
- Alibaba Cloud Yunxiao source files: https://help.aliyun.com/zh/yunxiao/user-guide/manage-source-files
- Alibaba Cloud Yunxiao WebIDE: https://help.aliyun.com/zh/yunxiao/user-guide/introduction-to-webide-features/

Yunxiao's public documentation confirms repository browsing and WebIDE capabilities but does not disclose the exact syntax-highlighting library. No specific viewer dependency is attributed to Yunxiao in this decision.
