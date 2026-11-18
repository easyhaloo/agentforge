# Recover a promotion after a PostgreSQL commit failure

Git updates the target and the run’s promotion receipt atomically. PostgreSQL commits the Changeset merges, promotion row, run event and queue transition afterward. A commit error can therefore leave the branch advanced while the queue still shows the original head. The scheduler pauses that train and cancellation returns a conflict while its head has a receipt.

1. Read the run ID and exact candidate SHA from the queue. For a local bare repository, `git show-ref --verify refs/agentforge/promotions/<run-id>` should return that SHA. The branch may have moved again since promotion.
2. As an active owner or admin, retry `POST /api/v1/organizations/{organizationID}/pipeline-runs/{run}/promote` with the original `{"candidateSHA":"<sha>"}`. A matching receipt lets the API finish the database work without writing the target again. The `promotion_requested` run event identifies the original promoter for the merge and its audit records. A separate `promotion_reconciled` event records who completed recovery.
3. After success, confirm that the original head is promoted, later entries are queued for rebuild, and the run has one `promoted` event. Repeating the request returns success.

If the receipt disagrees with the candidate, the original intent is missing (including a pre-upgrade partial promotion), or the current Changeset gates have changed, preserve the train and reconcile the Git and PostgreSQL records before proceeding. Deleting the receipt or resetting the branch destroys evidence needed for recovery.
