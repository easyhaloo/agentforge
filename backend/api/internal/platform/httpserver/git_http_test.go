package httpserver

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

func TestMain(m *testing.M) {
	if handled, status := githttp.RunHelper(os.Args); handled {
		os.Exit(status)
	}
	os.Exit(m.Run())
}

type testGitCredentials struct {
	mu    sync.Mutex
	items map[string]testGitCredential
}

type testGitCredential struct {
	org, repo, actor, scope string
	hash                    []byte
	expires                 time.Time
}

func (s *testGitCredentials) CreateGitCredential(_ context.Context, id, org, repo, actor, scope string, hash []byte, expires time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[id] = testGitCredential{org, repo, actor, scope, hash, expires}
	return nil
}

func (s *testGitCredentials) RevokeGitCredential(_ context.Context, id, org, repo, actor string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	item := s.items[id]
	if item.org == org && item.repo == repo && item.actor == actor {
		delete(s.items, id)
	}
	return nil
}

func (s *testGitCredentials) AuthorizeGitCredential(_ context.Context, hash []byte, org, repo string, write bool) (string, string, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, item := range s.items {
		if item.org == org && item.repo == repo && bytes.Equal(item.hash, hash) && item.expires.After(time.Now()) && (!write || item.scope == "write") {
			return item.org, item.actor, "main", nil
		}
	}
	return "", "", "", identity.ErrUnauthenticated
}

func (s *testGitCredentials) LockGitDefaultBranch(context.Context, string, string) (string, int, func(), error) {
	return "main", 0, func() {}, nil
}

