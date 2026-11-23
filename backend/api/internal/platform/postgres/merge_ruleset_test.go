package postgres

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

const rulesetTestRepo = "team/repo"

func setMainMergeRuleset(t *testing.T, s *Store, org string, rule githttp.RefRule) {
	t.Helper()
	metadata, err := s.ListRepositories(t.Context(), org)
	lockMust(t, err)
	for _, repository := range metadata {
		if repository.Slug != rulesetTestRepo {
			continue
		}
		rule.Name = "main policy"
		rule.Enabled = true
		rule.Target = "branch"
		rule.Include = []string{"~DEFAULT_BRANCH"}
		repository.RefRules = []githttp.RefRule{rule}
		_, err := s.SetRepositoryGeneralSettings(t.Context(), repository)
		lockMust(t, err)
		return
	}
	t.Fatal("fixture repository missing")
}

func approveRulesetTestRevision(t *testing.T, c *delivery.Changeset, actor, base string, revision delivery.ID) {
	t.Helper()
	now := time.Now()
	evalID, reviewID := revision+"-evaluation", revision+"-review"
	lockMust(t, c.RecordEvaluationAgainstBase(evalID, revision, base, delivery.EvaluationPassed, "passed", actor, now))
	lockMust(t, c.AttachEvidence(revision+"-evidence", revision, evalID, "test", "ref", actor, now))
	lockMust(t, c.AssignReview(reviewID, revision, "reviewer", actor, "", now))
	lockMust(t, c.DecideReview(reviewID, true, "reviewer", "approved", now))
}

func TestRepositoryRulesetChangesetMerge(t *testing.T) {
	ctx := t.Context()
	s, h, git, previousSHA, _ := integrationFixture(t)
	org := h.organizationID
	h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Repository: s, Identity: s, CSRF: s, AllowedOrigin: lockHTTPOrigin, Catalog: s, Git: git, Locker: s,
	})
	base, err := git.ResolveRevision(ctx, org, rulesetTestRepo, "refs/heads/main")
	lockMust(t, err)
	topic, err := git.ResolveRevision(ctx, org, rulesetTestRepo, "refs/heads/topic")
	lockMust(t, err)
	now := time.Now()
	plain, err := delivery.NewChangeset("plain-rule", rulesetTestRepo, "plain", h.userID, now)
	lockMust(t, err)
	lockMust(t, plain.AddGitRevision("current", "topic", topic.CommitSHA, topic.ParentSHA, h.userID, now))
	approveRulesetTestRevision(t, plain, h.userID, base.CommitSHA, "current")
	_, err = s.Create(ctx, org, plain)
	lockMust(t, err)
	pull, err := delivery.NewChangeset("pr-rule", rulesetTestRepo, "pull request", h.userID, now)
	lockMust(t, err)
	pull.PullRequest = &delivery.PullRequest{SourceBranch: "topic", BaseBranch: "main"}
	lockMust(t, pull.AddPullRequestRevision("prior", delivery.GitRevision{CommitSHA: previousSHA}, base.CommitSHA, h.userID, now))
	approveRulesetTestRevision(t, pull, h.userID, base.CommitSHA, "prior")
	lockMust(t, pull.AddPullRequestRevision("current", topic, base.CommitSHA, h.userID, now))
	stored, err := s.Create(ctx, org, pull)
	lockMust(t, err)

	merge := func(id delivery.ID, branch string, want int, detail string) {
		t.Helper()
		resp := h.do(ctx, http.MethodPost, h.mergePath(string(id)), `{"target_ref":"`+branch+`"}`)
		if resp.Code != want || !strings.Contains(resp.Body.String(), detail) {
			t.Fatalf("merge %s into %s: got %d %s, want %d containing %q", id, branch, resp.Code, resp.Body, want, detail)
		}
		if want != http.StatusOK {
			actual, err := git.ResolveRevision(ctx, org, rulesetTestRepo, "refs/heads/main")
			lockMust(t, err)
			if actual.CommitSHA != base.CommitSHA || h.stored(t, string(id)).Changeset.Merge != nil {
				t.Fatal("denied merge mutated Git or Changeset")
			}
		}
	}
	setMainMergeRuleset(t, s, org, githttp.RefRule{RequirePullRequest: true})
	merge(plain.ID, "main", http.StatusConflict, "verified pull request is required")
	merge(pull.ID, "other", http.StatusUnprocessableEntity, "Invalid merge target")
	merge(pull.ID, "main", http.StatusConflict, "Delivery precondition failed")
	approveRulesetTestRevision(t, pull, h.userID, base.CommitSHA, "current")
	_, err = s.Update(ctx, org, pull, stored.Version)
	lockMust(t, err)
	setMainMergeRuleset(t, s, org, githttp.RefRule{RestrictUpdate: true, RequirePullRequest: true})
	merge(pull.ID, "main", http.StatusConflict, "branch updates are restricted")
	setMainMergeRuleset(t, s, org, githttp.RefRule{RequirePullRequest: true})
	setMainMergeRuleset(t, s, org, githttp.RefRule{RequireMergeQueue: true})
	merge(pull.ID, "main", http.StatusConflict, "the merge queue is required")
	setMainMergeRuleset(t, s, org, githttp.RefRule{RequirePullRequest: true, RequireLinearHistory: true})
	merge(pull.ID, "main", http.StatusOK, "current")
	merged := h.stored(t, string(pull.ID)).Changeset.Merge
	target, err := git.ResolveRevision(ctx, org, rulesetTestRepo, "refs/heads/main")
	lockMust(t, err)
	if merged == nil || merged.RevisionID != "current" || merged.CommitSHA != target.CommitSHA || target.ParentSHA != base.CommitSHA || target.CommitSHA == topic.CommitSHA {
		t.Fatalf("verified current PR did not update branch and Changeset: %+v", merged)
	}
}

