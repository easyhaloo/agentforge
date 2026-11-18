package delivery

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"slices"
	"strings"
	"testing"
)

const listFilterSHA = "0123456789012345678901234567890123456789"

// listFilterReviewable returns a changeset whose current revision, rev-1, has a passed evaluation
// and active evidence, so reviews can be assigned to it.
func listFilterReviewable(t *testing.T) *Changeset {
	t.Helper()
	now := listFilterEpoch
	c, err := NewChangeset("cs-1", "org/repo", "One active review", "author", now)
	listFilterMust(t, err)
	listFilterMust(t, c.AddGitRevision("rev-1", "feature", listFilterSHA, "base", "author", now))
	listFilterMust(t, c.RecordEvaluation("eval-1", "rev-1", EvaluationPassed, "", "worker", now))
	listFilterMust(t, c.AttachEvidence("ev-1", "rev-1", "eval-1", "report", "artifact://sha256", "worker", now))
	return c
}

func listFilterSnapshot(t *testing.T, c *Changeset) []byte {
	t.Helper()
	data, err := json.Marshal(c)
	listFilterMust(t, err)
	return data
}

func listFilterReviewByID(t *testing.T, c *Changeset, id ID) Review {
	t.Helper()
	for _, review := range c.Reviews {
		if review.ID == id {
			return review
		}
	}
	t.Fatalf("review %s does not exist", id)
	return Review{}
}

// A revision has at most one active review. Once the current revision is approved, a further
// assignment is refused and nothing changes.
func TestAssignReviewIsRefusedOnceTheCurrentRevisionIsApproved(t *testing.T) {
	now := listFilterEpoch
	c := listFilterReviewable(t)
	listFilterMust(t, c.AssignReview("review-1", "rev-1", "bob", "author", "", now))
	listFilterMust(t, c.DecideReview("review-1", true, "bob", "approved", now))
	before := listFilterSnapshot(t, c)

	if got, want := ErrReviewAlreadyApproved.Error(), "a review is already approved for the current revision"; got != want {
		t.Fatalf("ErrReviewAlreadyApproved = %q, want %q", got, want)
	}
	refused := []struct {
		name   string
		assign func() error
	}{
		{"AssignReview to another reviewer", func() error { return c.AssignReview("review-2", "rev-1", "carol", "maintainer", "", now) }},
		{"SubmitReview", func() error { return c.SubmitReview("review-3", "rev-1", "dave", "", now) }},
		{"the approving reviewer again", func() error { return c.AssignReview("review-4", "rev-1", "bob", "author", "", now) }},
	}
	for _, tc := range refused {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.assign(); !errors.Is(err, ErrReviewAlreadyApproved) {
				t.Fatalf("error = %v, want ErrReviewAlreadyApproved", err)
			}
			if after := listFilterSnapshot(t, c); !bytes.Equal(before, after) {
				t.Fatalf("a refused assignment changed the changeset:\n before %s\n after  %s", before, after)
			}
		})
	}
	if got := c.Lifecycle(); got != LifecycleReadyToMerge {
		t.Fatalf("Lifecycle() = %q after the refused assignments, want ready_to_merge", got)
	}
	if err := c.ValidateMerge(); err != nil {
		t.Fatalf("ValidateMerge() = %v after the refused assignments, want nil", err)
	}
}

