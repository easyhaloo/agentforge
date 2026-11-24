package httpserver

import (
	"context"
	"errors"
	"net/http"
	"slices"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
)

func (d DeliveryDependencies) getPullRequestRequiredWorkflows(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	ctx, org := r.Context(), principal.OrganizationID
	stored, ok := d.load(w, r, org)
	if !ok {
		return
	}
	c := stored.Changeset
	pull := c.PullRequest
	if pull == nil {
		writeProblem(w, 404, "Pull request not found", "The changeset has no pull request")
		return
	}
	revision, hasRevision := c.CurrentRevision()
	result := struct {
		RevisionID   delivery.ID                      `json:"revision_id"`
		Checks       []githttp.RequiredWorkflowStatus `json:"checks"`
		BranchUpdate *pullBranchUpdate                `json:"branch_update,omitempty"`
	}{RevisionID: revision.ID, Checks: []githttp.RequiredWorkflowStatus{}}
	w.Header().Set("Cache-Control", "private, no-store")
	if !hasRevision {
		writeJSON(w, 200, result)
		return
	}
	unavailable := func() {
		writeProblem(w, 503, "Required workflows unavailable", "The repository workflow results could not be verified")
	}
	if d.Catalog == nil {
		unavailable()
		return
	}
	repositories, err := d.Catalog.ListRepositories(ctx, org)
	if err != nil {
		unavailable()
		return
	}
	index := slices.IndexFunc(repositories, func(repo delivery.RepositoryMetadata) bool { return repo.Slug == c.Repository })
	if index < 0 {
		unavailable()
		return
	}
	repo := repositories[index]
	policy := githttp.PushPolicy{DefaultBranch: repo.DefaultBranch, RefRules: repo.RefRules, ProtectedRefs: repo.ProtectedRefs,
		SuggestBranchUpdate: repo.SuggestBranchUpdate, WebCommitSignoffRequired: repo.WebCommitSignoffRequired}
	local, _ := d.Git.(*delivery.LocalGitProvider)
	if local != nil && !pull.Closed && c.Merge == nil && principal.Role != "viewer" && pull.SourceBranch != pull.BaseBranch && suggestBranchUpdate(policy, pull.BaseBranch) {
		methods := pullBranchMethods(policy, pull.SourceBranch)
		if len(methods) > 0 && local.IsBareRepository(ctx, org, c.Repository) {
			src, srcErr := local.ResolveRevision(ctx, org, c.Repository, "refs/heads/"+pull.SourceBranch)
			base, baseErr := local.ResolveRevision(ctx, org, c.Repository, "refs/heads/"+pull.BaseBranch)
			if srcErr == nil && baseErr == nil && src.CommitSHA == revision.CommitSHA {
				upToDate, err := local.IsAncestor(ctx, org, c.Repository, base.CommitSHA, src.CommitSHA)
				if err == nil && !upToDate {
					result.BranchUpdate = &pullBranchUpdate{base.CommitSHA, methods, policy.WebCommitSignoffRequired}
				}
			}
		}
	}
	checks := githttp.BranchRequiredWorkflows(repo.RefRules, pull.BaseBranch, repo.DefaultBranch)
	if len(checks) == 0 {
		writeJSON(w, 200, result)
		return
	}
	store, ok := d.Runs.(interface {
		RequiredWorkflowStatuses(context.Context, string, *delivery.Changeset, delivery.Revision, string, map[string]bool) ([]githttp.RequiredWorkflowStatus, error)
	})
	if !ok || d.Git == nil {
		unavailable()
		return
	}
	source, err := d.Git.ResolveRevision(ctx, org, c.Repository, "refs/heads/"+pull.SourceBranch)
	if err != nil {
		unavailable()
		return
	}
	base, err := d.Git.ResolveRevision(ctx, org, c.Repository, "refs/heads/"+pull.BaseBranch)
	if err != nil {
		unavailable()
		return
	}
	ancestryErr := local.CheckRequiredWorkflowBase(ctx, org, c.Repository, base.CommitSHA, revision.CommitSHA, checks)
	behind := errors.Is(ancestryErr, githttp.ErrStrictWorkflowBase)
	if ancestryErr != nil && !behind {
		unavailable()
		return
	}
	result.Checks, err = store.RequiredWorkflowStatuses(ctx, org, c, revision, base.CommitSHA, checks)
	if err != nil {
		unavailable()
		return
	}
	for i, check := range result.Checks {
		if source.CommitSHA != revision.CommitSHA {
			result.Checks[i].Status = "source_moved"
		} else if behind && checks[check.PipelineID] {
			result.Checks[i].Status = "behind"
		}
	}
	writeJSON(w, 200, result)
}
