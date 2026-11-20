# Repository Preview and Extensible WebIDE

## 1. Product decision

Repository Preview and WebIDE are first-class parts of AgentForge's native repository experience, built on the Source Control Core and existing Changeset lifecycle.

- **Repository Preview** is the read-only, zero-clone experience for humans and Agents to inspect a repository at an immutable commit.
- **WebIDE** is a browser-based editing client backed by an isolated, server-managed workspace.
- **Extensions** add language tooling, previews, commands and integrations through a versioned, permissioned SDK.

The browser must not become a second source of truth. Git remains canonical for repository content and refs; AgentForge's existing Changeset/Revision/Evaluation/Review/Merge lifecycle remains authoritative for delivery.

## 2. Architecture

```text
Browser
  | Repository Preview UI        | WebIDE Shell
  v                              v
Repository Experience BFF / REST API
  | resolve ref -> pinned SHA    | workspace session
  | tree/blob/README/history     | file read/write + diff
  | diff/blame/compare           | terminal/task stream
  +---------------+--------------+
                  v
          Source Control Core
       Git adapter / ACL / Derived Data
                  |
             Git storage

WebIDE Shell
  | Extension SDK / RPC
  +--> Web Extension Host (isolated Worker/iframe)
  +--> Language Server Gateway --> isolated LSP workers
  +--> Workspace Gateway -------> isolated workspace worker
  +--> Preview Gateway ---------> sandboxed preview runtime
```

Repository Preview can function without a workspace. WebIDE creates a workspace only when the user explicitly starts editing or running tools.

## 3. Repository Preview

### 3.1 Core user journeys

1. Repository landing: description, default branch, latest commit, README, language summary and recent activity.
2. Branch/tag selection: resolve a moving ref once, then pin every page request to the resulting full commit SHA.
3. File browser: paginated directory tree, breadcrumbs, file metadata and safe symlink handling.
4. File view: syntax highlighting, line numbers, copy/download, permalink, blame and file history.
5. Markdown preview: README and Markdown rendering with sanitization and safe link/image handling.
6. Commit history: commit details, changed files, parent links and author/time metadata.
7. Diff/compare: commit-to-commit, branch-to-branch and file-level diffs, including rename/binary indicators.
8. Agent context: stable URLs and APIs so an Agent can cite a precise repository, commit and path.

### 3.2 API contract