// The refusal belongs to the current revision's approval only, and arguments and the revision are
// checked before it.
func TestAssignReviewAfterApprovalOnlyConcernsTheCurrentRevision(t *testing.T) {
	now := listFilterEpoch
	c := listFilterReviewable(t)
	listFilterMust(t, c.AssignReview("review-1", "rev-1", "bob", "author", "", now))
	listFilterMust(t, c.DecideReview("review-1", true, "bob", "approved", now))

	if err := c.AssignReview("review-2", "rev-1", "author", "author", "", now); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("the author as reviewer: error = %v, want ErrInvalidInput", err)
	}
	if err := c.AssignReview("review-2", "rev-9", "carol", "author", "", now); !errors.Is(err, ErrRevisionNotCurrent) {
		t.Fatalf("an unknown revision: error = %v, want ErrRevisionNotCurrent", err)
	}

	// A new revision makes rev-1 history: assigning to it is "not current", not "already approved",
	// and the new revision can be reviewed again.
	listFilterMust(t, c.AddGitRevision("rev-2", "feature", listFilterSHA, "base", "author", now))
	if err := c.AssignReview("review-2", "rev-1", "carol", "author", "", now); !errors.Is(err, ErrRevisionNotCurrent) {
		t.Fatalf("the old revision: error = %v, want ErrRevisionNotCurrent", err)
	}
	listFilterMust(t, c.RecordEvaluation("eval-2", "rev-2", EvaluationPassed, "", "worker", now))
	listFilterMust(t, c.AttachEvidence("ev-2", "rev-2", "eval-2", "report", "artifact://sha256", "worker", now))
	listFilterMust(t, c.AssignReview("review-2", "rev-2", "carol", "author", "", now))
	if got := listFilterReviewByID(t, c, "review-1").Status; got != ReviewStale {
		t.Fatalf("the approval of rev-1 is %q after a new revision, want stale", got)
	}
	if got := c.Lifecycle(); got != LifecycleInReview {
		t.Fatalf("Lifecycle() = %q, want in_review for the new revision", got)
	}
}

func TestAssignReviewSupersedesThePendingReview(t *testing.T) {
	now := listFilterEpoch
	c := listFilterReviewable(t)
	listFilterMust(t, c.AssignReview("review-1", "rev-1", "bob", "author", "first", now))
	recorded := len(c.Audit)
	listFilterMust(t, c.AssignReview("review-2", "rev-1", "carol", "maintainer", "second", now))

	if got := listFilterReviewByID(t, c, "review-1").Status; got != ReviewStale {
		t.Fatalf("superseded review is %q, want stale", got)
	}
	second := listFilterReviewByID(t, c, "review-2")
	if second.Status != ReviewPending || second.Reviewer != "carol" || second.RevisionID != "rev-1" || second.Comment != "second" {
		t.Fatalf("new review = %+v, want a pending review of rev-1 assigned to carol", second)
	}
	wantAudit := []AuditEvent{
		{Sequence: uint64(recorded + 1), Actor: "maintainer", Operation: "review.superseded", TargetID: "review-1", Outcome: "stale", At: now},
		{Sequence: uint64(recorded + 2), Actor: "maintainer", Operation: "review.assigned", TargetID: "review-2", Outcome: "succeeded", At: now},
	}
	if got := c.Audit[recorded:]; !slices.Equal(got, wantAudit) {
		t.Fatalf("audit after the second assignment:\n got  %+v\n want %+v", got, wantAudit)
	}
	if got := c.Lifecycle(); got != LifecycleInReview {
		t.Fatalf("Lifecycle() = %q, want in_review", got)
	}
	if err := c.ValidateMerge(); !errors.Is(err, ErrReviewRequired) {
		t.Fatalf("ValidateMerge() = %v, want ErrReviewRequired while only a pending review exists", err)
	}
}

