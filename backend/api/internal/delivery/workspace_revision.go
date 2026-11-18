package delivery

import (
	"context"
	"errors"
)

var ErrWorkspaceRevisionUnavailable = errors.New("workspace revision creation is unavailable")

// WorkspaceRevisionFile is a saved text-file overlay to apply to an immutable base commit.
type WorkspaceRevisionFile struct {
	Path    string
	Content []byte
}

// WorkspaceRevisionCreator materializes a bounded workspace overlay as an immutable Git commit.
// Implementations must create a durable, immutable ref without moving a user branch.
type WorkspaceRevisionCreator interface {
	CreateWorkspaceRevision(context.Context, string, string, string, string, string, []WorkspaceRevisionFile) (GitRevision, error)
}
