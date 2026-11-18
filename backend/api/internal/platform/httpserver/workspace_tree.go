package httpserver

import (
	"net/http"
	"sort"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/workspace"
)

type workspaceTreeEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Kind string `json:"kind"`
	Source string `json:"source"`
	Version int64 `json:"version,omitempty"`
}

func (d DeliveryDependencies) listWorkspaceTree(w http.ResponseWriter, r *http.Request) {
	item, principal, ok := d.getWorkspace(w, r)
	if !ok { return }
	if d.Preview == nil { writeProblem(w, http.StatusServiceUnavailable, "Repository preview unavailable", "The Git preview reader is not configured"); return }
	directory := strings.TrimSpace(r.URL.Query().Get("path"))
	if directory != "" && !workspace.ValidPath(directory) { writeProblem(w, http.StatusBadRequest, "Invalid directory", "A safe relative directory path is required"); return }
	base, err := d.Preview.ListTree(r.Context(), principal.OrganizationID, item.Repository, item.BaseCommitSHA, directory)
	if err != nil { writeProblem(w, http.StatusNotFound, "Workspace directory unavailable", "The directory does not exist at the pinned base commit"); return }
	entries := make(map[string]workspaceTreeEntry, len(base))
	for _, entry := range base {
		entries[entry.Name] = workspaceTreeEntry{Name: entry.Name, Path: entry.Path, Kind: entry.Kind, Source: "base"}
	}
	overlays, err := d.Workspaces.ListWorkspaceFiles(r.Context(), principal.OrganizationID, item.ID)
	if err != nil { writeProblem(w, http.StatusInternalServerError, "Workspace tree unavailable", "Workspace file metadata could not be listed"); return }
	prefix := ""
	if directory != "" { prefix = directory + "/" }
	for _, overlay := range overlays {
		if !strings.HasPrefix(overlay.Path, prefix) { continue }
		remainder := strings.TrimPrefix(overlay.Path, prefix)
		if remainder == "" { continue }
		name := strings.SplitN(remainder, "/", 2)[0]
		entryPath := name
		if prefix != "" { entryPath = strings.TrimSuffix(prefix, "/") + "/" + name }
		kind := "file"
		if strings.Contains(remainder, "/") { kind = "tree" }
		existing, exists := entries[name]
		if exists && existing.Kind == "tree" { continue }
		entries[name] = workspaceTreeEntry{Name: name, Path: entryPath, Kind: kind, Source: "workspace", Version: overlay.Version}
	}
	result := make([]workspaceTreeEntry, 0, len(entries))
	for _, entry := range entries { result = append(result, entry) }
	// Stable bytewise ordering keeps the explorer deterministic across database collations.
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	writeJSON(w, http.StatusOK, map[string]any{"workspace_id": item.ID, "base_commit_sha": item.BaseCommitSHA, "path": directory, "items": result})
}

