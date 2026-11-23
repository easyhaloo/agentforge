package httpserver

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
)

// Call after taking the Changeset advisory lock, in the same order as merge.
// Hold the repository row lock through the Git CAS. The SQL lock uses NOWAIT
// so a busy repository does not block the Changeset lock holder.
func (d DeliveryDependencies) lockBranchWritePolicy(ctx context.Context, org, repo string) (delivery.BranchWriteCheck, func(), error) {
	catalog, ok := d.Catalog.(interface {
		LockGitPolicy(context.Context, string, string) (githttp.PushPolicy, func(), error)
	})
	if !ok {
		return nil, nil, errors.New("repository policy locking is unavailable")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	policy, release, err := catalog.LockGitPolicy(ctx, org, repo)
	if err != nil {
		return nil, nil, err
	}
	return policy.CheckBranchWrite, release, nil
}

func writeBranchRuleConflict(w http.ResponseWriter, err error) bool {
	if !errors.Is(err, githttp.ErrBranchCreationRestricted) && !errors.Is(err, githttp.ErrBranchUpdatesRestricted) && !errors.Is(err, githttp.ErrBranchPullRequestRequired) && !errors.Is(err, githttp.ErrBranchMergeQueueRequired) && !errors.Is(err, githttp.ErrRefNameRestricted) {
		return false
	}
	writeProblem(w, http.StatusConflict, "Repository rule blocks branch write", err.Error())
	return true
}
