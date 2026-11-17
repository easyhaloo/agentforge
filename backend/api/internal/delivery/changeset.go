package delivery

import (
	"errors"
	"fmt"
	"time"
)

type ID string
type Status string

const (
	EvaluationPending Status = "pending"
	EvaluationPassed  Status = "passed"
	EvaluationFailed  Status = "failed"
	EvidenceActive    Status = "active"
	EvidenceStale     Status = "stale"
	ReviewPending     Status = "pending"
	ReviewApproved    Status = "approved"
	ReviewRejected    Status = "rejected"
	ReviewStale       Status = "stale"
	MergeCompleted    Status = "completed"
)

var (
	ErrInvalidInput       = errors.New("invalid input")
	ErrRevisionNotCurrent = errors.New("revision is not current")
	ErrEvaluationRequired = errors.New("a passed evaluation is required")
	ErrEvidenceRequired   = errors.New("active evidence is required")
	ErrReviewRequired     = errors.New("an approved review is required")
	ErrAlreadyMerged      = errors.New("changeset is already merged")
)

type Revision struct {
	ID        ID
	Ref       string
	CreatedAt time.Time
}

type Evaluation struct {
	ID         ID
	RevisionID ID
	Status     Status
	Summary    string
	CreatedAt  time.Time
}

type Evidence struct {
	ID           ID
	RevisionID   ID
	EvaluationID ID
	Kind         string
	URI          string
	Status       Status
	CreatedAt    time.Time
}

type Review struct {
	ID         ID
	RevisionID ID
	Reviewer   string
	Status     Status
	Comment    string
	CreatedAt  time.Time
}

type Merge struct {
	ID         ID
	RevisionID ID
	Actor      string
	TargetRef  string
	CommitSHA  string
	CreatedAt  time.Time
}

type AuditEvent struct {
	Sequence  uint64
	Actor     string
	Operation string
	TargetID  ID
	Outcome   string
	At        time.Time
}

type Changeset struct {
	ID          ID
	Repository  string
	Title       string
	Revisions   []Revision
	Evaluations []Evaluation
	Evidence    []Evidence
	Reviews     []Review
	Merge       *Merge
	Audit       []AuditEvent
}

func NewChangeset(id ID, repository, title, actor string, now time.Time) (*Changeset, error) {
	if id == "" || repository == "" || title == "" || actor == "" {
		return nil, ErrInvalidInput
	}
	c := &Changeset{ID: id, Repository: repository, Title: title}
	c.record(actor, "changeset.created", id, "succeeded", now)
	return c, nil
}

func (c *Changeset) CurrentRevision() (Revision, bool) {
	if len(c.Revisions) == 0 {
		return Revision{}, false
	}
	return c.Revisions[len(c.Revisions)-1], true
}

func (c *Changeset) AddRevision(id ID, ref, actor string, now time.Time) error {
	if c == nil || id == "" || ref == "" || actor == "" || c.Merge != nil {
		return ErrInvalidInput
	}
	for _, revision := range c.Revisions {
		if revision.ID == id {
			return fmt.Errorf("%w: duplicate revision id", ErrInvalidInput)
		}
	}
	c.Revisions = append(c.Revisions, Revision{ID: id, Ref: ref, CreatedAt: now})
	for i := range c.Evidence {
		if c.Evidence[i].Status == EvidenceActive {
			c.Evidence[i].Status = EvidenceStale
		}
	}
	for i := range c.Reviews {
		if c.Reviews[i].Status == ReviewPending || c.Reviews[i].Status == ReviewApproved {
			c.Reviews[i].Status = ReviewStale
		}
	}
	c.record(actor, "revision.created", id, "succeeded", now)
	return nil
}

func (c *Changeset) RecordEvaluation(id, revisionID ID, status Status, summary, actor string, now time.Time) error {
	if c == nil || id == "" || actor == "" || (status != EvaluationPassed && status != EvaluationFailed) {
		return ErrInvalidInput
	}
	if err := c.requireCurrent(revisionID); err != nil {
		return err
	}
	for _, evaluation := range c.Evaluations {
		if evaluation.ID == id {
			return ErrInvalidInput
		}
	}
	c.Evaluations = append(c.Evaluations, Evaluation{ID: id, RevisionID: revisionID, Status: status, Summary: summary, CreatedAt: now})
	c.record(actor, "evaluation.recorded", id, "succeeded", now)
	return nil
}

