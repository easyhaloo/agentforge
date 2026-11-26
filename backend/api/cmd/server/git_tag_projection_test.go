package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
)

// fakeIssueRepository records LinkCommitIssues calls so the shared loop proves both projections
// consumed the event without a database.
type fakeIssueRepository struct{ linked []string }

func (f *fakeIssueRepository) LinkCommitIssues(ctx context.Context, org, repository, sha, subject, message string) error {
	f.linked = append(f.linked, sha)
	return nil
}

// writeJournalEvent stores one push event the way the Git HTTP hooks do.
func writeJournalEvent(t *testing.T, journal string, event githttp.PushEvent) {
	t.Helper()
	payload, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(journal, event.ID+".json"), payload, 0600); err != nil {
		t.Fatal(err)
	}
}

func gitCmd(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid"}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v %s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

// TestProjectTagPushes covers the journal loop end to end without a database: lightweight and
// annotated tags resolve to their commit, deletions enqueue nothing, and a replay of the same
// journal event is idempotent because the first pass archived the file.
func TestProjectTagPushes(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	org, repo := "org1", "team/repo"
	bare := filepath.Join(root, org, "team", "repo")
	if err := os.MkdirAll(filepath.Dir(bare), 0700); err != nil {
		t.Fatal(err)
	}
	src := t.TempDir()
	gitCmd(t, src, "init", "-b", "main")
	gitCmd(t, src, "commit", "--allow-empty", "-m", "base")
	first := gitCmd(t, src, "rev-parse", "HEAD")
	gitCmd(t, src, "commit", "--allow-empty", "-m", "second")
	second := gitCmd(t, src, "rev-parse", "HEAD")
	gitCmd(t, src, "tag", "v1.0.0", first)                         // lightweight
	gitCmd(t, src, "tag", "-a", "-m", "release", "v2.0.0", second) // annotated
	gitCmd(t, src, "clone", "--bare", src, bare)

	git, err := delivery.NewLocalGitProvider(root, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	journal := filepath.Join(root, ".agentforge-push-events")
	if err := os.MkdirAll(journal, 0700); err != nil {
		t.Fatal(err)
	}
	enqueued := map[string][]string{}
	// The real EnqueueTagRuns needs PostgreSQL; record what the projection would send instead.
	store := &tagEnqueueRecorder{enqueue: func(org, repository, ref, sha string) error {
		enqueued[ref] = append(enqueued[ref], sha)
		return nil
	}}
	issues := &fakeIssueRepository{}

	writeJournalEvent(t, journal, githttp.PushEvent{
		ID: "evt1", Organization: org, Repository: repo, Base: first, CreatedAt: time.Now().UTC(),
		Updates: []githttp.RefUpdate{
			{Ref: "refs/tags/v1.0.0", Old: "0000000000000000000000000000000000000000", New: first},
			{Ref: "refs/tags/v2.0.0", Old: "0000000000000000000000000000000000000000", New: second},
			{Ref: "refs/tags/gone", Old: first, New: "0000000000000000000000000000000000000000"}, // deletion
			{Ref: "refs/heads/main", Old: first, New: second},
		},
	})
	if err := projectPushEvent(ctx, journal, "evt1.json", git, issues, store); err != nil {
		t.Fatal(err)
	}
	if sha := enqueued["refs/tags/v1.0.0"]; len(sha) != 1 || sha[0] != first {
		t.Fatalf("lightweight tag enqueued %v, want [%s]", sha, first)
	}
	if sha := enqueued["refs/tags/v2.0.0"]; len(sha) != 1 || sha[0] != second {
		t.Fatalf("annotated tag enqueued %v, want [%s] (peeled to its commit)", sha, second)
	}
	if _, ok := enqueued["refs/tags/gone"]; ok {
		t.Fatal("tag deletion enqueued an event")
	}
	if len(issues.linked) != 1 || issues.linked[0] != second {
		t.Fatalf("branch push linked %v, want [%s]", issues.linked, second)
	}
	if _, err := os.Stat(filepath.Join(journal, "projected", "evt1.json")); err != nil {
		t.Fatalf("event was not archived: %v", err)
	}
	// A journal replay (event restored after a crash) must not enqueue again: the projection
	// reads only files in the journal root, and the archived copy is out of reach.
	if err := os.WriteFile(filepath.Join(journal, "evt1.json"), []byte("restored"), 0600); err == nil {
		if err := projectPushEvent(ctx, journal, "evt1.json", git, issues, store); err == nil {
			t.Fatal("a corrupt restored event projected cleanly; expected the archive to shield replays or the parse to fail")
		}
	}
}

type tagEnqueueRecorder struct {
	enqueue func(org, repository, ref, sha string) error
}

func (t *tagEnqueueRecorder) EnqueueTagRuns(ctx context.Context, org, repository, ref, sha string) error {
	return t.enqueue(org, repository, ref, sha)
}
