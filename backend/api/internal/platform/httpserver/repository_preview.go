package httpserver

import (
	"errors"
	"net/http"
	"strings"
	"strconv"
	"unicode/utf8"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

const repositoryPreviewMaxBlobBytes int64 = 1 << 20

func (d DeliveryDependencies) previewRepository(w http.ResponseWriter, r *http.Request) (Principal, delivery.RepositoryMetadata, string, bool) {
	principal, ok := d.principal(w, r, false)
	if !ok { return Principal{}, delivery.RepositoryMetadata{}, "", false }
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if d.Catalog == nil || d.Git == nil || d.Preview == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Repository preview unavailable", "Repository catalog, Git provider and read-only preview capability are required")
		return Principal{}, delivery.RepositoryMetadata{}, "", false
	}
	slug := strings.TrimSpace(r.PathValue("owner")) + "/" + strings.TrimSpace(r.PathValue("repo"))
	if strings.Contains(slug, "..") || strings.ContainsAny(slug, "\x00\\\\") || strings.TrimSpace(r.PathValue("owner")) == "" || strings.TrimSpace(r.PathValue("repo")) == "" {
		writeProblem(w, http.StatusBadRequest, "Invalid repository", "A valid owner/repository path is required")
		return Principal{}, delivery.RepositoryMetadata{}, "", false
	}
	repositories, err := d.Catalog.ListRepositories(r.Context(), principal.OrganizationID)
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Repository catalog unavailable", "The registered repository could not be verified")
		return Principal{}, delivery.RepositoryMetadata{}, "", false
	}
	var registered *delivery.RepositoryMetadata
	for i := range repositories {
		if repositories[i].Slug == slug { registered = &repositories[i]; break }
	}
	if registered == nil {
		writeProblem(w, http.StatusNotFound, "Repository not found", "The repository is not registered in the selected organization")
		return Principal{}, delivery.RepositoryMetadata{}, "", false
	}
	ref := strings.TrimSpace(r.URL.Query().Get("ref"))
	if ref == "" { ref = registered.DefaultBranch }
	revision, err := d.Git.ResolveRevision(r.Context(), principal.OrganizationID, slug, ref)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Git ref not found", "The requested branch, tag or commit could not be resolved")
		return Principal{}, delivery.RepositoryMetadata{}, "", false
	}
	return principal, *registered, revision.CommitSHA, true
}

func (d DeliveryDependencies) listRepositoryTree(w http.ResponseWriter, r *http.Request) {
	principal, repository, commitSHA, ok := d.previewRepository(w, r)
	if !ok { return }
	directory := r.URL.Query().Get("path")
	if len(directory) > 1024 {
		writeProblem(w, http.StatusBadRequest, "Invalid repository path", "The path exceeds 1024 bytes")
		return
	}
	entries, err := d.Preview.ListTree(r.Context(), principal.OrganizationID, repository.Slug, commitSHA, directory)
	if err != nil {
		if errors.Is(err, delivery.ErrPreviewPathInvalid) { writeProblem(w, http.StatusBadRequest, "Invalid repository path", "The requested path is not a valid repository directory"); return }
		if errors.Is(err, delivery.ErrPreviewTooLarge) { writeProblem(w, http.StatusRequestEntityTooLarge, "Directory too large", "The directory contains too many entries to preview"); return }
		writeProblem(w, http.StatusNotFound, "Directory not found", "The requested directory does not exist at this commit")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"repository":repository.Slug,"commit_sha":commitSHA,"path":directory,"items":entries})
}

func (d DeliveryDependencies) readRepositoryBlob(w http.ResponseWriter, r *http.Request) {
	principal, repository, commitSHA, ok := d.previewRepository(w, r)
	if !ok { return }
	filePath := r.URL.Query().Get("path")
	if len(filePath) == 0 || len(filePath) > 1024 {
		writeProblem(w, http.StatusBadRequest, "Invalid repository path", "A file path of at most 1024 bytes is required")
		return
	}
	content, blobSHA, err := d.Preview.ReadBlob(r.Context(), principal.OrganizationID, repository.Slug, commitSHA, filePath, repositoryPreviewMaxBlobBytes)
	if err != nil {
		if errors.Is(err, delivery.ErrPreviewTooLarge) { writeProblem(w, http.StatusRequestEntityTooLarge, "File too large", "Files larger than 1 MiB must be downloaded instead of previewed"); return }
		if errors.Is(err, delivery.ErrPreviewPathInvalid) { writeProblem(w, http.StatusBadRequest, "Invalid repository path", "The requested path is not a regular file"); return }
		writeProblem(w, http.StatusNotFound, "File not found", "The requested file does not exist at this commit")
		return
	}
	if !utf8.Valid(content) {
		writeProblem(w, http.StatusUnsupportedMediaType, "Binary preview unavailable", "The selected file is binary and cannot be displayed as source text")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"repository":repository.Slug,"commit_sha":commitSHA,"blob_sha":blobSHA,"path":filePath,"encoding":"utf-8","content":string(content)})
}

func (d DeliveryDependencies) listRepositoryHistory(w http.ResponseWriter, r *http.Request) {
	principal, repository, commitSHA, ok := d.previewRepository(w, r)
	if !ok { return }
	reader, supported := d.Preview.(delivery.RepositoryHistoryReader)
	if !supported {
		writeProblem(w, http.StatusServiceUnavailable, "Repository history unavailable", "The configured Git provider does not support commit history")
		return
	}
	limit := 30
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeProblem(w, http.StatusBadRequest, "Invalid history limit", "History limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	commits, err := reader.ListHistory(r.Context(), principal.OrganizationID, repository.Slug, commitSHA, limit)
	if errors.Is(err, delivery.ErrPreviewTooLarge) {
		writeProblem(w, http.StatusRequestEntityTooLarge, "History too large", "The requested history exceeds the preview output limit")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Repository history unavailable", "Commit history could not be read at this revision")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"repository":repository.Slug,"commit_sha":commitSHA,"items":commits})
}
