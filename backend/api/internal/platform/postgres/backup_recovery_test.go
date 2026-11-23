package postgres

import (
	"bytes"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
)

// The CI PostgreSQL service includes matching pg_dump and pg_restore clients.
func TestBackupRestoresCandidateAndQueue(t *testing.T) {
	container := os.Getenv("TEST_POSTGRES_CONTAINER")
	if container == "" {
		t.Skip("requires a disposable PostgreSQL service container")
	}
	ctx := t.Context()
	s, h, git, _, source := integrationFixture(t)
	org, repo := h.organizationID, "team/repo"
	preview, err := git.PrepareCandidate(ctx, org, repo, delivery.MergeRequest{Target: "main", Sources: []string{"topic"}})
	lockMust(t, err)
	entry, err := s.Enqueue(ctx, org, "p", 1, h.userID, nil, execution.Integration{Repository: repo, Strategy: "merge-commit", MergePreview: preview}, git)
	lockMust(t, err)
	token := registerTestRunner(t, s, org, pipeline.ContainerCheck)
	s.Close()
	destination := slugScratchDatabase(t, os.Getenv("DATABASE_URL"), 2)
	databaseCommand := func(dsn, script string) *exec.Cmd {
		u, err := url.Parse(dsn)
		lockMust(t, err)
		return exec.CommandContext(ctx, "docker", "exec", "-i", "--env", "PGDATABASE="+strings.TrimPrefix(u.Path, "/"), container, "sh", "-ec", script)
	}
	dump, err := databaseCommand(source, `exec pg_dump -U "$POSTGRES_USER" -Fc`).Output()
	lockMust(t, err)
	restore := databaseCommand(destination, `exec pg_restore -U "$POSTGRES_USER" --no-owner --single-transaction --exit-on-error -d "$PGDATABASE"`)
	restore.Stdin = bytes.NewReader(dump)
	if out, err := restore.CombinedOutput(); err != nil {
		t.Fatalf("restore: %v %s", err, out)
	}
	root := t.TempDir()
	bundle := filepath.Join(root, "repo.bundle")
	to := filepath.Join(root, org, repo)
	lockMust(t, os.MkdirAll(filepath.Dir(to), 0700))
	for _, args := range [][]string{{"-C", filepath.Join(git.Root, org, repo), "bundle", "create", bundle, "--all"}, {"clone", "--mirror", bundle, to}, {"-C", to, "fsck", "--full"}} {
		if out, err := exec.CommandContext(ctx, "git", args...).CombinedOutput(); err != nil {
			t.Fatalf("restore Git: %v %s", err, out)
		}
	}
	probe, err := os.ReadFile("../../../ops/pipeline-health.sql")
	lockMust(t, err)
	health := databaseCommand(destination, `exec psql -Xq -U "$POSTGRES_USER"`)
	health.Stdin = bytes.NewReader(probe)
	sample, err := health.CombinedOutput()
	if err != nil || !bytes.Contains(sample, []byte(`"queued": 1`)) {
		t.Fatalf("restored health sample: %v %s", err, sample)
	}
	restored, err := Open(ctx, destination)
	lockMust(t, err)
	defer restored.Close()
	entries, err := restored.ListQueue(ctx, org, repo, "main")
	lockMust(t, err)
	if len(entries) != 1 || entries[0] != entry {
		t.Fatal("queue provenance changed during restore", entries)
	}
	provider, err := delivery.NewLocalGitProvider(root, time.Minute)
	lockMust(t, err)
	path, clean, err := provider.CheckoutCandidate(ctx, org, repo, entry.CandidateSHA)
	lockMust(t, err)
	defer clean()
	if _, err = os.Stat(path); err != nil {
		t.Fatal(err)
	}
	task, err := restored.ClaimTask(ctx, token)
	lockMust(t, err)
	if task == nil || task.RunID != entry.RunID {
		t.Fatal("restored execution is not claimable")
	}
	lockMust(t, restored.FinishTask(ctx, *task, "succeeded", "restored"))
	lockMust(t, restored.PromoteIntegration(ctx, org, entry.RunID, h.userID, entry.CandidateSHA, provider))
	head, err := provider.ResolveRevision(ctx, org, repo, "refs/heads/main")
	lockMust(t, err)
	if head.CommitSHA != entry.CandidateSHA {
		t.Fatal("restored candidate did not promote")
	}
}
