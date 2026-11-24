package delivery

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestUpdatePullSourceChecksBothTips(t *testing.T) {
	root := t.TempDir()
	repo := filepath.Join(root, "org", "team", "repo")
	if err := os.MkdirAll(repo, 0700); err != nil {
		t.Fatal(err)
	}
	work := t.TempDir()
	gitTest(t, work, "init", "-b", "main")
	gitTest(t, work, "commit", "--allow-empty", "-m", "base")
	base := strings.TrimSpace(gitTest(t, work, "rev-parse", "HEAD"))
	gitTest(t, work, "branch", "topic")
	gitTest(t, work, "commit", "--allow-empty", "-m", "next")
	next := strings.TrimSpace(gitTest(t, work, "rev-parse", "HEAD"))
	gitTest(t, work, "clone", "--bare", work, repo)
	p, err := NewLocalGitProvider(root, 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	for _, tips := range [][2]string{{base, base}, {next, next}} {
		err := p.UpdatePullSource(t.Context(), "org", "team/repo", PinnedRef{Ref: "topic", SHA: tips[0]}, PinnedRef{Ref: "main", SHA: tips[1]}, next)
		if !errors.Is(err, ErrWriteConflict) {
			t.Fatalf("stale tips %v: %v", tips, err)
		}
		if got := strings.TrimSpace(gitTest(t, repo, "rev-parse", "topic")); got != base {
			t.Fatalf("source tip changed despite conflict: %s", got)
		}
	}
	if err := p.UpdatePullSource(t.Context(), "org", "team/repo", PinnedRef{Ref: "topic", SHA: base}, PinnedRef{Ref: "main", SHA: next}, next); err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(gitTest(t, repo, "rev-parse", "topic")); got != next {
		t.Fatalf("source tip did not advance: %s", got)
	}
}
