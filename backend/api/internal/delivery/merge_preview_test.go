package delivery

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestOrderedPreviewIsReproducibleAndDoesNotTouchRefs(t *testing.T) {
	root := t.TempDir()
	repo := filepath.Join(root, "org", "team", "repo")
	if err := os.MkdirAll(repo, 0700); err != nil {
		t.Fatal(err)
	}
	gitTest(t, repo, "init", "-b", "main")
	gitTest(t, repo, "commit", "--allow-empty", "-m", "base")
	for _, branch := range []string{"one", "two"} {
		gitTest(t, repo, "checkout", "-b", branch, "main")
		if err := os.WriteFile(filepath.Join(repo, "file with spaces"), []byte(branch), 0600); err != nil {
			t.Fatal(err)
		}
		gitTest(t, repo, "add", ".")
		gitTest(t, repo, "commit", "-m", branch)
	}
	refs := gitTest(t, repo, "show-ref")
	p, err := NewLocalGitProvider(root, time.Second*10)
	if err != nil {
		t.Fatal(err)
	}
	for _, branch := range []string{"one", "two"} {
		var sha string
		for range 2 {
			r, err := p.PreviewMerge(t.Context(), "org", "team/repo", MergeRequest{Target: "main", Sources: []string{branch}})
			if err != nil || r.Status != "clean" || r.TreeSHA == "" || r.CandidateSHA == "" {
				t.Fatalf("preview: %+v %v", r, err)
			}
			if sha != "" && r.CandidateSHA != sha {
				t.Fatal("unstable candidate")
			}
			sha = r.CandidateSHA
		}
	}
	result, err := p.PreviewMerge(t.Context(), "org", "team/repo", MergeRequest{Target: "main", Sources: []string{"one", "two"}})
	if err != nil || result.Status != "conflict" || result.ConflictAt == nil || *result.ConflictAt != 1 || len(result.ConflictPaths) != 1 || result.ConflictPaths[0] != "file with spaces" {
		t.Fatalf("combined conflict: %+v %v", result, err)
	}
	if refs != gitTest(t, repo, "show-ref") {
		t.Fatal("preview modified repository refs")
	}
}

func TestPreviewConflictKinds(t *testing.T) {
	for _, kind := range []string{"content", "delete-modify", "rename", "binary", "gitlink"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			repo := filepath.Join(root, "org", "team", "repo")
			if err := os.MkdirAll(repo, 0700); err != nil {
				t.Fatal(err)
			}
			git := func(args ...string) string { return strings.TrimSpace(gitTest(t, repo, args...)) }
			git("init", "-b", "main")
			write := func(data string) {
				if err := os.WriteFile(filepath.Join(repo, "file"), []byte(data), 0600); err != nil {
					t.Fatal(err)
				}
				git("add", "file")
			}
			update := func(side string) {
				switch {
				case kind == "gitlink":
					git("update-index", "--add", "--cacheinfo", "160000,"+git("commit-tree", git("mktree"), "-m", side)+",file")
				case kind == "binary":
					write("\x00" + side)
				case kind == "rename" && side != "base":
					git("mv", "file", side)
				case kind == "delete-modify" && side == "main":
					git("rm", "file")
				default:
					write(side + "\n")
				}
				git("commit", "-m", side)
			}
			update("base")
			git("branch", "feature")
			update("main")
			git("checkout", "feature")
			update("feature")
			p, err := NewLocalGitProvider(root, 10*time.Second)
			if err != nil {
				t.Fatal(err)
			}
			if !p.SupportsMergePreview(t.Context()) {
				t.Fatal("Git lacks ordered preview capability")
			}
			target, source := git("rev-parse", "main"), git("rev-parse", "feature")
			result, err := p.PreviewMerge(t.Context(), "org", "team/repo", MergeRequest{Target: target, Sources: []string{source}})
			if err != nil || result.Status != "conflict" || result.ConflictAt == nil || *result.ConflictAt != 0 || !slices.Contains(result.ConflictPaths, "file") || result.Target.SHA != target || len(result.Sources) != 1 || result.Sources[0].SHA != source || result.CandidateSHA != "" {
				t.Fatalf("preview=%+v err=%v", result, err)
			}
		})
	}
}

func TestPreviewRequiresTenantOwnedRepository(t *testing.T) {
	root := t.TempDir()
	other := filepath.Join(root, "b", "team", "repo")
	team := filepath.Join(root, "a", "team")
	for _, path := range []string{other, team} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	gitTest(t, other, "init", "-b", "main")
	gitTest(t, other, "commit", "--allow-empty", "-m", "base")
	if err := os.Symlink(other, filepath.Join(team, "link")); err != nil {
		t.Fatal(err)
	}
	gitTest(t, other, "worktree", "add", "--detach", filepath.Join(team, "linked"))
	p, err := NewLocalGitProvider(root, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	for _, slug := range []string{"team/link", "team/linked"} {
		_, err = p.PreviewMerge(t.Context(), "a", slug, MergeRequest{Target: "main", Sources: []string{"main"}})
		if !errors.Is(err, ErrRepositoryInvalid) {
			t.Fatalf("%s error=%v", slug, err)
		}
	}
}

func TestBuildAndPromoteOnlyRetainedCandidate(t *testing.T) {
	p := mustProvider(t, t.TempDir())
	cleanupRepo, err := p.InitializeRepository(t.Context(), "org", "team/repo", RepositoryInitialization{Readme: true})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanupRepo()
	repo := filepath.Join(p.Root, "org", "team", "repo")
	src := t.TempDir()
	gitTest(t, src, "clone", repo, ".")
	gitTest(t, src, "checkout", "-b", "topic")
	if err := os.WriteFile(filepath.Join(src, "input"), []byte("exact revision"), 0644); err != nil {
		t.Fatal(err)
	}
	gitTest(t, src, "add", "input")
	gitTest(t, src, "commit", "-m", "feature")
	gitTest(t, src, "push", "origin", "topic")
	candidate, err := p.PrepareCandidate(t.Context(), "org", "team/repo", MergeRequest{Target: "main", Sources: []string{"topic"}})
	if err != nil || candidate.Status != "clean" {
		t.Fatalf("prepare=%v %v", candidate, err)
	}
	gitTest(t, repo, "update-ref", "-d", "refs/heads/topic")
	gitTest(t, repo, "gc", "--prune=now")
	dir, cleanup, err := p.CheckoutCandidate(t.Context(), "org", "team/repo", candidate.CandidateSHA)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	b, err := os.ReadFile(filepath.Join(dir, "input"))
	if err != nil || string(b) != "exact revision" {
		t.Fatalf("wrong candidate contents %q, %v", b, err)
	}
	if _, err := os.Stat(filepath.Join(dir, ".git")); !os.IsNotExist(err) {
		t.Fatal("Git metadata exposed to build")
	}
	gitTest(t, repo, "update-ref", "refs/heads/main", candidate.Sources[0].SHA)
	if err := p.PromoteCandidate(t.Context(), "org", "team/repo", "run-1", candidate); !errors.Is(err, ErrCandidateStale) {
		t.Fatalf("stale promotion returned %v", err)
	}
	gitTest(t, repo, "update-ref", "refs/heads/main", candidate.Target.SHA)
	for range 2 {
		if err := p.PromoteCandidate(t.Context(), "org", "team/repo", "run-1", candidate); err != nil {
			t.Fatal(err)
		}
	}
	if got := stringTrim(gitTest(t, repo, "rev-parse", "main")); got != candidate.CandidateSHA {
		t.Fatalf("promoted %s", got)
	}
}
