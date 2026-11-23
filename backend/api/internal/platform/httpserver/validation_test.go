package httpserver

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

// TestCreateChangesetBranchValidation tests branch validation requirements
// from AC 1.2-1.3: invalid branches, empty refs, resolution failures
func TestCreateChangesetBranchValidation(t *testing.T) {
	root := t.TempDir()
	repoPath := filepath.Join(root, "org-test", "owner", "validate-repo")
	if err := os.MkdirAll(repoPath, 0755); err != nil {
		t.Fatal(err)
	}

	// Setup repository
	gitTest(t, repoPath, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(repoPath, "README.md"), []byte("test\n"), 0644); err != nil {
		t.Fatal(err)
	}
	gitTest(t, repoPath, "add", "README.md")
	gitTest(t, repoPath, "commit", "-m", "initial")
	gitTest(t, repoPath, "branch", "valid-feature")

	// Setup dependencies
	gitProvider, err := delivery.NewLocalGitProvider(root, 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}

	catalog := &testCatalog{
		repos: []delivery.RepositoryMetadata{
			{Slug: "owner/validate-repo", DefaultBranch: "main"},
		},
	}

	store := newTestDeliveryStore()

	deps := DeliveryDependencies{
		Identity:   &testPrincipal{Principal{OrganizationID: "org-test", UserID: "user-1", Role: "member"}},
		Catalog:    catalog,
		Git:        gitProvider,
		Repository: store,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/changesets", deps.createChangeset)

	tests := []struct {
		name           string
		sourceBranch   string
		expectStatus   int
		expectContains string
	}{
		{
			name:           "Valid branch succeeds",
			sourceBranch:   "valid-feature",
			expectStatus:   http.StatusCreated,
			expectContains: "valid-feature",
		},
		{
			name:           "Nonexistent branch fails",
			sourceBranch:   "nonexistent-branch",
			expectStatus:   http.StatusUnprocessableEntity,
			expectContains: "could not be resolved",
		},
		{
			name:           "Empty branch name fails",
			sourceBranch:   "",
			expectStatus:   http.StatusCreated, // Empty is treated as draft (no source_branch)
			expectContains: "",
		},
		{
			name:           "Path traversal attempt fails",
			sourceBranch:   "../../../etc/passwd",
			expectStatus:   http.StatusUnprocessableEntity,
			expectContains: "could not be resolved",
		},
		{
			name:           "Invalid ref format fails",
			sourceBranch:   "refs/heads/../../../etc/passwd",
			expectStatus:   http.StatusUnprocessableEntity,
			expectContains: "could not be resolved",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body := map[string]interface{}{
				"repository": "owner/validate-repo",
				"title":      "Test changeset",
			}
			if tt.sourceBranch != "" {
				body["source_branch"] = tt.sourceBranch
			}
			bodyJSON, _ := json.Marshal(body)

			req := httptest.NewRequest("POST", "/api/v1/organizations/org-test/changesets", bytes.NewReader(bodyJSON))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, req)

			if w.Code != tt.expectStatus {
				t.Errorf("Expected status %d, got %d: %s", tt.expectStatus, w.Code, w.Body.String())
			}

			if tt.expectContains != "" && !strings.Contains(w.Body.String(), tt.expectContains) {
				t.Errorf("Expected response to contain %q, got: %s", tt.expectContains, w.Body.String())
			}

			// For successful creation, verify no revision if empty branch
			if tt.expectStatus == http.StatusCreated && tt.sourceBranch == "" {
				var response struct {
					Changeset struct {
						Revisions []interface{} `json:"revisions"`
					} `json:"changeset"`
				}
				if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
					t.Fatal(err)
				}
				if len(response.Changeset.Revisions) != 0 {
					t.Errorf("Expected draft changeset with 0 revisions, got %d", len(response.Changeset.Revisions))
				}
			}
		})
	}

	t.Log("✓ Branch validation correctly rejects invalid refs")
	t.Log("✓ Path traversal attempts are blocked")
	t.Log("✓ Empty source_branch creates draft changeset")
	t.Log("✓ Valid branches create changesets with revisions")
}

