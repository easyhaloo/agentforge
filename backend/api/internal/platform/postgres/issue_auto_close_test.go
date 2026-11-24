package postgres

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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
		name                                                     string
		disabled, nonDefault, queued, registered, squash, closed bool
	}{
		{name: "default branch", closed: true},
		{name: "disabled", disabled: true},
		{name: "non-default branch", nonDefault: true},
		{name: "queue promotion", queued: true, closed: true},
		{name: "registered checkout", registered: true, closed: true},
		{name: "squashed source message", squash: true, closed: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ctx := t.Context()
			store, h, git, _, _ := integrationFixture(t)
			org, repo := h.organizationID, "team/repo"
			gitPath := filepath.Join(git.Root, org, "team", "repo")
			runGit := func(path string, args ...string) string {
				t.Helper()
				cmd := exec.CommandContext(ctx, "git", append([]string{"-C", path, "-c", "user.name=Test", "-c", "user.email=test@example.invalid"}, args...)...)
				out, err := cmd.CombinedOutput()
				if err != nil {
					t.Fatalf("git %v: %v %s", args, err, out)
				}
				return strings.TrimSpace(string(out))
			}
			if scenario.registered {
				bare := gitPath + "-bare"
				lockMust(t, os.Rename(gitPath, bare))
				runGit(filepath.Dir(gitPath), "clone", "--no-local", bare, gitPath)
				runGit(gitPath, "branch", "topic", "origin/topic")
				runGit(gitPath, "branch", "main", "origin/main")
			}
			tree := runGit(gitPath, "rev-parse", "topic^{tree}")
			commit := runGit(gitPath, "commit-tree", tree, "-p", "topic", "-m", "Resolve #4")
			runGit(gitPath, "update-ref", "refs/heads/topic", commit)
			repository := NewIssueRepository(store)
			h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
				Repository: store, Identity: store, CSRF: store, AllowedOrigin: lockHTTPOrigin,
				Catalog: store, Git: git, Locker: store, Runs: store, IssueRepo: repository,
			})
			basePath := "/api/v1/organizations/" + org
			for _, title := range []string{"Linked issue", "Plain reference", "Closing keyword", "Commit message keyword"} {
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
			pull.PullRequest = &delivery.PullRequest{BaseBranch: "main", SourceBranch: "topic", Description: "See #2. Fixes: #3."}
			lockMust(t, pull.AddPullRequestRevision("current", source, base.CommitSHA, h.userID, now))
			approveRulesetTestRevision(t, pull, h.userID, base.CommitSHA, "current")
			_, err = repository.CreateLinkedPullRequest(ctx, issues.DetailScope{
				OrganizationID: org, Repository: repo, Number: 1, UserID: h.userID, CanManage: true,
			}, pull)
			lockMust(t, err)
			if scenario.disabled || scenario.squash {
				settings, err := store.ListRepositories(ctx, org)
				lockMust(t, err)
				settings[0].AutoCloseIssuesDisabled = scenario.disabled
				if scenario.squash {
					settings[0].SquashCommitMessageFormat = "description"
				}
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
				body := `{"target_ref":"main"}`
				if scenario.squash {
					body = `{"target_ref":"main","merge_method":"squash"}`
				}
				resp := h.do(ctx, http.MethodPost, h.mergePath(string(pull.ID)), body)
				if resp.Code != http.StatusOK {
					t.Fatalf("merge: %d %s", resp.Code, resp.Body)
				}
				// Repeating the merge cannot insert another close event.
				h.do(ctx, http.MethodPost, h.mergePath(string(pull.ID)), `{"target_ref":"main"}`)
			}
			for _, number := range []int{1, 2, 3, 4} {
				var closed bool
				var events int
				lockMust(t, store.pool.QueryRow(ctx, `SELECT COALESCE(i.state='closed' AND i.state_reason='completed' AND i.closed_by=$4,false), (
					SELECT count(*) FROM issue_events e WHERE (e.organization_id,e.issue_id)=(i.organization_id,i.id)
					AND e.event_type='closed' AND (e.metadata->>'changeset_id'=$5 OR e.metadata->>'commit_sha'=$6)
				) FROM issues i WHERE i.organization_id=$1 AND i.repository=$2 AND i.number=$3`,
					org, repo, number, h.userID, string(pull.ID), commit).Scan(&closed, &events))
				want := scenario.closed && number != 2 && (number != 4 || !scenario.squash)
				if closed != want || events > 1 || (events == 1) != want {
					t.Fatalf("issue %d: closed=%t, close events=%d, want closure=%t", number, closed, events, want)
				}
			}
		})
	}
}

func TestMergedPullRequestCrossRepositoryIssuePermissions(t *testing.T) {
	ctx := t.Context()
	store, author, _, _, _ := integrationFixture(t)
	fixture := &lockFixture{ctx: ctx, store: store}
	allowed := newLockHTTP(t, fixture, 0, "permitted/target")
	denied := newLockHTTP(t, fixture, 0, "restricted/target")
	_, err := store.pool.Exec(ctx, `UPDATE organizations SET slug=CASE WHEN id=$1 THEN 'permitted' ELSE 'restricted' END WHERE id IN ($1,$2)`, allowed.organizationID, denied.organizationID)
	lockMust(t, err)
	_, err = store.pool.Exec(ctx, `INSERT INTO organization_memberships (organization_id,user_id,role,status)
		VALUES ($1,$3,'admin','active'), ($2,$3,'member','active')`, allowed.organizationID, denied.organizationID, author.userID)
	lockMust(t, err)
	repository := NewIssueRepository(store)
	now := time.Now().UTC()
	for _, fixture := range []struct {
		tenant *lockHTTP
		slug   string
	}{
		{allowed, "permitted/target"}, {denied, "restricted/target"},
	} {
		_, err := repository.Create(ctx, fixture.tenant.organizationID, &issues.Issue{
			ID: "issue", Repository: fixture.slug, Title: "Closing target", State: issues.StateOpen,
			CreatedBy: fixture.tenant.userID, CreatedAt: now, UpdatedAt: now,
		})
		lockMust(t, err)
	}
	pull, err := delivery.NewChangeset("cross-repository", "team/repo", "Cross-repository change", author.userID, now)
	lockMust(t, err)
	pull.PullRequest = &delivery.PullRequest{BaseBranch: "main", Description: "Closes Permitted/target#1 and fixes restricted/target#1."}
	tx, err := store.pool.Begin(ctx)
	lockMust(t, err)
	defer tx.Rollback(ctx)
	lockMust(t, closeMergedPullIssues(ctx, tx, author.organizationID, pull, "main", author.userID))
	lockMust(t, tx.Commit(ctx))
	for _, scenario := range []struct {
		tenant *lockHTTP
		slug   string
		want   issues.State
	}{
		{allowed, "permitted/target", issues.StateClosed}, {denied, "restricted/target", issues.StateOpen},
	} {
		issue, err := repository.Get(ctx, scenario.tenant.organizationID, scenario.slug, 1)
		lockMust(t, err)
		if issue.State != scenario.want {
			t.Errorf("issue in %s has state %s, want %s", scenario.slug, issue.State, scenario.want)
		}
	}
}