func TestRepositoryRulesetIntegrationPromotion(t *testing.T) {
	ctx := t.Context()
	root := t.TempDir()
	s, h, git, _, _ := integrationFixtureAt(t, root)
	org := h.organizationID
	api := "/api/v1/organizations/" + org
	response := h.do(ctx, http.MethodPost, api+"/pipelines/p/versions/1/integration-runs", `{"repository":"team/repo","target":"main","sources":["topic","other"]}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("create candidate: %d %s", response.Code, response.Body)
	}
	var run execution.Run
	lockMust(t, json.Unmarshal(response.Body.Bytes(), &run))
	task, err := s.ClaimTask(ctx, registerTestRunner(t, s, org, pipeline.ContainerCheck))
	lockMust(t, err)
	if task == nil || task.RunID != run.ID {
		t.Fatalf("missing candidate task: %+v", task)
	}
	lockMust(t, s.FinishTask(ctx, *task, "succeeded", "tested"))
	topic, err := git.ResolveRevision(ctx, org, rulesetTestRepo, "refs/heads/topic")
	lockMust(t, err)
	now := time.Now()
	pull, err := delivery.NewChangeset("candidate-pr", rulesetTestRepo, "topic PR", h.userID, now)
	lockMust(t, err)
	pull.PullRequest = &delivery.PullRequest{SourceBranch: "topic", BaseBranch: "main"}
	lockMust(t, pull.AddPullRequestRevision("current", topic, run.Integration.Target.SHA, h.userID, now))
	approveRulesetTestRevision(t, pull, h.userID, run.Integration.Target.SHA, "current")
	_, err = s.Create(ctx, org, pull)
	lockMust(t, err)

	promote := func(want int, detail string) {
		t.Helper()
		resp := h.do(ctx, http.MethodPost, api+"/pipeline-runs/"+run.ID+"/promote", `{"candidateSHA":"`+run.Integration.CandidateSHA+`"}`)
		if resp.Code != want || !strings.Contains(resp.Body.String(), detail) {
			t.Fatalf("promotion: got %d %s, want %d containing %q", resp.Code, resp.Body, want, detail)
		}
		if want != http.StatusOK {
			target, err := git.ResolveRevision(ctx, org, rulesetTestRepo, "refs/heads/main")
			lockMust(t, err)
			if target.CommitSHA != run.Integration.Target.SHA || h.stored(t, string(pull.ID)).Changeset.Merge != nil {
				t.Fatal("denied promotion mutated Git or Changeset")
			}
		}
	}
	setMainMergeRuleset(t, s, org, githttp.RefRule{RequireMergeQueue: true})
	promote(http.StatusConflict, "the merge queue is required")
	setMainMergeRuleset(t, s, org, githttp.RefRule{RestrictUpdate: true})
	promote(http.StatusConflict, "branch updates are restricted")
	setMainMergeRuleset(t, s, org, githttp.RefRule{RequireLinearHistory: true})
	promote(http.StatusConflict, "merge commits are not allowed by the linear history rule")
	setMainMergeRuleset(t, s, org, githttp.RefRule{RequirePullRequest: true})
	promote(http.StatusConflict, "cannot verify pull request coverage")
	other, err := git.ResolveRevision(ctx, org, rulesetTestRepo, "refs/heads/other")
	lockMust(t, err)
	otherPull, err := delivery.NewChangeset("candidate-other-pr", rulesetTestRepo, "other PR", h.userID, now)
	lockMust(t, err)
	otherPull.PullRequest = &delivery.PullRequest{SourceBranch: "other", BaseBranch: "main"}
	lockMust(t, otherPull.AddPullRequestRevision("current", other, run.Integration.Target.SHA, h.userID, now))
	stored, err := s.Create(ctx, org, otherPull)
	lockMust(t, err)
	promote(http.StatusConflict, "cannot verify pull request coverage for other")
	approveRulesetTestRevision(t, otherPull, h.userID, run.Integration.Target.SHA, "current")
	_, err = s.Update(ctx, org, otherPull, stored.Version)
	lockMust(t, err)
	moveSource := func(from, to string) {
		t.Helper()
		cmd := exec.CommandContext(ctx, "git", "-C", filepath.Join(root, org, rulesetTestRepo), "update-ref", "refs/heads/other", to, from)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("move source branch: %v %s", err, out)
		}
	}
	moveSource(other.CommitSHA, topic.CommitSHA)
	promote(http.StatusConflict, "source branch other moved")
	moveSource(topic.CommitSHA, other.CommitSHA)
	promote(http.StatusOK, "")
	for _, id := range []delivery.ID{pull.ID, otherPull.ID} {
		merged := h.stored(t, string(id)).Changeset.Merge
		if merged == nil || merged.RevisionID != "current" || merged.CommitSHA != run.Integration.CandidateSHA {
			t.Fatalf("verified pull request %s did not record the promoted revision: %+v", id, merged)
		}
	}
}

func TestRepositoryRulesetRequiresVerifiedQueueEntry(t *testing.T) {
	ctx := t.Context()
	s, h, git, _, _ := integrationFixture(t)
	org := h.organizationID
	setMainMergeRuleset(t, s, org, githttp.RefRule{RequireMergeQueue: true, RequireLinearHistory: true})
	api := "/api/v1/organizations/" + org
	response := h.do(ctx, http.MethodPost, api+"/pipelines/p/versions/1/merge-queue", `{"repository":"team/repo","target":"main","sources":["topic"]}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("enqueue: %d %s", response.Code, response.Body)
	}
	var entry execution.QueueEntry
	lockMust(t, json.Unmarshal(response.Body.Bytes(), &entry))
	run, err := s.GetRun(ctx, org, entry.RunID)
	lockMust(t, err)
	if run.Integration == nil || run.Integration.QueueEntry != entry.ID || run.Integration.Strategy != "ff-only" {
		t.Fatal("missing queue-bound run")
	}
	task, err := s.ClaimTask(ctx, registerTestRunner(t, s, org, pipeline.ContainerCheck))
	lockMust(t, err)
	if task == nil || task.RunID != entry.RunID {
		t.Fatal("missing candidate task")
	}
	lockMust(t, s.FinishTask(ctx, *task, "succeeded", "tested"))
	promote := func(want int, detail string) {
		t.Helper()
		response := h.do(ctx, http.MethodPost, api+"/pipeline-runs/"+entry.RunID+"/promote", `{"candidateSHA":"`+entry.CandidateSHA+`"}`)
		if response.Code != want || !strings.Contains(response.Body.String(), detail) {
			t.Fatalf("promote: %d %s; want %d containing %q", response.Code, response.Body, want, detail)
		}
	}
	promote(http.StatusConflict, "cannot verify pull request coverage")
	target, err := git.ResolveRevision(ctx, org, rulesetTestRepo, "refs/heads/main")
	lockMust(t, err)
	if target.CommitSHA != run.Integration.Target.SHA {
		t.Fatal("unverified queue moved main")
	}
	source, err := git.ResolveRevision(ctx, org, rulesetTestRepo, "refs/heads/topic")
	lockMust(t, err)
	now := time.Now()
	pull, err := delivery.NewChangeset("queue-pr", rulesetTestRepo, "queued pull request", h.userID, now)
	lockMust(t, err)
	pull.PullRequest = &delivery.PullRequest{SourceBranch: "topic", BaseBranch: "main"}
	lockMust(t, pull.AddPullRequestRevision("current", source, target.CommitSHA, h.userID, now))
	approveRulesetTestRevision(t, pull, h.userID, target.CommitSHA, "current")
	_, err = s.Create(ctx, org, pull)
	lockMust(t, err)
	promote(http.StatusOK, entry.CandidateSHA)
	target, err = git.ResolveRevision(ctx, org, rulesetTestRepo, "refs/heads/main")
	lockMust(t, err)
	merged := h.stored(t, string(pull.ID)).Changeset.Merge
	if target.CommitSHA != entry.CandidateSHA || merged == nil || merged.RevisionID != "current" || merged.CommitSHA != entry.CandidateSHA {
		t.Fatalf("verified queue did not advance main and record the current revision: %s %+v", target.CommitSHA, merged)
	}
}

