package postgres

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
)

func TestMergeQueueAdmissionRequiresCurrentWorkflowPass(t *testing.T) {
	ctx := t.Context()
	s, h, git, previous, _ := integrationFixture(t)
	org := h.organizationID
	rule := githttp.RefRule{
		RequireMergeQueue: true,
		RequiredWorkflows: &githttp.RequiredWorkflows{PipelineIDs: []string{"required-ci"}, Strict: true},
	}
	enableRequiredWorkflow(t, s, h, []githttp.RefRule{rule})
	setMainMergeRuleset(t, s, org, rule)
	preview, err := git.PrepareCandidate(ctx, org, rulesetTestRepo, delivery.MergeRequest{Target: "main", Sources: []string{"topic"}})
	lockMust(t, err)
	source, err := git.ResolveRevision(ctx, org, rulesetTestRepo, "refs/heads/topic")
	lockMust(t, err)
	enqueue := func(want int, detail string) {
		t.Helper()
		path := "/api/v1/organizations/" + org + "/pipelines/p/versions/1/merge-queue"
		res := h.do(ctx, http.MethodPost, path, `{"repository":"team/repo","target":"main","sources":["topic"]}`)
		if res.Code != want || !strings.Contains(res.Body.String(), detail) {
			t.Fatalf("enqueue returned %d %s, want %d containing %q", res.Code, res.Body, want, detail)
		}
	}
	assertNoEntry := func() {
		t.Helper()
		var count int
		lockMust(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM merge_queue_entries WHERE organization_id=$1`, org).Scan(&count))
		if count != 0 {
			t.Fatalf("rejected admission persisted %d entries", count)
		}
	}
	now := time.Now()
	newPull := func(id delivery.ID, revision delivery.GitRevision) *delivery.Changeset {
		t.Helper()
		c, err := delivery.NewChangeset(id, rulesetTestRepo, "Topic PR", h.userID, now)
		lockMust(t, err)
		c.PullRequest = &delivery.PullRequest{BaseBranch: "main", SourceBranch: "topic"}
		lockMust(t, c.AddPullRequestRevision("initial", revision, preview.Target.SHA, h.userID, now))
		_, err = s.Create(ctx, org, c)
		lockMust(t, err)
		return c
	}

	enqueue(http.StatusConflict, "open pull request")
	assertNoEntry()
	pull := newPull("queue-pr", delivery.GitRevision{CommitSHA: previous})
	enqueue(http.StatusConflict, "open pull request")
	assertNoEntry()

	passTriggeredRun := func(sha string) {
		t.Helper()
		lockMust(t, s.AdvanceTriggers(ctx))
		task, err := s.ClaimTask(ctx, registerTestRunner(t, s, org, pipeline.ContainerCheck))
		lockMust(t, err)
		if task == nil || task.PipelineID != "required-ci" || task.Trigger == nil || task.Trigger.SHA != sha {
			t.Fatalf("expected required-ci triggered for %s, got %+v", sha, task)
		}
		task.CheckedSourceSHA = sha
		lockMust(t, s.FinishTask(ctx, *task, "succeeded", "tested"))
	}
	passTriggeredRun(previous)
	lockMust(t, pull.AddPullRequestRevision("current", source, preview.Target.SHA, h.userID, now))
	_, err = s.Update(ctx, org, pull, 1)
	lockMust(t, err)
	enqueue(http.StatusConflict, "required-ci")
	assertNoEntry()

	passTriggeredRun(source.CommitSHA)
	wrongBase := execution.Integration{Repository: rulesetTestRepo, Strategy: "merge-commit", MergePreview: preview}
	wrongBase.Target.SHA = previous
	if _, err := s.Enqueue(ctx, org, "p", 1, h.userID, nil, wrongBase); !errors.Is(err, githttp.ErrRequiredWorkflows) {
		t.Fatalf("strict admission with a different target SHA returned %v", err)
	}
	assertNoEntry()

	duplicate := newPull("queue-pr-duplicate", source)
	enqueue(http.StatusConflict, "open pull request")
	assertNoEntry()
	lockMust(t, duplicate.ClosePullRequest(h.userID, now))
	_, err = s.Update(ctx, org, duplicate, 1)
	lockMust(t, err)
	enqueue(http.StatusCreated, source.CommitSHA)
}
