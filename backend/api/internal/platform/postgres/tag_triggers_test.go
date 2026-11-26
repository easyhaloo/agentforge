package postgres

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
)

// fixtureGit runs one git command against the fixture's bare repository and returns its output.
func fixtureGit(t *testing.T, git *delivery.LocalGitProvider, org string, args ...string) string {
	t.Helper()
	repo := filepath.Join(git.Root, org, "team", "repo")
	cmd := exec.Command("git", append([]string{"-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid"}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v %s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

// resolveCommit mirrors the peel the run path relies on: annotation tags resolve to commits.
func resolveCommit(t *testing.T, git *delivery.LocalGitProvider, org, ref string) string {
	t.Helper()
	repo := filepath.Join(git.Root, org, "team", "repo")
	out, err := exec.Command("git", "-C", repo, "rev-parse", ref+"^{commit}").Output()
	if err != nil {
		t.Fatalf("resolve %s: %v", ref, err)
	}
	return strings.TrimSpace(string(out))
}

// TestTagTriggerEnqueueIdempotentAndIsolated covers tag binding admission, the annotation-tag
// peel, enqueue idempotency across replays, run provenance and cross-organization isolation.
// It needs PostgreSQL and local Git, so CI runs it; locally it skips without DATABASE_URL.
func TestTagTriggerEnqueueIdempotentAndIsolated(t *testing.T) {
	ctx := t.Context()
	s, h, git, commit, _ := integrationFixture(t)
	org, actor := h.organizationID, h.userID

	v, err := s.PipelineVersion(ctx, org, "p", 1)
	lockMust(t, err)
	_, err = s.CreateRepositoryPipeline(ctx, org, "tag-ci", actor, "team/repo", &v.Definition)
	lockMust(t, err)
	_, err = s.ChangePipeline(ctx, org, "tag-ci", actor, "publish", 1, &v.Definition)
	lockMust(t, err)

	tagBinding, err := s.EnableWorkflowTrigger(ctx, org, "tag-ci", actor, "tag", "v*", 1, 0)
	lockMust(t, err)
	if tagBinding.TagPattern != "v*" {
		t.Fatalf("binding lost its pattern: %+v", tagBinding)
	}
	if _, err = s.EnableWorkflowTrigger(ctx, org, "tag-ci", actor, "tag", "../escape", 1, 0); err != pipeline.ErrTagPattern {
		t.Fatalf("an unsafe tag pattern was accepted: %v", err)
	}

	// An annotation tag must peel to the commit before enqueueing.
	annotated := fixtureGit(t, git, org, "tag", "-a", "-m", "annotated", "annotated-tag", commit)
	if peeled := resolveCommit(t, git, org, annotated); peeled != commit {
		t.Fatalf("annotation tag peeled to %s, want %s", peeled, commit)
	}

	lightweight := fixtureGit(t, git, org, "tag", "v1.0.0", commit)
	lockMust(t, s.EnqueueTagRuns(ctx, org, "team/repo", "refs/tags/"+lightweight, commit))
	lockMust(t, s.EnqueueTagRuns(ctx, org, "team/repo", "refs/tags/"+lightweight, commit)) // replay

	var events int
	lockMust(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM pipeline_trigger_events WHERE source->>'kind'='tag'`).Scan(&events))
	if events != 1 {
		t.Fatalf("replayed tag push produced %d events, want 1", events)
	}

	// A tag whose name matches no binding pattern is filtered at enqueue time: no event, no run.
	lockMust(t, s.EnqueueTagRuns(ctx, org, "team/repo", "refs/tags/not-a-release", commit))
	lockMust(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM pipeline_trigger_events WHERE source->>'kind'='tag' AND source->>'tag'='not-a-release'`).Scan(&events))
	if events != 0 {
		t.Fatalf("unmatched tag produced %d events, want 0", events)
	}

	// A stale event whose pattern changed after enqueue is skipped at dispatch: the durable
	// event stays but starts no run.
	_, err = s.pool.Exec(ctx, `INSERT INTO pipeline_trigger_events(binding_id,source)
	SELECT b.id,jsonb_build_object('kind','tag','bindingId',b.id,'repository',b.repository,'ref','refs/tags/retag','tag','retag','sha',$1)
	FROM pipeline_trigger_bindings b WHERE b.organization_id=$2 AND b.tag_pattern='v*'`, commit, org)
	lockMust(t, err)
	_, err = s.pool.Exec(ctx, `UPDATE pipeline_trigger_bindings SET tag_pattern='v2*' WHERE organization_id=$1 AND tag_pattern='v*'`, org)
	lockMust(t, err)
	lockMust(t, s.AdvanceTriggers(ctx))
	lockMust(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM pipeline_trigger_events WHERE source->>'tag'='retag' AND outcome='skipped'`).Scan(&events))
	if events != 1 {
		t.Fatalf("stale pattern event got %d skips, want 1", events)
	}

	// Enabling the same tag kind twice conflicts (409 at the API layer).
	_, err = s.EnableWorkflowTrigger(ctx, org, "tag-ci", actor, "tag", "v2*", 1, 0)
	if err != pipeline.ErrConflict {
		t.Fatalf("duplicate tag rule returned %v, want ErrConflict", err)
	}
	lockMust(t, s.AdvanceTriggers(ctx))
	var runID string
	lockMust(t, s.pool.QueryRow(ctx, `SELECT e.run_id FROM pipeline_trigger_events e WHERE e.source->>'kind'='tag' AND e.source->>'tag'=$1 AND e.outcome='queued'`, lightweight).Scan(&runID))
	run, err := s.GetRun(ctx, org, runID)
	lockMust(t, err)
	if run.Trigger == nil || run.Trigger.Kind != "tag" || run.Trigger.Tag != lightweight || run.Trigger.SHA != commit || run.Trigger.Repository != "team/repo" {
		t.Fatalf("tag run lost its provenance: %+v", run.Trigger)
	}

	// Another organization must not see the run.
	slugInsertOrganization(t, ctx, s, "foreign", "foreign", "active")
	foreign, err := s.GetRun(ctx, "foreign", runID)
	if foreign.ID != "" || err != pipeline.ErrMissing {
		t.Fatalf("cross-organization read returned %v, %v", foreign.ID, err)
	}

	// A disabled workflow captures no further tag events.
	_, err = s.pool.Exec(ctx, `UPDATE pipelines SET disabled=true WHERE organization_id=$1 AND id='tag-ci'`, org)
	lockMust(t, err)
	updated := fixtureGit(t, git, org, "tag", "v1.0.1", commit)
	lockMust(t, s.EnqueueTagRuns(ctx, org, "team/repo", "refs/tags/"+updated, commit))
	lockMust(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM pipeline_trigger_events WHERE source->>'kind'='tag' AND source->>'tag'=$1`, updated).Scan(&events))
	if events != 0 {
		t.Fatalf("disabled workflow captured %d tag events", events)
	}
}
