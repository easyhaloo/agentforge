package execution

import (
	"context"
	"encoding/json"
	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

type QueueEntry struct {
	ID           int64  `json:"id"`
	Repository   string `json:"repository"`
	Target       string `json:"target"`
	Source       string `json:"source"`
	SourceSHA    string `json:"sourceSHA"`
	Status       string `json:"status"`
	RunID        string `json:"runId,omitempty"`
	CandidateSHA string `json:"candidateSHA,omitempty"`
}

type QueueStore interface {
	Enqueue(context.Context, string, string, int, string, map[string]json.RawMessage, Integration) (QueueEntry, error)
	ListQueue(context.Context, string, string, string) ([]QueueEntry, error)
	CancelQueueEntry(context.Context, string, int64, string) error
}

type TrainProvider interface {
	PrepareCandidate(context.Context, string, string, delivery.MergeRequest) (delivery.MergePreview, error)
	ResolveRevision(context.Context, string, string, string) (delivery.GitRevision, error)
}
