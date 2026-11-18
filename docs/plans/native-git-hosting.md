[object Object]

## Source Control architecture evolution

The storage and API direction is governed by [Source Control Evolution](../architecture/source-control-evolution.md):

- **Git-native first:** retain Git object identity, standard client compatibility and the local bare-repository adapter as the first implementation.
- **Server-side API next:** expose diff, merge-base, history, blame, tree/blob and integration preview over the existing Git engine before introducing a second storage model.
- **Derived Data:** add rebuildable, algorithm-versioned graph/path/blame indexes only with concrete query use cases.
- **Pando-inspired scaling:** per-ref compare-and-swap, immutable object publication, pack reuse, streaming, scoped caching and safe compaction, prioritized by telemetry.
- **Scion-style storage deferred:** no Changeset WAL or parallel Blob store until a separate ADR establishes measured need, ID semantics, import/export fidelity and rollback.

The current roadmap stages remain authoritative for implementation ordering. This section adds architecture constraints; it does not mark any implementation phase complete.
