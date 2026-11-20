# WebIDE safe editing lifecycle

## Status

Proposed implementation contract for the next WebIDE delivery. The current WebIDE remains read-only until the complete write path and its tests are merged. This document does not claim that editing or saving is already available.

## Goals

- Keep repository browsing pinned to immutable Git commits.
- Allow text-file edits without granting the browser direct access to a Git remote or repository filesystem.
- Save only to a changeset-owned branch; never write the registered default branch from the editor.
- Detect stale editor buffers before creating a commit.
- Preserve the existing changeset revision, evaluation, evidence, review, audit, and merge lifecycle.
- Support both local and remote Git providers through one explicit capability contract.

## Non-goals

- Browser-side Git credentials, arbitrary Git commands, shell access, or arbitrary remote URLs.
- Editing binary files, symlinks, submodules, or files outside the repository.
- Force-pushing a default branch or bypassing the existing CI/evaluation/review/promotion gates.
- Treating a client-supplied branch name, commit SHA, or blob SHA as authorization.

## Proposed write contract

The API resolves the changeset and repository from the authenticated organization scope. The server derives the write branch from the changeset ID (for example, `agentforge/changesets/<changeset-id>`); clients cannot choose it.

A write request carries:

- `path`: normalized repository-relative path.
- `base_commit_sha`: immutable commit the editor loaded.
- `base_blob_sha`: blob SHA of the file the editor loaded; empty only for an explicitly supported new-file operation.
- `content`: UTF-8 text, bounded to 1 MiB.

The server must verify all of the following before writing:

1. The authenticated principal has active organization membership and write permission for the changeset.
2. The changeset belongs to the authenticated organization and is not merged.
3. The changeset's current revision commit equals `base_commit_sha`; the server must not trust the client value alone.
4. The path is non-empty, relative, normalized, at most 1024 bytes, and contains no empty, dot, dot-dot, NUL, or backslash segments.
5. The path resolves to a regular Git blob at the base commit. Symlinks and submodules are rejected.
6. The current blob SHA equals `base_blob_sha`. A mismatch returns HTTP 409 with a stable conflict problem type.
7. The content is valid UTF-8 and within the server-side byte limit.

The Git write capability must atomically compare-and-swap the changeset branch head against the expected commit. For a first save, the expected branch state is absent and the new commit's parent is the current changeset revision. For later saves, the expected branch head is the current changeset revision commit. A failed lease must never be retried as an unconditional force push.

On success, the server records the resulting commit as a new changeset revision using the existing changeset lock and repository version check. The revision's ref is the server-derived changeset branch. Existing domain behavior then invalidates stale evidence and reviews.

## Git provider capability

Add an optional, explicit repository-write capability rather than expanding the read-only preview interface. The capability should accept organization, repository, server-derived branch, expected parent commit, path, expected blob SHA, and UTF-8 content, and return the new commit SHA plus blob SHA.

Both providers must implement equivalent semantics:

- Local provider: use isolated Git plumbing and an expected-old-value ref update; do not depend on the worktree's checked-out branch or shared index.
- Remote provider: fetch the exact parent and changeset ref, construct a commit in an isolated temporary repository, and push with an explicit `--force-with-lease=<ref>:<expected>` (empty expected value for first creation). Never send a push to the registered default branch.

If a provider cannot guarantee the compare-and-swap contract, it must report the capability as unavailable; the API must fail closed.

## API shape

Proposed endpoint:

`PUT /api/v1/organizations/{organizationID}/changesets/{id}/files`

Request:

```json
{
  "path": "src/example.go",
  "base_commit_sha": "<loaded commit>",
  "base_blob_sha": "<loaded blob>",
  "content": "package example\n"
}
```

Success returns the updated stored changeset plus the saved path, resulting commit SHA, and resulting blob SHA. A stale base commit, stale blob, or failed ref lease returns HTTP 409. Invalid paths/content return HTTP 400 or 413. Unsupported provider capability returns HTTP 503.

A separate read endpoint is not required: the existing commit-pinned blob preview remains the source of editor content and blob identity.

## WebIDE behavior

- The initial editing increment uses the shared bounded multiline text control for UTF-8 buffers; it is not yet a syntax-aware IDE editor. A maintained CodeMirror 6 integration remains a required follow-up before claiming language-aware editing, autocomplete, or diagnostics.
- Keep per-file buffers keyed by repository, changeset, base commit, and path.
- Track clean/dirty state and provide explicit Save and Discard actions.
- Show a local line diff against the loaded content before save.
- Disable save while the request is in flight; do not silently overwrite a newer buffer.
- On HTTP 409, retain the user's buffer, fetch the latest revision/blob, show the conflict, and require an explicit reload or reapply action.
- After save, replace the base content and commit/blob identities with the server response and clear dirty state.
- Warn before changing repository, changeset, or file while dirty.

## Test requirements

- Domain/API: organization isolation, membership/role checks, merged changeset rejection, changeset locking, version conflicts, UTF-8 and byte limits, invalid path segments, symlink/submodule rejection, and stable 409 conflict responses.
- Git provider: first branch creation, subsequent update, wrong parent rejection, wrong blob rejection, concurrent writer lease failure, and proof that the default branch ref is unchanged.
- Remote provider: exact ref fetch, lease-protected push, cleanup on all paths, and no credential leakage in errors/logs.
- Web: dirty-state transitions, discard, save success, stale commit conflict, stale blob conflict, save-in-flight behavior, and dirty navigation guard.
- E2E: edit a text file on a changeset branch, verify the new revision is visible, and verify the default branch remains unchanged.

## Delivery gate

The implementation is complete only when both local and remote provider contracts are tested, WebIDE save and conflict flows are covered, and the repository CI workflow passes. Production deployment is out of scope; CI only.
