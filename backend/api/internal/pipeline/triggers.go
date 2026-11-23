package pipeline

import "context"

type TriggerBinding struct {
	ID           string `json:"id"`
	Kind         string `json:"kind"`
	Version      int    `json:"version"`
	EverySeconds int    `json:"everySeconds,omitempty"`
}

type TriggerStore interface {
	WorkflowTriggers(ctx context.Context, org, id string) ([]TriggerBinding, error)
	EnableWorkflowTrigger(ctx context.Context, org, id, actor, kind string, version, everySeconds int) (TriggerBinding, error)
	DisableWorkflowTrigger(ctx context.Context, org, id, binding string) error
}
