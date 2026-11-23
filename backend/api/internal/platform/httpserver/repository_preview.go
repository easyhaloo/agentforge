package httpserver

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

const repositoryPreviewMaxBlobBytes int64 = 1 << 20
const repositoryPreviewMaxImageBytes int64 = 2 << 20

func (d DeliveryDependencies) previewRepository(w http.ResponseWriter, r *http.Request) (Principal, delivery.RepositoryMetadata, string, bool) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return Principal{}, delivery.RepositoryMetadata{}, "", false
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if d.Catalog == nil || d.Git == nil || d.Preview == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Repository preview unavailable", "Repository catalog, Git provider and read-only preview capability are required")
		return Principal{}, delivery.RepositoryMetadata{}, "", false
	}
	registered, ok := d.registeredRepository(w, r, principal)
	if !ok {
		return Principal{}, delivery.RepositoryMetadata{}, "", false
	}
	ref := strings.TrimSpace(r.URL.Query().Get("ref"))
	if ref == "" {
		ref = registered.DefaultBranch
	}
	revision, err := d.Git.ResolveRevision(r.Context(), principal.OrganizationID, registered.Slug, ref)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Git ref not found", "The requested branch, tag or commit could not be resolved")
		return Principal{}, delivery.RepositoryMetadata{}, "", false
	}
	return principal, registered, revision.CommitSHA, true
}

func (d DeliveryDependencies) registeredRepository(w http.ResponseWriter, r *http.Request, principal Principal) (delivery.RepositoryMetadata, bool) {
	return d.resolveRegisteredRepository(w, r, principal, strings.TrimSpace(r.PathValue("owner"))+"/"+strings.TrimSpace(r.PathValue("repo")))
}

func (d DeliveryDependencies) resolveRegisteredRepository(w http.ResponseWriter, r *http.Request, principal Principal, slug string) (delivery.RepositoryMetadata, bool) {
	owner, name, ok := strings.Cut(slug, "/")
	if !ok || strings.TrimSpace(owner) == "" || strings.TrimSpace(name) == "" || strings.Contains(name, "/") || strings.Contains(slug, "..") || strings.ContainsAny(slug, "\x00\\") {
		writeProblem(w, http.StatusBadRequest, "Invalid repository", "A valid owner/repository path is required")
		return delivery.RepositoryMetadata{}, false
	}
	if d.Catalog == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Repository catalog unavailable", "Repository metadata storage is not configured")
		return delivery.RepositoryMetadata{}, false
	}
	repositories, err := d.Catalog.ListRepositories(r.Context(), principal.OrganizationID)
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Repository catalog unavailable", "The registered repository could not be verified")
		return delivery.RepositoryMetadata{}, false
	}
	var registered *delivery.RepositoryMetadata
	for i := range repositories {
		if repositories[i].Slug == slug {
			registered = &repositories[i]
			break
		}
	}
	if registered == nil {
		writeProblem(w, http.StatusNotFound, "Repository not found", "The repository is not registered in the selected organization")
		return delivery.RepositoryMetadata{}, false
	}
	return *registered, true
}

func (d DeliveryDependencies) listRepositoryTree(w http.ResponseWriter, r *http.Request) {
	principal, repository, commitSHA, ok := d.previewRepository(w, r)
	if !ok {
		return
	}
	directory := r.URL.Query().Get("path")
	if len(directory) > 1024 {
		writeProblem(w, http.StatusBadRequest, "Invalid repository path", "The path exceeds 1024 bytes")
		return
	}
	entries, err := d.Preview.ListTree(r.Context(), principal.OrganizationID, repository.Slug, commitSHA, directory)
	if err != nil {
		if errors.Is(err, delivery.ErrPreviewPathInvalid) {
			writeProblem(w, http.StatusBadRequest, "Invalid repository path", "The requested path is not a valid repository directory")
			return
		}
		if errors.Is(err, delivery.ErrPreviewTooLarge) {
			writeProblem(w, http.StatusRequestEntityTooLarge, "Directory too large", "The directory contains too many entries to preview")
			return
		}
		writeProblem(w, http.StatusNotFound, "Directory not found", "The requested directory does not exist at this commit")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"repository": repository.Slug, "commit_sha": commitSHA, "path": directory, "items": entries})
}