// Changesets persisted before the rule can hold several pending reviews on one revision; the next
// assignment supersedes every one of them and leaves other decisions alone.
func TestAssignReviewSupersedesEveryPendingReviewOfTheCurrentRevision(t *testing.T) {
	now := listFilterEpoch
	c := listFilterReviewable(t)
	c.Reviews = append(c.Reviews,
		Review{ID: "legacy-1", RevisionID: "rev-1", Reviewer: "bob", Status: ReviewPending, CreatedAt: now},
		Review{ID: "legacy-2", RevisionID: "rev-1", Reviewer: "carol", Status: ReviewPending, CreatedAt: now},
		Review{ID: "legacy-3", RevisionID: "rev-1", Reviewer: "dave", Status: ReviewRejected, CreatedAt: now},
	)
	recorded := len(c.Audit)
	listFilterMust(t, c.AssignReview("review-new", "rev-1", "erin", "author", "", now))

	for id, want := range map[ID]Status{"legacy-1": ReviewStale, "legacy-2": ReviewStale, "legacy-3": ReviewRejected, "review-new": ReviewPending} {
		if got := listFilterReviewByID(t, c, id).Status; got != want {
			t.Errorf("review %s is %q, want %q", id, got, want)
		}
	}
	var operations []string
	for _, event := range c.Audit[recorded:] {
		operations = append(operations, fmt.Sprintf("%s:%s:%s", event.Operation, event.TargetID, event.Outcome))
	}
	if want := []string{"review.superseded:legacy-1:stale", "review.superseded:legacy-2:stale", "review.assigned:review-new:succeeded"}; !slices.Equal(operations, want) {
		t.Fatalf("audit operations = %v, want %v", operations, want)
	}
}

func TestAssignReviewWithADuplicateIDChangesNothing(t *testing.T) {
	now := listFilterEpoch
	c := listFilterReviewable(t)
	listFilterMust(t, c.AssignReview("review-1", "rev-1", "bob", "author", "", now))
	before := listFilterSnapshot(t, c)

	if err := c.AssignReview("review-1", "rev-1", "carol", "author", "", now); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}
	if after := listFilterSnapshot(t, c); !bytes.Equal(before, after) {
		t.Fatalf("the pending review was superseded by an assignment that was refused:\n before %s\n after  %s", before, after)
	}
}

func TestRejectedReviewStaysRejectedWhenAnotherIsAssigned(t *testing.T) {
	now := listFilterEpoch
	c := listFilterReviewable(t)
	listFilterMust(t, c.AssignReview("review-1", "rev-1", "bob", "author", "", now))
	listFilterMust(t, c.DecideReview("review-1", false, "bob", "needs work", now))
	listFilterMust(t, c.AssignReview("review-2", "rev-1", "carol", "author", "", now))
	listFilterMust(t, c.DecideReview("review-2", false, "carol", "still needs work", now))
	listFilterMust(t, c.AssignReview("review-3", "rev-1", "dave", "author", "", now))

	for id, want := range map[ID]Status{"review-1": ReviewRejected, "review-2": ReviewRejected, "review-3": ReviewPending} {
		if got := listFilterReviewByID(t, c, id).Status; got != want {
			t.Errorf("review %s is %q, want %q", id, got, want)
		}
	}
	for _, event := range c.Audit {
		if event.Operation == "review.superseded" {
			t.Fatalf("a rejected review must not be superseded, got audit event %+v", event)
		}
	}
	if got := c.Lifecycle(); got != LifecycleInReview {
		t.Fatalf("Lifecycle() = %q, want in_review", got)
	}
}

func TestApproveAfterSupersedeWorks(t *testing.T) {
	now := listFilterEpoch
	c := listFilterReviewable(t)
	listFilterMust(t, c.AssignReview("review-1", "rev-1", "bob", "author", "", now))
	listFilterMust(t, c.AssignReview("review-2", "rev-1", "carol", "author", "", now))
	if got := listFilterReviewByID(t, c, "review-1").Status; got != ReviewStale {
		t.Fatalf("superseded review is %q, want stale", got)
	}
	listFilterMust(t, c.DecideReview("review-2", true, "carol", "approved", now))

	if got := c.Lifecycle(); got != LifecycleReadyToMerge {
		t.Fatalf("Lifecycle() = %q, want ready_to_merge", got)
	}
	if err := c.ValidateMerge(); err != nil {
		t.Fatalf("ValidateMerge() = %v, want nil", err)
	}
	listFilterMust(t, c.CompleteMerge("merge-1", "maintainer", "main", listFilterSHA, now))
	if c.Merge == nil || c.Merge.RevisionID != "rev-1" || c.Lifecycle() != LifecycleMerged {
		t.Fatalf("merge = %+v, lifecycle %q, want a merge of rev-1", c.Merge, c.Lifecycle())
	}
}

