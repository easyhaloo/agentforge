package httpserver

import (
	"net/http"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/workspace"
)

type createWorkspaceChangesetRequest struct {
	Title string `json:"title"`
}

func (d DeliveryDependencies) createWorkspaceChangeset(w http.ResponseWriter, r *http.Request) {
	item, principal, ok := d.getWorkspace(w, r)
	if !ok {
		return
	}
	if item.Status != workspace.StatusActive || !item.ExpiresAt.After(time.Now()) {
		writeProblem(w, http.StatusGone, "Workspace unavailable", "Only active workspaces can be submitted as changesets")
		return
	}
	if principal.Role == "viewer" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Viewers cannot submit workspace changes")
		return
	}
	if d.Repository == nil || d.Git == nil || d.Workspaces == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Changeset handoff unavailable", "Delivery storage, workspace storage and Git are required")
		return
	}
	creator, ok := d.Git.(delivery.WorkspaceRevisionCreator)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "Changeset handoff unavailable", "The configured Git provider cannot materialize workspace revisions")
		return
	}
	var input createWorkspaceChangesetRequest
	if !decodeWorkspaceJSON(w, r, &input) {
		return
	}
	title := strings.TrimSpace(input.Title)
	if title == "" || len(title) > 200 {
		writeProblem(w, http.StatusBadRequest, "Invalid changeset title", "A title between 1 and 200 characters is required")
		return
	}
	entries, err := d.Workspaces.ListWorkspaceFiles(r.Context(), principal.OrganizationID, item.ID)
	if err != nil {
		if err == workspace.ErrTooLarge {
			writeProblem(w, http.StatusRequestEntityTooLarge, "Workspace too large", "A workspace may contain at most 2,000 overlay files")
			return
		}
		writeProblem(w, http.StatusInternalServerError, "Workspace files unavailable", "The saved workspace overlay could not be listed")
		return
	}
	if len(entries) == 0 {
		writeProblem(w, http.StatusUnprocessableEntity, "No workspace changes", "Save at least one file before creating a changeset")
		return
	}
	files := make([]delivery.WorkspaceRevisionFile, 0, len(entries))
	var totalBytes int
	for _, entry := range entries {
		file, err := d.Workspaces.GetWorkspaceFile(r.Context(), principal.OrganizationID, item.ID, entry.Path)
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, "Workspace files unavailable", "A saved workspace file could not be loaded")
			return
		}
		totalBytes += len(file.Content)
		if totalBytes > 32<<20 {
			writeProblem(w, http.StatusRequestEntityTooLarge, "Workspace too large", "The combined saved overlay may not exceed 32 MiB")
			return
		}
		files = append(files, delivery.WorkspaceRevisionFile{Path: file.Path, Content: file.Content})
	}
	changesetID, err := newID()
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Changeset creation failed", "A changeset identifier could not be generated")
		return
	}
	revisionID, err := newID()
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Changeset creation failed", "A revision identifier could not be generated")
		return
	}
	revision, err := creator.CreateWorkspaceRevision(r.Context(), principal.OrganizationID, item.Repository,
		item.BaseCommitSHA, changesetID, revisionID, principal.UserID, files)
	if err != nil {
		writeProblem(w, http.StatusUnprocessableEntity, "Workspace revision failed", "The saved overlay could not be materialized on its immutable base commit")
		return
	}
	now := time.Now().UTC()
	changeset, err := delivery.NewChangeset(delivery.ID(changesetID), item.Repository, title, principal.UserID, now)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Changeset creation failed", "The changeset metadata was invalid")
		return
	}
	if err := changeset.AddGitRevision(delivery.ID(revisionID), revision.Ref, revision.CommitSHA, revision.ParentSHA, principal.UserID, now); err != nil {
		writeProblem(w, http.StatusInternalServerError, "Changeset creation failed", "The immutable revision could not be attached to the changeset")
		return
	}
	stored, err := d.Repository.Create(r.Context(), principal.OrganizationID, changeset)
	if err != nil {
		// The immutable ref is intentionally left intact for later reconciliation; no user branch is moved.
		writeProblem(w, http.StatusInternalServerError, "Changeset persistence failed", "The Git revision was created but its changeset record could not be persisted; retry with a new submission")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"changeset": toChangesetResponse(stored),
		"workspace_id": item.ID,
		"base_commit_sha": item.BaseCommitSHA,
		"revision_commit_sha": revision.CommitSHA,
	})
}