func (d DeliveryDependencies) readRepositoryBlob(w http.ResponseWriter, r *http.Request) {
	principal, repository, commitSHA, ok := d.previewRepository(w, r)
	if !ok {
		return
	}
	filePath := r.URL.Query().Get("path")
	if len(filePath) == 0 || len(filePath) > 1024 {
		writeProblem(w, http.StatusBadRequest, "Invalid repository path", "A file path of at most 1024 bytes is required")
		return
	}
	content, blobSHA, err := d.Preview.ReadBlob(r.Context(), principal.OrganizationID, repository.Slug, commitSHA, filePath, repositoryPreviewMaxBlobBytes)
	if err != nil {
		if errors.Is(err, delivery.ErrPreviewTooLarge) {
			writeProblem(w, http.StatusRequestEntityTooLarge, "File too large", "Files larger than 1 MiB must be downloaded instead of previewed")
			return
		}
		if errors.Is(err, delivery.ErrPreviewPathInvalid) {
			writeProblem(w, http.StatusBadRequest, "Invalid repository path", "The requested path is not a regular file")
			return
		}
		writeProblem(w, http.StatusNotFound, "File not found", "The requested file does not exist at this commit")
		return
	}
	if !utf8.Valid(content) {
		writeProblem(w, http.StatusUnsupportedMediaType, "Binary preview unavailable", "The selected file is binary and cannot be displayed as source text")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"repository": repository.Slug, "commit_sha": commitSHA, "blob_sha": blobSHA, "path": filePath, "encoding": "utf-8", "content": string(content)})
}

func (d DeliveryDependencies) listCommitIssues(w http.ResponseWriter, r *http.Request) {
	principal, repository, sha, ok := d.previewRepository(w, r)
	if !ok {
		return
	}
	reader, ok := d.IssueRepo.(interface {
		IssuesForCommit(context.Context, string, string, string) ([]int, error)
	})
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "Commit links unavailable", "Commit links are not configured")
		return
	}
	numbers, err := reader.IssuesForCommit(r.Context(), principal.OrganizationID, repository.Slug, sha)
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Commit links unavailable", "Could not read linked issues")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": numbers})
}

func (d DeliveryDependencies) listRepositoryHistory(w http.ResponseWriter, r *http.Request) {
	principal, repository, commitSHA, ok := d.previewRepository(w, r)
	if !ok {
		return
	}
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
	writeJSON(w, http.StatusOK, map[string]any{"repository": repository.Slug, "commit_sha": commitSHA, "items": commits})
}

func (d DeliveryDependencies) compareRepositoryCommits(w http.ResponseWriter, r *http.Request) {
	principal, repository, _, ok := d.previewRepository(w, r)
	if !ok {
		return
	}
	_, supported := d.Preview.(delivery.RepositoryCompareReader)
	if !supported {
		writeProblem(w, http.StatusServiceUnavailable, "Repository compare unavailable", "The configured Git provider does not support commit comparison")
		return
	}
	query := r.URL.Query()
	rawBase := query.Get("base")
	baseRef := strings.TrimSpace(rawBase)
	headRef := strings.TrimSpace(query.Get("head"))
	mode := strings.TrimSpace(query.Get("mode"))
	if !query.Has("base") || headRef == "" || len(baseRef) > 256 || len(headRef) > 256 || (baseRef == "" && rawBase != "") {
		writeProblem(w, http.StatusBadRequest, "Invalid compare refs", "Both base and head refs are required and must be at most 256 bytes. Base may be explicitly empty")
		return
	}
	if (mode != "" && mode != "merge-base") || (mode == "merge-base" && baseRef == "") {
		writeProblem(w, http.StatusBadRequest, "Invalid compare mode", "Mode must be empty or 'merge-base' with a nonempty base")
		return
	}
	var baseSHA string
	if baseRef != "" {
		base, err := d.Git.ResolveRevision(r.Context(), principal.OrganizationID, repository.Slug, baseRef)
		if err != nil {
			writeProblem(w, http.StatusNotFound, "Base revision not found", "The base ref could not be resolved")
			return
		}
		baseSHA = base.CommitSHA
	}
	head, err := d.Git.ResolveRevision(r.Context(), principal.OrganizationID, repository.Slug, headRef)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Head revision not found", "The head ref could not be resolved")
		return
	}
	comparison, err := d.compareCommits(r.Context(), principal.OrganizationID, repository.Slug, baseSHA, head.CommitSHA, mode, query.Get("include_commits") == "true")
	if errors.Is(err, delivery.ErrPreviewTooLarge) {
		writeProblem(w, http.StatusRequestEntityTooLarge, "Compare too large", "The comparison exceeds the 1 MiB preview output limit")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Compare unavailable", "The requested commits could not be compared")
		return
	}
	writeJSON(w, http.StatusOK, comparison)
}

