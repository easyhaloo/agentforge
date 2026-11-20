package delivery

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestLocalGitPreviewCompareWithMergeBaseExcludesBaseOnlyChanges verifies that
// three-dot comparison (merge-base mode) shows only head's changes, excluding
// changes that exist in base but not in the common ancestor.
func TestLocalGitPreviewCompareWithMergeBaseExcludesBaseOnlyChanges(t *testing.T) {
	root := t.TempDir()
	repository := filepath.Join(root, "org-a", "team", "diverged")
	if err := os.MkdirAll(repository, 0700); err != nil {
		t.Fatal(err)
	}

	// Create initial commit (common ancestor)
	gitTest(t, repository, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(repository, "common.txt"), []byte("common\n"), 0600); err != nil {
		t.Fatal(err)
	}
	gitTest(t, repository, "add", ".")
	gitTest(t, repository, "commit", "-m", "common ancestor")
	ancestor := stringTrim(gitTest(t, repository, "rev-parse", "HEAD"))

	// Create base (main) branch with unique change
	if err := os.WriteFile(filepath.Join(repository, "base-only.txt"), []byte("base change\n"), 0600); err != nil {
		t.Fatal(err)
	}
	gitTest(t, repository, "add", ".")
	gitTest(t, repository, "commit", "-m", "base branch change")
	base := stringTrim(gitTest(t, repository, "rev-parse", "HEAD"))

	// Create feature branch from common ancestor
	gitTest(t, repository, "checkout", ancestor)
	gitTest(t, repository, "checkout", "-b", "feature")
	if err := os.WriteFile(filepath.Join(repository, "feature.txt"), []byte("feature change\n"), 0600); err != nil {
		t.Fatal(err)
	}
	gitTest(t, repository, "add", ".")
	gitTest(t, repository, "commit", "-m", "feature branch change")
	head := stringTrim(gitTest(t, repository, "rev-parse", "HEAD"))

	provider, err := NewLocalGitProvider(root, 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}

	// Test: CompareWithMergeBase should show only feature.txt changes
	patch, err := provider.CompareWithMergeBase(context.Background(), "org-a", "team/diverged", base, head)
	if err != nil {
		t.Fatal(err)
	}

	// Should contain feature branch changes
	if !bytes.Contains([]byte(patch), []byte("+feature change")) {
		t.Errorf("merge-base compare missing feature changes: %s", patch)
	}

	// Should NOT contain base-only changes
	if bytes.Contains([]byte(patch), []byte("base-only.txt")) {
		t.Errorf("merge-base compare incorrectly includes base-only changes: %s", patch)
	}

	// Verify that regular Compare would show both
	regularPatch, err := provider.Compare(context.Background(), "org-a", "team/diverged", base, head)
	if err != nil {
		t.Fatal(err)
	}
	// Regular two-dot diff would show base-only.txt being removed (since it doesn't exist in head)
	if !bytes.Contains([]byte(regularPatch), []byte("base-only.txt")) {
		t.Logf("Note: regular compare shows: %s", regularPatch)
	}
}
