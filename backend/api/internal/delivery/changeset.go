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
	ID        ID        `json:"id"`
	Ref       string    `json:"ref"`
	CommitSHA string    `json:"commit_sha"`
	ParentSHA string    `json:"parent_sha,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type Evaluation struct {
	ID         ID        `json:"id"`
	RevisionID ID        `json:"revision_id"`
	Status     Status    `json:"status"`
	Summary    string    `json:"summary"`
	CreatedAt  time.Time `json:"created_at"`
}

type Evidence struct {
	ID           ID        `json:"id"`
	RevisionID   ID        `json:"revision_id"`
	EvaluationID ID        `json:"evaluation_id"`
	Kind         string    `json:"kind"`
	URI          string    `json:"uri"`
	SHA256       string    `json:"sha256,omitempty"`
	Size         int64     `json:"size,omitempty"`
	Status       Status    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
}

type Review struct {
	ID         ID        `json:"id"`
	RevisionID ID        `json:"revision_id"`
	Reviewer   string    `json:"reviewer"`
	Status     Status    `json:"status"`
	Comment    string    `json:"comment"`
	CreatedAt  time.Time `json:"created_at"`
}

type Merge struct {
	ID         ID        `json:"id"`
	RevisionID ID        `json:"revision_id"`
	Actor      string    `json:"actor"`
	TargetRef  string    `json:"target_ref"`
	CommitSHA  string    `json:"commit_sha"`
	CreatedAt  time.Time `json:"created_at"`
}

type AuditEvent struct {
	Sequence  uint64    `json:"sequence"`
	Actor     string    `json:"actor"`
	Operation string    `json:"operation"`
	TargetID  ID        `json:"target_id"`
	Outcome   string    `json:"outcome"`
	At        time.Time `json:"at"`
}

type Changeset struct {
	ID          ID          `json:"id"`
	CreatedBy   string      `json:"created_by"`
	Repository  string      `json:"repository"`
	Title       string      `json:"title"`
	Revisions   []Revision  `json:"revisions"`
	Evaluations []Evaluation `json:"evaluations"`
	Evidence    []Evidence  `json:"evidence"`
	Reviews     []Review    `json:"reviews"`
	Merge       *Merge      `json:"merge,omitempty"`
	Audit       []AuditEvent `json:"audit"`
}

func NewChangeset(id ID, repository, title, actor string, now time.Time) (*Changeset, error) {
	if id == "" || repository == "" || title == "" || actor == "" {
		return nil, ErrInvalidInput
	}
	c := &Changeset{ID: id, CreatedBy: actor, Repository: repository, Title: title}
	c.record(actor, "changeset.created", id, "succeeded", now)
	return c, nil
}

func (c *Changeset) CurrentRevision() (Revision, bool) {
	if len(c.Revisions) == 0 {
		return Revision{}, false
	}
	return c.Revisions[len(c.Revisions)-1], true
}

func (c *Changeset) AddRevision(id ID, ref, actor string, now time.Time) error { return c.AddGitRevision(id, ref, ref, "", actor, now) }

func (c *Changeset) AddGitRevision(id ID, ref, commitSHA, parentSHA, actor string, now time.Time) error {
	if c == nil || id == "" || ref == "" || actor == "" || c.Merge != nil {
		return ErrInvalidInput
	}
	for _, revision := range c.Revisions {
		if revision.ID == id {
			return fmt.Errorf("%w: duplicate revision id", ErrInvalidInput)
		}
	}
	c.Revisions = append(c.Revisions, Revision{ID: id, Ref: ref, CommitSHA: commitSHA, ParentSHA: parentSHA, CreatedAt: now})
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

func (c *Changeset) AttachEvidence(id, revisionID, evaluationID ID, kind, uri, actor string, now time.Time) error { return c.AttachEvidenceArtifact(id, revisionID, evaluationID, kind, uri, "", 0, actor, now) }

func (c *Changeset) AttachEvidenceArtifact(id, revisionID, evaluationID ID, kind, uri, digest string, size int64, actor string, now time.Time) error {
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
	c.Evidence = append(c.Evidence, Evidence{ID: id, RevisionID: revisionID, EvaluationID: evaluationID, Kind: kind, URI: uri, SHA256: digest, Size: size, Status: EvidenceActive, CreatedAt: now})
	c.record(actor, "evidence.attached", id, "succeeded", now)
	return nil
}

func (c *Changeset) SubmitReview(id, revisionID ID, reviewer, comment string, now time.Time) error { return c.AssignReview(id, revisionID, reviewer, reviewer, comment, now) }

func (c *Changeset) AssignReview(id, revisionID ID, reviewer, actor, comment string, now time.Time) error {
	if c == nil || id == "" || reviewer == "" || actor == "" || reviewer == c.CreatedBy {
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
	c.record(actor, "review.assigned", id, "succeeded", now)
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
	if !c.hasPassedEvaluation(revisionID) {
		return ErrEvaluationRequired
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

func (c *Changeset) hasPassedEvaluation(revisionID ID) bool {
	for _, evaluation := range c.Evaluations {
		if evaluation.RevisionID == revisionID && evaluation.Status == EvaluationPassed { return true }
	}
	return false
}