type repositoryComparison struct {
	Repository       string                       `json:"repository"`
	BaseSHA          string                       `json:"base_sha"`
	HeadSHA          string                       `json:"head_sha"`
	Patch            string                       `json:"patch"`
	Commits          *[]delivery.RepositoryCommit `json:"commits,omitempty"`
	CommitsTruncated *bool                        `json:"commits_truncated,omitempty"`
}

func (d DeliveryDependencies) compareCommits(ctx context.Context, org, repo, base, head, mode string, includeCommits bool) (repositoryComparison, error) {
	out := repositoryComparison{Repository: repo, BaseSHA: base, HeadSHA: head}
	reader, ok := d.Preview.(delivery.RepositoryCompareReader)
	if !ok {
		return out, delivery.ErrRepositoryInvalid
	}
	compare := reader.Compare
	if mode == "merge-base" {
		compare = reader.CompareWithMergeBase
	}
	patch, err := compare(ctx, org, repo, base, head)
	if err != nil {
		return out, err
	}
	out.Patch = patch
	if includeCommits {
		history, ok := d.Preview.(delivery.RepositoryCommitRangeReader)
		if !ok {
			return out, delivery.ErrRepositoryInvalid
		}
		commits, truncated, err := history.ListCommitRange(ctx, org, repo, base, head)
		if err != nil {
			return out, err
		}
		out.Commits, out.CommitsTruncated = &commits, &truncated
	}
	return out, nil
}

func (d DeliveryDependencies) listRepositoryFileHistory(w http.ResponseWriter, r *http.Request) {
	principal, repository, commitSHA, ok := d.previewRepository(w, r)
	if !ok {
		return
	}
	reader, supported := d.Preview.(delivery.RepositoryFileHistoryReader)
	if !supported {
		writeProblem(w, http.StatusServiceUnavailable, "File history unavailable", "The configured Git provider does not support file history")
		return
	}
	filePath := r.URL.Query().Get("path")
	limit := 30
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeProblem(w, http.StatusBadRequest, "Invalid history limit", "File history limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	if len(filePath) == 0 || len(filePath) > 1024 {
		writeProblem(w, http.StatusBadRequest, "Invalid repository path", "A file path of at most 1024 bytes is required")
		return
	}
	items, err := reader.ListFileHistory(r.Context(), principal.OrganizationID, repository.Slug, commitSHA, filePath, limit)
	if errors.Is(err, delivery.ErrPreviewTooLarge) {
		writeProblem(w, http.StatusRequestEntityTooLarge, "File history too large", "The requested file history exceeds the output limit")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusNotFound, "File history unavailable", "The requested file history could not be read at this revision")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"repository": repository.Slug, "commit_sha": commitSHA, "path": filePath, "items": items})
}

func (d DeliveryDependencies) blameRepositoryFile(w http.ResponseWriter, r *http.Request) {
	principal, repository, commitSHA, ok := d.previewRepository(w, r)
	if !ok {
		return
	}
	reader, supported := d.Preview.(delivery.RepositoryBlameReader)
	if !supported {
		writeProblem(w, http.StatusServiceUnavailable, "File blame unavailable", "The configured Git provider does not support blame")
		return
	}
	filePath := r.URL.Query().Get("path")
	start, end := 1, 200
	var err error
	if raw := r.URL.Query().Get("start"); raw != "" {
		start, err = strconv.Atoi(raw)
	}
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid blame range", "Blame line range must contain positive integers")
		return
	}
	if raw := r.URL.Query().Get("end"); raw != "" {
		end, err = strconv.Atoi(raw)
	}
	if err != nil || len(filePath) == 0 || len(filePath) > 1024 || start < 1 || end < start || end-start >= 500 {
		writeProblem(w, http.StatusBadRequest, "Invalid blame range", "A file path and a range of at most 500 lines are required")
		return
	}
	items, err := reader.Blame(r.Context(), principal.OrganizationID, repository.Slug, commitSHA, filePath, start, end)
	if errors.Is(err, delivery.ErrPreviewTooLarge) {
		writeProblem(w, http.StatusRequestEntityTooLarge, "Blame output too large", "The requested blame output exceeds the preview limit")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusNotFound, "File blame unavailable", "The requested file could not be blamed at this revision")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"repository": repository.Slug, "commit_sha": commitSHA, "path": filePath, "start": start, "end": end, "items": items})
}