func TestDecideOnASupersededReviewIsRefused(t *testing.T) {
	now := listFilterEpoch
	c := listFilterReviewable(t)
	listFilterMust(t, c.AssignReview("review-1", "rev-1", "bob", "author", "", now))
	listFilterMust(t, c.AssignReview("review-2", "rev-1", "carol", "author", "", now))
	before := listFilterSnapshot(t, c)

	for _, approved := range []bool{true, false} {
		if err := c.DecideReview("review-1", approved, "bob", "too late", now); !errors.Is(err, ErrRevisionNotCurrent) {
			t.Fatalf("deciding (approved=%v) a superseded review: error = %v, want ErrRevisionNotCurrent", approved, err)
		}
	}
	if after := listFilterSnapshot(t, c); !bytes.Equal(before, after) {
		t.Fatalf("a refused decision changed the changeset:\n before %s\n after  %s", before, after)
	}
	if got := c.Lifecycle(); got != LifecycleInReview {
		t.Fatalf("Lifecycle() = %q, want in_review (the new review is still pending)", got)
	}
	if err := c.ValidateMerge(); !errors.Is(err, ErrReviewRequired) {
		t.Fatalf("ValidateMerge() = %v, want ErrReviewRequired", err)
	}
}

// A new revision still invalidates pending and approved reviews exactly as before, and a rejected
// review stays as history.
func TestANewRevisionStillStalesPendingAndApprovedReviews(t *testing.T) {
	now := listFilterEpoch
	t.Run("approved", func(t *testing.T) {
		c := listFilterReviewable(t)
		listFilterMust(t, c.AssignReview("review-1", "rev-1", "bob", "author", "", now))
		listFilterMust(t, c.DecideReview("review-1", false, "bob", "", now))
		listFilterMust(t, c.AssignReview("review-2", "rev-1", "carol", "author", "", now))
		listFilterMust(t, c.DecideReview("review-2", true, "carol", "", now))
		listFilterMust(t, c.AddGitRevision("rev-2", "feature", listFilterSHA, "base", "author", now))
		for id, want := range map[ID]Status{"review-1": ReviewRejected, "review-2": ReviewStale} {
			if got := listFilterReviewByID(t, c, id).Status; got != want {
				t.Errorf("review %s is %q, want %q", id, got, want)
			}
		}
	})
	t.Run("pending", func(t *testing.T) {
		c := listFilterReviewable(t)
		listFilterMust(t, c.AssignReview("review-1", "rev-1", "bob", "author", "", now))
		listFilterMust(t, c.AddGitRevision("rev-2", "feature", listFilterSHA, "base", "author", now))
		if got := listFilterReviewByID(t, c, "review-1").Status; got != ReviewStale {
			t.Errorf("review-1 is %q, want stale", got)
		}
	})
}

// ---- randomized sequences ----------------------------------------------------------------------

var listFilterReviewers = []string{"bob", "carol", "dave", "erin"}

type listFilterReviewStats struct {
	steps                  int
	lifecycles             map[Lifecycle]int
	refusedAfterApproval   int // AssignReview refused because the current revision is approved
	superseded             int // AssignReview that superseded at least one pending review
	reassignedAfterReject  int // AssignReview right after a rejection on the same revision
	decideRefusedAsStale   int // DecideReview refused because the review had been superseded
	approvedAfterSupersede int // approvals on a revision that holds a superseded review
}

// listFilterReviewRun drives one random sequence of delivery operations on one changeset. Every
// operation is applied through the public domain methods, so every state it visits is reachable.
type listFilterReviewRun struct {
	t        *testing.T
	rng      *rand.Rand
	c        *Changeset
	sequence int
	history  []string
	counter  int
	stats    *listFilterReviewStats
}

