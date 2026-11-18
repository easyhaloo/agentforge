package postgres

import (
	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"testing"
)

func TestCandidateMaintenanceProtectsSharedBuilds(t *testing.T) {
	ctx := t.Context()
	s, h, git, _, _ := integrationFixture(t)
	org, repo := h.organizationID, "team/repo"
	preview, err := git.PrepareCandidate(ctx, org, repo, delivery.MergeRequest{Target: "main", Sources: []string{"topic"}})
	lockMust(t, err)
	sha := preview.CandidateSHA
	kept := func(want bool) {
		t.Helper()
		keep, err := s.CandidateInUse(ctx, org, repo, sha)
		lockMust(t, err)
		if keep != want {
			t.Fatalf("candidate in use %v, want %v", keep, want)
		}
	}
	if _, err = s.CandidateInUse(ctx, "unknown", repo, sha); err == nil {
		t.Fatal("unregistered tenant allowed")
	}
	kept(false)
	var runs []execution.Run
	for range 2 {
		run, err := s.CreateIntegrationRun(ctx, org, "p", 1, h.userID, nil, execution.Integration{Repository: repo, Strategy: "merge-commit", MergePreview: preview})
		lockMust(t, err)
		runs = append(runs, run)
	}
	kept(true)
	_, err = s.pool.Exec(ctx, `UPDATE pipeline_runs SET status='succeeded' WHERE id=$1`, runs[0].ID)
	lockMust(t, err)
	lockMust(t, s.PromoteIntegration(ctx, org, runs[0].ID, h.userID, sha, git))
	kept(true)
	_, err = s.pool.Exec(ctx, `UPDATE pipeline_runs SET status='failed' WHERE id=$1`, runs[1].ID)
	lockMust(t, err)
	kept(false)
	for range 2 {
		lockMust(t, git.DeleteCandidate(ctx, org, repo, sha))
	}
	if _, _, err := git.CheckoutCandidate(ctx, org, repo, sha); err == nil {
		t.Fatal("released candidate still available")
	}
	head, err := git.ResolveRevision(ctx, org, repo, "main")
	lockMust(t, err)
	if head.CommitSHA != sha {
		t.Fatal("target changed")
	}
	run, err := s.GetRun(ctx, org, runs[0].ID)
	lockMust(t, err)
	if run.Integration.CandidateSHA != sha {
		t.Fatal("audit provenance changed")
	}
}