func (d DeliveryDependencies) listRepositoryRefs(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	repository, ok := d.registeredRepository(w, r, principal)
	if !ok {
		return
	}
	reader, supported := d.Preview.(delivery.RepositoryRefsReader)
	if !supported {
		writeProblem(w, http.StatusServiceUnavailable, "Repository refs unavailable", "The configured Git provider does not support branch and tag listing")
		return
	}
	refs, err := reader.ListRefs(r.Context(), principal.OrganizationID, repository.Slug)
	if errors.Is(err, delivery.ErrPreviewTooLarge) {
		writeProblem(w, http.StatusRequestEntityTooLarge, "Too many repository refs", "The repository has too many refs to list")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Repository refs unavailable", "Branches and tags could not be read")
		return
	}
	var commitSHA string
	for _, ref := range refs {
		if ref.Kind == "branch" && ref.Name == repository.DefaultBranch {
			commitSHA = ref.SHA
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"repository": repository.Slug, "default_branch": repository.DefaultBranch, "resolved_commit_sha": commitSHA, "items": refs,
		"hosting_kind": d.repositoryHostingKind(r.Context(), repository), "git_credentials_available": d.GitHTTP != nil && d.GitHTTP.Available(repository.OrganizationID, repository.Slug),
		"merge_commit_message_format": repository.MergeCommitMessageFormat, "squash_commit_message_format": repository.SquashCommitMessageFormat,
		"allow_merge_commit": repository.AllowMergeCommit, "allow_squash_merge": repository.AllowSquashMerge, "allow_rebase_merge": repository.AllowRebaseMerge,
		"description": repository.Description, "delete_merged_branches": repository.DeleteMergedBranches, "web_commit_signoff_required": repository.WebCommitSignoffRequired, "issues_disabled": repository.IssuesDisabled, "auto_close_issues_disabled": repository.AutoCloseIssuesDisabled, "is_template": repository.IsTemplate, "push_ref_limit": repository.PushRefLimit, "protected_refs": append([]string{}, repository.ProtectedRefs...), "updated_at": repository.UpdatedAt})
}

// repositoryImageContentType deliberately recognizes only passive raster formats.
// SVG is excluded because it can contain active content when navigated or embedded.
func repositoryImageContentType(content []byte) string {
	switch {
	case len(content) >= 8 && string(content[:8]) == "\x89PNG\r\n\x1a\n":
		return "image/png"
	case len(content) >= 3 && content[0] == 0xff && content[1] == 0xd8 && content[2] == 0xff:
		return "image/jpeg"
	case len(content) >= 6 && (string(content[:6]) == "GIF87a" || string(content[:6]) == "GIF89a"):
		return "image/gif"
	case len(content) >= 12 && string(content[:4]) == "RIFF" && string(content[8:12]) == "WEBP":
		return "image/webp"
	default:
		return ""
	}
}

func (d DeliveryDependencies) readRepositoryImage(w http.ResponseWriter, r *http.Request) {
	principal, repository, commitSHA, ok := d.previewRepository(w, r)
	if !ok {
		return
	}
	filePath := r.URL.Query().Get("path")
	if len(filePath) == 0 || len(filePath) > 1024 {
		writeProblem(w, http.StatusBadRequest, "Invalid repository path", "An image path of at most 1024 bytes is required")
		return
	}
	content, _, err := d.Preview.ReadBlob(r.Context(), principal.OrganizationID, repository.Slug, commitSHA, filePath, repositoryPreviewMaxImageBytes)
	if err != nil {
		if errors.Is(err, delivery.ErrPreviewTooLarge) {
			writeProblem(w, http.StatusRequestEntityTooLarge, "Image too large", "Repository images larger than 2 MiB cannot be previewed")
			return
		}
		if errors.Is(err, delivery.ErrPreviewPathInvalid) {
			writeProblem(w, http.StatusBadRequest, "Invalid repository path", "The requested path is not a regular file")
			return
		}
		writeProblem(w, http.StatusNotFound, "Image not found", "The requested image does not exist at this commit")
		return
	}
	contentType := repositoryImageContentType(content)
	if contentType == "" {
		writeProblem(w, http.StatusUnsupportedMediaType, "Image format unsupported", "Only PNG, JPEG, GIF and WebP raster images can be previewed")
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(content)))
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}