func (r *listFilterReviewRun) id(prefix string) ID {
	r.counter++
	return ID(fmt.Sprintf("%s-%d", prefix, r.counter))
}

func (r *listFilterReviewRun) fail(format string, args ...any) {
	r.t.Helper()
	r.t.Fatalf("sequence %d, step %d: %s\nhistory:\n  %s", r.sequence, len(r.history)+1, fmt.Sprintf(format, args...), strings.Join(r.history, "\n  "))
}

var listFilterOperations = []string{"revision", "pass", "fail", "evidence", "assign", "approve", "reject"}

// chooseOperation mixes the natural next step of the current state (so sequences get deep enough
// to approve, supersede and re-assign) with uniformly random operations (so refusals are hit too).
func (r *listFilterReviewRun) chooseOperation() string {
	if r.rng.IntN(100) < 60 {
		pick := func(options ...string) string { return options[r.rng.IntN(len(options))] }
		switch r.c.Lifecycle() {
		case LifecycleDraft:
			return "revision"
		case LifecycleEvaluationPending:
			return pick("pass", "pass", "pass", "fail")
		case LifecycleEvaluationFailed:
			return pick("pass", "pass", "pass", "revision")
		case LifecycleEvidenceRequired:
			return "evidence"
		case LifecycleReviewRequired:
			return "assign"
		case LifecycleInReview:
			return pick("approve", "approve", "reject", "assign")
		case LifecycleChangesRequested:
			return pick("assign", "assign", "assign", "revision")
		case LifecycleReadyToMerge:
			return pick("assign", "assign", "revision", "fail", "approve", "reject", "pass")
		}
	}
	return listFilterOperations[r.rng.IntN(len(listFilterOperations))]
}

func (r *listFilterReviewRun) step() {
	var description string
	switch r.chooseOperation() {
	case "revision":
		description = r.addRevision()
	case "pass":
		description = r.evaluate(EvaluationPassed)
	case "fail":
		description = r.evaluate(EvaluationFailed)
	case "evidence":
		description = r.attachEvidence()
	case "assign":
		description = r.assignReview()
	case "approve":
		description = r.decideReview(true)
	default:
		description = r.decideReview(false)
	}
	r.history = append(r.history, description)
	r.check()
	r.stats.steps++
}

func (r *listFilterReviewRun) addRevision() string {
	id := r.id("rev")
	if err := r.c.AddGitRevision(id, "feature", listFilterSHA, "base", "author", listFilterEpoch); err != nil {
		r.fail("add revision %s: %v", id, err)
	}
	return "add revision " + string(id)
}

func (r *listFilterReviewRun) evaluate(status Status) string {
	current := r.c.currentRevisionID()
	id := r.id("eval")
	err := r.c.RecordEvaluation(id, current, status, "", "worker", listFilterEpoch)
	if (current == "") != errors.Is(err, ErrRevisionNotCurrent) || (current != "" && err != nil) {
		r.fail("record %s evaluation %s on %q: %v", status, id, current, err)
	}
	return fmt.Sprintf("record %s evaluation %s on %q: %v", status, id, current, err)
}

func (r *listFilterReviewRun) attachEvidence() string {
	current := r.c.currentRevisionID()
	evaluation := ID("eval-none")
	if latest, ok := r.c.latestEvaluation(current); ok && r.rng.IntN(100) < 80 {
		evaluation = latest.ID
	} else if n := len(r.c.Evaluations); n > 0 {
		evaluation = r.c.Evaluations[r.rng.IntN(n)].ID
	}
	id := r.id("ev")
	err := r.c.AttachEvidence(id, current, evaluation, "report", "artifact://sha256", "worker", listFilterEpoch)
	if err != nil && !errors.Is(err, ErrRevisionNotCurrent) && !errors.Is(err, ErrEvaluationRequired) {
		r.fail("attach evidence %s for evaluation %s: unexpected error %v", id, evaluation, err)
	}
	return fmt.Sprintf("attach evidence %s for evaluation %s on %q: %v", id, evaluation, current, err)
}

