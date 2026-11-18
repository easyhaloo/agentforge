package postgres

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func integrationFixture(t *testing.T) (*Store, *lockHTTP, *delivery.LocalGitProvider, string, string) {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("requires PostgreSQL")
	}
	ctx := t.Context()
	dsn = slugScratchDatabase(t, dsn, 1)
	s, err := Open(ctx, dsn)
	lockMust(t, err)
	t.Cleanup(s.Close)
	fx := &lockFixture{ctx: ctx, store: s}
	h := newLockHTTP(t, fx, 0, "team/repo")
	root := t.TempDir()
	src := t.TempDir()
	git := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", src, "-c", "user.name=Test", "-c", "user.email=test@example.invalid"}, args...)...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	git("init", "-b", "main")
	git("commit", "--allow-empty", "-m", "base")
	git("checkout", "-b", "topic")
	git("commit", "--allow-empty", "-m", "reviewed revision")
	revision := git("rev-parse", "HEAD")
	git("commit", "--allow-empty", "-m", "descendant")
	git("checkout", "-b", "other", "main")
	git("commit", "--allow-empty", "-m", "independent")
	git("clone", "--bare", src, filepath.Join(root, h.organizationID, "team", "repo"))
	provider, err := delivery.NewLocalGitProvider(root, time.Minute)
	lockMust(t, err)
	h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{Repository: s, Identity: s, CSRF: s, AllowedOrigin: lockHTTPOrigin, Runs: s, Catalog: s, Git: provider})
	def := pipeline.Definition{APIVersion: pipeline.APIVersion, Name: "build", Stages: []pipeline.Stage{{ID: "ci", Jobs: []pipeline.Job{{ID: "job", Steps: []pipeline.Step{{ID: "test", Uses: pipeline.ContainerCheck}}}}}}}
	for i, action := range []string{"create", "publish"} {
		_, err = s.ChangePipeline(ctx, h.organizationID, "p", h.userID, action, i, &def)
		lockMust(t, err)
	}
	return s, h, provider, revision, dsn
}

func TestIntegrationBuildAndGatedPromotion(t *testing.T) {
	ctx := t.Context()
	s, h, _, revision, _ := integrationFixture(t)
	base := "/api/v1/organizations/" + h.organizationID
	resp := h.do(ctx, "POST", base+"/pipelines/p/versions/1/integration-runs", `{"repository":"team/repo","target":"main","sources":["topic"]}`)
	if resp.Code != 201 {
		t.Fatalf("build: %d %s", resp.Code, resp.Body)
	}
	var run execution.Run
	lockMust(t, json.Unmarshal(resp.Body.Bytes(), &run))
	if run.Integration == nil {
		t.Fatal("missing candidate")
	}
	promote := func(sha string, want int) {
		t.Helper()
		resp := h.do(ctx, "POST", base+"/pipeline-runs/"+run.ID+"/promote", `{"candidateSHA":"`+sha+`"}`)
		if resp.Code != want {
			t.Fatalf("promote: %d %s, want %d", resp.Code, resp.Body, want)
		}
	}
	sha := run.Integration.CandidateSHA
	promote(sha, 409)
	task, err := s.ClaimTask(ctx, "worker")
	lockMust(t, err)
	if task == nil || task.Integration == nil || task.Integration.CandidateSHA != sha {
		t.Fatal("worker received wrong candidate")
	}
	lockMust(t, s.FinishTask(ctx, *task, "succeeded", "tested"))
	promote(run.Integration.Target.SHA, 409)
	now := time.Now()
	c, err := delivery.NewChangeset("c", "team/repo", "review", h.userID, now)
	lockMust(t, err)
	lockMust(t, c.AddGitRevision("rev", "topic", revision, "", h.userID, now))
	stored, err := s.Create(ctx, h.organizationID, c)
	lockMust(t, err)
	promote(sha, 409)
	lockMust(t, c.RecordEvaluationAgainstBase("eval", "rev", run.Integration.Target.SHA, delivery.EvaluationPassed, "passed", h.userID, now))
	lockMust(t, c.AttachEvidence("evidence", "rev", "eval", "test", "ref", h.userID, now))
	lockMust(t, c.AssignReview("review", "rev", "reviewer", h.userID, "", now))
	lockMust(t, c.DecideReview("review", true, "reviewer", "ok", now))
	_, err = s.Update(ctx, h.organizationID, c, stored.Version)
	lockMust(t, err)
	promote(sha, 200)
	promote(sha, 200)
	stored, err = s.Get(ctx, h.organizationID, c.ID)
	lockMust(t, err)
	if stored.Changeset.Merge == nil || stored.Changeset.Merge.CommitSHA != sha {
		t.Fatal("changeset did not record candidate")
	}
}

