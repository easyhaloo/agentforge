package postgres

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestRequiredPRConversations(t *testing.T) {
	for _, queued := range []bool{false, true} {
		name := "manual merge"
		if queued {
			name = "queue admission and promotion"
		}
		t.Run(name, func(t *testing.T) {
			ctx := t.Context()
			s, h, git, previousSHA, _ := integrationFixture(t)
			org, repo := h.organizationID, rulesetTestRepo
			h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
				Repository: s, Identity: s, CSRF: s, AllowedOrigin: lockHTTPOrigin, Catalog: s, Git: git, Locker: s, Runs: s,
			})
			rule := githttp.RefRule{RequirePullRequest: true, RequiredReviewThreadResolution: true, RequireMergeQueue: queued}
			setMainMergeRuleset(t, s, org, rule)
			base, err := git.ResolveRevision(ctx, org, repo, "refs/heads/main")
			lockMust(t, err)
			source, err := git.ResolveRevision(ctx, org, repo, "refs/heads/topic")
			lockMust(t, err)
			now := time.Now()
			pull, err := delivery.NewChangeset("conversations-pr", repo, "Review conversations", h.userID, now)
			lockMust(t, err)
			pull.PullRequest = &delivery.PullRequest{SourceBranch: "topic", BaseBranch: "main"}
			lockMust(t, pull.AddPullRequestRevision("previous", delivery.GitRevision{CommitSHA: previousSHA}, base.CommitSHA, h.userID, now))
			lockMust(t, pull.AddPRComment("inline", h.userID, "Outdated thread", "previous", "README.md", "right", 1, now))
			lockMust(t, pull.AddPRComment("general", h.userID, "General comment", "", "", "", 0, now))
			lockMust(t, pull.AddPullRequestRevision("current", source, base.CommitSHA, h.userID, now))
			approveRulesetTestRevision(t, pull, h.userID, base.CommitSHA, "current")
			_, err = s.Create(ctx, org, pull)
			lockMust(t, err)

			request := func(method, path, body string, status int, detail string) []byte {
				t.Helper()
				resp := h.do(ctx, method, path, body)
				if resp.Code != status || !strings.Contains(resp.Body.String(), detail) {
					t.Fatalf("%s %s: %d %s, want %d containing %q", method, path, resp.Code, resp.Body, status, detail)
				}
				return resp.Body.Bytes()
			}
			unchanged := func() {
				t.Helper()
				current, err := git.ResolveRevision(ctx, org, repo, "refs/heads/main")
				lockMust(t, err)
				if current.CommitSHA != base.CommitSHA || h.stored(t, string(pull.ID)).Changeset.Merge != nil {
					t.Fatal("a rejected merge moved the ref or persisted a merge record")
				}
			}
			commentPath := h.changesetsPath() + "/" + string(pull.ID) + "/pull-request/comments/"
			setResolution := func(value string) delivery.StoredChangeset {
				t.Helper()
				request(http.MethodPatch, commentPath+"inline/resolution", value, 200, "")
				return h.stored(t, string(pull.ID))
			}
			resolve := func() delivery.StoredChangeset { return setResolution(`{"resolved":true}`) }
			reopen := func() delivery.StoredChangeset { return setResolution(`{"resolved":false}`) }
			blocked := githttp.ErrUnresolvedConversations.Error()

			if !queued {
				merge := func(status int, detail string) {
					t.Helper()
					request(http.MethodPost, h.mergePath(string(pull.ID)), `{"target_ref":"main"}`, status, detail)
				}
				merge(409, blocked)
				unchanged()
				request(http.MethodPatch, commentPath+"general/resolution", `{"resolved":true}`, 404, "Inline conversation not found")
				request(http.MethodPatch, commentPath+"inline/resolution", `{}`, 400, "Resolution required")
				other := newLockHTTP(t, &lockFixture{ctx: ctx, store: s}, 0, repo)
				other.handler = h.handler
				outsidePath := strings.Replace(commentPath, org, other.organizationID, 1) + "inline/resolution"
				if resp := other.do(ctx, http.MethodPatch, outsidePath, `{"resolved":true}`); resp.Code != 404 {
					t.Fatalf("foreign organization resolution: %d %s", resp.Code, resp.Body)
				}
				_, err = s.pool.Exec(ctx, `INSERT INTO organization_memberships (organization_id,user_id,role,status) VALUES ($1,$2,'viewer','active')`, org, other.userID)
				lockMust(t, err)
				if resp := other.do(ctx, http.MethodPatch, commentPath+"inline/resolution", `{"resolved":true}`); resp.Code != 403 {
					t.Fatalf("viewer resolution: %d %s", resp.Code, resp.Body)
				}
				resolved := resolve()
				thread := resolved.Changeset.PullRequest.Comments[0]
				if thread.ResolvedAt == nil || thread.ResolvedBy != h.userID || resolved.Version != resolve().Version {
					t.Fatal("resolution did not persist resolver/time or was not idempotent")
				}
				thread = reopen().Changeset.PullRequest.Comments[0]
				if thread.ResolvedAt != nil || thread.ResolvedBy != "" {
					t.Fatal("reopening did not clear resolution")
				}
				merge(409, blocked)
				unchanged()
				resolve()
				merge(200, `"status":"merged"`)
				return
			}

			api := "/api/v1/organizations/" + org
			enqueue := func(status int, detail string) []byte {
				t.Helper()
				return request(http.MethodPost, api+"/pipelines/p/versions/1/merge-queue", `{"repository":"team/repo","target":"main","sources":["topic"]}`, status, detail)
			}
			enqueue(409, blocked)
			var count int
			lockMust(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM merge_queue_entries WHERE organization_id=$1`, org).Scan(&count))
			if count != 0 {
				t.Fatal("rejected admission persisted a queue entry")
			}
			resolve()
			var entry execution.QueueEntry
			lockMust(t, json.Unmarshal(enqueue(201, ""), &entry))
			task, err := s.ClaimTask(ctx, registerTestRunner(t, s, org, pipeline.ContainerCheck))
			lockMust(t, err)
			if task == nil || task.RunID != entry.RunID {
				t.Fatal("candidate task missing")
			}
			lockMust(t, s.FinishTask(ctx, *task, "succeeded", "passed"))
			promote := func(status int, detail string) {
				t.Helper()
				request(http.MethodPost, api+"/pipeline-runs/"+entry.RunID+"/promote", `{"candidateSHA":"`+entry.CandidateSHA+`"}`, status, detail)
			}
			reopen()
			promote(409, blocked)
			unchanged()
			recorded, err := git.HasPromotion(ctx, org, repo, entry.RunID, entry.CandidateSHA)
			lockMust(t, err)
			if recorded {
				t.Fatal("rejected promotion wrote a Git receipt")
			}
			resolve()
			promote(200, entry.CandidateSHA)
		})
	}
}