// assignReview assigns a review and checks the result against a model built from the raw records,
// not from the helpers under test: the precedence is input, current revision, evidence, approval.
func (r *listFilterReviewRun) assignReview() string {
	c := r.c
	current := c.currentRevisionID()
	target := current
	if r.rng.IntN(20) == 0 {
		target = "rev-unknown"
	}
	reviewer := listFilterReviewers[r.rng.IntN(len(listFilterReviewers))]
	if r.rng.IntN(20) == 0 {
		reviewer = c.CreatedBy
	}
	actor := "author"
	if r.rng.IntN(2) == 0 {
		actor = "maintainer"
	}
	id := r.id("review")
	if len(c.Reviews) > 0 && r.rng.IntN(30) == 0 {
		id = c.Reviews[r.rng.IntN(len(c.Reviews))].ID // a duplicate id
	}

	var want error
	switch {
	case reviewer == c.CreatedBy:
		want = ErrInvalidInput
	case current == "" || target != current:
		want = ErrRevisionNotCurrent
	case !slices.ContainsFunc(c.Evidence, func(e Evidence) bool { return e.RevisionID == target && e.Status == EvidenceActive }):
		want = ErrEvidenceRequired
	case slices.ContainsFunc(c.Reviews, func(v Review) bool { return v.RevisionID == target && v.Status == ReviewApproved }):
		want = ErrReviewAlreadyApproved
	case slices.ContainsFunc(c.Reviews, func(v Review) bool { return v.ID == id }):
		want = ErrInvalidInput
	}
	reviews, audit := slices.Clone(c.Reviews), slices.Clone(c.Audit)
	err := c.AssignReview(id, target, reviewer, actor, "", listFilterEpoch)
	description := fmt.Sprintf("assign review %s to %s on %q as %s: %v", id, reviewer, target, actor, err)

	if want != nil {
		if !errors.Is(err, want) {
			r.fail("%s\n  want error %v", description, want)
		}
		if !slices.Equal(reviews, c.Reviews) || !slices.Equal(audit, c.Audit) {
			r.fail("%s\n  a refused assignment changed the reviews or the audit trail", description)
		}
		if want == ErrReviewAlreadyApproved {
			r.stats.refusedAfterApproval++
		}
		return description
	}
	if err != nil {
		r.fail("%s\n  want success", description)
	}

	// Success: every pending review of the target revision is superseded, nothing else changes, and
	// the new pending review is appended.
	if len(c.Reviews) != len(reviews)+1 {
		r.fail("%s\n  %d reviews before, %d after", description, len(reviews), len(c.Reviews))
	}
	var wantAudit []AuditEvent
	for i, old := range reviews {
		expected := old
		if old.RevisionID == target && old.Status == ReviewPending {
			expected.Status = ReviewStale
			wantAudit = append(wantAudit, AuditEvent{Sequence: uint64(len(audit) + len(wantAudit) + 1), Actor: actor, Operation: "review.superseded", TargetID: old.ID, Outcome: "stale", At: listFilterEpoch})
		}
		if c.Reviews[i] != expected {
			r.fail("%s\n  review %d is %+v, want %+v", description, i, c.Reviews[i], expected)
		}
	}
	wantAudit = append(wantAudit, AuditEvent{Sequence: uint64(len(audit) + len(wantAudit) + 1), Actor: actor, Operation: "review.assigned", TargetID: id, Outcome: "succeeded", At: listFilterEpoch})
	if added := c.Reviews[len(reviews)]; added != (Review{ID: id, RevisionID: target, Reviewer: reviewer, Status: ReviewPending, CreatedAt: listFilterEpoch}) {
		r.fail("%s\n  new review is %+v", description, added)
	}
	if got := c.Audit[len(audit):]; !slices.Equal(got, wantAudit) {
		r.fail("%s\n  audit events\n   got  %+v\n   want %+v", description, got, wantAudit)
	}
	if len(wantAudit) > 1 {
		r.stats.superseded++
	}
	for i := len(reviews) - 1; i >= 0; i-- {
		if reviews[i].RevisionID == target {
			if reviews[i].Status == ReviewRejected {
				r.stats.reassignedAfterReject++
			}
			break
		}
	}
	return description
}

