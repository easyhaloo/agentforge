package delivery

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestInitializeRepository_Templates(t *testing.T) {
	tests := []struct {
		name      string
		init      RepositoryInitialization
		wantFiles []string
		checkFile string
		checkText string
	}{
		{"zero_options", RepositoryInitialization{}, nil, "", ""},
		{"readme_only", RepositoryInitialization{Readme: true}, []string{"README.md"}, "README.md", "# repo"},
		{"readme_desc", RepositoryInitialization{Readme: true, Description: "Test repo"}, []string{"README.md"}, "README.md", "Test repo"},
		{"node_mit", RepositoryInitialization{Gitignore: "node", License: "mit"}, []string{".gitignore", "LICENSE"}, ".gitignore", "node_modules/"},
		{"python_mit", RepositoryInitialization{Gitignore: "python", License: "mit"}, []string{".gitignore", "LICENSE"}, ".gitignore", "__pycache__/"},
		{"go_mit", RepositoryInitialization{Gitignore: "go", License: "mit"}, []string{".gitignore", "LICENSE"}, ".gitignore", "vendor/"},
		{"all_options", RepositoryInitialization{Description: "Full", Readme: true, Gitignore: "node", License: "mit"}, []string{"README.md", ".gitignore", "LICENSE"}, "LICENSE", "MIT License"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := t.TempDir()
			p := mustProvider(t, root)

			cleanup, err := p.InitializeRepository(context.Background(), "org1", "owner/repo", tt.init)
			if err != nil {
				t.Fatalf("InitializeRepository failed: %v", err)
			}
			defer cleanup()

			repoPath := filepath.Join(root, "org1", "owner", "repo")
			if got := runTestGit(t, repoPath, "symbolic-ref", "HEAD"); got != "refs/heads/main" {
				t.Fatalf("HEAD = %q, want refs/heads/main", got)
			}
			if got := runTestGit(t, repoPath, "rev-list", "--count", "refs/heads/main"); got != "1" {
				t.Fatalf("main commit count = %q, want 1", got)
			}
			if got := runTestGit(t, repoPath, "rev-parse", "--is-bare-repository"); got != "false" {
				t.Fatalf("is-bare-repository = %q, want false", got)
			}
			tracked := strings.Fields(runTestGit(t, repoPath, "ls-tree", "--name-only", "HEAD"))
			slices.Sort(tracked)
			slices.Sort(tt.wantFiles)
			if !slices.Equal(tracked, tt.wantFiles) {
				t.Fatalf("tracked files = %v, want %v", tracked, tt.wantFiles)
			}
			for _, file := range tt.wantFiles {
				if _, err := os.Stat(filepath.Join(repoPath, file)); err != nil {
					t.Errorf("missing file %s: %v", file, err)
				}
			}

			if tt.checkFile != "" {
				content := runTestGit(t, repoPath, "show", "HEAD:"+tt.checkFile)
				if !strings.Contains(content, tt.checkText) {
					t.Errorf("%s missing %q, got: %s", tt.checkFile, tt.checkText, content)
				}
			}

			if tt.init.Description != "" {
				desc := mustReadFile(t, filepath.Join(repoPath, ".git", "description"))
				if !strings.Contains(desc, tt.init.Description) {
					t.Errorf(".git/description missing %q", tt.init.Description)
				}
			}
		})
	}
}

func TestInitializeRepository_ValidationErrors(t *testing.T) {
	tests := []struct {
		name  string
		orgID string
		slug  string
		init  RepositoryInitialization
	}{
		{"empty_org", "", "owner/repo", RepositoryInitialization{}},
		{"org_slash", "org/bad", "owner/repo", RepositoryInitialization{}},
		{"org_too_long", strings.Repeat("a", 101), "owner/repo", RepositoryInitialization{}},
		{"org_starts_dot", ".org", "owner/repo", RepositoryInitialization{}},
		{"slug_no_slash", "org1", "repo", RepositoryInitialization{}},
		{"slug_three_parts", "org1", "a/b/c", RepositoryInitialization{}},
		{"owner_empty", "org1", "/repo", RepositoryInitialization{}},
		{"desc_too_long", "org1", "owner/repo", RepositoryInitialization{Description: strings.Repeat("a", 351)}},
		{"desc_nul", "org1", "owner/repo", RepositoryInitialization{Description: "test\x00"}},
		{"gitignore_invalid", "org1", "owner/repo", RepositoryInitialization{Gitignore: "rust"}},
		{"license_invalid", "org1", "owner/repo", RepositoryInitialization{License: "apache"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := mustProvider(t, t.TempDir())
			cleanup, err := p.InitializeRepository(context.Background(), tt.orgID, tt.slug, tt.init)
			if err == nil {
				defer cleanup()
				t.Fatal("expected validation error")
			}
			if !errors.Is(err, ErrRepositoryInvalid) {
				t.Errorf("unexpected error: %v", err)
			}
			if cleanup != nil {
				t.Error("cleanup should be nil on error")
			}
		})
	}
}

