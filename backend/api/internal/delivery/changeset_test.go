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
	if err := c.CompleteMerge("merge-1", "maintainer", "main", "deadbeef", now); !errors.Is(err, ErrEvaluationRequired) { t.Fatalf("expected fresh evaluation requirement, got %v", err) }
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

func TestMergeCannotBeCompletedWithoutCurrentEvaluationEvidenceAndReview(t *testing.T) {
	now:=time.Now().UTC()
	changeset,err:=NewChangeset("cs-gates","org/repo","Gate checks","author",now);if err!=nil{t.Fatal(err)}
	if err=changeset.AddGitRevision("rev-gates","feature","0123456789012345678901234567890123456789","base","author",now);err!=nil{t.Fatal(err)}
	if err=changeset.ValidateMerge();!errors.Is(err,ErrEvaluationRequired){t.Fatalf("without evaluation: %v",err)}
	if err=changeset.RecordEvaluation("eval-gates","rev-gates",EvaluationPassed,"passed","worker",now);err!=nil{t.Fatal(err)}
	if err=changeset.ValidateMerge();!errors.Is(err,ErrEvidenceRequired){t.Fatalf("without evidence: %v",err)}
	if err=changeset.AttachEvidence("evidence-gates","rev-gates","eval-gates","report","artifact://sha256","worker",now);err!=nil{t.Fatal(err)}
	if err=changeset.ValidateMerge();!errors.Is(err,ErrReviewRequired){t.Fatalf("without review: %v",err)}
	if err=changeset.AssignReview("review-gates","rev-gates","reviewer","author","",now);err!=nil{t.Fatal(err)}
	if err=changeset.ValidateMerge();!errors.Is(err,ErrReviewRequired){t.Fatalf("pending review: %v",err)}
	if err=changeset.DecideReview("review-gates",true,"reviewer","approved",now);err!=nil{t.Fatal(err)}
	if err=changeset.ValidateMerge();err!=nil{t.Fatalf("fully satisfied gates: %v",err)}
}

func TestLatestFailedEvaluationInvalidatesEarlierPass(t *testing.T) {
	now := time.Now().UTC()
	changeset, err := NewChangeset("cs-latest-eval", "org/repo", "Latest evaluation gate", "author", now)
	if err != nil { t.Fatal(err) }
	if err = changeset.AddGitRevision("rev-latest-eval", "feature", "0123456789012345678901234567890123456789", "base", "author", now); err != nil { t.Fatal(err) }
	if err = changeset.RecordEvaluationAgainstBase("eval-pass", "rev-latest-eval", "base-sha-1", EvaluationPassed, "passed", "worker", now); err != nil { t.Fatal(err) }
	if changeset.Evaluations[0].BaseSHA != "base-sha-1" { t.Fatalf("evaluation base SHA was not persisted: %#v", changeset.Evaluations[0]) }
	if err = changeset.AttachEvidence("evidence-latest", "rev-latest-eval", "eval-pass", "report", "artifact://sha256", "worker", now); err != nil { t.Fatal(err) }
	if err = changeset.AssignReview("review-latest", "rev-latest-eval", "reviewer", "author", "", now); err != nil { t.Fatal(err) }
	if err = changeset.DecideReview("review-latest", true, "reviewer", "approved", now); err != nil { t.Fatal(err) }
	if err = changeset.RecordEvaluationAgainstBase("eval-fail", "rev-latest-eval", "base-sha-1", EvaluationFailed, "failed", "worker", now); err != nil { t.Fatal(err) }
	if err = changeset.ValidateMerge(); !errors.Is(err, ErrEvaluationRequired) { t.Fatalf("latest failed evaluation must block merge, got %v", err) }
}