func TestRepositoryQueueRewritesOnlyVerifiedPullRequests(t *testing.T) {
	for method, wantCommits := range map[string]string{"squash": "1", "rebase": "2"} {
		t.Run(method, func(t *testing.T) {
			ctx := t.Context()
			s, h, git, _, _ := integrationFixture(t)
			org := h.organizationID
			repo := filepath.Join(git.Root, org, "team", "repo")
			work := t.TempDir()
			runGit := func(dir string, args ...string) string {
				t.Helper()
				cmd := exec.Command("git", append([]string{"-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid"}, args...)...)
				out, err := cmd.CombinedOutput()
				if err != nil {
					t.Fatalf("git %v: %v: %s", args, err, out)
				}
				return strings.TrimSpace(string(out))
			}
			runGit(work, "clone", "--branch", "topic", repo, ".")
			for _, name := range []string{"one", "two"} {
				lockMust(t, os.WriteFile(filepath.Join(work, name), []byte(name), 0600))
				runGit(work, "add", "--", name)
				runGit(work, "commit", "-m", name)
			}
			runGit(work, "push", "origin", "topic")
			base := runGit(repo, "rev-parse", "main")
			source, err := git.ResolveRevision(ctx, org, rulesetTestRepo, "refs/heads/topic")
			lockMust(t, err)
			rule := githttp.RefRule{RequireMergeQueue: true, RequireLinearHistory: true, MergeQueueMethod: method}
			setMainMergeRuleset(t, s, org, rule)
			_, err = s.pool.Exec(ctx, `UPDATE delivery_repositories SET delete_merged_branches=true WHERE organization_id=$1 AND slug=$2`, org, rulesetTestRepo)
			lockMust(t, err)
			api := "/api/v1/organizations/" + org
			enqueue := func(branch string) execution.QueueEntry {
				t.Helper()
				res := h.do(ctx, http.MethodPost, api+"/pipelines/p/versions/1/merge-queue", `{"repository":"team/repo","target":"main","sources":["`+branch+`"]}`)
				if res.Code != http.StatusCreated {
					t.Fatalf("enqueue %s: %d %s", branch, res.Code, res.Body)
				}
				var entry execution.QueueEntry
				lockMust(t, json.Unmarshal(res.Body.Bytes(), &entry))
				return entry
			}
			entry := enqueue("topic")
			second := enqueue("other")
			lockMust(t, s.AdvanceQueue(ctx, git))
			entries, err := s.ListQueue(ctx, org, rulesetTestRepo, "main")
			lockMust(t, err)
			if len(entries) != 2 || entries[1].ID != second.ID || entries[1].RunID == "" {
				t.Fatalf("second entry did not build behind the head: %+v", entries)
			}
			train, err := s.GetRun(ctx, org, entries[1].RunID)
			lockMust(t, err)
			if train.Integration == nil || len(train.Integration.Sources) != 2 {
				t.Fatalf("expected a speculative train for both sources: %+v", train.Integration)
			}
			run, err := s.GetRun(ctx, org, entry.RunID)
			lockMust(t, err)
			if run.Integration == nil || run.Integration.Strategy != method || entry.CandidateSHA == source.CommitSHA {
				t.Fatalf("unexpected queue candidate: %+v", run.Integration)
			}
			task, err := s.ClaimTask(ctx, registerTestRunner(t, s, org, pipeline.ContainerCheck))
			lockMust(t, err)
			if task == nil || task.RunID != entry.RunID {
				t.Fatal("missing candidate task")
			}
			lockMust(t, s.FinishTask(ctx, *task, "succeeded", "tested"))
			promote := func(want int, detail string) {
				t.Helper()
				res := h.do(ctx, http.MethodPost, api+"/pipeline-runs/"+entry.RunID+"/promote", `{"candidateSHA":"`+entry.CandidateSHA+`"}`)
				if res.Code != want || !strings.Contains(res.Body.String(), detail) {
					t.Fatalf("promote: %d %s; want %d %q", res.Code, res.Body, want, detail)
				}
			}
			promote(http.StatusConflict, "cannot verify pull request coverage")
			now := time.Now()
			pull, err := delivery.NewChangeset("queue-rewrite-pr", rulesetTestRepo, "verified pull request", h.userID, now)
			lockMust(t, err)
			pull.PullRequest = &delivery.PullRequest{SourceBranch: "topic", BaseBranch: "main"}
			lockMust(t, pull.AddPullRequestRevision("current", source, base, h.userID, now))
			approveRulesetTestRevision(t, pull, h.userID, base, "current")
			_, err = s.Create(ctx, org, pull)
			lockMust(t, err)
			runGit(repo, "update-ref", "refs/heads/topic", source.ParentSHA, source.CommitSHA)
			promote(http.StatusConflict, "source branch topic moved")
			if got := runGit(repo, "rev-parse", "main"); got != base {
				t.Fatalf("rejected promotion moved main to %s", got)
			}
			runGit(repo, "update-ref", "refs/heads/topic", source.CommitSHA, source.ParentSHA)
			promote(http.StatusOK, entry.CandidateSHA)
			if got := runGit(repo, "rev-parse", "main"); got != entry.CandidateSHA {
				t.Fatalf("main = %s, want %s", got, entry.CandidateSHA)
			}
			if got := runGit(repo, "rev-list", "--count", base+"..main"); got != wantCommits {
				t.Fatalf("%s introduced %s commits, want %s", method, got, wantCommits)
			}
			if runGit(repo, "show", "main:one") != "one" || runGit(repo, "show", "main:two") != "two" {
				t.Fatal("merged files differ from verified changes")
			}
			if merged := h.stored(t, string(pull.ID)).Changeset.Merge; merged == nil || merged.RevisionID != "current" || merged.CommitSHA != entry.CandidateSHA {
				t.Fatalf("merge did not record original revision and rewritten SHA: %+v", merged)
			}
			if got := runGit(repo, "for-each-ref", "refs/heads/topic"); got != "" {
				t.Fatalf("merged source branch was not deleted: %s", got)
			}
			lockMust(t, s.AdvanceQueue(ctx, git))
			entries, err = s.ListQueue(ctx, org, rulesetTestRepo, "main")
			lockMust(t, err)
			if len(entries) != 1 || entries[0].ID != second.ID || entries[0].RunID == "" || entries[0].RunID == train.ID {
				t.Fatalf("queue did not rebuild the second entry: %+v", entries)
			}
			rebuilt, err := s.GetRun(ctx, org, entries[0].RunID)
			lockMust(t, err)
			if rebuilt.Integration == nil || rebuilt.Integration.Target.SHA != entry.CandidateSHA || len(rebuilt.Integration.Sources) != 1 || rebuilt.Integration.Sources[0].SHA != second.SourceSHA {
				t.Fatalf("rebuilt candidate must use the promoted base and the second pinned source: %+v", rebuilt.Integration)
			}
		})
	}
}

