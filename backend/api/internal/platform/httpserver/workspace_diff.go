package httpserver

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/workspace"
)

type workspaceDiffEntry struct {
	Path          string `json:"path"`
	Status        string `json:"status"`
	BaseBlobSHA   string `json:"base_blob_sha,omitempty"`
	WorkspaceSHA  string `json:"workspace_sha256"`
	Version       int64  `json:"version"`
}

func workspaceDiffStatus(readErr error, baseContent []byte, baseBlobSHA, workspaceSHA string) (string, string, bool, error) {
	switch {
	case readErr == nil:
		digest := sha256.Sum256(baseContent)
		if hex.EncodeToString(digest[:]) == workspaceSHA {
			return "", baseBlobSHA, false, nil
		}
		return "modified", baseBlobSHA, true, nil
	case errors.Is(readErr, delivery.ErrRepositoryInvalid):
		return "added", "", true, nil
	case errors.Is(readErr, delivery.ErrPreviewTooLarge):
		return "modified", "", true, nil
	default:
		return "", "", false, readErr
	}
}

func (d DeliveryDependencies) getWorkspaceDiff(w http.ResponseWriter, r *http.Request) {
	item, principal, ok := d.getWorkspace(w, r)
	if !ok {
		return
	}
	if d.Preview == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Repository preview unavailable", "The Git preview reader is not configured")
		return
	}
	diffContext, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	files, err := d.Workspaces.ListWorkspaceFiles(diffContext, principal.OrganizationID, item.ID)
	if errors.Is(err, workspace.ErrTooLarge) {
		writeProblem(w, http.StatusRequestEntityTooLarge, "Workspace diff too large", "The workspace contains more than 2000 overlay files")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Workspace diff unavailable", "Workspace file metadata could not be listed")
		return
	}
	entries := make([]workspaceDiffEntry, 0, len(files))
	for _, file := range files {
		baseContent, baseBlobSHA, readErr := d.Preview.ReadBlob(diffContext, principal.OrganizationID, item.Repository, item.BaseCommitSHA, file.Path, workspace.MaxFileBytes)
		entry := workspaceDiffEntry{Path: file.Path, Status: "modified", WorkspaceSHA: file.SHA256, Version: file.Version}
		status, baseSHA, changed, statusErr := workspaceDiffStatus(readErr, baseContent, baseBlobSHA, file.SHA256)
		if statusErr != nil {
			writeProblem(w, http.StatusInternalServerError, "Workspace diff unavailable", "A base file could not be compared safely")
			return
		}
		if !changed {
			continue
		}
		entry.Status = status
		entry.BaseBlobSHA = baseSHA
		entries = append(entries, entry)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"workspace_id": item.ID,
		"base_commit_sha": item.BaseCommitSHA,
		"items": entries,
		"total": len(entries),
	})
}
