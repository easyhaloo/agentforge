# CI/CD Workflow Platform Architecture

## Status and scope

- Status: Proposed architecture for implementation.
- Product: AgentForge CI/CD and integration workflow platform.
- Repository architecture: monorepo + Go modular monolith.
- This document defines the target design; it does not claim these capabilities are implemented.
- The platform's own repository CI remains GitHub Actions. Product-managed pipelines are a separate system.

## 1. Goals

1. Provide cloud-build-platform-style custom workflows with a visual editor and a versioned declarative definition.
2. Support typed runtime parameters, secrets by reference, triggers, approvals, conditions, retries and timeouts.
3. Detect Git merge conflicts for one or many source branches against a target branch.
4. Build the exact combined result of ordered multi-branch integration, not merely build each branch independently.
5. Safely promote a verified integration result to the target branch, with optimistic concurrency and policy checks.
6. Reuse AgentForge's repository, Changeset, Revision, Evaluation, Review, Merge Gate and Trail domain capabilities rather than creating competing lifecycle concepts.
7. Keep execution durable and isolated; never run untrusted repository code in an HTTP handler.

## 2. Non-goals for the initial release

- Replacing GitHub Actions for AgentForge's own repository CI.
- Building a new Git hosting service.
- Kubernetes, Kafka, Redis or Temporal as mandatory initial infrastructure.
- Arbitrary cross-organization workflow sharing.
- AI conflict resolution that silently bypasses review or quality gates.
- Treating successful Git merge simulation as proof that the integrated application works.
- Executing untrusted shell commands in the API process or privileged worker host.

## 3. Product concepts and boundaries

| Concept | Responsibility |
| --- | --- |
| Pipeline | Stable identity and configuration owner for a reusable workflow |
| Pipeline Version | Immutable, validated workflow definition |
| Pipeline Run | One execution of one immutable version with an input snapshot |
| Stage / Job / Step | Workflow execution hierarchy |
| Execution Task | Durable schedulable unit claimed by a worker |
| Integration Run | Immutable snapshot and outcome for combining source refs |
| Integration Candidate | Temporary Git result built from an exact ordered set of commits |
| Conflict Report | Structured result of a merge simulation |
| Merge Queue Entry | Ordered request to promote an eligible candidate |
| Artifact | Immutable report, package, test output or log object |
| Approval | Actor decision bound to a specific run/candidate revision |

The workflow engine orchestrates domain operations. It must call the owning module's application interface for repository access, evaluation, review and merge. It must not write another module's tables or reimplement Changeset invariants.

## 4. System context

```text
React CI/CD workspace
  | REST + SSE
  v
Go API (modular monolith)
  | pipeline definitions / run commands
  | PostgreSQL (system of record + durable queue)
  | object storage (large logs and artifacts)
  v
Scheduler / isolated worker processes
  | Git integration worker
  | container build/test worker
  | approval / notification worker
  v
Git provider adapter + isolated workspaces
```

The API owns authorization, workflow validation, run creation, state transitions and scheduling. Workers claim durable tasks, execute bounded work and report results through authenticated internal interfaces. PostgreSQL is authoritative; SSE is notification only.

## 5. Backend module boundaries

Introduce modules incrementally when implementing real use cases:

- `pipeline`: pipeline identity, drafts, immutable versions, schemas, parameters and triggers.
- `execution`: runs, stages/jobs/steps, task scheduling, leases, retries, cancellation and event history.
- `integration`: source snapshots, ordered merge simulation, temporary candidates, conflict reports and merge queue orchestration.
- `scm`: provider-neutral ports and Git operations. Reuse the existing repository Git provider/local adapter; extend it rather than creating a parallel Git abstraction.
- `artifact`: content-addressed metadata and object-storage references for logs, reports and packages.

Existing `repository`, `changeset`, `revision`, `evaluation`, `review`, `merge` and `trail` modules remain owners of their current domain invariants. Avoid empty packages and generic abstractions without an implemented use case.