// decideReview approves or rejects a review (usually the pending one, sometimes any other) and
// checks the result against a model of the unchanged decision rules.
func (r *listFilterReviewRun) decideReview(approve bool) string {
	c := r.c
	current := c.currentRevisionID()
	target := ID("review-none")
	pending := slices.IndexFunc(c.Reviews, func(v Review) bool { return v.RevisionID == current && v.Status == ReviewPending })
	switch {
	case pending >= 0 && r.rng.IntN(100) < 85:
		target = c.Reviews[pending].ID
	case len(c.Reviews) > 0:
		target = c.Reviews[r.rng.IntN(len(c.Reviews))].ID
	}
	found := slices.IndexFunc(c.Reviews, func(v Review) bool { return v.ID == target })
	acting := "bob"
	if found >= 0 {
		acting = c.Reviews[found].Reviewer
	}
	if r.rng.IntN(10) == 0 {
		acting = listFilterReviewers[r.rng.IntN(len(listFilterReviewers))]
	}

	var want error
	switch {
	case found < 0:
		want = ErrInvalidInput
	case c.Reviews[found].RevisionID != current || c.Reviews[found].Status != ReviewPending:
		want = ErrRevisionNotCurrent
	case c.Reviews[found].Reviewer != acting:
		want = ErrReviewForbidden
	}
	reviews, audit := slices.Clone(c.Reviews), slices.Clone(c.Audit)
	err := c.DecideReview(target, approve, acting, "", listFilterEpoch)
	description := fmt.Sprintf("decide review %s (approve=%v) as %s: %v", target, approve, acting, err)

	if want != nil {
		if !errors.Is(err, want) {
			r.fail("%s\n  want error %v", description, want)
		}
		if !slices.Equal(reviews, c.Reviews) || !slices.Equal(audit, c.Audit) {
			r.fail("%s\n  a refused decision changed the reviews or the audit trail", description)
		}
		if want == ErrRevisionNotCurrent && reviews[found].Status == ReviewStale && reviews[found].RevisionID == current {
			r.stats.decideRefusedAsStale++
		}
		return description
	}
	if err != nil {
		r.fail("%s\n  want success", description)
	}
	status := ReviewRejected
	if approve {
		status = ReviewApproved
	}
	expected := slices.Clone(reviews)
	expected[found].Status = status
	if !slices.Equal(c.Reviews, expected) {
		r.fail("%s\n  reviews are %+v, want %+v", description, c.Reviews, expected)
	}
	wantEvent := AuditEvent{Sequence: uint64(len(audit) + 1), Actor: acting, Operation: "review.decided", TargetID: target, Outcome: string(status), At: listFilterEpoch}
	if got := c.Audit[len(audit):]; len(got) != 1 || got[0] != wantEvent {
		r.fail("%s\n  audit events %+v, want %+v", description, got, wantEvent)
	}
	if approve && slices.ContainsFunc(reviews, func(v Review) bool { return v.RevisionID == current && v.Status == ReviewStale }) {
		r.stats.approvedAfterSupersede++
	}
	return description
}

