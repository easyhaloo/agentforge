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

The current repository preview remains read-only. No dedicated WebIDE route or editor dependency is assumed by this change. File navigation is kept behind a callback boundary so a future editor shell can reuse the repository, commit, path, and line context without changing Markdown URL resolution. Editing, save, and write-back are not claimed as supported.