Dependency rules:
- Transport -> application -> domain/ports.
- Infrastructure implements ports and is wired at composition root.
- Domain does not import HTTP, SQL drivers, Git CLI or cloud SDKs.
- Cross-module writes go through owning application interfaces or explicit events.
- A workflow step may invoke an allowlisted capability; it cannot mutate business tables directly.

## 6. Workflow definition

Use a versioned JSON document as the canonical persisted representation. Validate it server-side with a published JSON Schema and semantic validation. The UI edits the same model. YAML import/export is a later compatibility surface, not a second source of truth.

Conceptual shape:

```yaml
apiVersion: agentforge.dev/v1
kind: Pipeline
metadata:
  name: multi-branch-integration
spec:
  parameters:
    - name: targetBranch
      type: branch
      required: true
      default: main
    - name: sourceBranches
      type: branches
      required: true
    - name: autoMerge
      type: boolean
      default: false
  stages:
    - name: validate
      jobs:
        - name: conflict-check
          steps:
            - uses: git/conflict-check
    - name: integration
      dependsOn: [validate]
      jobs:
        - name: merge-and-test
          steps:
            - uses: git/create-integration-candidate
            - uses: build/container
            - uses: test/command
    - name: promote
      dependsOn: [integration]
      when: parameters.autoMerge
      jobs:
        - name: promote-candidate
          steps:
            - uses: git/promote-candidate
```

The example is illustrative. The implementation schema must define strict allowed fields, capability versions, expression grammar, limits and compatibility rules.

Workflow hierarchy:
- Workflow: immutable published version and run policy.
- Stage: dependency/condition boundary; stages are sequential by default.
- Job: schedulable unit; independent jobs may run in parallel subject to concurrency limits.
- Step: ordered operation within one job.

Required definition features:
- Stable IDs for stages, jobs and steps.
- Explicit dependencies and cycle detection.
- Conditions using a constrained expression language (no arbitrary eval).
- Per-job timeout, retry policy and concurrency group.
- Fail-fast and continue-on-error semantics with explicit defaults.
- Manual approval as a first-class step.
- Capability/runner requirements.
- Workflow and capability schema versioning.

## 7. Parameters and secrets

Supported initial types: string, boolean, integer/number, choice, branch, branches, repository and secret reference. Add structured objects only when a concrete use case exists.

Every parameter definition includes name, type, description, required, default, validation constraints and whether runtime override is allowed. Validate values at run creation and persist a redacted immutable snapshot.

Secrets:
- Store secret material in a dedicated encrypted secret facility or external secret manager; pipeline definitions contain references only.
- Never return secret material from APIs or persist it in run parameter snapshots.
- Inject only into authorized steps, scoped to the minimum lifetime and permissions.
- Redact known secret values from stdout/stderr and structured logs.
- Never expose secrets to untrusted fork/PR workflows by default.
- Audit secret reference access without recording secret values.

## 8. Triggers

Initial trigger types: manual/API and repository webhook (push and pull-request events). Scheduled, tag, Changeset lifecycle and upstream-pipeline triggers can follow.

Trigger filters include repository, branch include/exclude patterns, event type and optional path filters. Webhook handling must verify signatures, deduplicate delivery IDs and enqueue work transactionally. Trigger execution must pin event commit SHAs; branch names are mutable references.

## 9. Durable execution model

Persist Workflow Run -> Stage Run -> Job Run -> Step Run and Execution Task records. Use PostgreSQL transactional claiming with leases/heartbeats and bounded concurrency for the initial scheduler.

Required semantics:
- At-least-once task delivery with idempotent task/step handling; do not promise exactly-once execution.
- Lease expiry and safe reclaim after worker loss.
- Cancellation propagated to process/container and recorded durably.
- Retry policy distinguishes retryable infrastructure failures from deterministic command failures.
- Per-run, per-job and per-step timeout.
- Resource limits for CPU, memory, disk, process count and wall-clock time.
- Per-task isolated workspace and disposable container.
- Worker identity, capability registration and version reporting.
- Logs streamed in chunks or uploaded to object storage; database stores indexed metadata and offsets.
- Events are append-oriented; current state is a materialized authoritative record.

