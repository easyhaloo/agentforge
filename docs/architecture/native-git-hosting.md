# Native Git Hosting Architecture

## Status and product boundary

Status: Proposed target architecture. This document does not claim that Smart HTTP, SSH, LFS or the browser explorer are already implemented.

AgentForge is an independent Git hosting platform, in the same product category as GitHub and GitLab. AgentForge owns repository creation, Git object storage, refs, authentication, authorization, Git transport, browsing and repository policy. GitHub and GitLab are not upstream data sources, runtime dependencies or provider integrations for this capability.

A repository is a first-class AgentForge resource. The platform interoperates with standard Git clients but does not delegate repository authority to another hosting service. Do not introduce a GitHub/GitLab Provider abstraction. Internal storage and transport interfaces may isolate implementation details, but their semantics remain AgentForge-owned.

## 1. Vocabulary and ownership

- Repository record: PostgreSQL metadata, tenant ownership, visibility, settings and storage locator.
- Bare repository: native Git repository without a working tree; authoritative storage for Git objects and refs.
- Git Hosting Engine: AgentForge-owned capability for repository lifecycle, storage, Git commands, transport, hooks and policy.
- Git transport: Smart HTTP initially; SSH is a later transport.
- Commit: immutable Git object identified by its full object ID.
- Changeset / Revision: AgentForge delivery-domain concepts. A Revision is bound to an immutable commit SHA, never a mutable branch name.

PostgreSQL owns tenant metadata, identity, permissions, policy and durable events. Git owns objects and refs. Do not mirror commit/tree/blob contents into relational tables.

## 2. High-level architecture

    Git CLI / Browser
       | HTTPS Git Smart HTTP       | HTTPS REST
       v                            v
    Go Git HTTP Gateway         Repository API
       | identity + ACL             | metadata + policy
       | bounded transport         v
       |                       PostgreSQL
       v
    Git Hosting Engine
       | lifecycle / refs / object reads / hooks
       v
    Bare Git repositories (initially durable local volume)
       |
       +--> durable outbox --> indexing, activity, CI, Changeset and Trail events
       |
       +--> object storage (later: Git LFS and large artifacts)

The Go modular monolith is the control plane. Git is the data plane. Local durable storage is the MVP deployment choice, not a claim of horizontal scalability.

## 3. Storage

### Initial implementation

Use one bare repository per AgentForge repository, stored under a server-controlled durable filesystem root.

- Initialize with git init --bare using a fixed executable and argument list.
- Store only a generated storage key in PostgreSQL; never derive a filesystem path from an organization or repository slug.
- Keep storage outside the web root with restrictive filesystem ownership and permissions.
- Do not allow users to upload hooks or repository config.
- PostgreSQL stores repository ID, organization, slug, visibility, default branch, storage key, lifecycle state, limits and timestamps.
- Git stores objects, refs, packfiles and Git metadata.
- Git LFS payloads and build/evaluation artifacts belong in object storage, not PostgreSQL or the API container filesystem.

Before multiple API/worker nodes share repositories, define and test shared-storage or repository-sharding topology. Do not place bare repositories on an arbitrary object-store mount.

### Storage boundary

The git module owns a narrow internal storage port: create, open, quarantine/delete, health/size inspection and stable storage identity. A filesystem implementation comes first. This is an internal implementation boundary, not an external Git provider abstraction.

Storage migration is an explicit operation: freeze writes, copy and verify objects/refs, compare integrity and object counts, atomically switch the locator, then resume writes. Retain old storage through the rollback window.

## 4. Git Hosting Engine modules

Introduce modules only when implementing their first real use case.

| Capability | Responsibility |
| --- | --- |
| repository | Tenant-owned metadata, lifecycle, visibility, default branch and settings |
| git | Bare repository lifecycle, safe Git command boundary, object/ref reads and ref mutation |
| gittransport | Smart HTTP negotiation, auth handoff and bounded process execution |
| authorization | Organization/repository permission decisions |
| gitpolicy | Branch protection, receive rules and quotas |
| git-events | Durable post-receive outbox, idempotent consumers and reconciliation |
| changeset/revision | Existing delivery lifecycle; bind each Revision to a full immutable commit SHA |

