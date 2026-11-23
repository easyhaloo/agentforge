package postgres

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestMergedPullRequestClosesLinkedIssues(t *testing.T) {
	for _, scenario := range []struct {
		name                                 string
		disabled, nonDefault, queued, closed bool
	}{
		{name: "default branch", closed: true},
		{name: "disabled", disabled: true},
		{name: "non-default branch", nonDefault: true},
		{name: "queue promotion", queued: true, closed: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ctx := t.Context()
			store, h, git, _, _ := integrationFixture(t)
			org, repo := h.organizationID, "team/repo"
			repository := NewIssueRepository(store)
			h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
				Repository: store, Identity: store, CSRF: store, AllowedOrigin: lockHTTPOrigin,
				Catalog: store, Git: git, Locker: store, Runs: store, IssueRepo: repository,
			})
			basePath := "/api/v1/organizations/" + org
			for _, title := range []string{"Linked issue", "Unlinked issue"} {
				resp := h.do(ctx, http.MethodPost, basePath+"/issues", `{"repository":"team/repo","title":"`+title+`"}`)
				if resp.Code != http.StatusCreated {
					t.Fatalf("create issue: %d %s", resp.Code, resp.Body)
				}
			}
			base, err := git.ResolveRevision(ctx, org, repo, "refs/heads/main")
			lockMust(t, err)
			source, err := git.ResolveRevision(ctx, org, repo, "refs/heads/topic")
			lockMust(t, err)
			now := time.Now().UTC()
			pull, err := delivery.NewChangeset("linked-pull", repo, "Fix linked issue", h.userID, now)
			lockMust(t, err)
			pull.PullRequest = &delivery.PullRequest{BaseBranch: "main", SourceBranch: "topic"}
			lockMust(t, pull.AddPullRequestRevision("current", source, base.CommitSHA, h.userID, now))
			approveRulesetTestRevision(t, pull, h.userID, base.CommitSHA, "current")
			_, err = repository.CreateLinkedPullRequest(ctx, issues.DetailScope{
				OrganizationID: org, Repository: repo, Number: 1, UserID: h.userID, CanManage: true,
			}, pull)
			lockMust(t, err)
			if scenario.disabled {
				settings, err := store.ListRepositories(ctx, org)
				lockMust(t, err)
				settings[0].AutoCloseIssuesDisabled = true
				_, err = store.SetRepositoryGeneralSettings(ctx, settings[0])
				lockMust(t, err)
			}
			if scenario.nonDefault {
				lockMust(t, store.SetRepositoryDefaultBranch(ctx, org, repo, "other", "main", func() error { return nil }))
			}
			if scenario.queued {
				resp := h.do(ctx, http.MethodPost, basePath+"/pipelines/p/versions/1/merge-queue", `{"repository":"team/repo","target":"main","sources":["topic"]}`)
				if resp.Code != http.StatusCreated {
					t.Fatalf("enqueue: %d %s", resp.Code, resp.Body)
				}
				var entry execution.QueueEntry
				lockMust(t, json.Unmarshal(resp.Body.Bytes(), &entry))
				task, err := store.ClaimTask(ctx, registerTestRunner(t, store, org, pipeline.ContainerCheck))
				lockMust(t, err)
				if task == nil {
					t.Fatal("no queue task claimed")
				}
				lockMust(t, store.FinishTask(ctx, *task, "succeeded", "tested"))
				lockMust(t, store.PromoteIntegration(ctx, org, entry.RunID, h.userID, entry.CandidateSHA, git))
			} else {
				resp := h.do(ctx, http.MethodPost, h.mergePath(string(pull.ID)), `{"target_ref":"main"}`)
				if resp.Code != http.StatusOK {
					t.Fatalf("merge: %d %s", resp.Code, resp.Body)
				}
				// Repeating the merge cannot insert another close event.
				h.do(ctx, http.MethodPost, h.mergePath(string(pull.ID)), `{"target_ref":"main"}`)
			}
			for _, number := range []int{1, 2} {
				var closed bool
				var events int
				lockMust(t, store.pool.QueryRow(ctx, `SELECT COALESCE(i.state='closed' AND i.state_reason='completed' AND i.closed_by=$4,false), (
					SELECT count(*) FROM issue_events e WHERE (e.organization_id,e.issue_id)=(i.organization_id,i.id)
					AND e.event_type='closed' AND e.metadata->>'changeset_id'=$5
				) FROM issues i WHERE i.organization_id=$1 AND i.repository=$2 AND i.number=$3`,
					org, repo, number, h.userID, string(pull.ID)).Scan(&closed, &events))
				want := scenario.closed && number == 1
				if closed != want || events > 1 || (events == 1) != want {
					t.Fatalf("issue %d: closed=%t, close events=%d, want closure=%t", number, closed, events, want)
				}
			}
		})
	}
}
