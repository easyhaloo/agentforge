package httpserver

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

func TestWorkspaceDiffStatus(t *testing.T) {
	tests := []struct {
		name        string
		readErr     error
		blobSHA     string
		base        []byte
		workspace   string
		wantStatus  string
		wantChanged bool
		wantSHA     string
		wantErr     bool
	}{
		{name: "modified base file", blobSHA: "base-blob", base: []byte("base"), workspace: "different", wantStatus: "modified", wantSHA: "base-blob", wantChanged: true},
		{name: "unchanged base file", blobSHA: "base-blob", base: []byte("same"), workspace: func() string { sum := sha256.Sum256([]byte("same")); return hex.EncodeToString(sum[:]) }(), wantSHA: "base-blob"},
		{name: "new workspace file", readErr: delivery.ErrRepositoryInvalid, wantStatus: "added", wantChanged: true},
		{name: "base file exceeds editor bound", readErr: delivery.ErrPreviewTooLarge, wantStatus: "modified", wantChanged: true},
		{name: "repository read failure", readErr: errors.New("storage unavailable"), wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, sha, changed, err := workspaceDiffStatus(tt.readErr, tt.base, tt.blobSHA, tt.workspace)
			if (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
			if status != tt.wantStatus || sha != tt.wantSHA || changed != tt.wantChanged {
				t.Fatalf("got (%q, %q, %v), want (%q, %q, %v)", status, sha, changed, tt.wantStatus, tt.wantSHA, tt.wantChanged)
			}
		})
	}
}
