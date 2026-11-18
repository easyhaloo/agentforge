# Native Git Hosting API and Data Model

Companion to native-git-hosting.md. This is the first-pass contract; implementation schemas must be added to contracts/openapi/openapi.yaml with each vertical slice.

## 1. Persistence ownership

### PostgreSQL control plane

| Entity | Key fields | Notes |
| --- | --- | --- |
| repositories | id, organization_id, name, slug, description, visibility, default_branch, storage_key, lifecycle_state, created_by, timestamps | Unique organization_id + slug; storage_key is generated server-side |
| repository_access_tokens | id, repository_id nullable, organization_id, token_hash, token_prefix, scopes, expires_at, revoked_at, last_used_at, created_by | Hash only; nullable repository_id means org-scoped |
| repository_branch_policies | id, repository_id, pattern, require_reviews, require_ci, allow_force_push, timestamps | Deterministic pattern precedence |
| repository_events_outbox | id, repository_id, event_type, payload, occurred_at, published_at, attempts, next_attempt_at | Idempotent event key; no secret material |
| repository_storage_operations | id, repository_id, operation, state, source_key, target_key, timestamps, error_code | Provision/migrate/quarantine/delete |
| repository_usage_snapshots | repository_id, measured_at, bytes, object_count, refs_count | Asynchronous measurements; never trust client sizes |

Use UUID primary keys unless existing migration conventions establish another standard. Add tenant-safe foreign keys and indexes for organization, lifecycle, slug, token hash, pending outbox and usage history.

Do not add authoritative relational copies of Git commits, trees, blobs, tags or refs. Search indexes and activity projections are rebuildable derived data.

### Bare repository data plane

Git objects include commits, trees, blobs and annotated tags. Refs include refs/heads/*, refs/tags/* and explicitly supported namespaces. HEAD is the default branch symbolic ref. Git refs are authoritative for current branch heads; PostgreSQL default_branch is product configuration and must be validated when changed.

### Object storage

Later use for Git LFS payloads and large generated artifacts. LFS pointer metadata remains in Git; payload access is tied to repository authorization. Build/evaluation artifacts remain separately scoped and Revision-bound.

## 2. Permission model

| Action | Minimum permission |
| --- | --- |
| Read metadata, browse or clone private repo | Repository read |
| Create repository | Organization Owner/Admin |
| Push to unprotected branch | Repository write |
| Change settings, tokens or branch policy | Organization Owner/Admin or explicit repository admin |
| Delete repository | Organization Owner/Admin |
| Bypass protected branch | Explicit bypass permission plus audit |

Public visibility may allow anonymous clone/read-only browsing. It never grants push. Resolve private repository visibility only after authorization to avoid existence leaks.

## 3. REST contract

All routes use /api/v1. Organization-scoped resources follow ADR-008. Repository IDs are stable opaque identifiers; slugs are presentation identifiers.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /orgs/{org}/repositories | List visible repositories |
| POST | /orgs/{org}/repositories | Provision native bare repository |
| GET | /repositories/{id} | Read metadata and permissions |
| PATCH | /repositories/{id} | Update metadata, visibility, default branch and settings |
| DELETE | /repositories/{id} | Quarantine then delete |
| GET | /repositories/{id}/refs | List supported refs |
| GET | /repositories/{id}/branches | List branches |
| GET | /repositories/{id}/tags | List tags |
| GET | /repositories/{id}/commits?ref={ref}&cursor={cursor} | History resolved to immutable IDs |
| GET | /repositories/{id}/tree?commit={sha}&path={path} | Directory entries at pinned commit |
| GET | /repositories/{id}/blob?commit={sha}&path={path} | Bounded file metadata/content |
| GET | /repositories/{id}/compare?base={sha}&head={sha} | Bounded diff |
| GET | /repositories/{id}/archive?commit={sha} | Archive for pinned commit |
| POST | /repositories/{id}/access-tokens | Create scoped HTTPS token; secret returned once |
| GET | /repositories/{id}/access-tokens | List token metadata only |
| DELETE | /repositories/{id}/access-tokens/{token_id} | Revoke token |
| GET | /repositories/{id}/branch-policies | List branch policies |
| PUT | /repositories/{id}/branch-policies/{policy_id} | Create/update policy |
| DELETE | /repositories/{id}/branch-policies/{policy_id} | Remove policy |

Smart HTTP transport routes are protocol endpoints, not JSON REST resources.

### Illustrative create request

    {
      "name": "agentforge",
      "slug": "agentforge",
      "description": "Agent-native source control",
      "visibility": "private",
      "default_branch": "main"
    }

### Illustrative repository response

    {
      "id": "repo_opaque_id",
      "organization_id": "org_opaque_id",
      "name": "agentforge",
      "slug": "agentforge",
      "visibility": "private",
      "default_branch": "main",
      "clone_urls": {
        "https": "https://git.example.test/org/agentforge.git"
      },
      "lifecycle_state": "ready",
      "created_at": "2026-11-18T00:00:00Z"
    }

### Illustrative tree entry

    {
      "commit_sha": "full-commit-object-id",
      "path": "backend/api",
      "entries": [
        {"name":"cmd","path":"backend/api/cmd","type":"tree","mode":"040000","object_id":"tree-id"},
        {"name":"go.mod","path":"backend/api/go.mod","type":"blob","mode":"100644","object_id":"blob-id","size":1234}
      ],
      "next_cursor": null
    }

### Illustrative blob response

    {
      "commit_sha": "full-commit-object-id",
      "path": "README.md",
      "object_id": "blob-id",
      "mode": "100644",
      "size": 1234,
      "content_type": "text/markdown; charset=utf-8",
      "encoding": "utf-8",
      "content": "# README"
    }

These examples are illustrative. OpenAPI must define optional fields, limits, errors and content negotiation. Large blobs should stream/download rather than be embedded as unbounded JSON.

## 4. Contract invariants

- Authorize repository before resolving refs or exposing object metadata.
- Resolve ref once; every response includes full immutable commit SHA.
- Tree/blob/diff/archive operate on full commit IDs, not moving branch names.
- Blob lookup is commit+path; arbitrary object IDs are not an authorization boundary.
- Normalize repository-relative paths and reject traversal.
- Treat object IDs as opaque; validate against the repository's configured object format.
- Bound pagination and response sizes.
- Use RFC 9457-style problem details with stable codes: repository_not_found, repository_access_denied, invalid_ref, invalid_path, object_not_found, content_too_large, repository_not_ready and git_operation_timeout.
- Token creation returns secret once; later reads expose prefix, scopes, expiry, revocation and last-used metadata.
- Retryable mutations accept idempotency keys where duplicate effects are harmful.

## 5. HTTPS token format

Use a high-entropy opaque token with a non-secret lookup prefix, e.g. afg_pat_<prefix>_<secret>. Store a one-way hash of the complete token, support revocation/expiry/scopes and record last use asynchronously. Never accept a token as a query parameter. Prefer HTTP Basic authentication with the token as password for standard Git clients. Reverse proxies must redact Authorization headers.

## 6. OpenAPI rollout

Do not add speculative endpoints before backend behavior is scheduled. Introduce schemas in vertical slices: (1) repository metadata/lifecycle, (2) refs/tree/blob/commits, (3) tokens and Smart HTTP docs, (4) compare/archive/branch policies.

Contract tests cover auth failures, tenant isolation, invalid paths/refs, response limits and immutable commit pinning.