func (c *Changeset) AttachEvidence(id, revisionID, evaluationID ID, kind, uri, actor string, now time.Time) error {
	if c == nil || id == "" || kind == "" || uri == "" || actor == "" {
		return ErrInvalidInput
	}
	if err := c.requireCurrent(revisionID); err != nil {
		return err
	}
	evaluation, ok := c.evaluation(evaluationID)
	if !ok || evaluation.RevisionID != revisionID || evaluation.Status != EvaluationPassed {
		return ErrEvaluationRequired
	}
	c.Evidence = append(c.Evidence, Evidence{ID: id, RevisionID: revisionID, EvaluationID: evaluationID, Kind: kind, URI: uri, Status: EvidenceActive, CreatedAt: now})
	c.record(actor, "evidence.attached", id, "succeeded", now)
	return nil
}

func (c *Changeset) SubmitReview(id, revisionID ID, reviewer, comment string, now time.Time) error {
	if c == nil || id == "" || reviewer == "" {
		return ErrInvalidInput
	}
	if err := c.requireCurrent(revisionID); err != nil {
		return err
	}
	if !c.hasActiveEvidence(revisionID) {
		return ErrEvidenceRequired
	}
	for _, review := range c.Reviews {
		if review.ID == id {
			return ErrInvalidInput
		}
	}
	c.Reviews = append(c.Reviews, Review{ID: id, RevisionID: revisionID, Reviewer: reviewer, Status: ReviewPending, Comment: comment, CreatedAt: now})
	c.record(reviewer, "review.submitted", id, "succeeded", now)
	return nil
}

func (c *Changeset) DecideReview(id ID, approved bool, reviewer, comment string, now time.Time) error {
	if c == nil || reviewer == "" {
		return ErrInvalidInput
	}
	for i := range c.Reviews {
		review := &c.Reviews[i]
		if review.ID != id {
			continue
		}
		if review.RevisionID != c.currentRevisionID() || review.Status != ReviewPending {
			return ErrRevisionNotCurrent
		}
		if review.Reviewer != reviewer {
			return ErrInvalidInput
		}
		if approved {
			review.Status = ReviewApproved
		} else {
			review.Status = ReviewRejected
		}
		review.Comment = comment
		c.record(reviewer, "review.decided", id, string(review.Status), now)
		return nil
	}
	return ErrInvalidInput
}

func (c *Changeset) CompleteMerge(id ID, actor, targetRef, commitSHA string, now time.Time) error {
	if c == nil || id == "" || actor == "" || targetRef == "" || commitSHA == "" {
		return ErrInvalidInput
	}
	if c.Merge != nil {
		return ErrAlreadyMerged
	}
	revisionID := c.currentRevisionID()
	if revisionID == "" {
		return ErrRevisionNotCurrent
	}
	if !c.hasActiveEvidence(revisionID) {
		return ErrEvidenceRequired
	}
	if !c.hasApprovedReview(revisionID) {
		return ErrReviewRequired
	}
	c.Merge = &Merge{ID: id, RevisionID: revisionID, Actor: actor, TargetRef: targetRef, CommitSHA: commitSHA, CreatedAt: now}
	c.record(actor, "merge.completed", id, "succeeded", now)
	return nil
}

func (c *Changeset) requireCurrent(revisionID ID) error {
	if revisionID == "" || revisionID != c.currentRevisionID() {
		return ErrRevisionNotCurrent
	}
	return nil
}

func (c *Changeset) currentRevisionID() ID {
	revision, ok := c.CurrentRevision()
	if !ok {
		return ""
	}
	return revision.ID
}

func (c *Changeset) evaluation(id ID) (Evaluation, bool) {
	for _, evaluation := range c.Evaluations {
		if evaluation.ID == id {
			return evaluation, true
		}
	}
	return Evaluation{}, false
}

func (c *Changeset) hasActiveEvidence(revisionID ID) bool {
	for _, evidence := range c.Evidence {
		if evidence.RevisionID == revisionID && evidence.Status == EvidenceActive {
			return true
		}
	}
	return false
}

func (c *Changeset) hasApprovedReview(revisionID ID) bool {
	for _, review := range c.Reviews {
		if review.RevisionID == revisionID && review.Status == ReviewApproved {
			return true
		}
	}
	return false
}

func (c *Changeset) record(actor, operation string, target ID, outcome string, now time.Time) {
	c.Audit = append(c.Audit, AuditEvent{Sequence: uint64(len(c.Audit) + 1), Actor: actor, Operation: operation, TargetID: target, Outcome: outcome, At: now})
}