All repository reads are scoped to a repository and immutable commit identity. Moving refs are resolved only at the request boundary.

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/repos/{repo}/preview` | Repository landing metadata and default ref resolution |
| `GET /api/v1/repos/{repo}/refs` | Paginated branches and tags |
| `GET /api/v1/repos/{repo}/commits/{sha}/tree` | Directory entries at a pinned commit |
| `GET /api/v1/repos/{repo}/commits/{sha}/blob?path=...` | Authorized file metadata/content stream |
| `GET /api/v1/repos/{repo}/commits/{sha}/readme` | README selection and rendered-source metadata |
| `GET /api/v1/repos/{repo}/commits/{sha}/history?path=...` | Paged path history |
| `GET /api/v1/repos/{repo}/commits/{sha}/blame?path=...` | Line attribution |
| `GET /api/v1/repos/{repo}/compare/{base}...{head}` | Commit/branch comparison after ref pinning |
| `GET /api/v1/repos/{repo}/commits/{sha}/diff` | Commit diff and changed paths |

Exact route naming is finalized in OpenAPI before implementation. APIs must support pagination, bounded output, cancellation and conditional requests where useful. Large blobs stream with size limits; binary content is downloadable, not rendered as text.

### 3.3 Rendering and security

- Resolve branch/tag to a full commit SHA and include it in canonical browser URLs. A ref may move; a pinned SHA must not.
- Check repository and directory ACL before tree/blob/history/blame access. Object IDs alone never authorize reads.
- Treat repository files, Markdown, filenames, commit messages and extension metadata as untrusted input.
- Sanitize Markdown HTML; disable raw HTML by default or render it through a strict sanitizer.
- External images and links must not cause server-side fetches. Use browser-side safe links or a controlled proxy with SSRF protections and explicit policy.
- Never execute repository HTML, JavaScript, shell scripts, notebooks or build output in the AgentForge application origin.
- Escape path segments, reject traversal and NULs, and define symlink/submodule behavior explicitly.
- Apply file-size, line-count, diff-size, pagination and rendering budgets. Do not load entire large repositories into browser memory.
- Use CSP and safe content disposition for raw/download routes; binary previews require an allowlist.
- Cache immutable commit-scoped results. Cache keys include repository identity and visibility context; re-authorize before serving private cached data.

## 4. WebIDE

### 4.1 MVP experience

- Repository and commit picker with an explicit “Open in WebIDE” action.
- Explorer, editor tabs, split panes, search, command palette and diagnostics panel.
- Monaco editor as the initial editor surface; language intelligence is provided through Language Server Protocol (LSP) adapters rather than hard-coding every language into the frontend.
- Read-only mode for historical commits; editable mode always attaches to a workspace based on a pinned base commit.
- Git status/diff view and explicit save, discard and Changeset creation actions.
- Terminal, build, test and preview are separate isolated worker capabilities and are not executed in the browser or API process.
- Browser reconnect restores the workspace session from durable server state; unsaved client buffers are clearly distinguished from persisted workspace files.

### 4.2 Workspace lifecycle

1. User selects a repository and base ref/commit.
2. Backend resolves the ref to a full commit SHA and authorizes workspace creation.
3. Workspace service creates an isolated workspace from that exact commit.
4. Browser receives a short-lived workspace session capability, not a Git storage credential.
5. File operations pass through workspace APIs; autosave is explicit/configurable and versioned.
6. Diff compares workspace state to the pinned base commit.
7. User creates or updates a Changeset through the existing Changeset API, preserving Revision and Evidence provenance.
8. Merge/promotion remains governed by existing review, policy and expected-target-SHA checks.
9. Workspace expires or is retained according to policy; cleanup is durable and auditable.

A Git worktree is a workspace implementation detail, not a security boundary. Untrusted build/test/Agent code runs in isolated workers with CPU, memory, disk, network and time limits. Workspace credentials are scoped and revoked on expiry.

### 4.3 Workspace API

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/repos/{repo}/workspaces` | Create workspace from pinned base commit |
| `GET /api/v1/workspaces/{id}` | Workspace metadata and state |
| `GET/PUT /api/v1/workspaces/{id}/files` | Read/write workspace files with path and version checks |
| `GET /api/v1/workspaces/{id}/diff` | Diff against pinned base |
| `POST /api/v1/workspaces/{id}/tasks` | Start isolated build/test/task |
| `GET /api/v1/workspaces/{id}/events` | SSE lifecycle and task notifications |
| `POST /api/v1/workspaces/{id}/changesets` | Create/update Changeset from workspace state |
| `DELETE /api/v1/workspaces/{id}` | Explicit cleanup |

Workspace writes use optimistic version/ETag checks to prevent silent lost updates. All operations enforce tenant, repository, path and workspace authorization.

## 5. Extension platform

### 5.1 Extension types

1. **UI extensions:** panels, views, tabs, status-bar items, context menus and command-palette commands.
2. **Language extensions:** syntax grammars, snippets, diagnostics, completion, hover, go-to-definition and formatting via LSP or a restricted language adapter.
3. **Repository extensions:** custom file renderers, diff annotations, metadata panels and repository actions.
4. **Preview extensions:** framework-aware preview launchers, port discovery and preview decorations.
5. **Workflow extensions:** commands that invoke authorized AgentForge APIs, CI workflows or workspace tasks.
6. **Agent tools:** typed, auditable tools exposed to Agents under the same permission model.

### 5.2 Manifest and SDK

Each extension declares:
- stable extension ID, version, publisher and compatibility range;
- entry point and contribution points;
- required capabilities/scopes;
- commands, views, languages, file associations and activation events;
- settings schema and localization metadata;
- integrity hash/signature and provenance.

The SDK exposes versioned APIs for commands, workspace files, repository metadata, diagnostics, UI contributions, tasks, previews and notifications. It does not expose raw database access, arbitrary Git storage paths, host credentials or unrestricted backend network access.

### 5.3 Isolation and permissions

