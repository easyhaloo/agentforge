package httpserver

import (
	"errors"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

func TestWorkspaceDiffStatus(t *testing.T) {
	tests := []struct {
		name       string
		readErr    error
		blobSHA    string
		wantStatus string
		wantSHA    string
		wantErr    bool
	}{
		{name: "existing base file", blobSHA: "base-blob", wantStatus: "modified", wantSHA: "base-blob"},
		{name: "new workspace file", readErr: delivery.ErrRepositoryInvalid, wantStatus: "added"},
		{name: "base file exceeds editor bound", readErr: delivery.ErrPreviewTooLarge, wantStatus: "modified"},
		{name: "repository read failure", readErr: errors.New("storage unavailable"), wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, sha, err := workspaceDiffStatus(tt.readErr, tt.blobSHA)
			if (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
			if status != tt.wantStatus || sha != tt.wantSHA {
				t.Fatalf("got (%q, %q), want (%q, %q)", status, sha, tt.wantStatus, tt.wantSHA)
			}
		})
	}
}
