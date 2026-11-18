package delivery

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLocalGitPreviewListsPinnedTreeAndReadsExactBlob(t *testing.T) {
	root := t.TempDir()
	repository := filepath.Join(root, "org-a", "team", "repo")
	if err := os.MkdirAll(filepath.Join(repository, "docs"), 0700); err != nil { t.Fatal(err) }
	gitTest(t, repository, "init", "-b", "main")
	want := []byte{0, 1, 2, ' ', '\n', '\t'}
	if err := os.WriteFile(filepath.Join(repository, "docs", "binary.dat"), want, 0600); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(repository, "README.md"), []byte("# Hello\n"), 0600); err != nil { t.Fatal(err) }
	gitTest(t, repository, "add", ".")
	gitTest(t, repository, "commit", "-m", "initial")
	commit := stringTrim(gitTest(t, repository, "rev-parse", "HEAD"))

	provider, err := NewLocalGitProvider(root, 10*time.Second)
	if err != nil { t.Fatal(err) }
	entries, err := provider.ListTree(context.Background(), "org-a", "team/repo", commit, "docs")
	if err != nil { t.Fatal(err) }
	if len(entries) != 1 || entries[0].Name != "binary.dat" || entries[0].Kind != "file" {
		t.Fatalf("unexpected tree entries: %#v", entries)
	}
	got, object, err := provider.ReadBlob(context.Background(), "org-a", "team/repo", commit, "docs/binary.dat", 1024)
	if err != nil { t.Fatal(err) }
	if !bytes.Equal(got, want) { t.Fatalf("blob bytes = %v, want %v", got, want) }
	if len(object) != 40 { t.Fatalf("object id = %q", object) }
	if _, _, err := provider.ReadBlob(context.Background(), "org-a", "team/repo", commit, "docs/binary.dat", 2); err != ErrPreviewTooLarge {
		t.Fatalf("expected size limit error, got %v", err)
	}
}

func TestLocalGitPreviewRejectsTraversalAndInvalidCommit(t *testing.T) {
	provider, err := NewLocalGitProvider(t.TempDir(), time.Second)
	if err != nil { t.Fatal(err) }
	if _, err := provider.ListTree(context.Background(), "org-a", "team/repo", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "../outside"); err != ErrPreviewPathInvalid {
		t.Fatalf("expected traversal rejection, got %v", err)
	}
	if _, _, err := provider.ReadBlob(context.Background(), "org-a", "team/repo", "not-a-commit", "README.md", 1024); err != ErrPreviewPathInvalid {
		t.Fatalf("expected invalid commit rejection, got %v", err)
	}
}

func TestLocalGitPreviewListsCommitHistoryPinnedToRevision(t *testing.T) {
	root := t.TempDir()
	repository := filepath.Join(root, "org-a", "team", "history")
	if err := os.MkdirAll(repository, 0700); err != nil { t.Fatal(err) }
	gitTest(t, repository, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(repository, "README.md"), []byte("first\n"), 0600); err != nil { t.Fatal(err) }
	gitTest(t, repository, "add", ".")
	gitTest(t, repository, "commit", "-m", "first commit")
	first := stringTrim(gitTest(t, repository, "rev-parse", "HEAD"))
	if err := os.WriteFile(filepath.Join(repository, "README.md"), []byte("second\n"), 0600); err != nil { t.Fatal(err) }
	gitTest(t, repository, "commit", "-am", "second commit")
	second := stringTrim(gitTest(t, repository, "rev-parse", "HEAD"))

	provider, err := NewLocalGitProvider(root, 10*time.Second)
	if err != nil { t.Fatal(err) }
	history, err := provider.ListHistory(context.Background(), "org-a", "team/history", second, 10)
	if err != nil { t.Fatal(err) }
	if len(history) != 2 || history[0].SHA != second || history[0].Subject != "second commit" || history[1].SHA != first {
		t.Fatalf("unexpected history: %#v", history)
	}
	pinned, err := provider.ListHistory(context.Background(), "org-a", "team/history", first, 10)
	if err != nil { t.Fatal(err) }
	if len(pinned) != 1 || pinned[0].SHA != first {
		t.Fatalf("history was not pinned to requested commit: %#v", pinned)
	}
	if _, err := provider.ListHistory(context.Background(), "org-a", "team/history", second, 101); err != ErrPreviewPathInvalid {
		t.Fatalf("expected invalid limit rejection, got %v", err)
	}
}
