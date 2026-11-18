package httpserver

import (
	"errors"
	"net/http"
	"sort"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/workspace"
)

type workspaceTreeEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Kind    string `json:"kind"`
	Source  string `json:"source"`
	Version int64  `json:"version,omitempty"`
}

func (d DeliveryDependencies) listWorkspaceTree(w http.ResponseWriter, r *http.Request) {
	item, principal, ok := d.getWorkspace(w, r)
	if !ok {
		return
	}
	if d.Preview == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Repository preview unavailable", "The Git preview reader is not configured")
		return
	}
	directory := strings.TrimSpace(r.URL.Query().Get("path"))
	if directory != "" && !workspace.ValidPath(directory) {
		writeProblem(w, http.StatusBadRequest, "Invalid directory", "A safe relative directory path is required")
		return
	}
	base, err := d.Preview.ListTree(r.Context(), principal.OrganizationID, item.Repository, item.BaseCommitSHA, directory)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Workspace directory unavailable", "The directory does not exist at the pinned base commit")
		return
	}
	overlays, err := d.Workspaces.ListWorkspaceFiles(r.Context(), principal.OrganizationID, item.ID)
	if errors.Is(err, workspace.ErrTooLarge) {
		writeProblem(w, http.StatusRequestEntityTooLarge, "Workspace tree too large", "The workspace contains more than 2000 overlay files")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Workspace tree unavailable", "Workspace file metadata could not be listed")
		return
	}
	entries, err := mergeWorkspaceTreeEntries(base, overlays, directory)
	if errors.Is(err, workspace.ErrInvalidInput) {
		writeProblem(w, http.StatusConflict, "Workspace path conflict", "A workspace file conflicts with a file or directory at the pinned base commit")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Workspace tree unavailable", "The workspace tree could not be combined")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"workspace_id": item.ID, "base_commit_sha": item.BaseCommitSHA, "path": directory, "items": entries})
}

// mergeWorkspaceTreeEntries combines a pinned base tree with workspace overlays.
// It rejects file/directory collisions rather than silently hiding one side.
func mergeWorkspaceTreeEntries(base []delivery.PreviewEntry, overlays []workspace.FileEntry, directory string) ([]workspaceTreeEntry, error) {
	entries := make(map[string]workspaceTreeEntry, len(base))
	for _, entry := range base {
		if entry.Name == "" || (entry.Kind != "tree" && entry.Kind != "file" && entry.Kind != "symlink") {
			return nil, workspace.ErrInvalidInput
		}
		if _, exists := entries[entry.Name]; exists {
			return nil, workspace.ErrInvalidInput
		}
		entries[entry.Name] = workspaceTreeEntry{Name: entry.Name, Path: entry.Path, Kind: entry.Kind, Source: "base"}
	}

	prefix := ""
	if directory != "" {
		prefix = directory + "/"
	}
	for _, overlay := range overlays {
		if !workspace.ValidPath(overlay.Path) {
			return nil, workspace.ErrInvalidInput
		}
		if !strings.HasPrefix(overlay.Path, prefix) {
			continue
		}
		remainder := strings.TrimPrefix(overlay.Path, prefix)
		if remainder == "" {
			continue
		}
		parts := strings.SplitN(remainder, "/", 2)
		name := parts[0]
		entryPath := name
		if prefix != "" {
			entryPath = strings.TrimSuffix(prefix, "/") + "/" + name
		}
		kind := "file"
		if len(parts) == 2 {
			kind = "tree"
		}
		existing, exists := entries[name]
		if exists {
			if existing.Kind != kind && !(existing.Kind == "symlink" && kind == "file") {
				return nil, workspace.ErrInvalidInput
			}
			if kind == "tree" {
				// Keep the base directory metadata, but mark it as containing edits.
				existing.Source = "workspace"
				entries[name] = existing
				continue
			}
		}
		entries[name] = workspaceTreeEntry{Name: name, Path: entryPath, Kind: kind, Source: "workspace", Version: overlay.Version}
	}

	result := make([]workspaceTreeEntry, 0, len(entries))
	for _, entry := range entries {
		result = append(result, entry)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	return result, nil
}
