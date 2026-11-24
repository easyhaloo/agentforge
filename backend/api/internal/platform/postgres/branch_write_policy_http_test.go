package postgres

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestPlatformBranchWritesHonorRepositoryRulesets(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("requires PostgreSQL")
	}
	ctx := t.Context()
	store, err := Open(ctx, slugScratchDatabase(t, dsn, 1))
	lockMust(t, err)
	t.Cleanup(store.Close)
	const repo = "team/repo"
	owner := newLockHTTP(t, &lockFixture{ctx: ctx, store: store}, 0, repo)
	root := t.TempDir()
	dir := filepath.Join(root, owner.organizationID, repo)
	lockMust(t, os.MkdirAll(dir, 0700))
	git := func(t *testing.T, args ...string) string {
		t.Helper()
		cmd := exec.CommandContext(t.Context(), "git", append([]string{"-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid"}, args...)...)
		cmd.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null")
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v: %s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	git(t, "init", "--template=", "-b", "main")
	lockMust(t, os.WriteFile(filepath.Join(dir, "hello.txt"), []byte("before\n"), 0600))
	git(t, "add", "hello.txt")
	git(t, "commit", "-m", "initial")
	base, blob := git(t, "rev-parse", "HEAD"), git(t, "rev-parse", "HEAD:hello.txt")
	provider, err := delivery.NewLocalGitProvider(root, 10*time.Second)
	lockMust(t, err)
	issueRepo := NewIssueRepository(store)
	owner.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Repository: store, Identity: store, CSRF: store, Catalog: store, Locker: store, AllowedOrigin: lockHTTPOrigin,
		Git: provider, Preview: provider, IssueRepo: issueRepo, IssueDetailRepo: issueRepo,
	})
	orgPath := "/api/v1/organizations/" + owner.organizationID
	call := func(t *testing.T, method, path, body string, status int) []byte {
		t.Helper()
		resp := owner.do(t.Context(), method, path, body)
		if resp.Code != status {
			t.Fatalf("%s %s: %d, want %d: %s", method, path, resp.Code, status, resp.Body)
		}
		return resp.Body.Bytes()
	}
	setRules := func(t *testing.T, rules ...githttp.RefRule) {
		t.Helper()
		repositories, err := store.ListRepositories(t.Context(), owner.organizationID)
		lockMust(t, err)
		metadata := repositories[0]
		metadata.RefRules = rules
		_, err = store.SetRepositoryGeneralSettings(t.Context(), metadata)
		lockMust(t, err)
	}
	assertRef := func(t *testing.T, ref, want string) {
		t.Helper()
		got := git(t, "for-each-ref", "--format=%(refname) %(objectname)", ref)
		if want != "" {
			want = ref + " " + want
		}
		if got != want {
			t.Fatalf("ref %s: %q, want %q", ref, got, want)
		}
	}
	assertRuleConflict := func(t *testing.T, response []byte, rule, branch string) {
		t.Helper()
		var problem struct{ Title, Detail string }
		lockMust(t, json.Unmarshal(response, &problem))
		if problem.Title != "Repository rule blocks branch write" || !strings.Contains(problem.Detail, rule) || !strings.Contains(problem.Detail, branch) {
			t.Fatalf("expected a conflict identifying rule %q and branch %q, got %s", rule, branch, response)
		}
	}

	t.Run("Issue create branch", func(t *testing.T) {
		var issue issues.Issue
		lockMust(t, json.Unmarshal(call(t, http.MethodPost, orgPath+"/issues", `{"repository":"team/repo","title":"Branch rules"}`, http.StatusCreated), &issue))
		path := fmt.Sprintf("%s/issues/%d/branches?repository=team%%2Frepo", orgPath, issue.Number)
		branch := "agentforge/issues/" + string(issue.ID) + "/fix"
		ref := "refs/heads/" + branch
		body := fmt.Sprintf(`{"name":"fix","base_branch":"main","base_sha":%q}`, base)
		creation := githttp.RefRule{Name: "Issue branch creation", Enabled: true, Target: "branch", Include: []string{"agentforge/issues/**"}, RestrictCreation: true}
		setRules(t, creation)
		assertRuleConflict(t, call(t, http.MethodPost, path, body, http.StatusConflict), creation.Name, branch)
		assertRef(t, ref, "")

		naming := creation
		naming.Name = "Issue branch naming"
		naming.RestrictCreation = false
		naming.NamePatterns = []githttp.RefNamePattern{{Operator: "starts_with", Pattern: "release/"}}
		setRules(t, naming)
		assertRuleConflict(t, call(t, http.MethodPost, path, body, http.StatusConflict), naming.Name, branch)
		assertRef(t, ref, "")

		creation.Exclude = []string{branch}
		setRules(t, creation,
			githttp.RefRule{Name: "Default branch creation", Enabled: true, Target: "branch", Include: []string{"~DEFAULT_BRANCH"}, RestrictCreation: true},
			githttp.RefRule{Name: "Issue branch updates", Enabled: true, Target: "branch", Include: []string{branch}, RestrictUpdate: true, RequirePullRequest: true},
		)
		_, release, err := store.LockGitPolicy(t.Context(), owner.organizationID, repo)
		lockMust(t, err)
		func() {
			defer release()
			call(t, http.MethodPost, path, body, http.StatusServiceUnavailable)
			assertRef(t, ref, "")
		}()
		var created delivery.RepositoryRef
		lockMust(t, json.Unmarshal(call(t, http.MethodPost, path, body, http.StatusCreated), &created))
		if created.Name != branch || created.SHA != base {
			t.Fatalf("unexpected issue branch: %+v", created)
		}
		assertRef(t, ref, base)
		call(t, http.MethodPost, path, body, http.StatusConflict)
		assertRef(t, ref, base)
		assertRef(t, "refs/heads/main", base)
	})

	t.Run("WebIDE create and update branch", func(t *testing.T) {
		var created struct{ Changeset struct{ ID string } }
		lockMust(t, json.Unmarshal(call(t, http.MethodPost, owner.changesetsPath(), `{"repository":"team/repo","title":"Edit file","source_branch":"main"}`, http.StatusCreated), &created))
		id := created.Changeset.ID
		branch := "agentforge/changesets/" + id
		ref := "refs/heads/" + branch
		path := owner.changesetsPath() + "/" + id + "/files"
		save := func(t *testing.T, commit, blob, content string, status int) []byte {
			t.Helper()
			body := fmt.Sprintf(`{"path":"hello.txt","base_commit_sha":%q,"base_blob_sha":%q,"content":%q}`, commit, blob, content)
			return call(t, http.MethodPut, path, body, status)
		}
		creation := githttp.RefRule{Name: "WebIDE branch creation", Enabled: true, Target: "branch", Include: []string{branch}, RestrictCreation: true}
		update := githttp.RefRule{Name: "WebIDE branch PR required", Enabled: true, Target: "branch", Include: []string{branch}, RequirePullRequest: true}
		initial := owner.stored(t, id).Version
		setRules(t, creation)
		assertRuleConflict(t, save(t, base, blob, "denied", http.StatusConflict), creation.Name, branch)
		assertRef(t, ref, "")

		naming := creation
		naming.Name = "WebIDE branch naming"
		naming.RestrictCreation = false
		naming.NamePatterns = []githttp.RefNamePattern{{Operator: "starts_with", Pattern: "release/"}}
		setRules(t, naming)
		assertRuleConflict(t, save(t, base, blob, "denied", http.StatusConflict), naming.Name, branch)
		assertRef(t, ref, "")
		if got := owner.stored(t, id).Version; got != initial {
			t.Fatalf("blocked creation recorded a revision: version %d, want %d", got, initial)
		}

		setRules(t, update)
		save(t, base, blob, "first edit\n", http.StatusOK)
		first := git(t, "rev-parse", ref)
		firstBlob := git(t, "rev-parse", ref+":hello.txt")
		version := owner.stored(t, id).Version
		assertRuleConflict(t, save(t, first, firstBlob, "denied", http.StatusConflict), update.Name, branch)
		assertRef(t, ref, first)
		update.Name = "WebIDE branch update restricted"
		update.RequirePullRequest, update.RestrictUpdate = false, true
		setRules(t, update)
		assertRuleConflict(t, save(t, first, firstBlob, "denied", http.StatusConflict), update.Name, branch)
		assertRef(t, ref, first)
		if got := owner.stored(t, id).Version; got != version {
			t.Fatalf("blocked updates recorded a revision: version %d, want %d", got, version)
		}

		setRules(t, creation)
		save(t, first, firstBlob, "second edit\n", http.StatusOK)
		if got := git(t, "show", ref+":hello.txt"); got != "second edit" {
			t.Fatalf("updated branch content = %q", got)
		}
		assertRef(t, "refs/heads/main", base)
	})
}
