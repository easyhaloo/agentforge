package httpserver

import (
	"errors"
	"net/http"
	"slices"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

func (d DeliveryDependencies) mergePreviewRoutes(mux *http.ServeMux) {
	const base = "/api/v1/organizations/{organizationID}/merge-preview"
	provider, supported := d.Git.(delivery.MergePreviewProvider)
	slots := make(chan struct{}, 1) // One preview per API process bounds temporary repositories and Git subprocesses.
	mux.HandleFunc("GET "+base+"/capabilities", func(w http.ResponseWriter, r *http.Request) {
		if _, ok := d.principal(w, r, false); !ok {
			return
		}
		writeJSON(w, 200, map[string]bool{"orderedMergePreview": supported && provider.SupportsMergePreview(r.Context())})
	})
	mux.HandleFunc("POST "+base, func(w http.ResponseWriter, r *http.Request) {
		user, ok := d.principal(w, r, true)
		if !ok {
			return
		}
		if !supported || d.Catalog == nil {
			writeProblem(w, 503, "Merge preview unavailable", "A registered repository and preview-capable provider are required")
			return
		}
		var input struct {
			Repository string `json:"repository"`
			delivery.MergeRequest
		}
		if !decodeJSON(w, r, &input) {
			return
		}
		repos, err := d.Catalog.ListRepositories(r.Context(), user.OrganizationID)
		if err != nil {
			writeProblem(w, 503, "Catalog unavailable", "Could not read registered repositories")
			return
		}
		if !slices.ContainsFunc(repos, func(item delivery.RepositoryMetadata) bool { return item.Slug == input.Repository }) {
			writeProblem(w, 404, "Unknown repository", "Select a repository registered in this organization")
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			writeProblem(w, 429, "Preview in progress", "Retry after the current preview completes")
			return
		}
		result, err := provider.PreviewMerge(r.Context(), user.OrganizationID, input.Repository, input.MergeRequest)
		switch {
		case err == nil:
			writeJSON(w, 200, result)
		case errors.Is(err, delivery.ErrRepositoryInvalid):
			writeProblem(w, 422, "Invalid merge inputs", "Provide a target and one to 32 distinct source revisions")
		default:
			writeProblem(w, 503, "Git preview unavailable", "Check the repository, Git version and execution limits")
		}
	})
}
