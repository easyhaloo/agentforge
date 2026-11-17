package delivery

// Lifecycle is the server-owned overall state of a changeset (ADR-003). Clients display it and
// filter by it; they never derive it.
type Lifecycle string

const (
	LifecycleDraft             Lifecycle = "draft"
	LifecycleEvaluationPending Lifecycle = "evaluation_pending"
	LifecycleEvaluationFailed  Lifecycle = "evaluation_failed"
	LifecycleEvidenceRequired  Lifecycle = "evidence_required"
	LifecycleReviewRequired    Lifecycle = "review_required"
	LifecycleInReview          Lifecycle = "in_review"
	LifecycleChangesRequested  Lifecycle = "changes_requested"
	LifecycleReadyToMerge      Lifecycle = "ready_to_merge"
	LifecycleMerged            Lifecycle = "merged"
)

// Valid reports whether l is one of the lifecycle values the server can produce.
func (l Lifecycle) Valid() bool {
	switch l {
	case LifecycleDraft, LifecycleEvaluationPending, LifecycleEvaluationFailed, LifecycleEvidenceRequired,
		LifecycleReviewRequired, LifecycleInReview, LifecycleChangesRequested, LifecycleReadyToMerge, LifecycleMerged:
		return true
	}
	return false
}

// Lifecycle derives the overall state from the changeset history. Only the CURRENT revision is
// judged: evaluations, evidence and reviews of older revisions never count (agent.md section 6).
func (c *Changeset) Lifecycle() Lifecycle {
	if c.Merge != nil {
		return LifecycleMerged
	}
	revisionID := c.currentRevisionID()
	if revisionID == "" {
		return LifecycleDraft
	}
	if evaluation, ok := c.latestEvaluation(revisionID); ok && evaluation.Status == EvaluationFailed {
		return LifecycleEvaluationFailed
	}
	if !c.hasPassedEvaluation(revisionID) {
		return LifecycleEvaluationPending
	}
	if !c.hasActiveEvidence(revisionID) {
		return LifecycleEvidenceRequired
	}
	review, ok := c.latestReview(revisionID)
	switch {
	case !ok:
		return LifecycleReviewRequired
	case review.Status == ReviewRejected:
		return LifecycleChangesRequested
	case review.Status != ReviewApproved:
		return LifecycleInReview
	}
	return LifecycleReadyToMerge
}

func (c *Changeset) latestReview(revisionID ID) (Review, bool) {
	for i := len(c.Reviews) - 1; i >= 0; i-- {
		if c.Reviews[i].RevisionID == revisionID {
			return c.Reviews[i], true
		}
	}
	return Review{}, false
}
