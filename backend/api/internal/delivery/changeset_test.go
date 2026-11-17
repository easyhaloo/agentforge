package delivery

import (
	"errors"
	"testing"
	"time"
)

func TestLifecycleRequiresRevisionBoundEvidenceAndApproval(t *testing.T) {
	now := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)
	c, err := NewChangeset("cs-1", "org/repo", "Ship feature", "author", now)
	if err != nil { t.Fatal(err) }
	if err := c.AddRevision("rev-1", "abc123", "author", now); err != nil { t.Fatal(err) }
	if err := c.RecordEvaluation("eval-1", "rev-1", EvaluationPassed, "all checks passed", "worker", now); err != nil { t.Fatal(err) }
	if err := c.AttachEvidence("ev-1", "rev-1", "eval-1", "ci-run", "https://ci.example/run/1", "worker", now); err != nil { t.Fatal(err) }
	if err := c.SubmitReview("review-1", "rev-1", "reviewer", "", now); err != nil { t.Fatal(err) }
	if err := c.CompleteMerge("merge-1", "maintainer", "main", "deadbeef", now); !errors.Is(err, ErrReviewRequired) { t.Fatalf("expected approval requirement, got %v", err) }
	if err := c.DecideReview("review-1", true, "reviewer", "looks good", now); err != nil { t.Fatal(err) }
	if err := c.CompleteMerge("merge-1", "maintainer", "main", "deadbeef", now); err != nil { t.Fatal(err) }
	if c.Merge == nil || c.Merge.RevisionID != "rev-1" { t.Fatalf("merge must reference reviewed revision: %#v", c.Merge) }
}

func TestNewRevisionStalesEvidenceAndReview(t *testing.T) {
	now := time.Now().UTC()
	c, _ := NewChangeset("cs-1", "org/repo", "Ship feature", "author", now)
	_ = c.AddRevision("rev-1", "abc123", "author", now)
	_ = c.RecordEvaluation("eval-1", "rev-1", EvaluationPassed, "", "worker", now)
	_ = c.AttachEvidence("ev-1", "rev-1", "eval-1", "ci-run", "run://1", "worker", now)
	_ = c.SubmitReview("review-1", "rev-1", "reviewer", "", now)
	if err := c.AddRevision("rev-2", "def456", "author", now); err != nil { t.Fatal(err) }
	if c.Evidence[0].Status != EvidenceStale { t.Fatalf("evidence should be stale, got %s", c.Evidence[0].Status) }
	if c.Reviews[0].Status != ReviewStale { t.Fatalf("review should be stale, got %s", c.Reviews[0].Status) }
	if err := c.CompleteMerge("merge-1", "maintainer", "main", "deadbeef", now); !errors.Is(err, ErrEvidenceRequired) { t.Fatalf("expected fresh evidence requirement, got %v", err) }
	if err := c.RecordEvaluation("eval-old", "rev-1", EvaluationPassed, "", "worker", now); !errors.Is(err, ErrRevisionNotCurrent) { t.Fatalf("expected current revision check, got %v", err) }
}

func TestAuditSequenceIsMonotonic(t *testing.T) {
	now := time.Now().UTC()
	c, _ := NewChangeset("cs-1", "org/repo", "Ship feature", "author", now)
	_ = c.AddRevision("rev-1", "abc123", "author", now)
	for i, event := range c.Audit {
		if event.Sequence != uint64(i+1) { t.Fatalf("event %d has sequence %d", i, event.Sequence) }
	}
}
