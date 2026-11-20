package httpserver

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/workspace"
	"github.com/jackc/pgx/v5"
)

type createWorkspaceRequest struct {
	BaseRef string `json:"base_ref"`
}

type writeWorkspaceFileRequest struct {
	Path            string `json:"path"`
	Content         string `json:"content"`
	ExpectedVersion int64  `json:"expected_version"`
}

func (d DeliveryDependencies) createWorkspace(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.Workspaces == nil || d.Catalog == nil || d.Git == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Workspace unavailable", "Workspace storage, repository catalog and Git provider are required")
		return
	}
	slug := strings.TrimSpace(r.PathValue("owner")) + "/" + strings.TrimSpace(r.PathValue("repo"))
	if strings.Contains(slug, "..") || strings.ContainsAny(slug, "\x00\\") {
		writeProblem(w, http.StatusBadRequest, "Invalid repository", "A valid owner/repository path is required")
		return
	}
	repositories, err := d.Catalog.ListRepositories(r.Context(), principal.OrganizationID)
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Repository catalog unavailable", "The registered repository could not be verified")
		return
	}
	var registered *delivery.RepositoryMetadata
	for i := range repositories {
		if repositories[i].Slug == slug {
			registered = &repositories[i]
			break
		}
	}
	if registered == nil {
		writeProblem(w, http.StatusNotFound, "Repository not found", "The repository is not registered in this organization")
		return
	}
	var input createWorkspaceRequest
	if r.ContentLength > 0 && !decodeJSON(w, r, &input) {
		return
	}
	baseRef := strings.TrimSpace(input.BaseRef)
	if baseRef == "" {
		baseRef = registered.DefaultBranch
	}
	revision, err := d.Git.ResolveRevision(r.Context(), principal.OrganizationID, slug, baseRef)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Base revision not found", "The workspace base ref could not be resolved")
		return
	}
	var idBytes [16]byte
	if _, err := rand.Read(idBytes[:]); err != nil {
		writeProblem(w, http.StatusInternalServerError, "Workspace creation failed", "A workspace identifier could not be generated")
		return
	}
	now := time.Now().UTC()
	item, err := workspace.New(workspace.Workspace{
		ID: "ws_" + hex.EncodeToString(idBytes[:]), OrganizationID: principal.OrganizationID,
		Repository: slug, OwnerID: principal.UserID, BaseCommitSHA: revision.CommitSHA,
		BaseRef: baseRef, ExpiresAt: now.Add(8 * time.Hour),
	}, now)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid workspace", "The workspace parameters are invalid")
		return
	}
	created, err := d.Workspaces.CreateWorkspace(r.Context(), item)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Workspace creation failed", "The workspace could not be persisted")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"workspace": created})
}

func (d DeliveryDependencies) getWorkspace(w http.ResponseWriter, r *http.Request) (workspace.Workspace, Principal, bool) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return workspace.Workspace{}, Principal{}, false
	}
	if d.Workspaces == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Workspace unavailable", "Workspace storage is not configured")
		return workspace.Workspace{}, Principal{}, false
	}
	item, err := d.Workspaces.GetWorkspace(r.Context(), principal.OrganizationID, r.PathValue("workspaceID"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeProblem(w, http.StatusNotFound, "Workspace not found", "The workspace does not exist in this organization")
		return workspace.Workspace{}, Principal{}, false
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Workspace lookup failed", "The workspace could not be loaded")
		return workspace.Workspace{}, Principal{}, false
	}
	if item.OwnerID != principal.UserID && principal.Role != "owner" && principal.Role != "admin" {
		writeProblem(w, http.StatusForbidden, "Workspace access denied", "Only the workspace owner or organization administrators can access this workspace")
		return workspace.Workspace{}, Principal{}, false
	}
	if item.Status == workspace.StatusActive && !item.ExpiresAt.After(time.Now()) {
		writeProblem(w, http.StatusGone, "Workspace expired", "The workspace has expired and is no longer editable")
		return workspace.Workspace{}, Principal{}, false
	}
	return item, principal, true
}

func (d DeliveryDependencies) getWorkspaceHandler(w http.ResponseWriter, r *http.Request) {
	item, _, ok := d.getWorkspace(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"workspace": item})
}

