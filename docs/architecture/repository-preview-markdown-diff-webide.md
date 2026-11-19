# Repository preview: Markdown and diff behavior

## Markdown safety and navigation

- Repository Markdown is rendered by a bounded React renderer; raw HTML remains escaped text and is never injected as markup.
- External destinations are limited to `https:`, `http:`, and `mailto:`. Scheme-relative URLs, executable schemes, absolute filesystem paths, malformed escapes, and paths escaping the repository root are inert.
- Relative links resolve against the directory containing the Markdown file and open through the authenticated, organization-scoped repository blob preview at the currently pinned commit.
- Relative images are served through an authenticated, organization-scoped image endpoint pinned to the same immutable commit as the Markdown document. The endpoint enforces a 2 MiB limit, verifies PNG/JPEG/GIF/WebP signatures instead of trusting file extensions or Git metadata, returns `private, no-store` with `X-Content-Type-Options: nosniff`, and rejects SVG, HTML, and unknown formats. External images remain inert to avoid third-party tracking and credential leakage.

## Unified diff

- The compare endpoint already returns unified patch text; the web client parses file headers, hunk headers, additions, removals, context, and no-newline markers.
- Old/new line numbers are derived from hunk ranges. Diff content is rendered as text, never HTML.
- Binary/omitted patch sections remain metadata and do not fabricate line-level content.

## Repository source viewer

The repository file page uses an AgentForge-owned read-only source viewer with line numbers, active-line anchors, copy, and a language label. The initial implementation uses a deliberately small regex tokenizer and extension map; it is a transitional implementation, not a complete language grammar system. It must not grow into a hand-maintained language parser.

A shared language metadata registry now provides extension, basename, and shebang detection plus Shiki and Monaco language identifiers. The target renderer is Shiki tokenization with React-rendered text tokens, lazy grammar loading, plain-text first paint, and safe fallback for unknown or oversized files. See [repository code viewer and WebIDE architecture](repository-code-viewer-and-webide.md).

## WebIDE boundary

The organization-scoped `/orgs/:org/webide` shell reuses the repository catalog, refs, tree, and blob APIs. It supports repository/ref selection, directory navigation, commit-pinned file preview, and `path`/`line` deep links. The repository preview exposes an “Open in WebIDE” handoff that preserves repository, commit, and file path.

The WebIDE supports a safe text-editing lifecycle scoped to an unmerged Changeset: dirty buffer, save/discard, local diff, optimistic concurrency using commit/blob SHAs, and conflict preservation. The backend creates a new Changeset revision and never writes to the repository default branch. The current editor is a shared textarea; Monaco is the target editing surface, loaded lazily behind an AgentForge adapter. See [WebIDE safe editing lifecycle](webide-safe-editing-lifecycle.md) and [repository code viewer and WebIDE architecture](repository-code-viewer-and-webide.md).

## Component boundaries

- Repository source viewer: read-only, Shiki target.
- WebIDE: editable, Monaco target, Changeset-only writes.
- Unified diff: independent parser and renderer.
- Markdown: independent bounded renderer with repository URL/image protections.

Do not load Monaco for ordinary repository browsing. Do not inject highlighter HTML. Do not route Markdown or diff parsing through the code editor.
