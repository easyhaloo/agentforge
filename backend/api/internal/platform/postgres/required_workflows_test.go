package postgres

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func enableRequiredWorkflow(t *testing.T, s *Store, h *lockHTTP, rules []githttp.RefRule) {
	t.Helper()
	ctx, org := t.Context(), h.organizationID
	v, err := s.PipelineVersion(ctx, org, "p", 1)
	lockMust(t, err)
	_, err = s.CreateRepositoryPipeline(ctx, org, "required-ci", h.userID, rulesetTestRepo, &v.Definition)
	lockMust(t, err)
	_, err = s.ChangePipeline(ctx, org, "required-ci", h.userID, "publish", 1, nil)
	lockMust(t, err)
	if err := s.ValidateRequiredWorkflows(ctx, org, rulesetTestRepo, rules); !errors.Is(err, githttp.ErrIneligibleRequiredWorkflow) {
		t.Fatalf("workflow without a revision trigger was accepted: %v", err)
	}
	_, err = s.EnableWorkflowTrigger(ctx, org, "required-ci", h.userID, "changeset_revision", 1, 0)
	lockMust(t, err)
	lockMust(t, s.ValidateRequiredWorkflows(ctx, org, rulesetTestRepo, rules))
}

func TestRequiredWorkflowBlocksMergeUntilCurrentAutomaticRunPasses(t *testing.T) {
	ctx := t.Context()
	s, h, git, previous, _ := integrationFixture(t)
	org := h.organizationID
	h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Repository: s, Identity: s, CSRF: s, AllowedOrigin: lockHTTPOrigin, Catalog: s, Git: git, Locker: s, Runs: s,
	})
	checks := &githttp.RequiredWorkflows{PipelineIDs: []string{"required-ci"}, Strict: true}
	rule := githttp.RefRule{RequiredWorkflows: checks}
	enableRequiredWorkflow(t, s, h, []githttp.RefRule{rule})
	setMainMergeRuleset(t, s, org, rule)
	base, err := git.ResolveRevision(ctx, org, rulesetTestRepo, "refs/heads/main")
	lockMust(t, err)
	topic, err := git.ResolveRevision(ctx, org, rulesetTestRepo, "refs/heads/topic")
	lockMust(t, err)
	now := time.Now()
	c, err := delivery.NewChangeset("required-checks", rulesetTestRepo, "Required checks", h.userID, now)
	lockMust(t, err)
	c.PullRequest = &delivery.PullRequest{SourceBranch: "topic", BaseBranch: "main"}
	lockMust(t, c.AddPullRequestRevision("prior", delivery.GitRevision{CommitSHA: previous}, base.CommitSHA, h.userID, now))
	_, err = s.Create(ctx, org, c)
	lockMust(t, err)
	claimAndPass := func(expectedSource string) {
		t.Helper()
		task, err := s.ClaimTask(ctx, registerTestRunner(t, s, org, pipeline.ContainerCheck))
		lockMust(t, err)
		if task == nil || task.PipelineID != "required-ci" {
			t.Fatalf("expected required-ci task, got %+v", task)
		}
		if expectedSource != "" {
			if task.Trigger == nil || task.Trigger.SHA != expectedSource {
				t.Fatalf("task was not bound to the expected checkout: %+v", task.Trigger)
			}
			_, cleanup, err := git.CheckoutRevision(ctx, org, rulesetTestRepo, expectedSource)
			lockMust(t, err)
			cleanup()
			task.CheckedSourceSHA = expectedSource
		}
		lockMust(t, s.FinishTask(ctx, *task, "succeeded", "tested"))
	}
	lockMust(t, s.AdvanceTriggers(ctx))
	claimAndPass(previous)
	lockMust(t, c.AddPullRequestRevision("current", topic, base.CommitSHA, h.userID, now))
	approveRulesetTestRevision(t, c, h.userID, base.CommitSHA, "current")
	_, err = s.Update(ctx, org, c, 1)
	lockMust(t, err)
	_, err = s.CreateRun(ctx, org, "required-ci", 1, h.userID, nil)
	lockMust(t, err)
	claimAndPass("")

	merge := func() int {
		t.Helper()
		response := h.do(ctx, http.MethodPost, h.mergePath(string(c.ID)), `{"target_ref":"main"}`)
		if response.Code != 200 && !strings.Contains(response.Body.String(), "required-ci") {
			t.Fatalf("unexpected merge response: %d %s", response.Code, response.Body)
		}
		return response.Code
	}
	if merge() != http.StatusConflict {
		t.Fatal("a manual run or earlier revision authorized merging")
	}
	stillBase, err := git.ResolveRevision(ctx, org, rulesetTestRepo, "refs/heads/main")
	lockMust(t, err)
	if stillBase.CommitSHA != base.CommitSHA {
		t.Fatal("blocked merge changed target")
	}
	lockMust(t, s.AdvanceTriggers(ctx))
	claimAndPass(topic.CommitSHA)
	revision, _ := c.CurrentRevision()
	if err := s.CheckRequiredWorkflows(ctx, org, c, revision, previous, map[string]bool{"required-ci": true}); !errors.Is(err, githttp.ErrRequiredWorkflows) {
		t.Fatalf("strict check accepted a different target commit: %v", err)
	}
	if merge() != http.StatusOK {
		t.Fatal("a successful automatic run for the current revision should allow merging")
	}
}