The repository module must not own a provider_connection to GitHub/GitLab. Its Git authority is AgentForge's Git Hosting Engine.

## 5. Git Smart HTTP

Support standard Git Smart HTTP endpoints:
- GET /{org}/{repo}.git/info/refs?service=git-upload-pack
- POST /{org}/{repo}.git/git-upload-pack
- GET /{org}/{repo}.git/info/refs?service=git-receive-pack
- POST /{org}/{repo}.git/git-receive-pack

The first release supports clone/fetch/pull via upload-pack and push via receive-pack over HTTPS. Enable protocol v2 only after compatibility tests cover supported Git clients.

Prefer the maintained Git git-http-backend implementation as the MVP protocol engine rather than implementing pkt-line, negotiation, packfile parsing or pack generation in Go. Go owns routing, identity, repository lookup, ACL, policy, rate limits, process supervision, audit and event handling. Implement and test the CGI boundary explicitly; do not assume a normal HTTP handler can invoke CGI safely without a dedicated adapter.

The adapter must:
- Map a validated route to a server-generated bare-repository path.
- Set a minimal allowlisted CGI environment.
- Invoke a fixed executable with argument arrays; never a shell command string.
- Set GIT_CONFIG_NOSYSTEM=1, controlled HOME and controlled Git config search paths.
- Deny unsafe protocol helpers and unapproved upload/receive services.
- Apply request, response, CPU, memory, process and wall-clock limits.
- Cap request body and pack size according to repository quotas.
- Stream bodies with cancellation and bounded buffers.
- Terminate child processes on disconnect, timeout or shutdown.
- Redact credentials and sensitive environment values from logs.

If CGI proves unsuitable, a Go-native transport may replace it only after protocol compatibility and security tests demonstrate parity. Never build a partial home-grown packfile implementation.

## 6. Authentication, authorization and push policy

Authentication and authorization are separate checks.

- Browser/API sessions use the existing identity/session boundary.
- Git HTTPS uses revocable scoped personal access tokens or deploy tokens; persist only token hashes, show a secret once, support expiry and last-used metadata.
- Never put long-lived secrets in clone URLs, logs, process arguments or refs.
- Anonymous clone is a repository visibility policy, not a global bypass.
- Every transport request resolves the repository and active organization context before starting Git.
- upload-pack requires read permission; receive-pack requires write permission.
- Private repository existence must not leak through distinguishable unauthorized responses.
- Protected branch bypass requires explicit permission and an audit record.

Push pipeline:
1. Resolve repository, authenticate principal/token and authorize write access.
2. Check repository lifecycle, quotas and concurrency.
3. Run receive-pack under process/resource limits.
4. Run pre-receive policy against proposed old/new refs: branch protection, allowed namespaces, object/size limits and commit policy.
5. Accept/reject ref updates atomically using Git receive-pack semantics.
6. On success, persist a durable post-receive outbox event with repository ID, actor, ref updates and resulting commit IDs.
7. Asynchronously derive activity, indexes, CI triggers, Changeset/Revision links and Trail events.
8. Reconcile refs against outbox/event state after crashes.

Pre-receive checks cannot depend on later asynchronous work. Post-receive side effects must be idempotent and recoverable. Do not attempt a distributed transaction across PostgreSQL and Git refs; Git refs are authoritative for accepted Git state and the outbox/reconciliation repairs downstream projections.

## 7. Safe Git command boundary

All Git operations go through one internal command runner.

- Fixed Git binary path and explicit argument arrays; no shell interpolation.
- Resolve repository paths from trusted storage keys, never user paths.
- Validate refs with Git ref-format rules and paths as repository-relative POSIX paths; reject NUL, absolute paths, traversal and ambiguous encodings.
- Resolve branch/tag names to full commit IDs before multi-step reads.
- Use controlled environment; disable system/global config, external diff, pager, hooks and credential helpers for read operations.
- Apply deadlines, process-group cancellation, output limits and concurrency limits.
- Never execute repository code in API handlers. Evaluation/build execution belongs in isolated workers.
- Do not permit user-controlled Git config, alternates, hooks, filters, smudge/clean commands or submodule URLs to execute on the server.
- Treat symlinks and gitlinks/submodules as metadata; do not follow them during preview.

