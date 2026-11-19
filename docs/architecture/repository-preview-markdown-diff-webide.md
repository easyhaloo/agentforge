# Repository preview: Markdown and diff behavior

## Markdown safety and navigation

- Repository Markdown is rendered by a bounded React renderer; raw HTML remains escaped text and is never injected as markup.
- External destinations are limited to `https:`, `http:`, and `mailto:`. Scheme-relative URLs, executable schemes, absolute filesystem paths, malformed escapes, and paths escaping the repository root are inert.
- Relative links resolve against the directory containing the Markdown file and open through the authenticated, organization-scoped repository blob preview at the currently pinned commit.
- Relative images are currently rendered as inert textual image references. The preview API exposes UTF-8 text blobs only; binary image delivery is intentionally not inferred or routed through an unauthenticated third-party URL. A future binary/blob endpoint must preserve organization authorization, commit pinning, size limits, content-type allow-listing, and `nosniff`.

## Unified diff

- The compare endpoint already returns unified patch text; the web client parses file headers, hunk headers, additions, removals, context, and no-newline markers.
- Old/new line numbers are derived from hunk ranges. Diff content is rendered as text, never HTML.
- Binary/omitted patch sections remain metadata and do not fabricate line-level content.

## WebIDE boundary

An organization-scoped `/orgs/:org/webide` shell now reuses the repository catalog, refs, tree, and blob APIs. It supports repository/ref selection, directory navigation, commit-pinned file preview, and `path`/`line` deep links. The repository preview exposes an “Open in WebIDE” handoff that preserves repository, commit, and file path. The shell is explicitly read-only: no Monaco/CodeMirror dependency, editing buffer, save, or write-back API is present. A future editor adapter can replace the source viewer while retaining the existing authorization and commit-pinning boundary.