// check asserts the invariants that must hold after every step, whether it succeeded or was refused.
func (r *listFilterReviewRun) check() {
	c := r.c
	lifecycle := c.Lifecycle()
	if !lifecycle.Valid() || lifecycle == LifecycleMerged {
		r.fail("Lifecycle() = %q", lifecycle)
	}
	// ADR-003: the status the server reports and the merge gate it enforces must agree.
	if mergeErr := c.ValidateMerge(); (lifecycle == LifecycleReadyToMerge) != (mergeErr == nil) {
		r.fail("Lifecycle() = %q but ValidateMerge() = %v", lifecycle, mergeErr)
	}
	current := c.currentRevisionID()
	for i, review := range c.Reviews {
		active := review.Status == ReviewPending || review.Status == ReviewApproved
		for _, later := range c.Reviews[i+1:] {
			if later.RevisionID != review.RevisionID {
				continue
			}
			if review.Status == ReviewApproved {
				r.fail("review %s is approved but review %s was added after it on revision %s", review.ID, later.ID, review.RevisionID)
			}
			if active && (later.Status == ReviewPending || later.Status == ReviewApproved) {
				r.fail("reviews %s and %s are both active on revision %s", review.ID, later.ID, review.RevisionID)
			}
		}
		// On the current revision a review only goes stale by being superseded by a later one.
		if review.Status == ReviewStale && review.RevisionID == current {
			later := slices.ContainsFunc(c.Reviews[i+1:], func(v Review) bool { return v.RevisionID == current })
			recorded := slices.ContainsFunc(c.Audit, func(e AuditEvent) bool {
				return e.Operation == "review.superseded" && e.TargetID == review.ID && e.Outcome == "stale"
			})
			if !later || !recorded {
				r.fail("review %s is stale on the current revision without a later review (%v) or a review.superseded event (%v)", review.ID, later, recorded)
			}
		}
	}
	r.stats.lifecycles[lifecycle]++
}

func TestRandomizedReviewSequencesKeepTheStatusAndTheMergeGateInStep(t *testing.T) {
	const sequences = 20000
	stats := &listFilterReviewStats{lifecycles: map[Lifecycle]int{}}
	rng := rand.New(rand.NewPCG(20261118, 1))
	for sequence := 0; sequence < sequences; sequence++ {
		c, err := NewChangeset("cs-random", "org/repo", "Random sequence", "author", listFilterEpoch)
		listFilterMust(t, err)
		run := &listFilterReviewRun{t: t, rng: rng, c: c, sequence: sequence, stats: stats}
		for steps := 1 + rng.IntN(40); steps > 0; steps-- {
			run.step()
		}
	}
	t.Logf("%d sequences, %d steps; lifecycles %v; refused after approval %d, superseded %d, reassigned after rejection %d, decision refused as stale %d, approved after supersede %d",
		sequences, stats.steps, stats.lifecycles, stats.refusedAfterApproval, stats.superseded, stats.reassignedAfterReject, stats.decideRefusedAsStale, stats.approvedAfterSupersede)

	// The run must really visit the interesting states: each floor is about a tenth of what this
	// seed produces, so a generator that stops reaching them fails here instead of passing vacuously.
	for _, lifecycle := range []Lifecycle{LifecycleDraft, LifecycleEvaluationPending, LifecycleEvaluationFailed, LifecycleEvidenceRequired,
		LifecycleReviewRequired, LifecycleInReview, LifecycleChangesRequested, LifecycleReadyToMerge} {
		if got := stats.lifecycles[lifecycle]; got < 5000 {
			t.Errorf("only %d steps ended in %s, want at least 5000", got, lifecycle)
		}
	}
	for _, floor := range []struct {
		name     string
		got, min int
	}{
		{"assignments refused after an approval", stats.refusedAfterApproval, 1000},
		{"assignments that superseded a pending review", stats.superseded, 1000},
		{"assignments right after a rejection", stats.reassignedAfterReject, 500},
		{"decisions refused on a superseded review", stats.decideRefusedAsStale, 300},
		{"approvals on a revision with a superseded review", stats.approvedAfterSupersede, 400},
	} {
		if floor.got < floor.min {
			t.Errorf("only %d %s, want at least %d", floor.got, floor.name, floor.min)
		}
	}
}
