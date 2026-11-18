package httpserver

import (
	"errors"
	"net/http"

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

func (d DeliveryDependencies) getWorkspaceDiff(w http.ResponseWriter, r *http.Request) {
	item, principal, ok := d.getWorkspace(w, r)
	if !ok {
		return
	}
	if d.Preview == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Repository preview unavailable", "The Git preview reader is not configured")
		return
	}
	files, err := d.Workspaces.ListWorkspaceFiles(r.Context(), principal.OrganizationID, item.ID)
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
		_, baseBlobSHA, readErr := d.Preview.ReadBlob(r.Context(), principal.OrganizationID, item.Repository, item.BaseCommitSHA, file.Path, workspace.MaxFileBytes)
		entry := workspaceDiffEntry{Path: file.Path, Status: "modified", WorkspaceSHA: file.SHA256, Version: file.Version}
		switch {
		case readErr == nil:
			entry.BaseBlobSHA = baseBlobSHA
		case errors.Is(readErr, delivery.ErrRepositoryInvalid):
			entry.Status = "added"
		case errors.Is(readErr, delivery.ErrPreviewTooLarge):
			// The path exists at the base, but its content is outside the editor bound.
			entry.Status = "modified"
		default:
			writeProblem(w, http.StatusInternalServerError, "Workspace diff unavailable", "A base file could not be compared safely")
			return
		}
		entries = append(entries, entry)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"workspace_id": item.ID,
		"base_commit_sha": item.BaseCommitSHA,
		"items": entries,
		"total": len(entries),
	})
}