func TestInitializeRepository_Conflicts(t *testing.T) {
	tests := []struct {
		name  string
		setup func(root string)
	}{
		{"existing_dir", func(root string) {
			os.MkdirAll(filepath.Join(root, "org1", "owner", "repo"), 0700)
		}},
		{"existing_file", func(root string) {
			os.MkdirAll(filepath.Join(root, "org1", "owner"), 0700)
			os.WriteFile(filepath.Join(root, "org1", "owner", "repo"), []byte("x"), 0600)
		}},
		{"existing_symlink", func(root string) {
			os.MkdirAll(filepath.Join(root, "org1", "owner"), 0700)
			os.MkdirAll(filepath.Join(root, "target"), 0700)
			os.Symlink(filepath.Join(root, "target"), filepath.Join(root, "org1", "owner", "repo"))
		}},
		{"parent_symlink_org", func(root string) {
			os.MkdirAll(filepath.Join(root, "real"), 0700)
			os.Symlink(filepath.Join(root, "real"), filepath.Join(root, "org1"))
		}},
		{"parent_symlink_owner", func(root string) {
			os.MkdirAll(filepath.Join(root, "org1", "real"), 0700)
			os.Symlink(filepath.Join(root, "org1", "real"), filepath.Join(root, "org1", "owner"))
		}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := t.TempDir()
			tt.setup(root)
			p := mustProvider(t, root)

			cleanup, err := p.InitializeRepository(context.Background(), "org1", "owner/repo", RepositoryInitialization{})
			if cleanup != nil {
				defer cleanup()
			}
			if err == nil {
				t.Fatal("expected conflict error")
			}
			want := ErrVersionConflict
			if strings.HasPrefix(tt.name, "parent_") {
				want = ErrRepositoryInvalid
			}
			if !errors.Is(err, want) || cleanup != nil {
				t.Fatalf("got %v, want %v and nil cleanup", err, want)
			}
		})
	}
}