func TestGitSmartHTTPCloneFetchPushAndCredentials(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is required")
	}
	root := t.TempDir()
	helper, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	transport, err := githttp.New(t.Context(), root, helper)
	if err != nil {
		t.Fatal(err)
	}
	localGit := func(dir string, args ...string) string {
		t.Helper()
		return runGitHTTPTest(t, dir, nil, args...)
	}
	seed := t.TempDir()
	localGit(seed, "init", "--initial-branch=main", ".")
	localGit(seed, "commit", "--allow-empty", "-m", "Seed")
	bare := filepath.Join(root, "org-a", "imported", "project")
	if err := os.MkdirAll(filepath.Dir(bare), 0700); err != nil {
		t.Fatal(err)
	}
	localGit(seed, "clone", "--bare", ".", bare)
	seedSHA := localGit(seed, "rev-parse", "HEAD")
	creds := &testGitCredentials{items: map[string]testGitCredential{}}
	deps := DeliveryDependencies{
		GitHTTP: transport, GitCredentials: creds, Identity: fixedIdentity{role: "member"}, CSRF: allowCSRF{}, AllowedOrigin: "https://app.example.test",
		Catalog: &lifecycleCatalog{items: []delivery.RepositoryMetadata{{OrganizationID: "org-a", Slug: "imported/project", DefaultBranch: "main"}}},
	}
	handler := NewHandlerWithDependencies(deps)
	server := httptest.NewTLSServer(handler)
	defer server.Close()
	ca := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	const credentialPath = "/api/v1/organizations/org-a/repositories/imported/project/git-credentials"
	request := func(handler http.Handler, method, path, body, token string, csrf bool) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if csrf {
			addValidCSRFCookies(req)
		}
		if token != "" {
			req.SetBasicAuth("git", token)
		}
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, req)
		return result
	}
	if got := request(handler, "POST", credentialPath, `{"scope":"write"}`, "", false).Code; got != http.StatusForbidden {
		t.Fatalf("POST without CSRF got %d", got)
	}
	viewer := deps
	viewer.Identity = fixedIdentity{role: "viewer"}
	if got := request(NewHandlerWithDependencies(viewer), "POST", credentialPath, `{"scope":"write"}`, "", true).Code; got != http.StatusForbidden {
		t.Fatalf("viewer write credential got %d", got)
	}
	type credential struct {
		ID, Token, Username string
		ExpiresAt           time.Time `json:"expires_at"`
	}
	issue := func(scope string) credential {
		t.Helper()
		activeHandler := handler
		if scope == "read" {
			activeHandler = NewHandlerWithDependencies(viewer)
		}
		response := request(activeHandler, "POST", credentialPath, `{"scope":"`+scope+`"}`, "", true)
		var value credential
		if response.Code != http.StatusCreated || json.Unmarshal(response.Body.Bytes(), &value) != nil || value.ID == "" || value.Username != "git" || value.ExpiresAt.Before(time.Now().Add(59*time.Minute)) {
			t.Fatalf("credential creation failed, status=%d", response.Code)
		}
		expectedHash := sha256.Sum256([]byte(value.Token))
		if !bytes.Equal(creds.items[value.ID].hash, expectedHash[:]) || !strings.Contains(response.Header().Get("Cache-Control"), "no-store") {
			t.Fatal("credential storage or cache policy is incorrect")
		}
		return value
	}
	read, write := issue("read"), issue("write")
	const path = "/git/org-a/imported/project.git"
	const refs = "/info/refs?service="
	const authFailure = http.StatusUnauthorized
	for _, c := range []struct{ path, token string }{
		{path + refs + githttp.UploadPack, ""},
		{path + refs + githttp.ReceivePack, read.Token},
		{"/git/org-a/imported/other.git" + refs + githttp.UploadPack, write.Token},
		{"/git/org-b/imported/project.git" + refs + githttp.UploadPack, write.Token},
	} {
		result := request(handler, "GET", c.path, "", c.token, false)
		if result.Code != authFailure || result.Header().Get("WWW-Authenticate") == "" {
			t.Fatalf("unauthorized %s got %d", c.path, result.Code)
		}
	}
	gitEnv := func(token string) []string {
		return []string{"GIT_SSL_CAINFO=" + ca, "GIT_CONFIG_COUNT=1", "GIT_CONFIG_KEY_0=http.extraHeader", "GIT_CONFIG_VALUE_0=Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte("git:"+token))}
	}
	checkout := filepath.Join(t.TempDir(), "checkout")
	runGitHTTPTest(t, seed, gitEnv(read.Token), "clone", server.URL+path, checkout)
	if got := localGit(checkout, "rev-parse", "HEAD"); got != seedSHA {
		t.Fatalf("clone HEAD = %s, want %s", got, seedSHA)
	}
	localGit(checkout, "checkout", "-b", "issue-1")
	localGit(checkout, "commit", "--allow-empty", "-m", "Add change for #1")
	pushedSHA := localGit(checkout, "rev-parse", "HEAD")
	runGitHTTPTest(t, checkout, gitEnv(write.Token), "push", "origin", "HEAD:refs/heads/issue-1")
	runGitHTTPTest(t, checkout, gitEnv(read.Token), "fetch", "origin", "refs/heads/issue-1")
	if got := localGit(checkout, "rev-parse", "FETCH_HEAD"); got != pushedSHA {
		t.Fatalf("fetch SHA = %s, want %s", got, pushedSHA)
	}
	for _, ref := range []string{"refs/heads/main", "refs/notes/commits"} {
		out, err := gitHTTPTestCommand(t, checkout, gitEnv(write.Token), "push", "origin", "HEAD:"+ref).CombinedOutput()
		if err == nil || !strings.Contains(string(out), "pre-receive hook declined") {
			t.Fatalf("push to protected ref %s was not rejected by policy: %s", ref, out)
		}
	}
	journal, err := filepath.Glob(filepath.Join(root, ".agentforge-push-events", "*.json"))
	if err != nil || len(journal) != 1 {
		t.Fatalf("accepted pushes journaled = %d, want 1 (%v)", len(journal), err)
	}
	data, err := os.ReadFile(journal[0])
	if err != nil {
		t.Fatal(err)
	}
	var event githttp.PushEvent
	if err := json.Unmarshal(data, &event); err != nil {
		t.Fatal(err)
	}
	if event.Organization != "org-a" || event.Repository != "imported/project" || event.Actor != "test-user" || event.Base != seedSHA || event.ID+".json" != filepath.Base(journal[0]) || len(event.Updates) != 1 || event.Updates[0] != (githttp.RefUpdate{Ref: "refs/heads/issue-1", Old: strings.Repeat("0", 40), New: pushedSHA}) {
		t.Fatalf("unexpected event: %+v", event)
	}
	if got := request(handler, "DELETE", credentialPath+"/"+write.ID, "", "", true).Code; got != http.StatusNoContent {
		t.Fatalf("revocation got %d", got)
	}
	if got := request(handler, "GET", path+refs+githttp.UploadPack, "", write.Token, false).Code; got != authFailure {
		t.Fatalf("revoked token got %d", got)
	}
}

func gitHTTPTestCommand(t *testing.T, dir string, env []string, args ...string) *exec.Cmd {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	t.Cleanup(cancel)
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append([]string{"PATH=" + os.Getenv("PATH"), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_TERMINAL_PROMPT=0",
		"GIT_AUTHOR_NAME=AgentForge", "GIT_AUTHOR_EMAIL=developer@example.invalid", "GIT_COMMITTER_NAME=AgentForge", "GIT_COMMITTER_EMAIL=developer@example.invalid"}, env...)
	return cmd
}

func runGitHTTPTest(t *testing.T, dir string, env []string, args ...string) string {
	t.Helper()
	out, err := gitHTTPTestCommand(t, dir, env, args...).CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", args[0], err, out)
	}
	return strings.TrimSpace(string(out))
}
