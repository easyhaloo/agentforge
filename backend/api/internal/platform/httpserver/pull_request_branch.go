package httpserver

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
)

type pullBranchUpdate struct {
	BaseSHA         string   `json:"base_sha"`
	Methods         []string `json:"methods"`
	SignoffRequired bool     `json:"signoff_required"`
}

func suggestBranchUpdate(policy githttp.PushPolicy, base string) bool {
	if policy.SuggestBranchUpdate {
		return true
	}
	for _, strict := range githttp.BranchRequiredWorkflows(policy.RefRules, base, policy.DefaultBranch) {
		if strict {
			return true
		}
	}
	return false
}

func pullBranchMethods(policy githttp.PushPolicy, branch string) []string {
	var methods []string
	if policy.CheckPullSourceWrite(branch, false) == nil && githttp.LinearHistoryRule(policy.RefRules, branch, policy.DefaultBranch) == "" {
		methods = append(methods, "merge")
	}
	if policy.CheckPullSourceWrite(branch, true) == nil {
		methods = append(methods, "rebase")
	}
	return methods
}

func (d DeliveryDependencies) updatePullRequestBranch(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	ctx, org := r.Context(), principal.OrganizationID
	var input struct {
		RevisionID delivery.ID `json:"revision_id"`
		BaseSHA    string      `json:"base_sha"`
		Method     string      `json:"method"`
		Signoff    bool        `json:"signoff"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.RevisionID == "" || input.BaseSHA == "" || (input.Method != "merge" && input.Method != "rebase") {
		writeProblem(w, 422, "Invalid pull request branch update", "Supply the current revision, base SHA and update method")
		return
	}
	unlock, ok := d.lockChangeset(w, r, org)
	if !ok {
		return
	}
	defer unlock()
	stored, ok := d.load(w, r, org)
	if !ok {
		return
	}
	repo := stored.Changeset.Repository
	git, hosted := d.Git.(*delivery.LocalGitProvider)
	if !hosted || !git.IsBareRepository(ctx, org, repo) {
		writeProblem(w, 422, "Repository does not support branch updates", "Only native Git repositories support web branch updates")
		return
	}
	policy, release, err := d.lockBranchWritePolicy(ctx, org, repo)
	if err != nil {
		writeProblem(w, 503, "Repository policy lock unavailable", "The repository policy could not be locked for the branch update")
		return
	}
	defer release()
	// A queue promotion can change the Changeset before the policy lock is taken.
	stored, ok = d.load(w, r, org)
	if !ok {
		return
	}
	c := stored.Changeset
	pull := c.PullRequest
	current, exists := c.CurrentRevision()
	conflict := func() {
		writeProblem(w, 409, "Pull request branches or policy changed", "Reload the pull request before updating its branch")
	}
	if c.Repository != repo || pull == nil || pull.Closed || c.Merge != nil || !exists || current.ID != input.RevisionID || !suggestBranchUpdate(policy, pull.BaseBranch) || !slices.Contains(pullBranchMethods(policy, pull.SourceBranch), input.Method) {
		conflict()
		return
	}
	source, err := git.ResolveRevision(ctx, org, repo, "refs/heads/"+pull.SourceBranch)
	if err != nil || source.CommitSHA != current.CommitSHA {
		conflict()
		return
	}
	base, err := git.ResolveRevision(ctx, org, repo, "refs/heads/"+pull.BaseBranch)
	if err != nil || base.CommitSHA != input.BaseSHA {
		conflict()
		return
	}
	contained, err := git.IsAncestor(ctx, org, repo, base.CommitSHA, source.CommitSHA)
	if err != nil || contained {
		conflict()
		return
	}
	signoff, ok := d.webCommitSignoff(w, r, principal, policy.WebCommitSignoffRequired, input.Signoff)
	if !ok {
		return
	}
	request := delivery.MergeRequest{Target: source.CommitSHA, Sources: []string{base.CommitSHA}, Strategy: "merge-commit", BranchSignoff: &signoff}
	if input.Method == "rebase" {
		request.Target, request.Sources[0], request.Strategy = base.CommitSHA, source.CommitSHA, "rebase"
	}
	// Test content and construct immutable objects with the isolated Git provider.
	candidate, err := git.PrepareCandidate(ctx, org, repo, request)
	if err != nil {
		writeProblem(w, 503, "Branch update unavailable", "Git could not prepare the update")
		return
	}
	if candidate.Status != "clean" {
		writeProblem(w, 409, "Pull request branch has conflicts", "Resolve the conflicts locally and refresh the pull request revision")
		return
	}
	next, err := git.ResolveRevision(ctx, org, repo, candidate.CandidateSHA)
	if err != nil {
		writeProblem(w, 503, "Branch update unavailable", "Git could not read the updated revision")
		return
	}
	if next.CommitSHA == base.CommitSHA {
		conflict()
		return
	}
	if githttp.LinearHistoryRule(policy.RefRules, pull.SourceBranch, policy.DefaultBranch) != "" {
		if err := git.CheckLinearHistory(ctx, org, repo, source.CommitSHA, next.CommitSHA); err != nil {
			if !writeBranchRuleConflict(w, err) {
				conflict()
			}
			return
		}
	}
	id, err := newID()
	if err != nil {
		writeProblem(w, 500, "Unable to create revision", "An identifier could not be generated")
		return
	}
	if err := c.AddPullRequestRevision(delivery.ID(id), next, base.CommitSHA, principal.UserID, time.Now().UTC()); err != nil {
		writeDeliveryError(w, err)
		return
	}
	writer, ok := d.Repository.(interface {
		UpdatePullSource(context.Context, string, *delivery.Changeset, int64, func() error) (delivery.StoredChangeset, error)
	})
	if !ok {
		writeProblem(w, 503, "Branch update unavailable", "The changeset store cannot coordinate branch updates")
		return
	}
	advanced := false
	updated, err := writer.UpdatePullSource(ctx, org, c, stored.Version, func() error {
		err := git.UpdatePullSource(ctx, org, repo, delivery.PinnedRef{Ref: pull.SourceBranch, SHA: source.CommitSHA}, delivery.PinnedRef{Ref: pull.BaseBranch, SHA: base.CommitSHA}, next.CommitSHA)
		advanced = err == nil
		return err
	})
	if err != nil && advanced {
		writeProblem(w, 500, "Pull request revision needs refresh", "The source branch was updated. Reload the pull request and use Update revision if the new revision is missing")
		return
	}
	if errors.Is(err, delivery.ErrWriteConflict) {
		conflict()
		return
	}
	if err != nil {
		writeRepositoryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toChangesetResponse(updated))
}
