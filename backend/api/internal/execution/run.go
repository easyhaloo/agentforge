// Package execution owns durable runs of published workflow versions.
package execution

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

var ErrInputs = errors.New("invalid run inputs")
var ErrQuota = errors.New("active run quota reached")

type Run struct {
	ID         string                     `json:"id"`
	PipelineID string                     `json:"pipelineId"`
	Version    int                        `json:"version"`
	ActorID    string                     `json:"actorId"`
	Status     string                     `json:"status"`
	Inputs     map[string]json.RawMessage `json:"inputs"`
	CreatedAt  time.Time                  `json:"createdAt"`
	Deadline   time.Time                  `json:"deadline"`
}

type Store interface {
	CreateRun(context.Context, string, string, int, string, map[string]json.RawMessage) (Run, error)
	GetRun(context.Context, string, string) (Run, error)
	Events(context.Context, string, string, int64) ([]Event, error)
	DecideRun(context.Context, string, string, string, string, string) error
}

type Task struct {
	RunID      string
	StepID     string
	WorkerID   string
	Attempt    int
	Capability string
	Deadline   time.Time
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