func (d DeliveryDependencies) readWorkspaceFile(w http.ResponseWriter, r *http.Request) {
	item, principal, ok := d.getWorkspace(w, r)
	if !ok {
		return
	}
	filePath := r.URL.Query().Get("path")
	if !workspace.ValidPath(filePath) {
		writeProblem(w, http.StatusBadRequest, "Invalid file path", "A safe relative file path is required")
		return
	}
	if overlay, err := d.Workspaces.GetWorkspaceFile(r.Context(), principal.OrganizationID, item.ID, filePath); err == nil {
		if !utf8.Valid(overlay.Content) {
			writeProblem(w, http.StatusUnsupportedMediaType, "Binary preview unavailable", "Binary workspace files cannot be opened in the text editor")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"workspace_id": item.ID, "path": filePath, "content": string(overlay.Content), "sha256": overlay.SHA256, "version": overlay.Version, "source": "workspace"})
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		writeProblem(w, http.StatusInternalServerError, "Workspace file read failed", "The workspace overlay could not be read")
		return
	}
	if d.Preview == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Repository preview unavailable", "The Git preview reader is not configured")
		return
	}
	content, blobSHA, err := d.Preview.ReadBlob(r.Context(), principal.OrganizationID, item.Repository, item.BaseCommitSHA, filePath, workspace.MaxFileBytes)
	if errors.Is(err, delivery.ErrPreviewTooLarge) {
		writeProblem(w, http.StatusRequestEntityTooLarge, "File too large", "The file exceeds the 2 MiB workspace editor limit")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusNotFound, "File not found", "The file does not exist at the workspace base commit")
		return
	}
	if !utf8.Valid(content) {
		writeProblem(w, http.StatusUnsupportedMediaType, "Binary preview unavailable", "Binary repository files cannot be opened in the text editor")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"workspace_id": item.ID, "path": filePath, "content": string(content), "sha256": blobSHA, "version": int64(0), "source": "base"})
}

func (d DeliveryDependencies) writeWorkspaceFile(w http.ResponseWriter, r *http.Request) {
	item, principal, ok := d.getWorkspace(w, r)
	if !ok {
		return
	}
	if item.Status != workspace.StatusActive || !item.ExpiresAt.After(time.Now()) {
		writeProblem(w, http.StatusGone, "Workspace unavailable", "Closed or expired workspaces cannot be edited")
		return
	}
	if principal.Role == "viewer" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Viewers cannot edit workspace files")
		return
	}
	var input writeWorkspaceFileRequest
	if !decodeWorkspaceJSON(w, r, &input) {
		return
	}
	if !workspace.ValidPath(input.Path) || len(input.Content) > workspace.MaxFileBytes {
		writeProblem(w, http.StatusBadRequest, "Invalid file", "A safe relative path and content no larger than 2 MiB are required")
		return
	}
	var existing *workspace.File
	current, err := d.Workspaces.GetWorkspaceFile(r.Context(), principal.OrganizationID, item.ID, input.Path)
	if err == nil {
		existing = &current
	} else if !errors.Is(err, pgx.ErrNoRows) {
		writeProblem(w, http.StatusInternalServerError, "Workspace file read failed", "The existing workspace file could not be read")
		return
	}
	now := time.Now().UTC()
	updated, err := item.PutFile(existing, input.Path, []byte(input.Content), input.ExpectedVersion, principal.UserID, now)
	if errors.Is(err, workspace.ErrVersionConflict) {
		writeProblem(w, http.StatusConflict, "File version conflict", "The file changed since it was loaded; refresh before saving")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid workspace write", "The workspace is not active or the file input is invalid")
		return
	}
	stored, err := d.Workspaces.PutWorkspaceFile(r.Context(), principal.OrganizationID, updated, input.ExpectedVersion)
	if errors.Is(err, workspace.ErrVersionConflict) {
		writeProblem(w, http.StatusConflict, "File version conflict", "The file changed since it was loaded; refresh before saving")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Workspace file write failed", "The file could not be persisted")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"workspace_id": item.ID, "path": stored.Path, "content": string(stored.Content), "sha256": stored.SHA256, "version": stored.Version, "source": "workspace"})
}

func decodeWorkspaceJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 3<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid workspace request body", "The request must be valid JSON and no larger than 3 MiB")
		return false
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		writeProblem(w, http.StatusBadRequest, "Invalid workspace request body", "Only one JSON value is allowed")
		return false
	}
	return true
}