A worker must not receive broad host Docker socket access from untrusted jobs. Use a constrained execution service/runner boundary. Network egress should be denied by default or policy-controlled; credentials should be short-lived and scoped.

## 10. Git integration and conflict detection

### 10.1 Snapshot first

At integration-run creation:
1. Authorize repository and target branch access.
2. Resolve target and every source branch to immutable full commit SHAs.
3. Persist ordered branch list, SHA, provider, repository identity and requested strategy.
4. Record the base/target SHA and fetch time.
5. Use only these pinned commits during candidate construction.

A branch name alone is never a reproducible build input.

### 10.2 Conflict modes

- Single source: test target + source.
- Ordered train: target + source A, then prior candidate + source B, continuing in explicit order.
- Combination matrix: optional pairwise or user-selected combinations for diagnostics; do not imply that pairwise success proves the full ordered train can merge.
- Candidate build: construct the exact final tree/commit and run configured build/tests against it.

Prefer Git's merge-tree plumbing when available for non-mutating merge simulation, but treat output parsing as version-sensitive and test supported Git versions. For exact integration and promotion, use isolated temporary repositories/worktrees and normal Git merge semantics. Handle rename/delete, binary, submodule and directory/file conflicts. Persist conflict paths and structured diagnostics; never modify user source branches during checking.

A successful merge simulation only establishes Git-level mergeability. It does not establish application compatibility; build and test the combined candidate.

### 10.3 Candidate and branch safety

Create a namespaced temporary ref such as `refs/agentforge/integration/<run-id>` (provider capabilities permitting) or keep the candidate in isolated local storage. Record candidate tree/commit SHA and cleanup expiry. Never force-push or rewrite source branches.

Merge strategies for initial release:
- Merge commit / no-fast-forward (preferred).
- Fast-forward only when explicitly requested and valid.

Squash and rebase can follow after their provenance and Changeset semantics are specified.

### 10.4 Safe promotion

Promotion must be a separate, gated operation:
1. Verify candidate succeeded and required evidence is current.
2. Re-check authorization, branch protection, review and merge policy.
3. Compare target branch current SHA with the exact base SHA used to create candidate.
4. If target moved, mark candidate stale and rebuild/revalidate against the new base.
5. Promote using provider compare-and-swap / expected-SHA update semantics where available; never force update.
6. If provider cannot guarantee atomic expected-SHA update, serialize promotion per target branch and re-read immediately before update, documenting the residual race.
7. Persist resulting commit SHA and audit event.

Do not call a GitHub status check or an external CI status alone sufficient for AgentForge's own domain merge gate; bind evidence to the exact candidate commit and applicable Changeset/Revision.

## 11. Merge queue

Queue is scoped by repository + target branch. Initial policy is FIFO with optional priority only after starvation controls are defined. Only one promotion may mutate a target branch at a time.

A train candidate is based on target + preceding eligible entries + current entry in queue order. Each entry stores pinned source SHA, candidate SHA, policy snapshot and result. When an earlier entry changes, fails or is removed, all dependent later candidates become stale and must be rebuilt. A successful entry is promoted, then the next candidate is rebuilt or validated against the new target SHA. Do not reuse stale results.

## 12. Persistence model

Initial logical tables (exact schema to be determined with existing migration conventions):

| Table | Purpose |
| --- | --- |
| pipelines | Stable pipeline identity, owner and status |
| pipeline_versions | Immutable canonical definition, schema version and checksum |
| pipeline_triggers | Trigger configuration and secret-safe metadata |
| pipeline_runs | Run identity, version, status and timestamps |
| pipeline_run_parameters | Redacted parameter snapshot |
| pipeline_stage_runs | Stage state and dependency snapshot |
| pipeline_job_runs | Job state, worker/runner and attempt |
| pipeline_step_runs | Step state, inputs/outputs references and attempt |
| execution_tasks | Durable queue, lease, retry and heartbeat |
| execution_events | Append-oriented lifecycle/progress events |
| integration_runs | Repository, target, pinned refs, strategy and status |
| integration_sources | Ordered source branch + immutable SHA |
| conflict_reports | Structured conflict result and affected paths |
| merge_queue_entries | Queue position, candidate and promotion state |
| artifacts | Content digest, media type, storage key and provenance |
| approval_records | Actor, decision and exact run/candidate reference |

