# Release build candidates

Stop API instances, workers and repository writers and take a paired database and Git backup. Candidate preparation retains a Git ref before PostgreSQL commits the run, so an online inventory can mistake a new candidate for an orphan.

Use the deployment’s `DATABASE_URL` and its Git configuration, either `GIT_REPOSITORY_ROOT` or `GIT_REMOTE_BINDINGS_FILE`. For a remote binding, list `refs/heads/agentforge/integration/*` on the bound upstream. List candidate IDs with `git -C "$repository" for-each-ref --format='%(objectname)' refs/agentforge/integration/`. From the backend module, run `go run ./cmd/candidate-prune ORG REPOSITORY FULL_SHA` to check each candidate. The command retains candidates needed by queued or running builds, successful standalone runs waiting for promotion, and attached successful queue runs. Several runs can share a candidate.

Use `-apply-offline` before the positional arguments to release an eligible ref. Repeated removal is safe. The command preserves target branches, promotion receipts, and all PostgreSQL provenance. Ordinary Git garbage collection governs when unreachable objects are reclaimed.