func TestNativePullMergeMethodsAndRecovery(t *testing.T) {
	for _, method := range []string{"merge", "squash", "rebase"} {
		t.Run(method, func(t *testing.T) {
			ctx := t.Context()
			s, h, git, _, _ := integrationFixture(t)
			org := h.organizationID
			h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
				Repository: s, Identity: s, CSRF: s, AllowedOrigin: lockHTTPOrigin, Catalog: s, Git: git, Locker: s,
			})
			base, err := git.ResolveRevision(ctx, org, rulesetTestRepo, "refs/heads/main")
			lockMust(t, err)
			checkout := t.TempDir()
			repo := filepath.Join(git.Root, org, "team", "repo")
			run := func(directory string, args ...string) string {
				t.Helper()
				out, err := exec.Command("git", append([]string{"-C", directory, "-c", "user.name=Test", "-c", "user.email=test@example.invalid"}, args...)...).CombinedOutput()
				if err != nil {
					t.Fatalf("git %v: %v: %s", args, err, out)
				}
				return strings.TrimSpace(string(out))
			}
			run(checkout, "clone", "--branch", "topic", repo, ".")
			for _, name := range []string{"one", "two"} {
				lockMust(t, os.WriteFile(filepath.Join(checkout, name), []byte(name), 0600))
				run(checkout, "add", "--", name)
				run(checkout, "commit", "-m", name)
			}
			run(checkout, "push", "origin", "topic")
			source, err := git.ResolveRevision(ctx, org, rulesetTestRepo, "refs/heads/topic")
			lockMust(t, err)
			now := time.Now()
			pull, err := delivery.NewChangeset("native-pull", rulesetTestRepo, "native PR", h.userID, now)
			lockMust(t, err)
			pull.PullRequest = &delivery.PullRequest{SourceBranch: "topic", BaseBranch: "main"}
			lockMust(t, pull.AddPullRequestRevision("current", source, base.CommitSHA, h.userID, now))
			stored, err := s.Create(ctx, org, pull)
			lockMust(t, err)
			merge := func(want int) {
				t.Helper()
				resp := h.do(ctx, http.MethodPost, h.mergePath(string(pull.ID)), `{"target_ref":"main","merge_method":"`+method+`"}`)
				if resp.Code != want {
					t.Fatalf("merge returned %d %s, want %d", resp.Code, resp.Body, want)
				}
			}
			merge(http.StatusConflict)
			approveRulesetTestRevision(t, pull, h.userID, base.CommitSHA, "current")
			stored, err = s.Update(ctx, org, pull, stored.Version)
			lockMust(t, err)
			if method == "merge" {
				setMainMergeRuleset(t, s, org, githttp.RefRule{RequireLinearHistory: true})
				merge(http.StatusConflict)
				setMainMergeRuleset(t, s, org, githttp.RefRule{RequirePullRequest: true})
			}
			if head := run(repo, "rev-parse", "main"); head != base.CommitSHA {
				t.Fatalf("denied merge moved target to %s", head)
			}
			if method == "squash" {
				_, err := s.pool.Exec(ctx, `CREATE FUNCTION reject_pull_merge_result() RETURNS trigger LANGUAGE plpgsql AS $$
				BEGIN IF OLD.pull_merge_intent IS NOT NULL AND NEW.state ? 'merge' THEN RAISE EXCEPTION 'simulated persistence failure'; END IF; RETURN NEW; END $$;
				CREATE TRIGGER reject_pull_merge_result BEFORE UPDATE ON delivery_changesets FOR EACH ROW EXECUTE FUNCTION reject_pull_merge_result()`)
				lockMust(t, err)
				merge(http.StatusInternalServerError)
				intent, err := s.PullMergeIntent(ctx, org, pull.ID)
				lockMust(t, err)
				if intent == nil || run(repo, "rev-parse", "main") != intent.Candidate.CandidateSHA || h.stored(t, string(pull.ID)).Changeset.Merge != nil {
					t.Fatal("the interrupted merge did not preserve a recoverable decision")
				}
				if _, err := s.Update(ctx, org, pull, stored.Version); !errors.Is(err, ErrVersionConflict) {
					t.Fatalf("pending merge must fence other updates: %v", err)
				}
				_, err = s.pool.Exec(ctx, `DROP TRIGGER reject_pull_merge_result ON delivery_changesets`)
				lockMust(t, err)
				setMainMergeRuleset(t, s, org, githttp.RefRule{RequireMergeQueue: true})
			}
			merge(http.StatusOK)
			tip := run(repo, "rev-parse", "main")
			storedMerge := h.stored(t, string(pull.ID)).Changeset.Merge
			if storedMerge == nil || storedMerge.RevisionID != "current" || storedMerge.Actor != h.userID || storedMerge.CommitSHA != tip || run(repo, "show", "main:two") != "two" {
				t.Fatalf("incorrect merged record or tree: %+v", storedMerge)
			}
			switch method {
			case "merge":
				if parents := strings.Fields(run(repo, "show", "-s", "--format=%P", "main")); len(parents) != 2 || parents[1] != source.CommitSHA {
					t.Fatalf("merge commit has unexpected parents: %v", parents)
				}
			default:
				want := map[string]string{"squash": "1", "rebase": "2"}[method]
				if count := run(repo, "rev-list", "--count", base.CommitSHA+"..main"); count != want {
					t.Fatalf("wrong number of rewritten commits: %s", count)
				}
			}
		})
	}
}