func TestMergeQueueRebuildAfterRemoval(t *testing.T) {
	ctx := t.Context()
	store, h, git, _, dsn := integrationFixture(t)
	org, repo, target := h.organizationID, "team/repo", "main"
	base := "/api/v1/organizations/" + org
	enqueue := func(source string) execution.QueueEntry {
		t.Helper()
		resp := h.do(ctx, "POST", base+"/pipelines/p/versions/1/merge-queue", `{"repository":"team/repo","target":"main","sources":["`+source+`"]}`)
		if resp.Code != 201 {
			t.Fatalf("enqueue %s: %d %s", source, resp.Code, resp.Body)
		}
		var e execution.QueueEntry
		lockMust(t, json.Unmarshal(resp.Body.Bytes(), &e))
		return e
	}
	first := enqueue("topic")
	second := enqueue("other")
	if first.RunID == "" || second.RunID != "" || first.ID >= second.ID {
		t.Fatal("unexpected initial order", first, second)
	}
	store.Close()
	s, err := Open(ctx, dsn)
	lockMust(t, err)
	defer s.Close()
	advance := func() {
		t.Helper()
		errs := make(chan error, 2)
		for range 2 {
			go func() { errs <- s.AdvanceQueue(ctx, git) }()
		}
		for range 2 {
			lockMust(t, <-errs)
		}
	}
	list := func() []execution.QueueEntry {
		t.Helper()
		entries, err := s.ListQueue(ctx, org, repo, target)
		lockMust(t, err)
		return entries
	}
	advance()
	built := list()[1]
	r, err := s.GetRun(ctx, org, built.RunID)
	lockMust(t, err)
	if len(r.Integration.Sources) != 2 || r.Integration.Sources[0].SHA != first.SourceSHA || r.Integration.Sources[1].SHA != second.SourceSHA {
		t.Fatal("incorrect train", r.Integration)
	}
	finish := func(expected string) {
		t.Helper()
		task, err := s.ClaimTask(ctx, "worker")
		lockMust(t, err)
		if task == nil || task.RunID != expected {
			t.Fatalf("expected task for %s, got %v", expected, task)
		}
		lockMust(t, s.FinishTask(ctx, *task, "succeeded", "passed"))
	}
	finish(first.RunID)
	finish(built.RunID)
	promote := func(e execution.QueueEntry) error {
		return s.PromoteIntegration(ctx, org, e.RunID, h.userID, e.CandidateSHA, git)
	}
	if err := promote(built); !errors.Is(err, pipeline.ErrConflict) {
		t.Fatal("non-head promotion", err)
	}
	if err := s.CancelQueueEntry(ctx, "unrelated", first.ID, h.userID); !errors.Is(err, pipeline.ErrMissing) {
		t.Fatal("foreign cancellation", err)
	}
	lockMust(t, s.CancelQueueEntry(ctx, org, first.ID, h.userID))
	entries := list()
	if len(entries) != 1 || entries[0].RunID != "" {
		t.Fatal("stale reference", entries)
	}
	if err := promote(built); !errors.Is(err, pipeline.ErrConflict) {
		t.Fatal("detached run promoted", err)
	}
	advance()
	rebuilt := list()[0]
	if rebuilt.CandidateSHA == built.CandidateSHA || rebuilt.RunID == built.RunID {
		t.Fatal("stale rebuild", rebuilt)
	}
	finish(rebuilt.RunID)
	errs := make(chan error, 2)
	for range 2 {
		go func() { errs <- promote(rebuilt) }()
	}
	for range 2 {
		lockMust(t, <-errs)
	}
	head, err := git.ResolveRevision(ctx, org, repo, "refs/heads/main")
	lockMust(t, err)
	if head.CommitSHA != rebuilt.CandidateSHA || len(list()) != 0 {
		t.Fatal("promotion did not drain head")
	}
	var promotions int
	lockMust(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM integration_promotions`).Scan(&promotions))
	if promotions != 1 {
		t.Fatal("duplicate promotion", promotions)
	}
}

func TestMergeQueueConcurrentAdmissionAndFailedHead(t *testing.T) {
	ctx := t.Context()
	s, h, git, _, _ := integrationFixture(t)
	org, repo := h.organizationID, "team/repo"
	admit := func(source string) func() (execution.QueueEntry, error) {
		t.Helper()
		preview, err := git.PrepareCandidate(ctx, org, repo, delivery.MergeRequest{Target: "main", Sources: []string{source}})
		lockMust(t, err)
		return func() (execution.QueueEntry, error) {
			return s.Enqueue(ctx, org, "p", 1, h.userID, nil, execution.Integration{MergePreview: preview, Repository: repo, Strategy: "merge-commit"})
		}
	}
	enqueue := admit("topic")
	outcomes := make(chan error, 2)
	for range 2 {
		go func() { _, err := enqueue(); outcomes <- err }()
	}
	a, b := <-outcomes, <-outcomes
	if !(a == nil && errors.Is(b, pipeline.ErrConflict) || b == nil && errors.Is(a, pipeline.ErrConflict)) {
		t.Fatalf("duplicate admission: %v, %v", a, b)
	}
	_, err := admit("other")()
	lockMust(t, err)
	lockMust(t, s.AdvanceQueue(ctx, git))
	entries, err := s.ListQueue(ctx, org, repo, "main")
	lockMust(t, err)
	head, err := s.ClaimTask(ctx, "worker1")
	lockMust(t, err)
	tail, err := s.ClaimTask(ctx, "worker2")
	lockMust(t, err)
	if head == nil || tail == nil || head.RunID != entries[0].RunID || tail.RunID != entries[1].RunID {
		t.Fatal("expected both builds to be leased")
	}
	lockMust(t, s.FinishTask(ctx, *head, "failed", "check failed"))
	_, err = s.pool.Exec(ctx, `UPDATE merge_queue_entries SET checked_at='-infinity' WHERE id=$1`, entries[0].ID)
	lockMust(t, err)
	lockMust(t, s.AdvanceQueue(ctx, git))
	if !errors.Is(s.Heartbeat(ctx, *tail), execution.ErrLease) {
		t.Fatal("superseded worker retained its lease")
	}
	detached, err := s.GetRun(ctx, org, tail.RunID)
	lockMust(t, err)
	if detached.Status != "cancelled" {
		t.Fatal("detached build still consumes quota")
	}
	_, err = s.pool.Exec(ctx, `UPDATE organization_memberships SET role='viewer' WHERE organization_id=$1 AND user_id=$2`, org, h.userID)
	lockMust(t, err)
	lockMust(t, s.AdvanceQueue(ctx, git))
	remaining, err := s.ListQueue(ctx, org, repo, "main")
	lockMust(t, err)
	if len(remaining) != 0 {
		t.Fatal("rebuilt after membership downgrade", remaining)
	}
}