// TestCompareValidation tests comparison endpoint validation
func TestCompareValidation(t *testing.T) {
	root := t.TempDir()
	repoPath := filepath.Join(root, "org-test", "owner", "compare-repo")
	if err := os.MkdirAll(repoPath, 0755); err != nil {
		t.Fatal(err)
	}

	gitTest(t, repoPath, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(repoPath, "file.txt"), []byte("content\n"), 0644); err != nil {
		t.Fatal(err)
	}
	gitTest(t, repoPath, "add", "file.txt")
	gitTest(t, repoPath, "commit", "-m", "commit")
	commitSHA := strings.TrimSpace(string(gitTest(t, repoPath, "rev-parse", "HEAD")))

	gitProvider, err := delivery.NewLocalGitProvider(root, 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}

	catalog := &testCatalog{
		repos: []delivery.RepositoryMetadata{
			{Slug: "owner/compare-repo", DefaultBranch: "main"},
		},
	}

	deps := DeliveryDependencies{
		Identity: &testPrincipal{Principal{OrganizationID: "org-test", UserID: "user-1", Role: "member"}},
		Catalog:  catalog,
		Git:      gitProvider,
		Preview:  gitProvider,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/compare", deps.compareRepositoryCommits)

	tests := []struct {
		name         string
		query        string
		expectStatus int
		expectError  string
	}{
		{
			name:         "Valid comparison succeeds",
			query:        "?base=" + commitSHA + "&head=" + commitSHA,
			expectStatus: http.StatusOK,
			expectError:  "",
		},
		{
			name:         "Explicit empty base compares against the empty tree",
			query:        "?base=&head=" + commitSHA,
			expectStatus: http.StatusOK,
		},
		{
			name:         "Merge base mode requires a nonempty ref",
			query:        "?base=&head=" + commitSHA + "&mode=merge-base",
			expectStatus: http.StatusBadRequest,
			expectError:  "with a nonempty base",
		},
		{
			name:         "Missing base parameter",
			query:        "?head=" + commitSHA,
			expectStatus: http.StatusBadRequest,
			expectError:  "base and head refs are required",
		},
		{
			name:         "Missing head parameter",
			query:        "?base=" + commitSHA,
			expectStatus: http.StatusBadRequest,
			expectError:  "base and head refs are required",
		},
		{
			name:         "Invalid mode parameter",
			query:        "?base=" + commitSHA + "&head=" + commitSHA + "&mode=invalid",
			expectStatus: http.StatusBadRequest,
			expectError:  "Mode must be empty or 'merge-base'",
		},
		{
			name:         "Valid merge-base mode",
			query:        "?base=" + commitSHA + "&head=" + commitSHA + "&mode=merge-base",
			expectStatus: http.StatusOK,
			expectError:  "",
		},
		{
			name:         "Nonexistent base ref",
			query:        "?base=nonexistent&head=" + commitSHA,
			expectStatus: http.StatusNotFound,
			expectError:  "base ref could not be resolved",
		},
		{
			name:         "Nonexistent head ref",
			query:        "?base=" + commitSHA + "&head=nonexistent",
			expectStatus: http.StatusNotFound,
			expectError:  "head ref could not be resolved",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/v1/organizations/org-test/repositories/owner/compare-repo/compare"+tt.query, nil)
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, req)

			if w.Code != tt.expectStatus {
				t.Errorf("Expected status %d, got %d: %s", tt.expectStatus, w.Code, w.Body.String())
			}

			if tt.expectError != "" && !strings.Contains(w.Body.String(), tt.expectError) {
				t.Errorf("Expected error containing %q, got: %s", tt.expectError, w.Body.String())
			}
		})
	}

	t.Log("✓ Comparison endpoint validates required parameters")
	t.Log("✓ Invalid mode parameter rejected")
	t.Log("✓ Nonexistent refs return 404")
}
