package httpserver

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
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

type repositorySettingsResponse struct {
	delivery.RepositoryMetadata
	HostingKind        string    `json:"hosting_kind"`
	PullRequestMethods *[]string `json:"pull_request_merge_methods,omitempty"`
}

func (d DeliveryDependencies) repositorySettings(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	repository, ok := d.registeredRepository(w, r, principal)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	response := repositorySettingsResponse{RepositoryMetadata: repository, HostingKind: d.repositoryHostingKind(r.Context(), repository)}
	if branch := r.URL.Query().Get("target_branch"); branch != "" && response.HostingKind == "hosted" {
		methods := repository.MergeMethods.PullRequestMethods(repository.RefRules, branch, repository.DefaultBranch)
		response.PullRequestMethods = &methods
	}
	writeJSON(w, http.StatusOK, response)
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
	var input struct {
		githttp.MergeMethods
		MergeCommitMessageFormat  *string            `json:"merge_commit_message_format"`
		SquashCommitMessageFormat *string            `json:"squash_commit_message_format"`
		DefaultBranch             string             `json:"default_branch"`
		PreviousBranch            string             `json:"previous_branch"`
		Description               *string            `json:"description"`
		WebCommitSignoffRequired  *bool              `json:"web_commit_signoff_required"`
		DeleteMergedBranches      *bool              `json:"delete_merged_branches"`
		IssuesDisabled            *bool              `json:"issues_disabled"`
		ActionsRetentionDays      *int               `json:"actions_retention_days"`
		ActionsDisabled           *bool              `json:"actions_disabled"`
		IsTemplate                *bool              `json:"is_template"`
		PushRefLimit              *int               `json:"push_ref_limit"`
		ProtectedRefs             *[]string          `json:"protected_refs"`
		RefRules                  *[]githttp.RefRule `json:"ref_rules"`
		UpdatedAt                 time.Time          `json:"updated_at"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.MergeMethods.Specified() || input.MergeCommitMessageFormat != nil || input.SquashCommitMessageFormat != nil || input.Description != nil || input.IsTemplate != nil || input.PushRefLimit != nil || input.ProtectedRefs != nil || input.ActionsDisabled != nil || input.ActionsRetentionDays != nil || input.IssuesDisabled != nil || input.DeleteMergedBranches != nil || input.WebCommitSignoffRequired != nil || input.RefRules != nil {
		if input.DefaultBranch != "" || input.PreviousBranch != "" || input.UpdatedAt.IsZero() {
			writeProblem(w, 422, "Invalid settings update", "Provide the current version and update general settings separately from the default branch")
			return
		}
		if !input.UpdatedAt.Equal(repository.UpdatedAt) {
			writeProblem(w, 409, "Repository settings changed", "Reload the settings before trying again")
			return
		}
		if input.MergeCommitMessageFormat != nil || input.SquashCommitMessageFormat != nil {
			if d.repositoryHostingKind(r.Context(), repository) != "hosted" ||
				(input.MergeCommitMessageFormat != nil && !githttp.ValidMergeMessageFormat(*input.MergeCommitMessageFormat, false)) ||
				(input.SquashCommitMessageFormat != nil && !githttp.ValidMergeMessageFormat(*input.SquashCommitMessageFormat, true)) {
				writeProblem(w, 422, "Invalid merge message format", "Choose a supported format for a native Git repository")
				return
			}
			if input.MergeCommitMessageFormat != nil {
				repository.MergeCommitMessageFormat = *input.MergeCommitMessageFormat
			}
			if input.SquashCommitMessageFormat != nil {
				repository.SquashCommitMessageFormat = *input.SquashCommitMessageFormat
			}
		}
		if input.Description != nil {
			repository.Description = strings.TrimSpace(*input.Description)
			if utf8.RuneCountInString(repository.Description) > 350 || strings.ContainsRune(repository.Description, 0) {
				writeProblem(w, 422, "Invalid description", "Repository descriptions must be at most 350 characters")
				return
			}
		}
		if input.IsTemplate != nil {
			if *input.IsTemplate && d.repositoryHostingKind(r.Context(), repository) != "hosted" {
				writeProblem(w, 422, "Invalid template repository", "Only native Git repositories can be used as templates")
				return
			}
			repository.IsTemplate = *input.IsTemplate
		}
		if input.PushRefLimit != nil {
			limit := *input.PushRefLimit
			if limit != 0 && (limit < 2 || limit > githttp.MaxPushRefs) {
				writeProblem(w, 422, "Invalid push limit", "Set the limit to zero or between 2 and 128")
				return
			}
			if limit != 0 && d.repositoryHostingKind(r.Context(), repository) != "hosted" {
				writeProblem(w, 422, "Invalid push policy", "Push limits require a native Git repository")
				return
			}
			repository.PushRefLimit = limit
		}
		if input.ProtectedRefs != nil {
			if !githttp.ValidProtectedRefs(*input.ProtectedRefs) ||
				(len(*input.ProtectedRefs) > 0 && d.repositoryHostingKind(r.Context(), repository) != "hosted") {
				writeProblem(w, 422, "Invalid ref protection", "Provide up to 20 unique branch or tag patterns for a native Git repository")
				return
			}
			repository.ProtectedRefs = *input.ProtectedRefs
		}
		if input.RefRules != nil {
			if !githttp.ValidRefRules(*input.RefRules) ||
				(len(*input.RefRules) > 0 && d.repositoryHostingKind(r.Context(), repository) != "hosted") {
				writeProblem(w, 422, "Invalid rulesets", "Provide up to 10 valid rulesets for a native Git repository")
				return
			}
			for i := range *input.RefRules {
				if (*input.RefRules)[i].Exclude == nil {
					(*input.RefRules)[i].Exclude = []string{}
				}
			}
			if _, err := githttp.QueueMergeStrategy(*input.RefRules, repository.DefaultBranch, repository.DefaultBranch); err != nil {
				writeProblem(w, 422, "Invalid merge queue method", err.Error())
				return
			}
			if slices.ContainsFunc(*input.RefRules, func(rule githttp.RefRule) bool { return rule.RequiredWorkflows != nil }) {
				store, ok := d.Catalog.(interface {
					ValidateRequiredWorkflows(context.Context, string, string, []githttp.RefRule) error
				})
				if !ok {
					writeProblem(w, 503, "Required workflows unavailable", "The repository workflow configuration could not be verified")
					return
				}
				err := store.ValidateRequiredWorkflows(r.Context(), principal.OrganizationID, repository.Slug, *input.RefRules)
				if errors.Is(err, githttp.ErrIneligibleRequiredWorkflow) {
					writeProblem(w, 422, "Invalid required workflows", err.Error())
					return
				}
				if err != nil {
					writeProblem(w, 503, "Required workflows unavailable", "The repository workflow configuration could not be verified")
					return
				}
			}
			repository.RefRules = *input.RefRules
		}
		if input.DeleteMergedBranches != nil {
			if *input.DeleteMergedBranches && d.repositoryHostingKind(r.Context(), repository) != "hosted" {
				writeProblem(w, 422, "Invalid branch cleanup policy", "Automatic branch deletion requires a native Git repository")
				return
			}
			repository.DeleteMergedBranches = *input.DeleteMergedBranches
		}
		if input.WebCommitSignoffRequired != nil {
			repository.WebCommitSignoffRequired = *input.WebCommitSignoffRequired
		}
		if input.IssuesDisabled != nil {
			repository.IssuesDisabled = *input.IssuesDisabled
		}
		if input.ActionsDisabled != nil {
			repository.ActionsDisabled = *input.ActionsDisabled
		}
		if input.ActionsRetentionDays != nil {
			maxDays := 400
			if repository.Visibility == "public" {
				maxDays = 90
			}
			if days := *input.ActionsRetentionDays; days < 0 || days > maxDays {
				writeProblem(w, 422, "Invalid Actions retention period", fmt.Sprintf("Use zero for the platform default or choose between 1 and %d days", maxDays))
				return
			}
			repository.ActionsRetentionDays = *input.ActionsRetentionDays
		}
		repository.UpdatedAt = input.UpdatedAt
		d.updateRepositoryGeneralSettings(w, r, repository, input.MergeMethods)
		return
	}
	store, storeOK := d.Catalog.(interface {
		SetRepositoryDefaultBranch(context.Context, string, string, string, string, func() error) error
	})
	reader, refsOK := d.Preview.(delivery.RepositoryRefsReader)
	if !storeOK || !refsOK {
		writeProblem(w, 503, "Repository settings unavailable", "Repository catalog and Git branch access are required")
		return
	}
	branch := strings.TrimSpace(input.DefaultBranch)
	branchNotFound := errors.New("branch not found")
	verifyBranch := func() error {
		if branch == "agentforge" || strings.HasPrefix(branch, "agentforge/") {
			return branchNotFound
		}
		refs, err := reader.ListRefs(r.Context(), principal.OrganizationID, repository.Slug)
		if err != nil {
			return err
		}
		for _, ref := range refs {
			if ref.Kind == "branch" && ref.Name == branch {
				return nil
			}
		}
		return branchNotFound
	}
	err := store.SetRepositoryDefaultBranch(r.Context(), principal.OrganizationID, repository.Slug, branch, input.PreviousBranch, verifyBranch)
	switch {
	case errors.Is(err, delivery.ErrVersionConflict):
		writeProblem(w, 409, "Repository settings changed", "Reload the settings before trying again")
	case errors.Is(err, branchNotFound):
		writeProblem(w, 422, "Branch not found", "Select an existing Git branch")
	case err != nil:
		writeRepositoryError(w, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func (d DeliveryDependencies) repositoryHostingKind(ctx context.Context, repository delivery.RepositoryMetadata) string {
	if provider, ok := d.Git.(*delivery.LocalGitProvider); ok && provider.IsBareRepository(ctx, repository.OrganizationID, repository.Slug) {
		return "hosted"
	}
	return "registered"
}

func (d DeliveryDependencies) updateRepositoryGeneralSettings(w http.ResponseWriter, r *http.Request, repository delivery.RepositoryMetadata, methods githttp.MergeMethods) {
	store, ok := d.Catalog.(interface {
		PatchRepositoryGeneralSettings(context.Context, delivery.RepositoryMetadata, githttp.MergeMethods) (delivery.RepositoryMetadata, error)
	})
	if !ok {
		writeProblem(w, 503, "Repository settings unavailable", "Repository settings are not configured")
		return
	}
	updated, err := store.PatchRepositoryGeneralSettings(r.Context(), repository, methods)
	switch {
	case errors.Is(err, delivery.ErrVersionConflict):
		writeProblem(w, 409, "Repository settings changed", "Reload the settings before trying again")
	case errors.Is(err, delivery.ErrNoRepositoryMergeMethod):
		writeProblem(w, 422, "Invalid merge methods", "Enable at least one pull request merge method")
	case err != nil:
		writeProblem(w, 500, "Unable to update repository settings", "General settings could not be saved")
	default:
		writeJSON(w, http.StatusOK, repositorySettingsResponse{RepositoryMetadata: updated, HostingKind: d.repositoryHostingKind(r.Context(), updated)})
	}
}
