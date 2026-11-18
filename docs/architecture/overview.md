## 12. CI/CD workflow platform (proposed)

The product CI/CD platform is distinct from GitHub Actions used to validate this repository. Its target architecture, product journeys and delivery plan are specified in:

- [CI/CD architecture](cicd-architecture.md)
- [CI/CD product design](../product/cicd-product-design.md)
- [CI/CD development plan](../plans/cicd-development-plan.md)

The platform will provide versioned custom workflows, typed parameters, durable isolated execution, Git conflict detection, ordered multi-branch integration candidates, candidate builds and safe promotion. It will be implemented inside the Go modular monolith with explicit `pipeline`, `execution` and `integration` ownership, extending existing repository/SCM and Changeset lifecycle interfaces rather than duplicating them.

Key invariants:
- Pipeline versions and run inputs are immutable snapshots.
- Every integration source ref is resolved and pinned to a full commit SHA.
- A successful Git merge simulation is not equivalent to a successful application build.
- Candidate promotion rechecks the target base SHA, current authorization, review and quality gates; a moved target invalidates the candidate.
- Untrusted code runs only in isolated, resource-bounded workers.
- PostgreSQL remains the initial system of record and durable scheduler; add brokers or workflow infrastructure only when measured requirements justify them.

These are target decisions, not claims that the CI/CD product capabilities are already implemented.