- Web extensions run in a Worker or sandboxed iframe with a message-based RPC bridge; no direct access to the application DOM or cookies.
- Server-side extension tasks run in isolated workers/containers with explicit resource/network limits.
- Capabilities are deny-by-default, granted per extension and organization, and checked on every RPC.
- High-risk scopes (network access, secrets, terminal/task execution, repository writes) require explicit administrator/user consent and audit events.
- Extensions receive short-lived scoped tokens; never pass session cookies, Git credentials or long-lived secrets.
- Validate manifests and package integrity; maintain an allowlist/approval policy and revocation mechanism.
- Version the SDK and provide compatibility checks, quotas, telemetry, failure isolation and kill switches.
- An extension cannot bypass repository ACL, workspace ACL, branch protection, Changeset review or CI gates.

### 5.4 Marketplace and compatibility

Start with first-party extensions and organization-private extensions. Add a curated registry only after the SDK, permission model, signing, review and lifecycle are stable. Do not promise VS Code Marketplace compatibility. Open VSX or broader VS Code extension compatibility is a later compatibility project with a documented supported subset.

## 6. Preview runtime and ports

A WebIDE preview is untrusted application output. It must run in a separate origin or isolated runtime with:
- per-workspace ephemeral routing and short-lived access tokens;
- strict CSP, iframe sandbox and origin isolation;
- network egress restrictions and no ambient access to AgentForge cookies;
- port allowlists and explicit preview exposure;
- bounded CPU, memory, disk and lifetime;
- explicit stop/expiry and audit.

Do not proxy arbitrary localhost ports from a shared trusted origin. Do not treat a preview URL as public unless the user explicitly publishes it.

## 7. Data model concepts

- `RepositorySnapshot`: repository ID, resolved commit SHA, ref-at-resolution, metadata version.
- `Workspace`: repository ID, base commit SHA, owner/tenant, status, resource class, expiry and worker identity.
- `WorkspaceFileVersion`: workspace ID, normalized path, content hash/version and update metadata.
- `Extension`: publisher, extension ID, version, manifest, package digest, signature and review status.
- `ExtensionGrant`: extension/version, organization, granted capabilities, actor and expiry.
- `PreviewSession`: workspace ID, runtime, port mapping, isolated origin, access policy and expiry.
- `WorkspaceTask`: workspace ID, task definition, worker lease, logs/artifacts and result.

These are conceptual boundaries; migrations should be introduced only with the corresponding implemented vertical slice.

## 8. Delivery plan and acceptance criteria

### Phase R1 — Repository Preview foundation
- Server-side tree/blob/README/history/commit/diff APIs over the existing Git adapter.
- Pinned SHA routes, pagination, content streaming and authorization.
- Repository landing, tree browser, README and source viewer.
- Tests for private-repository isolation, path traversal, binary/large files, unsafe Markdown and moving-ref races.

### Phase R2 — Rich repository inspection
- Blame, path history, compare views, line anchors and stable permalinks.
- Derived Data for hot history/blame queries.
- Browser E2E coverage and bounded performance tests.

### Phase I1 — WebIDE editor shell
- Workspace create/read/write/diff lifecycle.
- Monaco editor, explorer, tabs, search and Changeset handoff.
- Read-only historical mode and optimistic file writes.
- Tests for workspace isolation, reconnect, expiry and stale writes.

### Phase I2 — Execution and live preview
- Isolated terminal/build/test tasks, logs and SSE notifications.
- Preview gateway with isolated origin, CSP and egress policy.
- Tests proving preview cannot access application cookies or another workspace.

### Phase X1 — Extension SDK
- Versioned manifest, command registry, contribution points and Web Extension Host.
- First-party sample extension and organization-private installation.
- Capability grants, audit, package integrity, quotas and revocation tests.

### Phase X2 — Ecosystem
- Curated extension registry, publishing/review workflow, compatibility tooling and optional Open VSX subset.
- Only proceed after extension isolation and permission audits pass.

## 9. Explicit non-goals for the first release

- Full VS Code Marketplace compatibility.
- Running untrusted code in the browser origin, Go API process or shared worker.
- Public preview URLs by default.
- An extension that can access arbitrary host APIs or repository storage.
- A separate IDE-specific source-control lifecycle that bypasses Changesets.
- Full remote desktop/container IDE before the workspace API and isolation model are proven.

## 10. Operational metrics

Track repository page latency, tree/blob request volume, large-file rejection, cache hit ratio by visibility, workspace startup latency, active workspace count, reconnect rate, task queue time, preview startup/egress, extension activation time, RPC failures, resource usage, permission denials and extension crash/revocation rates.