Use organization-scoped foreign keys and authorization predicates. Store large logs and artifacts in object storage; PostgreSQL stores metadata, checksums and immutable references. Retention and cleanup must be explicit.

## 13. API surface

All endpoints are under `/api/v1` and organization-scoped where applicable. Names below are proposed; final OpenAPI schemas and route conventions must follow existing API patterns.

| Method | Resource | Purpose |
| --- | --- | --- |
| GET/POST | `/organizations/{org}/pipelines` | List/create |
| GET | `/organizations/{org}/pipelines/{id}` | Details |
| PUT | `/organizations/{org}/pipelines/{id}/draft` | Update draft |
| POST | `/organizations/{org}/pipelines/{id}/publish` | Publish immutable version |
| GET | `/organizations/{org}/pipelines/{id}/versions` | Version history |
| POST | `/organizations/{org}/pipelines/{id}/runs` | Start run with parameters |
| GET | `/organizations/{org}/pipeline-runs/{id}` | Run details |
| POST | `/organizations/{org}/pipeline-runs/{id}/cancel` | Cancel |
| GET | `/organizations/{org}/pipeline-runs/{id}/events` | SSE notifications |
| GET | `/organizations/{org}/pipeline-runs/{id}/logs` | Log metadata/chunks |
| POST | `/organizations/{org}/integration-runs` | Create integration run |
| GET | `/organizations/{org}/integration-runs/{id}` | Integration details |
| POST | `/organizations/{org}/integration-runs/{id}/conflict-check` | Run conflict check |
| GET | `/organizations/{org}/integration-runs/{id}/conflicts` | Conflict report |
| GET | `/organizations/{org}/merge-queues` | List queues |
| POST | `/organizations/{org}/merge-queues/{id}/entries` | Enqueue candidate |
| POST | `/organizations/{org}/merge-queue-entries/{id}/cancel` | Remove entry |

Use idempotency keys for run creation, webhook deduplication and promotion commands. SSE carries notifications only; clients refetch authoritative state from REST.

## 14. Frontend information architecture

Upgrade the existing flat `/pipelines` mock route to a real organization-scoped CI/CD workspace when backend APIs are ready, following ADR-008. Proposed sections:
- Pipelines: list, create, clone, enable/disable.
- Workflow editor: component palette, graph canvas, node configuration and validation.
- Runs: history, status, filters and run details.
- Integration: target branch, ordered source branches, pinned SHAs, conflict report and candidate build.
- Merge queues: queue state, train candidates and promotion history.
- Artifacts: build outputs and test reports.
- Settings: parameters, secret references, triggers and runner policies.

Editor layout: left capability palette, center graph, right selected-node configuration. The graph is a presentation of the canonical workflow definition; backend validation is authoritative. Provide accessible non-drag alternatives for adding/reordering nodes.

## 15. Observability, security and operations

- Correlate request ID, pipeline run ID, task ID, integration run ID and worker ID.
- Record actor/automation attribution for every state transition and promotion.
- Enforce organization membership and role policy on every read/write.
- Rate-limit manual/API triggers and webhook ingestion.
- Apply per-organization concurrency and resource quotas.
- Restrict allowed container images and pin image digests.
- Use ephemeral workspaces and cleanup on completion/expiry.
- Protect against path traversal, archive bombs, log injection and oversized artifacts.
- Keep audit metadata even when large log objects expire.
- Monitor queue age, lease expiry, worker capacity, run duration, failure rates and stale candidate rebuilds.

## 16. Delivery phases and acceptance

See `docs/plans/cicd-development-plan.md` for the implementation sequence and measurable acceptance criteria. This architecture is accepted only as the target design after review; implementation status must be tracked separately and never inferred from this document.
