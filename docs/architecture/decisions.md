## ADR-009: First-party CI/CD workflow and integration platform

- Status: Proposed
- Decision: Build a first-party, organization-scoped CI/CD workflow product inside the existing Go modular monolith. Keep GitHub Actions as the CI system for the AgentForge repository itself; do not conflate repository CI with user-managed pipelines.
- Context: AgentForge needs reusable custom workflows, typed run parameters, durable execution, conflict detection, ordered multi-branch integration builds and safe promotion. Existing repository, Changeset, Revision, Evaluation, Review and Merge Gate capabilities should remain authoritative owners of their invariants.
- Decision details:
  - Persist canonical versioned workflow definitions as validated JSON; visual editing is the primary UX and YAML import/export is an interoperability feature.
  - Introduce pipeline, execution and integration module boundaries incrementally; extend the existing Git provider/local adapter through explicit ports.
  - Use PostgreSQL for workflow state, run metadata and initial durable task scheduling. Use isolated worker processes/containers for all untrusted repository execution.
  - Pin target and source refs to immutable commit SHAs at run creation. Build and test the exact ordered integration candidate.
  - Use Git merge simulation for conflict diagnostics, but require a real isolated candidate build for application validation.
  - Promotion is separate from candidate creation and requires current policy/evidence/approval plus expected-target-SHA concurrency protection. A moved target makes the candidate stale and requires rebuild/revalidation.
  - Add a per-repository/target-branch merge queue only after candidate provenance and safe promotion are implemented.
  - Do not add Redis, Kafka, Temporal or Kubernetes as initial mandatory dependencies.
- Consequences:
  - Workflow version, run, task, integration candidate and approval provenance must be persisted and auditable.
  - Secrets are references, never plaintext in definitions, API responses or run snapshots.
  - At-least-once task delivery requires idempotent task/step behavior and lease recovery.
  - The UI must distinguish mergeability, build/test success, gate eligibility and actual promotion.
  - Implementation proceeds according to `docs/plans/cicd-development-plan.md`; this ADR does not imply implementation is complete.
