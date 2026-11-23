package postgres

import (
	"errors"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
)

func TestMergeQueueRecoveryAfterPromotionCommitFailure(t *testing.T) {
	ctx := t.Context()
	s, h, git, revision, dsn := integrationFixture(t)
	org, repo := h.organizationID, "team/repo"
	admit := func(source string) execution.QueueEntry {
		t.Helper()
		preview, err := git.PrepareCandidate(ctx, org, repo, delivery.MergeRequest{Target: "main", Sources: []string{source}})
		lockMust(t, err)
		e, err := s.Enqueue(ctx, org, "p", 1, h.userID, nil, execution.Integration{Repository: repo, Strategy: "merge-commit", MergePreview: preview})
		lockMust(t, err)
		return e
	}
	head, tail := admit("topic"), admit("other")
	lockMust(t, s.AdvanceQueue(ctx, git))
	entries := func() []execution.QueueEntry {
		t.Helper()
		q, err := s.ListQueue(ctx, org, repo, "main")
		lockMust(t, err)
		return q
	}
	before := entries()
	if len(before) != 2 || before[1].RunID == "" {
		t.Fatalf("expected a built tail, got %+v", before)
	}
	task, err := s.ClaimTask(ctx, registerTestRunner(t, s, org, pipeline.ContainerCheck))
	lockMust(t, err)
	if task == nil || task.RunID != head.RunID {
		t.Fatalf("expected head task, got %+v", task)
	}
	lockMust(t, s.FinishTask(ctx, *task, "succeeded", "passed"))
	base, err := git.ResolveRevision(ctx, org, repo, "refs/heads/main")
	lockMust(t, err)
	now := time.Now()
	c, err := delivery.NewChangeset("reviewed", repo, "topic", h.userID, now)
	lockMust(t, err)
	lockMust(t, c.AddGitRevision("rev", "topic", revision, "", h.userID, now))
	lockMust(t, c.RecordEvaluationAgainstBase("eval", "rev", base.CommitSHA, delivery.EvaluationPassed, "passed", h.userID, now))
	lockMust(t, c.AttachEvidence("evidence", "rev", "eval", "test", "ref", h.userID, now))
	lockMust(t, c.AssignReview("review", "rev", "reviewer", h.userID, "", now))
	lockMust(t, c.DecideReview("review", true, "reviewer", "ok", now))
	created, err := s.Create(ctx, org, c)
	lockMust(t, err)
	execSQL := func(sql string, args ...any) {
		t.Helper()
		_, err := s.pool.Exec(ctx, sql, args...)
		lockMust(t, err)
	}
	execSQL(`CREATE FUNCTION fail_promotion_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected promotion commit failure'; END $$;
 CREATE CONSTRAINT TRIGGER fail_promotion_commit AFTER INSERT ON integration_promotions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_promotion_commit()`)
	promote := func(actor string) error {
		return s.PromoteIntegration(ctx, org, head.RunID, actor, head.CandidateSHA, git)
	}
	const promoter = "promotion-admin"
	execSQL(`INSERT INTO users(id,display_name) VALUES ($1,$1)`, promoter)
	execSQL(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'admin','active')`, org, promoter)
	if err := promote(promoter); err == nil || !strings.Contains(err.Error(), "injected promotion commit failure") {
		t.Fatalf("expected deferred COMMIT failure, got %v", err)
	}
	moved, err := git.ResolveRevision(ctx, org, repo, "refs/heads/main")
	lockMust(t, err)
	receipt, err := git.HasPromotion(ctx, org, repo, head.RunID, head.CandidateSHA)
	lockMust(t, err)
	if !receipt || moved.CommitSHA != head.CandidateSHA {
		t.Fatal("Git transaction did not commit")
	}
	assertAudit := func(want int) {
		t.Helper()
		for _, q := range []string{
			`SELECT count(*),coalesce(min(actor_id),'') FROM integration_promotions WHERE run_id=$1`,
			`SELECT count(*),coalesce(min(actor),'') FROM merge_queue_events WHERE run_id=$1 AND status='promoted'`,
			`SELECT count(*),coalesce(min(actor),'') FROM pipeline_run_events WHERE run_id=$1 AND kind='promoted'`,
		} {
			var n int
			var actor string
			lockMust(t, s.pool.QueryRow(ctx, q, head.RunID).Scan(&n, &actor))
			if n != want || want == 1 && actor != promoter {
				t.Fatalf("%s: count=%d actor=%q", q, n, actor)
			}
		}
		stored, err := s.Get(ctx, org, c.ID)
		lockMust(t, err)
		m := stored.Changeset.Merge
		if stored.Version != created.Version+int64(want) || (m != nil) != (want == 1) {
			t.Fatalf("unexpected changeset version or merge: %d %+v", stored.Version, m)
		}
		if m != nil && (m.Actor != promoter || m.CommitSHA != head.CandidateSHA || m.RevisionID != "rev" || m.ID != delivery.ID(head.RunID)) {
			t.Fatalf("unexpected changeset after %d promotions: %+v version %d", want, m, stored.Version)
		}
	}
	assertAudit(0)
	s.Close()
	s, err = Open(ctx, dsn)
	lockMust(t, err)
	defer s.Close()
	for _, id := range []int64{head.ID, tail.ID} {
		execSQL(`UPDATE merge_queue_entries SET checked_at=CASE WHEN id=$1 THEN '-infinity'::timestamptz ELSE now() END`, id)
		lockMust(t, s.AdvanceQueue(ctx, git))
		if err := s.CancelQueueEntry(ctx, org, id, h.userID, git); !errors.Is(err, pipeline.ErrConflict) {
			t.Fatalf("cancel %d: %v", id, err)
		}
		if got := entries(); !slices.Equal(got, before) {
			t.Fatalf("queue changed before recovery: %+v", got)
		}
	}
	execSQL(`DROP TRIGGER fail_promotion_commit ON integration_promotions`)
	if err := promote("unrelated-user"); !errors.Is(err, execution.ErrTriggerDenied) {
		t.Fatalf("unauthorized retry: %v", err)
	}
	// A ruleset enabled after Git wrote its receipt cannot invalidate recovery.
	setMainMergeRuleset(t, s, org, true, true)
	// A later branch move must survive replay of the receipt.
	path := filepath.Join(git.Root, org, repo)
	if out, err := exec.CommandContext(ctx, "git", "-C", path, "update-ref", "refs/heads/main", tail.SourceSHA, head.CandidateSHA).CombinedOutput(); err != nil {
		t.Fatalf("advance branch: %v %s", err, out)
	}
	errs := make(chan error, 2)
	for range 2 {
		go func() { errs <- promote(h.userID) }()
	}
	for range 2 {
		lockMust(t, <-errs)
	}
	assertAudit(1)
	var reconciliations int
	var reconciler string
	lockMust(t, s.pool.QueryRow(ctx, `SELECT count(*),coalesce(min(actor),'') FROM pipeline_run_events WHERE run_id=$1 AND kind='promotion_reconciled'`, head.RunID).Scan(&reconciliations, &reconciler))
	if reconciliations != 1 || reconciler != h.userID {
		t.Fatalf("recovery audit: count=%d actor=%q", reconciliations, reconciler)
	}
	moved, err = git.ResolveRevision(ctx, org, repo, "refs/heads/main")
	lockMust(t, err)
	if moved.CommitSHA != tail.SourceSHA {
		t.Fatal("recovery overwrote later target")
	}
	if got := entries(); len(got) != 1 || got[0].ID != tail.ID || got[0].Status != "queued" || got[0].RunID != "" {
		t.Fatalf("expected tail ready to rebuild, got %+v", got)
	}
}
