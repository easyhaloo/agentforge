package delivery

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func gitTest(t *testing.T, dir string, args ...string) string {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", dir}, args...)...)
	command.Env = append(os.Environ(), "GIT_AUTHOR_NAME=AgentForge Test", "GIT_AUTHOR_EMAIL=test@example.invalid", "GIT_COMMITTER_NAME=AgentForge Test", "GIT_COMMITTER_EMAIL=test@example.invalid")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
	return string(output)
}

func TestLocalGitProviderResolvesRevisionAndMerges(t *testing.T) {
	root := t.TempDir()
	repository := filepath.Join(root, "org-a", "team", "repo")
	if err := os.MkdirAll(repository, 0700); err != nil {
		t.Fatal(err)
	}
	gitTest(t, repository, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(repository, "README.md"), []byte("base\n"), 0600); err != nil {
		t.Fatal(err)
	}
	gitTest(t, repository, "add", "README.md")
	gitTest(t, repository, "commit", "-m", "base")
	base := gitTest(t, repository, "rev-parse", "HEAD")
	gitTest(t, repository, "checkout", "-b", "feature")
	if err := os.WriteFile(filepath.Join(repository, "feature.txt"), []byte("feature\n"), 0600); err != nil {
		t.Fatal(err)
	}
	gitTest(t, repository, "add", "feature.txt")
	gitTest(t, repository, "commit", "-m", "feature")
	feature := gitTest(t, repository, "rev-parse", "HEAD")

	provider, err := NewLocalGitProvider(root, time.Second*10)
	if err != nil {
		t.Fatal(err)
	}
	revision, err := provider.ResolveRevision(context.Background(), "org-a", "team/repo", "feature")
	if err != nil {
		t.Fatal(err)
	}
	if revision.CommitSHA != stringTrim(feature) || revision.ParentSHA != stringTrim(base) {
		t.Fatalf("resolved revision=%#v", revision)
	}
	gitTest(t, repository, "checkout", "main")
	merged, err := provider.MergeRevision(context.Background(), "org-a", "team/repo", revision.CommitSHA, "main")
	if err != nil {
		t.Fatal(err)
	}
	if merged.TargetRef != "main" || len(merged.CommitSHA) != 40 {
		t.Fatalf("merge=%#v", merged)
	}
	if got := stringTrim(gitTest(t, repository, "rev-parse", "HEAD")); got != merged.CommitSHA {
		t.Fatalf("HEAD=%s merge=%s", got, merged.CommitSHA)
	}
	retried, err := provider.MergeRevision(context.Background(), "org-a", "team/repo", revision.CommitSHA, "main")
	if err != nil {
		t.Fatal(err)
	}
	if retried.CommitSHA != merged.CommitSHA {
		t.Fatalf("merge retry commit=%s, want idempotent %s", retried.CommitSHA, merged.CommitSHA)
	}
}

func TestLocalGitProviderRejectsPathTraversalAndUnresolvedRefs(t *testing.T) {
	provider, err := NewLocalGitProvider(t.TempDir(), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.ResolveRevision(context.Background(), "../outside", "team/repo", "main"); err == nil {
		t.Fatal("expected organization traversal rejection")
	}
	if _, err := provider.ResolveRevision(context.Background(), "org-a", "../../outside", "main"); err == nil {
		t.Fatal("expected repository traversal rejection")
	}
}

func stringTrim(value string) string {
	for len(value) > 0 && (value[len(value)-1] == '\n' || value[len(value)-1] == '\r') {
		value = value[:len(value)-1]
	}
	return value
}
