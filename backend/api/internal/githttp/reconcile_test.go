package githttp

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestReconcileInterruptedPush(t *testing.T) {
	git, err := exec.LookPath("git")
	if err != nil {
		t.Skip("requires Git CLI")
	}
	transport := &Transport{root: t.TempDir(), git: git}
	const org, repo = "org", "imported/project"
	bare := filepath.Join(transport.root, org, filepath.FromSlash(repo))
	run := func(args ...string) string {
		t.Helper()
		cmd := exec.CommandContext(t.Context(), git, append([]string{"--git-dir=" + bare}, args...)...)
		cmd.Env = []string{"PATH=/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null",
			"GIT_AUTHOR_NAME=Fixture", "GIT_AUTHOR_EMAIL=fixture@example.test",
			"GIT_COMMITTER_NAME=Fixture", "GIT_COMMITTER_EMAIL=fixture@example.test"}
		cmd.Stdin = strings.NewReader("")
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	run("init", "--bare", "--initial-branch=main", bare)
	tree := run("mktree")
	old := run("commit-tree", tree, "-m", "initial")
	newer := run("commit-tree", tree, "-p", old, "-m", "pushed")
	zero := strings.Repeat("0", len(old))
	run("update-ref", "refs/heads/advanced", newer)
	run("update-ref", "refs/heads/unchanged", old)
	run("update-ref", "refs/heads/created", newer)
	// A ref with a partially matching name must not mask the accepted deletion.
	run("update-ref", "refs/heads/deleted/descendant", old)

	journal := transport.journal()
	if err := os.MkdirAll(intentDirectory(journal), 0700); err != nil {
		t.Fatal(err)
	}
	event := PushEvent{ID: uuid.NewString(), Organization: org, Repository: repo, Actor: "actor",
		CreatedAt: time.Now().UTC(), Updates: []RefUpdate{
			{Ref: "refs/heads/advanced", Old: old, New: newer},
			{Ref: "refs/heads/unchanged", Old: old, New: newer},
			{Ref: "refs/heads/created", Old: zero, New: newer},
			{Ref: "refs/heads/deleted", Old: old, New: zero},
		}}
	intent := filepath.Join(intentDirectory(journal), event.ID)
	if err := writePushEvent(intent, event); err != nil {
		t.Fatal(err)
	}
	locks := 0
	lock := func(_ context.Context, organization, repository string) (PushPolicy, func(), error) {
		if organization != org || repository != repo {
			t.Fatalf("unexpected recovery scope %q %q", organization, repository)
		}
		locks++
		return PushPolicy{DefaultBranch: "main"}, func() { locks-- }, nil
	}
	final := filepath.Join(journal, event.ID+".json")
	for range 2 {
		if err := transport.Reconcile(t.Context(), lock); err != nil {
			t.Fatal(err)
		}
		if locks != 0 {
			t.Fatal("recovery did not release its repository lock")
		}
		if _, err := os.Stat(intent); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("intent remains after recovery: %v", err)
		}
		payload, err := os.ReadFile(final)
		if err != nil {
			t.Fatal(err)
		}
		var got PushEvent
		if err := json.Unmarshal(payload, &got); err != nil {
			t.Fatal(err)
		}
		want := []RefUpdate{event.Updates[0], event.Updates[2], event.Updates[3]}
		if got.ID != event.ID || got.Organization != org || got.Repository != repo || got.Actor != event.Actor ||
			!got.CreatedAt.Equal(event.CreatedAt) || !slices.Equal(got.Updates, want) {
			t.Fatalf("recovered event = %+v, want original event with updates %+v", got, want)
		}
	}
	archive := filepath.Join(journal, "projected")
	if err := os.Mkdir(archive, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(final, filepath.Join(archive, filepath.Base(final))); err != nil {
		t.Fatal(err)
	}
	if err := writePushEvent(intent, event); err != nil {
		t.Fatal(err)
	}
	if err := transport.Reconcile(t.Context(), lock); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{intent, final} {
		if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("already projected event must not be republished: %s: %v", path, err)
		}
	}

}
