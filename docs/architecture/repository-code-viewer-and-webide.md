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
- The current application theme provider exposes a single dark palette and no light/dark mode contract. Use the matching `github-dark` Shiki theme today; when the application introduces theme switching, move to Shiki dual-theme tokens backed by the same explicit theme state rather than inferring theme from DOM or hard-coding per-viewer colors.

### 2. WebIDE: Monaco Editor

Adopt Monaco Editor as the target WebIDE editor, loaded lazily on the WebIDE route.

- Monaco is the editing surface, not the repository read-only viewer.
- Keep the existing Changeset-only save API, commit/blob SHA optimistic concurrency, dirty-buffer lifecycle, conflict preservation, and permission checks as the authoritative write boundary.
- Do not enable writes against arbitrary branches or the repository default branch.
- Configure language support from the same shared language registry used by the repository viewer.
- Expose a narrow AgentForge editor adapter for file content, language, read-only state, active line, diagnostics, save, and disposal. Avoid coupling page state to Monaco internals.
- The adapter contract in `apps/web/src/shared/code/EditorAdapter.tsx` now defines AgentForge-owned diagnostic, command, and position types plus optional capabilities for reveal, diagnostics, command execution, formatting, and disposal. The textarea adapter intentionally implements only line focusing; capability checks let it remain lightweight until Monaco is introduced.
- Both the Changeset editor and isolated workspace editor are route-lazy and now consume the same AgentForge-owned `shared/code/EditorAdapter.tsx` contract. The transitional TextArea adapter supports per-surface accessible labels and presentation styles without moving persistence into the editor.
- Workspace persistence remains isolated: `WorkspaceEditorPage` calls `workspaceAPI.writeFile(..., selected.version)`, while Changeset persistence remains `changesetAPI.saveFile` with commit/blob SHA concurrency. The shared adapter owns only editing and navigation capabilities; it does not own save APIs or model persistence.

### 2.1 Monaco integration implementation contract

The first implementation should use the official `monaco-editor` ESM package directly and an AgentForge-owned React adapter. Do not add `@monaco-editor/react` as a runtime wrapper in the initial integration: the application is on React 19, the wrapper's published documentation has historically directed React 19 users to a release-candidate channel, and the adapter needs explicit control over model ownership and disposal. Confirm the stable Monaco package version and peer/type compatibility in the actual npm install before committing the lockfile; the currently researched stable package line is 0.57.x.

- Keep every Monaco import in a dedicated WebIDE-only module below the lazy `WebIDERoute` boundary. Do not re-export the adapter from shared barrel files imported by repository browsing.
- Use Vite's ESM worker imports (`?worker`) and `MonacoEnvironment.getWorker` for editor, JSON, CSS, HTML, and TypeScript workers. Do not use legacy `getWorkerUrl`, CDN loading, or AMD assets.
- Instantiate one editor per mounted WebIDE surface. Maintain a URI-keyed model registry for open files; use stable repository + changeset + path URIs so language services and view state remain attached to the correct file.
- Treat React's `value` as the authoritative buffer. On external value changes, update the Monaco model only when model content differs; on editor changes, call `onChange` without resetting selection or undo history.
- Set Monaco's `readOnly` option from the adapter prop. Do not use `disabled` semantics or allow a readonly model to become editable through commands.
- Implement `focusLine`, `revealLine`, `getPosition`, `setDiagnostics`, `executeCommand`, and `formatDocument` through the existing `EditorController`. Map AgentForge diagnostics to Monaco markers and clear markers when the owning model changes or is disposed.
- Register only AgentForge-owned commands and keybindings. Save remains owned by `WebIDEPage`; Ctrl/Cmd+S must continue through the existing Changeset save path.
- Dispose editor instances, model references owned by the adapter, marker state, and command/keybinding registrations on unmount. Do not dispose shared models still referenced by another open tab.
- Do not add language servers or network-backed LSP in this slice. First enable Monaco's built-in TypeScript/JavaScript, JSON, CSS, and HTML services; additional language services require a separate measured scope.
- Keep all writes routed through `changesetAPI.saveFile` with the current `base_commit_sha` and `base_blob_sha`. Monaco models are buffers, never a second persistence layer.

Required validation before marking this phase complete: regenerate the workspace lockfile with npm, run `npm ci --ignore-scripts --no-audit --no-fund`, TypeScript/build/unit tests, and browser tests that prove repository routes do not load Monaco chunks; WebIDE mount/unmount releases resources; switching files preserves the correct model; readonly state is enforced; dirty buffers survive navigation prompts; save and stale-SHA conflict behavior remain unchanged.

### 3. Diff viewer: independent renderer

Keep unified diff parsing and row rendering independent from Shiki and Monaco. Preserve old/new line numbers, hunk boundaries, and add/remove/context states. Shiki is an optional asynchronous token-decoration layer over each hunk's source lines; it must never participate in diff parsing, alter line mapping, or inject generated HTML. Unknown languages, oversized diffs, and highlighting failures remain readable as plain text.

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
2. **Repository viewer migration**: Shiki tokenization is integrated into source and unified-diff views. Both render escaped plaintext first, share one lazy highlighter, load detected grammars on demand, and render themed tokens as React text nodes/spans. Source files and per-file diffs above 256 KiB / 10,000 lines remain plaintext. Diff parsing and old/new line mapping remain independent of syntax tokenization. Unit coverage exercises real TypeScript tokenization, source-as-text safety, line anchors, active lines, diff row markers, and fallback behavior. CI validation passed for source and diff highlighting: unit tests, production build, Chromium Playwright browser tests, and CI Gate all succeeded. Highlighter initialization failures are retryable; failed grammar loads are evicted so a transient failure does not permanently disable a language.
3. **WebIDE foundation**: establish the editor adapter contract and retain the Changeset-only save lifecycle. Next: add Monaco as a lazy-loaded route dependency behind the adapter, then add browser tests for dirty state, discard, save, conflict, deep links, and keyboard shortcuts.
4. **Navigation and diagnostics**: wire editor diagnostics and language services through adapter capabilities; add Tree-sitter-backed structural navigation only after language-service requirements and performance budgets are measured.
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
