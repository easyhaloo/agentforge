package httpserver

import (
	"context"
	"net/http"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
)

type pullMergeStore interface {
	PullMergeIntent(context.Context, string, delivery.ID) (*delivery.PullMergeIntent, error)
	WritePullMergeIntent(context.Context, string, delivery.ID, int64, *delivery.PullMergeIntent) error
	CompletePullMergeIntent(context.Context, string, delivery.StoredChangeset, delivery.PullMergeIntent, *delivery.LocalGitProvider) (delivery.StoredChangeset, error)
}

// A committed receipt is processed before checking the live branch or the new
// selection: an earlier attempt already moved Git under the applicable policy.
func (d DeliveryDependencies) recoverPullMerge(w http.ResponseWriter, r *http.Request, org string, stored delivery.StoredChangeset, release func()) bool {
	store, persistent := d.Repository.(pullMergeStore)
	if !persistent || stored.Changeset.PullRequest == nil {
		return false
	}
	ctx, c := r.Context(), stored.Changeset
	intent, err := store.PullMergeIntent(ctx, org, c.ID)
	if err != nil {
		writeRepositoryError(w, err)
		return true
	}
	if intent == nil {
		return false
	}
	git, local := d.Git.(*delivery.LocalGitProvider)
	if !local {
		writeProblem(w, 503, "Git provider unavailable", "A local Git provider is required to recover this merge")
		return true
	}
	recorded, err := git.HasPromotion(ctx, org, c.Repository, string(intent.ID), intent.Candidate.CandidateSHA)
	if err != nil {
		writeProblem(w, 503, "Git merge unavailable", "The previous merge could not be reconciled")
		return true
	}
	if recorded {
		d.finishPullMerge(w, r, org, store, git, stored, *intent, release)
		return true
	}
	if err := store.WritePullMergeIntent(ctx, org, c.ID, stored.Version, nil); err != nil {
		writeRepositoryError(w, err)
		return true
	}
	return false
}

func (d DeliveryDependencies) mergeNativePull(w http.ResponseWriter, r *http.Request, org, actor string, stored delivery.StoredChangeset, revision delivery.Revision, baseSHA, strategy string, formats githttp.MergeMessageFormats, release func()) {
	store, persistent := d.Repository.(pullMergeStore)
	git, local := d.Git.(*delivery.LocalGitProvider)
	if !persistent || !local {
		writeProblem(w, 503, "Merge method unavailable", "A local Git provider and durable merge records are required")
		return
	}
	ctx, c := r.Context(), stored.Changeset
	pull := c.PullRequest
	candidate, err := git.PrepareCandidate(ctx, org, c.Repository, delivery.MergeRequest{
		Target: pull.BaseBranch, Sources: []string{pull.SourceBranch}, Strategy: strategy,
		PullMessage: c.PullMergeMessage(formats),
	})
	if err != nil || candidate.Status != "clean" || candidate.Target.SHA != baseSHA || len(candidate.Sources) != 1 || candidate.Sources[0].SHA != revision.CommitSHA {
		writeProblem(w, 409, "Git merge rejected", "The verified source and target could not be merged using this method")
		return
	}
	id, err := newID()
	if err != nil {
		writeProblem(w, 500, "Unable to record merge", "An identifier could not be generated")
		return
	}
	intent := delivery.PullMergeIntent{ID: delivery.ID(id), RevisionID: revision.ID, Actor: actor, CreatedAt: time.Now().UTC(), Candidate: candidate}
	// Compare-and-set fences the policy-checked Changeset version. Comment mutations
	// cannot commit while the intent is present, including during receipt recovery.
	if err := store.WritePullMergeIntent(ctx, org, c.ID, stored.Version, &intent); err != nil {
		writeRepositoryError(w, err)
		return
	}
	if err := git.PromoteRewrittenCandidate(ctx, org, c.Repository, id, candidate); err != nil {
		// The retry verifies the receipt before clearing any unresolved intent.
		writeProblem(w, 409, "Git merge could not be confirmed", "Retry to reconcile the merge or refresh the branches if they have moved")
		return
	}
	d.finishPullMerge(w, r, org, store, git, stored, intent, release)
}

func (d DeliveryDependencies) finishPullMerge(w http.ResponseWriter, r *http.Request, org string, store pullMergeStore, git *delivery.LocalGitProvider, stored delivery.StoredChangeset, intent delivery.PullMergeIntent, release func()) {
	updated, err := store.CompletePullMergeIntent(r.Context(), org, stored, intent, git)
	if err != nil {
		writeRepositoryError(w, err)
		return
	}
	d.cleanupPullMerge(r.Context(), org, updated, git, release)
	writeJSON(w, http.StatusOK, toChangesetResponse(updated))
}

func (d DeliveryDependencies) cleanupPullMerge(ctx context.Context, org string, stored delivery.StoredChangeset, git *delivery.LocalGitProvider, release func()) {
	if cleaner, ok := d.Catalog.(interface {
		CleanupMergedPullRequestBranches(context.Context, string, string, []delivery.Changeset, *delivery.LocalGitProvider)
	}); ok && git != nil && stored.Changeset.PullRequest != nil {
		release()
		cleaner.CleanupMergedPullRequestBranches(ctx, org, stored.Changeset.Repository, []delivery.Changeset{*stored.Changeset}, git)
	}
}
