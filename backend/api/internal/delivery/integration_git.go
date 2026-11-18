package delivery

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"time"
)

// IntegrationGitProvider is the candidate lifecycle shared by the API, worker and offline pruning tool.
type IntegrationGitProvider interface {
	GitProvider
	MergePreviewProvider
	PrepareCandidate(context.Context, string, string, MergeRequest) (MergePreview, error)
	CheckoutCandidate(context.Context, string, string, string) (string, func(), error)
	CandidateCommits(context.Context, string, string, MergePreview) ([]string, error)
	PromoteCandidate(context.Context, string, string, string, MergePreview) error
	HasPromotion(context.Context, string, string, string, string) (bool, error)
	DeleteCandidate(context.Context, string, string, string) error
}

// LoadIntegrationGit selects the operator's remote bindings or, when unset, local Git storage.
func LoadIntegrationGit(bindingsFile, localRoot string, timeout time.Duration) (IntegrationGitProvider, error) {
	if bindingsFile == "" {
		p, err := NewLocalGitProvider(localRoot, timeout)
		if err != nil {
			return nil, err
		}
		return p, nil
	}
	f, err := os.Open(bindingsFile)
	if err != nil {
		return nil, ErrProviderUnavailable
	}
	defer f.Close()
	const maxSize = 1 << 20
	data, err := io.ReadAll(io.LimitReader(f, maxSize+1))
	if err != nil {
		return nil, ErrProviderUnavailable
	}
	if len(data) > maxSize {
		return nil, ErrRepositoryInvalid
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	var bindings []RemoteGitRepository
	if err = d.Decode(&bindings); err != nil || d.Decode(new(json.RawMessage)) != io.EOF {
		return nil, ErrRepositoryInvalid
	}
	p, err := NewRemoteGitProvider(bindings, timeout)
	if err != nil {
		return nil, err
	}
	return p, nil
}
