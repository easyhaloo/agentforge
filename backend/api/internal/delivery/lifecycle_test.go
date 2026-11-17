package delivery

import (
	"testing"
	"time"
)

func TestChangesetLifecycleStatus(t *testing.T) {
	now := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)
	const sha = "0123456789012345678901234567890123456789"

	// Every step is a real domain transition, so each case is a state the API can actually reach.
	type step func(*Changeset) error
	revision := func(id ID) step {
		return func(c *Changeset) error { return c.AddGitRevision(id, "feature", sha, "base", "author", now) }
	}
	evaluation := func(id, revisionID ID, status Status) step {
		return func(c *Changeset) error { return c.RecordEvaluation(id, revisionID, status, "", "worker", now) }
	}
	evidence := func(id, revisionID, evaluationID ID) step {
		return func(c *Changeset) error {
			return c.AttachEvidence(id, revisionID, evaluationID, "report", "artifact://sha256", "worker", now)
		}
	}
	review := func(id, revisionID ID, reviewer string) step {
		return func(c *Changeset) error { return c.AssignReview(id, revisionID, reviewer, "author", "", now) }
	}
	decision := func(id ID, approved bool, reviewer string) step {
		return func(c *Changeset) error { return c.DecideReview(id, approved, reviewer, "", now) }
	}
	merge := func(c *Changeset) error { return c.CompleteMerge("merge-1", "maintainer", "main", sha, now) }
	build := func(t *testing.T, steps []step) *Changeset {
		t.Helper()
		c, err := NewChangeset("cs-1", "org/repo", "Ship feature", "author", now)
		if err != nil {
			t.Fatal(err)
		}
		for i, apply := range steps {
			if err := apply(c); err != nil {
				t.Fatalf("step %d: %v", i, err)
			}
		}
		return c
	}
	concat := func(parts ...[]step) []step {
		var all []step
		for _, part := range parts {
			all = append(all, part...)
		}
		return all
	}

	evaluated := []step{revision("rev-1"), evaluation("eval-1", "rev-1", EvaluationPassed)}
	withEvidence := concat(evaluated, []step{evidence("ev-1", "rev-1", "eval-1")})
	inReview := concat(withEvidence, []step{review("review-1", "rev-1", "reviewer")})
	approved := concat(inReview, []step{decision("review-1", true, "reviewer")})
	newRevision := concat(approved, []step{revision("rev-2")})
	newRevisionEvaluated := concat(newRevision, []step{evaluation("eval-2", "rev-2", EvaluationPassed)})
	newRevisionEvidence := concat(newRevisionEvaluated, []step{evidence("ev-2", "rev-2", "eval-2")})
	newRevisionInReview := concat(newRevisionEvidence, []step{review("review-2", "rev-2", "reviewer")})

	t.Run("states", func(t *testing.T) {
		cases := []struct {
			name  string
			steps []step
			want  Lifecycle
		}{
			{"no revision is a draft", nil, LifecycleDraft},
			{"revision without evaluation", []step{revision("rev-1")}, LifecycleEvaluationPending},
			{"failed evaluation", []step{revision("rev-1"), evaluation("eval-1", "rev-1", EvaluationFailed)}, LifecycleEvaluationFailed},
			{"passed evaluation without evidence", evaluated, LifecycleEvidenceRequired},
			{"evidence without review", withEvidence, LifecycleReviewRequired},
			{"pending review", inReview, LifecycleInReview},
			{"rejected review", concat(inReview, []step{decision("review-1", false, "reviewer")}), LifecycleChangesRequested},
			{"approved review", approved, LifecycleReadyToMerge},
			{"merged", concat(approved, []step{merge}), LifecycleMerged},
			{"latest failed evaluation overrides an earlier pass", concat(approved, []step{evaluation("eval-fail", "rev-1", EvaluationFailed)}), LifecycleEvaluationFailed},
			{"latest passed evaluation after a failure", []step{revision("rev-1"), evaluation("eval-1", "rev-1", EvaluationFailed), evaluation("eval-2", "rev-1", EvaluationPassed)}, LifecycleEvidenceRequired},
			{"new revision invalidates evaluation, evidence and review", newRevision, LifecycleEvaluationPending},
			{"stale evidence does not satisfy the new revision", newRevisionEvaluated, LifecycleEvidenceRequired},
			{"stale review does not satisfy the new revision", newRevisionEvidence, LifecycleReviewRequired},
			{"new revision pending review", newRevisionInReview, LifecycleInReview},
			{"new revision approved", concat(newRevisionInReview, []step{decision("review-2", true, "reviewer")}), LifecycleReadyToMerge},
			{"rejected then reassigned and pending", concat(inReview, []step{decision("review-1", false, "reviewer"), review("review-2", "rev-1", "reviewer-2")}), LifecycleInReview},
			{"rejected then reassigned and approved", concat(inReview, []step{decision("review-1", false, "reviewer"), review("review-2", "rev-1", "reviewer-2"), decision("review-2", true, "reviewer-2")}), LifecycleReadyToMerge},
			{"assigning while a review is pending supersedes it", concat(inReview, []step{review("review-2", "rev-1", "reviewer-2")}), LifecycleInReview},
			{"approved after the first review was superseded", concat(inReview, []step{review("review-2", "rev-1", "reviewer-2"), decision("review-2", true, "reviewer-2")}), LifecycleReadyToMerge},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				c := build(t, tc.steps)
				got := c.Lifecycle()
				if got != tc.want {
					t.Fatalf("Lifecycle() = %q, want %q", got, tc.want)
				}
				// ADR-003: the reported status must agree with the authoritative merge gate.
				if got != LifecycleMerged && (got == LifecycleReadyToMerge) != (c.ValidateMerge() == nil) {
					t.Fatalf("Lifecycle() = %q but ValidateMerge() = %v", got, c.ValidateMerge())
				}
			})
		}
	})
}

func TestChangesetLifecycleValid(t *testing.T) {
	for _, value := range []string{"draft", "evaluation_pending", "evaluation_failed", "evidence_required", "review_required", "in_review", "changes_requested", "ready_to_merge", "merged"} {
		if !Lifecycle(value).Valid() {
			t.Errorf("Lifecycle(%q).Valid() = false, want true", value)
		}
	}
	for _, value := range []string{"", "bogus", "Draft", "ready-to-merge", "pending"} {
		if Lifecycle(value).Valid() {
			t.Errorf("Lifecycle(%q).Valid() = true, want false", value)
		}
	}
}
