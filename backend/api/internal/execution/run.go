// Package execution owns durable runs of published workflow versions.
package execution

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

var ErrInputs = errors.New("invalid run inputs")
var ErrQuota = errors.New("active run quota reached")

type Webhook struct {
	Ref          string `json:"ref,omitempty"`
	Hook         string `json:"hook"`
	Delivery     string `json:"delivery"`
	Digest       string `json:"digest"`
	RepositoryID int64  `json:"repositoryId"`
	Event        string `json:"event"`
	SHA          string `json:"sha"`
}

var ErrTriggerDenied = errors.New("webhook trigger denied")

type Integration struct {
	QueueEntry int64  `json:"queueEntry,omitempty"`
	Repository string `json:"repository"`
	Strategy   string `json:"strategy"`
	delivery.MergePreview
}

type TriggerSource struct {
	Kind        string     `json:"kind"`
	BindingID   string     `json:"bindingId"`
	ScheduledAt *time.Time `json:"scheduledAt,omitempty"`
	Repository  string     `json:"repository,omitempty"`
	ChangesetID string     `json:"changesetId,omitempty"`
	RevisionID  string     `json:"revisionId,omitempty"`
	SHA         string     `json:"sha,omitempty"`
}

type Run struct {
	StepStatuses map[string]string          `json:"stepStatuses,omitempty"`
	Trigger      *TriggerSource             `json:"trigger,omitempty"`
	Integration  *Integration               `json:"integration,omitempty"`
	Webhook      *Webhook                   `json:"webhook,omitempty"`
	ID           string                     `json:"id"`
	PipelineID   string                     `json:"pipelineId"`
	Version      int                        `json:"version"`
	ActorID      string                     `json:"actorId"`
	Status       string                     `json:"status"`
	Inputs       map[string]json.RawMessage `json:"inputs"`
	CreatedAt    time.Time                  `json:"createdAt"`
	Deadline     time.Time                  `json:"deadline"`
}

type PromotionProvider interface {
	CandidateCommits(context.Context, string, string, delivery.MergePreview) ([]string, error)
	PromoteCandidate(context.Context, string, string, string, delivery.MergePreview) error
}

type Store interface {
	PromoteIntegration(context.Context, string, string, string, string, PromotionProvider) error
	CreateIntegrationRun(context.Context, string, string, int, string, map[string]json.RawMessage, Integration) (Run, error)
	TriggerRun(context.Context, string, string, int, string, Webhook) (Run, error)
	CreateRun(context.Context, string, string, int, string, map[string]json.RawMessage) (Run, error)
	GetRun(context.Context, string, string) (Run, error)
	Events(context.Context, string, string, int64) ([]Event, error)
	DecideRun(context.Context, string, string, string, string, string) error
}

type Task struct {
	Integration    *Integration
	OrganizationID string
	PipelineID     string
	SecretRefs     map[string]string
	RunID          string
	StepID         string
	WorkerID       string
	Attempt        int
	Capability     string
	Deadline       time.Time
}

var ErrLease = errors.New("task lease lost")

type Event struct {
	Seq       int64     `json:"seq"`
	CreatedAt time.Time `json:"createdAt"`
	Message   *string   `json:"message,omitempty"`
	Kind      string    `json:"kind"`
	StepID    *string   `json:"stepId,omitempty"`
	Actor     string    `json:"actor"`
}
