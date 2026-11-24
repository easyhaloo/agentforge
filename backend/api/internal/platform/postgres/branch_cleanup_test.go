package postgres

import (
	"encoding/json"
	"errors"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestMergeAutomaticallyDeletesOnlyUnusedReviewedBranches(t *testing.T) {
	for _, scenario := range []struct {
		name, protected                                    string
		enabled, queued, inUse, checkedOut, moved, deleted bool
	}{
		{name: "disabled by default"},
		{name: "direct merge", enabled: true, deleted: true},
		{name: "queue promotion", enabled: true, queued: true, deleted: true},
		{name: "protected", enabled: true, protected: "refs/heads/topic"},
		{name: "open pull request", enabled: true, inUse: true},
		{name: "linked worktree", enabled: true, checkedOut: true},
		{name: "source advanced after review", enabled: true, queued: true, moved: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ctx := t.Context()
			root := t.TempDir()
			s, h, git, reviewed, _ := integrationFixtureAt(t, root)
			h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{Repository: s, Identity: s, CSRF: s, AllowedOrigin: lockHTTPOrigin, Runs: s, Catalog: s, Locker: s, Git: git})
			org, repo := h.organizationID, "team/repo"
			baseURL := "/api/v1/organizations/" + org
			base, err := git.ResolveRevision(ctx, org, repo, "refs/heads/main")
			lockMust(t, err)
			if scenario.enabled {
				repositories, err := s.ListRepositories(ctx, org)
				lockMust(t, err)
				settings := repositories[0]
				settings.DeleteMergedBranches = true
				if scenario.protected != "" {
					settings.ProtectedRefs = []string{scenario.protected}
				}
				_, err = s.SetRepositoryGeneralSettings(ctx, settings)
				lockMust(t, err)
			}
			gitCommand := func(args ...string) {
				t.Helper()
				cmd := exec.CommandContext(ctx, "git", append([]string{"-C", filepath.Join(root, org, repo)}, args...)...)
				if out, err := cmd.CombinedOutput(); err != nil {
					t.Fatalf("git %v: %v %s", args, err, out)
				}
			}
			if !scenario.moved {
				gitCommand("update-ref", "refs/heads/topic", reviewed)
			}
			if scenario.checkedOut {
				gitCommand("worktree", "add", filepath.Join(t.TempDir(), "topic"), "topic")
			}
			now := time.Now().UTC()
			change, err := delivery.NewChangeset("cleanup", repo, "PR ready to merge", h.userID, now)
			lockMust(t, err)
			change.PullRequest = &delivery.PullRequest{SourceBranch: "topic", BaseBranch: "main"}
			lockMust(t, change.AddGitRevision("revision", "topic", reviewed, base.CommitSHA, h.userID, now))
			lockMust(t, change.RecordEvaluationAgainstBase("eval", "revision", base.CommitSHA, delivery.EvaluationPassed, "passed", h.userID, now))
			lockMust(t, change.AttachEvidence("evidence", "revision", "eval", "test", "ref", h.userID, now))
			lockMust(t, change.AssignReview("review", "revision", "reviewer", h.userID, "", now))
			lockMust(t, change.DecideReview("review", true, "reviewer", "ok", now))
			_, err = s.Create(ctx, org, change)
			lockMust(t, err)
			if scenario.inUse {
				open, err := delivery.NewChangeset("open", repo, "Another draft", h.userID, now)
				lockMust(t, err)
				open.PullRequest = &delivery.PullRequest{SourceBranch: "other", BaseBranch: "topic", Draft: true}
				_, err = s.Create(ctx, org, open)
				lockMust(t, err)
			}
			if scenario.queued {
				if scenario.moved {
					// Build the reviewed topic first, then advance the live branch before promotion.
					tip, err := git.ResolveRevision(ctx, org, repo, "refs/heads/topic")
					lockMust(t, err)
					gitCommand("update-ref", "refs/heads/moved", tip.CommitSHA)
					gitCommand("update-ref", "refs/heads/topic", reviewed)
				}
				resp := h.do(ctx, "POST", baseURL+"/pipelines/p/versions/1/merge-queue", `{"repository":"team/repo","target":"main","sources":["topic"]}`)
				if resp.Code != 201 {
					t.Fatalf("enqueue: %d %s", resp.Code, resp.Body)
				}
				var entry execution.QueueEntry
				lockMust(t, json.Unmarshal(resp.Body.Bytes(), &entry))
				if scenario.moved {
					gitCommand("update-ref", "refs/heads/topic", "refs/heads/moved")
				}
				task, err := s.ClaimTask(ctx, registerTestRunner(t, s, org, pipeline.ContainerCheck))
				lockMust(t, err)
				if task == nil {
					t.Fatal("no evaluation task claimed")
				}
				lockMust(t, s.FinishTask(ctx, *task, "succeeded", "tested"))
				lockMust(t, s.PromoteIntegration(ctx, org, entry.RunID, h.userID, entry.CandidateSHA, git))
			} else {
				resp := h.do(ctx, "POST", baseURL+"/changesets/cleanup/merge", `{"target_ref":"main"}`)
				if resp.Code != 200 {
					t.Fatalf("merge: %d %s", resp.Code, resp.Body)
				}
			}
			stored := h.stored(t, "cleanup")
			if stored.Changeset.Merge == nil || stored.Changeset.Merge.RevisionID != "revision" {
				t.Fatal("merge was not recorded against the reviewed revision")
			}
			_, err = git.ResolveRevision(ctx, org, repo, "refs/heads/topic")
			if scenario.deleted {
				if !errors.Is(err, delivery.ErrRepositoryInvalid) {
					t.Fatalf("expected topic to be deleted, got %v", err)
				}
			} else {
				lockMust(t, err)
			}
		})
	}
}
