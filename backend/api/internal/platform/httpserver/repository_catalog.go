package httpserver

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
)

type repositorySummary struct {
	delivery.RepositoryMetadata
	Git      *delivery.RepositoryGitSummary `json:"git,omitempty"`
	Activity *delivery.RepositoryActivity   `json:"activity,omitempty"`
}

func (d DeliveryDependencies) repositorySummaries(ctx context.Context, organization string, items []delivery.RepositoryMetadata) []repositorySummary {
	result := make([]repositorySummary, len(items))
	for i, item := range items {
		result[i].RepositoryMetadata = item
	}
	if catalog, ok := d.Catalog.(interface {
		RepositoryActivities(context.Context, string) ([]delivery.RepositoryActivity, error)
	}); ok {
		if activities, err := catalog.RepositoryActivities(ctx, organization); err == nil {
			bySlug := make(map[string]delivery.RepositoryActivity, len(activities))
			for _, activity := range activities {
				bySlug[activity.Slug] = activity
			}
			for i, item := range items {
				if activity, found := bySlug[item.Slug]; found {
					result[i].Activity = &activity
				}
			}
		}
	}
	if provider, ok := d.Preview.(delivery.RepositoryGitSummarizer); ok {
		// ponytail: bound live Git scans per request; persist summaries on Git updates if large catalogs hit this budget.
		ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
		defer cancel()
		var workers sync.WaitGroup
		for start := 0; start < min(4, len(items)); start++ {
			workers.Add(1)
			go func(start int) {
				defer workers.Done()
				for i := start; i < len(items) && ctx.Err() == nil; i += 4 {
					item := items[i]
					if summary, err := provider.SummarizeRepository(ctx, organization, item.Slug, item.DefaultBranch); err == nil {
						result[i].Git = &summary
					}
				}
			}(start)
		}
		workers.Wait()
	}
	return result
}

func (d DeliveryDependencies) listRepositoryActions(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	repository, ok := d.registeredRepository(w, r, principal)
	if !ok {
		return
	}
	store, ok := d.Catalog.(interface {
		ListRepositoryActions(context.Context, string, string, delivery.RepositoryActionFilter, int, int) ([]delivery.RepositoryAction, error)
	})
	if !ok {
		writeProblem(w, 503, "Repository runs unavailable", "Run storage is unavailable")
		return
	}
	const pageSize = 20
	offset := 0
	if value := r.URL.Query().Get("offset"); value != "" {
		parsed, err := strconv.ParseInt(value, 10, 32)
		if err != nil || parsed < 0 || parsed > 2147483647-pageSize {
			writeProblem(w, 400, "Invalid offset", "offset must be a nonnegative integer")
			return
		}
		offset = int(parsed)
	}
	query := r.URL.Query()
	filter := delivery.RepositoryActionFilter{
		Workflow: query.Get("workflow"), Status: query.Get("status"), Event: query.Get("event"), Query: strings.TrimSpace(query.Get("q")),
		Branch: strings.TrimSpace(query.Get("branch")), Actor: strings.TrimSpace(query.Get("actor")),
	}
	if len(filter.Workflow) > 128 || len(filter.Query) > 512 || len(filter.Branch) > 255 || len(filter.Actor) > 255 ||
		strings.ContainsRune(filter.Workflow+filter.Query+filter.Branch+filter.Actor, 0) ||
		!slices.Contains([]string{"", "queued", "running", "succeeded", "failed", "cancelled", "timed_out"}, filter.Status) ||
		!slices.Contains([]string{"", "manual", "webhook", "changeset_revision", "schedule", "merge_queue", "integration", "rerun"}, filter.Event) {
		writeProblem(w, 400, "Invalid run filters", "Provide supported status and event values and a valid search term")
		return
	}
	items, err := store.ListRepositoryActions(r.Context(), principal.OrganizationID, repository.Slug, filter, pageSize+1, offset)
	if err != nil {
		writeProblem(w, 500, "Unable to list repository runs", "The run query failed")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, 200, map[string]any{"items": items[:min(pageSize, len(items))], "has_more": len(items) > pageSize})
}

func (d DeliveryDependencies) listRepositoryWorkflows(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	repository, ok := d.registeredRepository(w, r, principal)
	if !ok {
		return
	}
	store, ok := d.Catalog.(interface {
		ListRepositoryWorkflows(context.Context, string, string) ([]pipeline.Summary, error)
	})
	if !ok {
		writeProblem(w, 503, "Repository workflows unavailable", "Workflow storage is unavailable")
		return
	}
	items, err := store.ListRepositoryWorkflows(r.Context(), principal.OrganizationID, repository.Slug)
	if err != nil {
		writeProblem(w, 500, "Unable to list repository workflows", "The workflow query failed")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, 200, map[string]any{"items": items})
}

func (d DeliveryDependencies) updateRepositorySettings(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if principal.Role != "owner" && principal.Role != "admin" {
		writeProblem(w, 403, "Insufficient permissions", "Only organization owners and administrators can manage repository settings")
		return
	}
	repository, ok := d.registeredRepository(w, r, principal)
	if !ok {
		return
	}
	store, storeOK := d.Catalog.(interface {
		SetRepositoryDefaultBranch(context.Context, string, string, string, string) error
	})
	reader, refsOK := d.Preview.(delivery.RepositoryRefsReader)
	if !storeOK || !refsOK {
		writeProblem(w, 503, "Repository settings unavailable", "Repository catalog and Git branch access are required")
		return
	}
	var input struct {
		DefaultBranch  string `json:"default_branch"`
		PreviousBranch string `json:"previous_branch"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	branch := strings.TrimSpace(input.DefaultBranch)
	refs, err := reader.ListRefs(r.Context(), principal.OrganizationID, repository.Slug)
	if err != nil {
		writeRepositoryError(w, err)
		return
	}
	for _, ref := range refs {
		if ref.Kind != "branch" || ref.Name != branch {
			continue
		}
		err = store.SetRepositoryDefaultBranch(r.Context(), principal.OrganizationID, repository.Slug, branch, input.PreviousBranch)
		switch {
		case errors.Is(err, delivery.ErrVersionConflict):
			writeProblem(w, 409, "Repository settings changed", "Reload the settings before trying again")
		case err != nil:
			writeProblem(w, 500, "Unable to update repository settings", "The default branch could not be saved")
		default:
			w.WriteHeader(http.StatusNoContent)
		}
		return
	}
	writeProblem(w, 422, "Branch not found", "Select an existing Git branch")
}