func TestInitializeRepository_Cancellation(t *testing.T) {
	root := t.TempDir()
	p := mustProvider(t, root)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	cleanup, err := p.InitializeRepository(ctx, "org1", "owner/repo", RepositoryInitialization{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want context.Canceled", err)
	}
	if cleanup != nil {
		t.Error("cleanup should be nil on error")
	}

	// No directory should be created
	if _, err := os.Stat(filepath.Join(root, "org1")); !os.IsNotExist(err) {
		t.Error("repo should not exist after cancellation")
	}
}

func TestInitializeRepository_CleanupSafety(t *testing.T) {
	t.Run("idempotent", func(t *testing.T) {
		root := t.TempDir()
		p := mustProvider(t, root)

		cleanup, err := p.InitializeRepository(context.Background(), "org1", "owner/repo", RepositoryInitialization{Readme: true})
		if err != nil {
			t.Fatal(err)
		}

		repoPath := filepath.Join(root, "org1", "owner", "repo")
		mustExist(t, repoPath)

		cleanup()
		cleanup()
		cleanup()

		mustNotExist(t, repoPath)
	})

	t.Run("protects_replacement", func(t *testing.T) {
		root := t.TempDir()
		p := mustProvider(t, root)

		cleanup, err := p.InitializeRepository(context.Background(), "org1", "owner/repo", RepositoryInitialization{})
		if err != nil {
			t.Fatal(err)
		}

		repoPath := filepath.Join(root, "org1", "owner", "repo")
		if err := os.Rename(repoPath, repoPath+"-original"); err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(repoPath, 0700); err != nil {
			t.Fatal(err)
		}
		marker := filepath.Join(repoPath, "MARKER")
		if err := os.WriteFile(marker, []byte("new"), 0600); err != nil {
			t.Fatal(err)
		}

		cleanup()

		mustExist(t, marker) // Replacement protected
	})

	t.Run("preserves_siblings", func(t *testing.T) {
		root := t.TempDir()
		p := mustProvider(t, root)

		sibling := filepath.Join(root, "org1", "owner", "sibling")
		os.MkdirAll(sibling, 0700)
		marker := filepath.Join(sibling, "MARKER")
		os.WriteFile(marker, []byte("x"), 0600)

		cleanup, err := p.InitializeRepository(context.Background(), "org1", "owner/repo", RepositoryInitialization{})
		if err != nil {
			t.Fatal(err)
		}

		cleanup()

		mustExist(t, marker)
		mustExist(t, filepath.Join(root, "org1", "owner"))
	})
}

func TestInitializeRepository_GitIsolation(t *testing.T) {
	t.Run("commit_identity", func(t *testing.T) {
		root := t.TempDir()
		p := mustProvider(t, root)

		cleanup, err := p.InitializeRepository(context.Background(), "org1", "owner/repo", RepositoryInitialization{Readme: true})
		if err != nil {
			t.Fatal(err)
		}
		defer cleanup()

		repoPath := filepath.Join(root, "org1", "owner", "repo")
		identity := runTestGit(t, repoPath, "log", "--format=%an <%ae>", "-1")
		want := "AgentForge <agentforge@localhost>"
		if identity != want {
			t.Errorf("identity = %q, want %q", identity, want)
		}
	})

	t.Run("inherited_config_isolation", func(t *testing.T) {
		root := t.TempDir()
		parent := filepath.Join(root, "parent")
		os.MkdirAll(parent, 0700)

		runTestGit(t, parent, "init")
		runTestGit(t, parent, "config", "user.name", "Evil")
		runTestGit(t, parent, "config", "user.email", "evil@example.com")

		providerRoot := filepath.Join(parent, "repos")
		os.MkdirAll(providerRoot, 0700)
		p := mustProvider(t, providerRoot)
		t.Setenv("GIT_DIR", filepath.Join(parent, ".git"))
		t.Setenv("GIT_WORK_TREE", parent)
		t.Setenv("GIT_CONFIG_COUNT", "1")
		t.Setenv("GIT_CONFIG_KEY_0", "commit.gpgSign")
		t.Setenv("GIT_CONFIG_VALUE_0", "true")
		t.Setenv("GIT_AUTHOR_NAME", "Environment override")

		cleanup, err := p.InitializeRepository(context.Background(), "org1", "owner/repo", RepositoryInitialization{Readme: true})
		if err != nil {
			t.Fatal(err)
		}
		defer cleanup()

		repoPath := filepath.Join(providerRoot, "org1", "owner", "repo")
		author, err := p.run(t.Context(), repoPath, "log", "--format=%an", "-1")
		if err != nil {
			t.Fatal(err)
		}
		if author != "AgentForge" {
			t.Errorf("author = %q (inherited?), want AgentForge", author)
		}
	})
}

func TestInitializeRepository_RollsBackOnGitFailure(t *testing.T) {
	p := mustProvider(t, t.TempDir())
	t.Setenv("PATH", t.TempDir())
	cleanup, err := p.InitializeRepository(t.Context(), "org1", "owner/repo", RepositoryInitialization{})
	if err == nil || cleanup != nil {
		t.Fatalf("want Git failure and nil cleanup, got %v", err)
	}
	mustNotExist(t, filepath.Join(p.Root, "org1", "owner", "repo"))
}

// Helpers

func mustProvider(t *testing.T, root string) *LocalGitProvider {
	t.Helper()
	p, err := NewLocalGitProvider(root, 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func mustReadFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func mustExist(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("path %s should exist: %v", path, err)
	}
}

func mustNotExist(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("path %s should not exist", path)
	}
}
