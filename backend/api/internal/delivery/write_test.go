package delivery

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func runTestGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func TestLocalGitProviderSaveTextFileUsesChangesetBranchAndCAS(t *testing.T) {
	root := t.TempDir()
	repo := filepath.Join(root, "org-1", "owner", "repo")
	if err := os.MkdirAll(repo, 0700); err != nil {
		t.Fatal(err)
	}
	runTestGit(t, repo, "init", "-b", "main")
	runTestGit(t, repo, "config", "user.name", "Test")
	runTestGit(t, repo, "config", "user.email", "test@example.invalid")
	if err := os.WriteFile(filepath.Join(repo, "hello.txt"), []byte("before\n"), 0600); err != nil {
		t.Fatal(err)
	}
	runTestGit(t, repo, "add", "hello.txt")
	runTestGit(t, repo, "commit", "-m", "initial")
	base := runTestGit(t, repo, "rev-parse", "HEAD")
	blob := runTestGit(t, repo, "rev-parse", "HEAD:hello.txt")
	provider, err := NewLocalGitProvider(root, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}

	result, err := provider.SaveTextFile(context.Background(), "org-1", "owner/repo", "cs-123", base, blob, "hello.txt", []byte("after\n"))
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if result.Branch != "agentforge/changesets/cs-123" {
		t.Fatalf("unexpected branch: %s", result.Branch)
	}
	if result.CommitSHA == base || result.BlobSHA == blob {
		t.Fatal("save did not create new Git objects")
	}
	if got := runTestGit(t, repo, "rev-parse", "refs/heads/main"); got != base {
		t.Fatalf("default branch moved: %s != %s", got, base)
	}
	if got := runTestGit(t, repo, "rev-parse", "refs/heads/"+result.Branch); got != result.CommitSHA {
		t.Fatalf("changeset branch mismatch: %s", got)
	}
	content, gotBlob, err := provider.ReadBlob(context.Background(), "org-1", "owner/repo", result.CommitSHA, "hello.txt", 1<<20)
	if err != nil || string(content) != "after\n" || gotBlob != result.BlobSHA {
		t.Fatalf("read saved blob: %q %s %v", content, gotBlob, err)
	}

	_, err = provider.SaveTextFile(context.Background(), "org-1", "owner/repo", "cs-123", base, blob, "hello.txt", []byte("stale\n"))
	if err != ErrWriteConflict {
		t.Fatalf("expected CAS conflict, got %v", err)
	}
}

func TestLocalGitProviderSaveTextFileRejectsUnsafePathsAndSymlinks(t *testing.T) {
	root := t.TempDir()
	repo := filepath.Join(root, "org-1", "owner", "repo")
	if err := os.MkdirAll(repo, 0700); err != nil {
		t.Fatal(err)
	}
	runTestGit(t, repo, "init", "-b", "main")
	runTestGit(t, repo, "config", "user.name", "Test")
	runTestGit(t, repo, "config", "user.email", "test@example.invalid")
	if err := os.WriteFile(filepath.Join(repo, "target.txt"), []byte("safe\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("target.txt", filepath.Join(repo, "link.txt")); err != nil {
		t.Fatal(err)
	}
	runTestGit(t, repo, "add", "target.txt", "link.txt")
	runTestGit(t, repo, "commit", "-m", "initial")
	base := runTestGit(t, repo, "rev-parse", "HEAD")
	blob := runTestGit(t, repo, "rev-parse", "HEAD:target.txt")
	provider, err := NewLocalGitProvider(root, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"../escape", "/absolute", "a//b", "a\\b"} {
		if _, err := provider.SaveTextFile(context.Background(), "org-1", "owner/repo", "cs-456", base, blob, path, []byte("x")); err != ErrWriteInvalid {
			t.Fatalf("path %q: expected invalid input, got %v", path, err)
		}
	}
	linkBlob := runTestGit(t, repo, "rev-parse", "HEAD:link.txt")
	if _, err := provider.SaveTextFile(context.Background(), "org-1", "owner/repo", "cs-456", base, linkBlob, "link.txt", []byte("x")); err != ErrWriteInvalid {
		t.Fatalf("expected symlink rejection, got %v", err)
	}
}