Commands such as for-each-ref, rev-parse, ls-tree, cat-file, log, diff-tree and archive are invoked only through this boundary with bounded output.

## 8. Repository browsing and preview

The browser explorer reads AgentForge's own bare repository; it is not a GitHub API proxy.

1. Authorize organization membership and repository read policy.
2. Resolve branch/tag/ref once to a full commit SHA.
3. List a directory with ls-tree at that commit.
4. Resolve repository-relative path in that commit to a tree/blob entry.
5. Read the blob by its resolved object ID with a strict byte limit.
6. Return commit SHA, path, object ID, size, mode and content metadata.

Do not expose an arbitrary-SHA blob endpoint without proving repository access and reachability from the requested commit. Blob IDs are internal cache keys only after authorization; private content caches must be scoped by repository and authorization policy.

Use CodeMirror 6 read-only for source. Render Markdown with sanitization and safe URL policy; images with content-type and size limits; JSON with depth/size limits; CSV with virtualized rows; PDF through a bounded viewer; binary/unknown files as metadata plus download. Never render untrusted HTML/SVG inline without sanitization or sandboxing.

## 9. API and frontend routes

Preserve ADR-008 organization-scoped routes:
- /orgs/:org/repositories/:repo
- /orgs/:org/repositories/:repo/tree/:ref/*path
- /orgs/:org/repositories/:repo/commits/:sha
- /orgs/:org/repositories/:repo/compare/:base...:head

REST stays under /api/v1 and uses repository IDs as stable authorization keys:
- GET /repositories/{id}/refs
- GET /repositories/{id}/branches
- GET /repositories/{id}/tags
- GET /repositories/{id}/commits?ref={ref}&cursor={cursor}
- GET /repositories/{id}/tree?commit={sha}&path={path}
- GET /repositories/{id}/blob?commit={sha}&path={path}
- GET /repositories/{id}/compare?base={sha}&head={sha}
- GET /repositories/{id}/archive?commit={sha}

The blob endpoint is commit+path based; the server resolves the object ID after authorization. Never accept an untrusted filesystem path or use a moving branch name as final content identity. Enforce pagination and response/diff limits. Full request/response shapes are in native-git-api-and-data-model.md.

## 10. Changeset integration

- repository owns tenant metadata and access policy.
- git owns Git refs and object access.
- revision stores full immutable commit SHA and optional parent/base SHA.
- evaluation, evidence, review and merge bind to one exact Revision.
- Merge rechecks current target ref and policy gates immediately before updating the ref.
- Successful merge records resulting commit SHA and emits an idempotent Trail event.

Do not make Changeset or Revision depend on GitHub/GitLab pull-request objects. Changeset is AgentForge's native review abstraction.

## 11. Operations and security

- Repository lifecycle states: provisioning, ready, deleting, quarantined, failed.
- Provisioning/deletion are idempotent workflows with compensation for partial failure.
- Deletion revokes access and quarantines storage before physical deletion under retention policy.
- Backups cover PostgreSQL and Git storage with a tested consistent recovery procedure.
- Monitor repository count/size, object count, pack size, command latency, transport errors, timeouts, rejected pushes, outbox lag and integrity failures.
- Run scheduled git fsck/integrity checks.
- Define quotas for repository size, push pack, request size, concurrent Git processes and archive/blob downloads.
- Treat names, paths, commit messages, refs and Git output as untrusted display data.
- Audit lifecycle, token, permission, force-push, bypass and rejected-policy events.

## 12. Acceptance

A real Git client interoperability suite must create a repository, clone, fetch and push; reject unauthorized and protected updates; browse a pinned commit; and verify post-receive recovery after injected failures.
