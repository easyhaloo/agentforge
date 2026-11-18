# AgentForge CI/CD Product Design

## Product vision

Provide a first-party, organization-scoped CI/CD workspace that combines cloud-build-platform-style workflow authoring with AgentForge's verified-change lifecycle. Users can define reusable workflows, run parameterized builds, detect merge conflicts, validate ordered multi-branch integration candidates and promote only verified results.

This is a product design, not a statement that the UI or backend is already implemented.

## Primary user journeys

### 1. Create and publish a workflow

1. Open CI/CD > Pipelines.
2. Create from blank or a template.
3. Choose repository and default trigger.
4. Add stages, jobs and steps from a capability palette.
5. Configure dependencies, conditions, retry, timeout and runner requirements.
6. Define typed parameters and secret references.
7. Validate the graph and publish an immutable version.
8. Trigger a test run and inspect logs/results.

Draft edits do not mutate versions used by existing runs. Publishing creates a new immutable version.

### 2. Run with parameters

The run dialog displays only runtime-overridable parameters. It validates required values and constraints before submission, shows safe defaults and branch/repository selectors, and never reveals secret values. The run detail records the workflow version and redacted parameter snapshot.

### 3. Multi-branch integration build

1. Select repository and target branch.
2. Select one or more source branches/Changesets.
3. Arrange the merge order explicitly.
4. Choose merge strategy and conflict policy.
5. Preview resolved source commit SHAs.
6. Start conflict detection.
7. If conflict-free, create an isolated integration candidate.
8. Run build, tests and configured quality checks against the exact candidate.
9. Inspect conflict files, test results and provenance.
10. Request approval or enqueue for promotion.

The UI must clearly distinguish:
- Git mergeability.
- Candidate build/test result.
- Policy/approval eligibility.
- Actual promotion result.

### 4. Merge queue

Show queue entries by repository and target branch. Each entry displays order, source, pinned SHA, candidate status, checks, approval and whether it is stale. Explain why a candidate was invalidated and whether it is rebuilding. Do not display a green state for an outdated candidate.

## Information architecture

The existing `/pipelines` route is currently a mock ResourceRoute. Keep it as a placeholder until the live API exists; when graduating the feature to a real backend-backed page, use organization-scoped routes consistent with ADR-008.

Proposed navigation within CI/CD:
- Pipelines
- Runs
- Integration Builds
- Merge Queues
- Artifacts
- Settings

## Workflow editor

Three-pane layout:
- Left: categorized capabilities (Git, build, test, quality, control, artifact).
- Center: graph canvas with stages, jobs, dependencies and execution order.
- Right: selected node configuration.

Initial capabilities:
- Git: checkout, resolve refs, conflict check, create integration candidate, promote candidate.
- Build: container command, Go build, Node build, Docker build.
- Test: command, unit test, E2E test, coverage.
- Quality: lint, dependency scan, policy check.
- Control: condition, parallel, approval, set variable.
- Artifact: upload, download, publish report.

Capabilities are versioned and have typed input/output schemas. Do not expose arbitrary internal application services as user-configurable steps.

## Parameter UX

Types: string, boolean, number/integer, choice, branch, branches, repository and secret reference. Each parameter shows description, required/default state, constraints and runtime override policy. Secrets are selected by reference; their values are never shown after creation.

## Run detail

Run detail should include:
- Workflow name/version and actor/trigger.
- Overall state and timing.
- Stage/job/step graph and live progress.
- Per-step logs and attempt history.
- Repository, ref and immutable commit SHA.
- Redacted parameters.
- Artifacts, test reports and provenance.
- Cancellation/retry actions when policy permits.
- Approval and audit timeline.

## Conflict report UX

Display a summary by source branch and merge step, then a file-level list. Include conflict category when determinable, path, base/source/target SHAs and the exact candidate sequence. Avoid claiming semantic conflict resolution; Git conflict output may not classify every conflict reliably.

## Permissions

Use organization roles and repository permissions already enforced by the backend. Separate permissions for:
- View pipeline and run.
- Edit draft.
- Publish version.
- Trigger run.
- Manage secret references.
- Approve promotion.
- Administer runners and quotas.

Never trust frontend role checks as authorization.

## Product acceptance

- A user can author, validate, publish and run a workflow without editing YAML.
- A run is reproducible from immutable version + pinned source refs + safe parameter snapshot.
- Multi-branch candidate uses explicit order and immutable commit inputs.
- Conflict and build outcomes are separately visible.
- Promotion is impossible when candidate is stale, checks fail, approval is missing or authorization denies it.
- Logs and artifacts are accessible only to authorized organization members.
