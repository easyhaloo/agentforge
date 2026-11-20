package postgres

import (
	"strings"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
)

func TestTriggerRecoveryAndConcurrentAdmission(t *testing.T) {
	ctx := t.Context()
	s, h, _, sha, dsn := integrationFixture(t)
	exec := func(sql string, args ...any) { t.Helper(); _, err := s.pool.Exec(ctx, sql, args...); lockMust(t, err) }
	exec(`INSERT INTO pipeline_trigger_bindings(organization_id,pipeline_id,version,actor_id,repository) VALUES($1,'p',1,$2,'team/repo')`, h.organizationID, h.userID)
	exec(`INSERT INTO pipeline_trigger_bindings(organization_id,pipeline_id,version,actor_id,every_seconds,next_due) VALUES($1,'p',1,$2,3600,now()-interval '3 days')`, h.organizationID, h.userID)
	c := &delivery.Changeset{ID: "change", Title: "test", Repository: "team/repo", Revisions: []delivery.Revision{{ID: "r1", CommitSHA: sha}}}
	stored, err := s.Create(ctx, h.organizationID, c)
	lockMust(t, err)
	secondSHA := strings.Repeat("b", 40)
	c.Revisions = append(c.Revisions, delivery.Revision{ID: "r2", CommitSHA: secondSHA})
	stored, err = s.Update(ctx, h.organizationID, c, stored.Version)
	lockMust(t, err)
	stored, err = s.Update(ctx, h.organizationID, c, stored.Version)
	lockMust(t, err)
	slugInsertOrganization(t, ctx, s, "foreign", "foreign", "active")
	_, err = s.Create(ctx, "foreign", c)
	lockMust(t, err)
	s.Close()
	s, err = Open(ctx, dsn)
	lockMust(t, err)
	defer s.Close()
	done := make(chan error, 8)
	for range 8 {
		go func() { done <- s.AdvanceTriggers(ctx) }()
	}
	for range 8 {
		lockMust(t, <-done)
	}
	for range 3 {
		lockMust(t, s.AdvanceTriggers(ctx))
	}
	count := func(sql string, want int) {
		t.Helper()
		var n int
		lockMust(t, s.pool.QueryRow(ctx, sql).Scan(&n))
		if n != want {
			t.Fatalf("%s: got %d, want %d", sql, n, want)
		}
	}
	count(`SELECT count(*) FROM pipeline_runs`, 3)
	count(`SELECT count(*) FROM pipeline_trigger_events WHERE outcome='queued'`, 3)
	count(`SELECT count(*) FROM pipeline_runs WHERE trigger_source->>'kind'='schedule' AND (trigger_source->>'scheduledAt')::timestamptz BETWEEN now()-interval '1 hour' AND now()`, 1)
	var id string
	lockMust(t, s.pool.QueryRow(ctx, `SELECT id FROM pipeline_runs WHERE trigger_source->>'revisionId'='r1'`).Scan(&id))
	r, err := s.GetRun(ctx, h.organizationID, id)
	lockMust(t, err)
	if r.Trigger.SHA != sha || r.Trigger.ChangesetID != "change" || r.Trigger.BindingID == "" {
		t.Fatal("wrong revision source", r.Trigger)
	}
	if _, err = s.GetRun(ctx, "foreign", id); err != pipeline.ErrMissing {
		t.Fatal("foreign run access", err)
	}
	if _, err = s.pool.Exec(ctx, `UPDATE pipeline_runs SET trigger_source=NULL WHERE id=$1`, id); err == nil {
		t.Fatal("rewrote run provenance")
	}
	exec(`UPDATE organization_memberships SET role='viewer' WHERE organization_id=$1 AND user_id=$2`, h.organizationID, h.userID)
	c.Revisions = append(c.Revisions, delivery.Revision{ID: "r3", CommitSHA: secondSHA})
	_, err = s.Update(ctx, h.organizationID, c, stored.Version)
	lockMust(t, err)
	lockMust(t, s.AdvanceTriggers(ctx))
	count(`SELECT count(*) FROM pipeline_trigger_events WHERE outcome='denied'`, 1)
	count(`SELECT count(*) FROM pipeline_runs`, 3)
}
