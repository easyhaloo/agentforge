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

func TestRepositoryMergeMethodsSettingsAndWebMerge(t *testing.T) {
	ctx := t.Context()
	s, h, git, _, _ := integrationFixture(t)
	org, repo := h.organizationID, rulesetTestRepo
	h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Repository: s, Identity: s, CSRF: s, AllowedOrigin: lockHTTPOrigin, Catalog: s, Git: git, Preview: git, Locker: s,
	})
	path := "/api/v1/organizations/" + org + "/repositories/" + repo
	read := func(endpoint string) delivery.RepositoryMetadata {
		t.Helper()
		resp := h.do(ctx, http.MethodGet, path+endpoint, "")
		if resp.Code != 200 {
			t.Fatalf("GET %s: %d %s", endpoint, resp.Code, resp.Body)
		}
		var got delivery.RepositoryMetadata
		lockMust(t, json.Unmarshal(resp.Body.Bytes(), &got))
		return got
	}
	assertMethods := func(got delivery.RepositoryMetadata, merge, squash, rebase bool) {
		t.Helper()
		if got.AllowMergeCommit == nil || *got.AllowMergeCommit != merge || got.AllowSquashMerge == nil || *got.AllowSquashMerge != squash || got.AllowRebaseMerge == nil || *got.AllowRebaseMerge != rebase {
			t.Fatalf("unexpected merge method settings: %+v", got)
		}
	}
	patch := func(version time.Time, fields string, want int, detail string) {
		t.Helper()
		payload := `{"updated_at":"` + version.Format(time.RFC3339Nano) + `",` + fields + `}`
		resp := h.do(ctx, http.MethodPatch, path+"/settings", payload)
		if resp.Code != want || !strings.Contains(resp.Body.String(), detail) {
			t.Fatalf("PATCH %s: %d %s; want %d containing %q", payload, resp.Code, resp.Body, want, detail)
		}
	}
	initial := read("/settings")
	assertMethods(initial, true, true, true)
	patch(initial.UpdatedAt, `"allow_merge_commit":false`, 200, `"allow_merge_commit":false`)
	patch(initial.UpdatedAt, `"allow_squash_merge":false`, 409, "Repository settings changed")
	current := read("/settings")
	assertMethods(current, false, true, true)
	patch(current.UpdatedAt, `"allow_squash_merge":false,"allow_rebase_merge":false`, 422, "Enable at least one pull request merge method")
	patch(current.UpdatedAt, `"description":"preserve merge methods"`, 200, `"allow_merge_commit":false`)
	assertMethods(read("/refs"), false, true, true)

	base, err := git.ResolveRevision(ctx, org, repo, "refs/heads/main")
	lockMust(t, err)
	source, err := git.ResolveRevision(ctx, org, repo, "refs/heads/topic")
	lockMust(t, err)
	now := time.Now()
	pr, err := delivery.NewChangeset("merge-method-pr", repo, "verified pull request", h.userID, now)
	lockMust(t, err)
	pr.PullRequest = &delivery.PullRequest{SourceBranch: "topic", BaseBranch: "main"}
	lockMust(t, pr.AddPullRequestRevision("current", source, base.CommitSHA, h.userID, now))
	approveRulesetTestRevision(t, pr, h.userID, base.CommitSHA, "current")
	_, err = s.Create(ctx, org, pr)
	lockMust(t, err)
	merge := func(body string, want int, detail string) {
		t.Helper()
		resp := h.do(ctx, http.MethodPost, h.mergePath(string(pr.ID)), body)
		if resp.Code != want || !strings.Contains(resp.Body.String(), detail) {
			t.Fatalf("web merge: %d %s; want %d containing %q", resp.Code, resp.Body, want, detail)
		}
	}
	merge(`{"target_ref":"main","merge_method":"merge"}`, 409, "Merge method unavailable")
	after, err := git.ResolveRevision(ctx, org, repo, "refs/heads/main")
	lockMust(t, err)
	if after.CommitSHA != base.CommitSHA || h.stored(t, string(pr.ID)).Changeset.Merge != nil {
		t.Fatal("disabled web merge changed the branch or PR")
	}
	setMainMergeRuleset(t, s, org, githttp.RefRule{RequireLinearHistory: true})
	merge(`{"target_ref":"main"}`, 200, `"status":"merged"`)
	merged, err := git.ResolveRevision(ctx, org, repo, "refs/heads/main")
	lockMust(t, err)
	if merged.CommitSHA == source.CommitSHA || merged.ParentSHA != base.CommitSHA {
		t.Fatal("the default method should squash when merge commits are disabled")
	}
}

func TestRepositoryMergeMethodsQueueAdmissionAndPromotion(t *testing.T) {
	ctx := t.Context()
	s, h, git, _, _ := integrationFixture(t)
	org, repo := h.organizationID, rulesetTestRepo
	api := "/api/v1/organizations/" + org
	setMergeCommit := func(enabled bool) {
		t.Helper()
		items, err := s.ListRepositories(ctx, org)
		lockMust(t, err)
		for _, item := range items {
			if item.Slug == repo {
				_, err := s.PatchRepositoryGeneralSettings(ctx, item, githttp.MergeMethods{AllowMergeCommit: &enabled})
				lockMust(t, err)
				return
			}
		}
		t.Fatal("missing fixture repository")
	}
	enqueue := func(want int) execution.QueueEntry {
		t.Helper()
		resp := h.do(ctx, http.MethodPost, api+"/pipelines/p/versions/1/merge-queue", `{"repository":"team/repo","target":"main","sources":["topic"]}`)
		if resp.Code != want || (want == 409 && !strings.Contains(resp.Body.String(), "Merge method disabled")) {
			t.Fatalf("admission: %d %s; want %d", resp.Code, resp.Body, want)
		}
		var entry execution.QueueEntry
		if want == 201 {
			lockMust(t, json.Unmarshal(resp.Body.Bytes(), &entry))
		}
		return entry
	}
	setMergeCommit(false)
	enqueue(409)
	entries, err := s.ListQueue(ctx, org, repo, "main")
	lockMust(t, err)
	if len(entries) != 0 {
		t.Fatal("denied admission inserted a queue entry")
	}
	setMergeCommit(true)
	entry := enqueue(201)
	task, err := s.ClaimTask(ctx, registerTestRunner(t, s, org, pipeline.ContainerCheck))
	lockMust(t, err)
	if task == nil || task.RunID != entry.RunID {
		t.Fatal("candidate task missing")
	}
	lockMust(t, s.FinishTask(ctx, *task, "succeeded", "passed"))
	base, err := git.ResolveRevision(ctx, org, repo, "refs/heads/main")
	lockMust(t, err)
	setMergeCommit(false)
	resp := h.do(ctx, http.MethodPost, api+"/pipeline-runs/"+entry.RunID+"/promote", `{"candidateSHA":"`+entry.CandidateSHA+`"}`)
	if resp.Code != 409 || !strings.Contains(resp.Body.String(), "Merge method disabled") {
		t.Fatalf("promotion: %d %s", resp.Code, resp.Body)
	}
	after, err := git.ResolveRevision(ctx, org, repo, "refs/heads/main")
	lockMust(t, err)
	recorded, err := git.HasPromotion(ctx, org, repo, entry.RunID, entry.CandidateSHA)
	lockMust(t, err)
	if after.CommitSHA != base.CommitSHA || recorded {
		t.Fatal("disabled promotion moved the branch or wrote a receipt")
	}
}
