package delivery

import (
	"encoding/pem"
	"errors"
	"net/http"
	"net/http/cgi"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Exercise real upload-pack and receive-pack over TLS with an ephemeral credential.
func TestRemoteGitContract(t *testing.T) {
	for _, host := range []string{"github", "gitlab"} {
		t.Run(host, func(t *testing.T) {
			ctx := t.Context()
			src, root := t.TempDir(), t.TempDir()
			bare := filepath.Join(root, "team", "repo.git")
			git := func(dir string, args ...string) string {
				t.Helper()
				out, err := previewGit(ctx, dir, append([]string{"-c", "protocol.file.allow=always"}, args...)...)
				if err != nil {
					t.Fatalf("fixture git %s: %v", args[0], err)
				}
				return strings.TrimSpace(string(out))
			}
			write := func(p, s string) {
				t.Helper()
				if err := os.WriteFile(p, []byte(s), 0600); err != nil {
					t.Fatal(err)
				}
			}
			git(src, "init", "--template=", "-b", "master")
			git(src, "commit", "--allow-empty", "-m", "base")
			base := git(src, "rev-parse", "HEAD")
			git(src, "checkout", "-b", "topic")
			write(filepath.Join(src, "input"), "pinned files")
			git(src, "add", "input")
			git(src, "commit", "-m", "one")
			intermediate := git(src, "rev-parse", "HEAD")
			git(src, "commit", "--allow-empty", "-m", "two")
			tip := git(src, "rev-parse", "HEAD")
			git(src, "clone", "--template=", "--bare", src, bare)
			git(bare, "config", "http.receivepack", "true")
			bin, err := exec.LookPath("git")
			if err != nil {
				t.Fatal(err)
			}
			backend := &cgi.Handler{Path: bin, Args: []string{"http-backend"}, Env: []string{"GIT_PROJECT_ROOT=" + root, "GIT_HTTP_EXPORT_ALL=1", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null"}}
			username := "x-access-token"
			if host == "gitlab" {
				username = "oauth2"
			}
			const password = "only-for-this-fixture"
			var raceTarget, loseReply atomic.Bool
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				u, p, ok := r.BasicAuth()
				if !ok || u != username || p != password {
					http.Error(w, "denied", 403)
					return
				}
				if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/git-receive-pack") {
					if raceTarget.Swap(false) {
						if _, err := previewGit(r.Context(), bare, "update-ref", "refs/heads/master", tip, base); err != nil {
							t.Error(err)
							http.Error(w, "fixture failure", 500)
							return
						}
					}
					if loseReply.Swap(false) {
						backend.ServeHTTP(httptest.NewRecorder(), r)
						http.Error(w, "lost reply", 502)
						return
					}
				}
				backend.ServeHTTP(w, r)
			}))
			defer server.Close()
			ca := filepath.Join(root, "ca.pem")
			write(ca, string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw})))
			file := filepath.Join(root, "token")
			write(file, password)
			const org, repo = "org", "delivery/repo"
			binding := RemoteGitRepository{Provider: host, OrganizationID: org, Repository: repo, URL: server.URL + "/team/repo.git", TokenFile: file, CAFile: ca}
			p, err := NewRemoteGitProvider([]RemoteGitRepository{binding}, 30*time.Second)
			if err != nil {
				t.Fatal(err)
			}
			req := MergeRequest{Target: "master", Sources: []string{"topic"}}
			if _, err = p.PrepareCandidate(ctx, "other", repo, req); !errors.Is(err, ErrRepositoryInvalid) {
				t.Fatalf("unbound tenant: %v", err)
			}
			for _, bad := range []string{"../topic", "topic:master", "agentforge/promotions/run"} {
				if _, err := p.PreviewMerge(ctx, org, repo, MergeRequest{Target: bad, Sources: req.Sources}); !errors.Is(err, ErrRepositoryInvalid) {
					t.Fatalf("unsafe ref %q: %v", bad, err)
				}
			}
			rev, err := p.ResolveRevision(ctx, org, repo, "refs/heads/topic")
			if err != nil || rev.CommitSHA != tip || rev.ParentSHA != intermediate {
				t.Fatalf("resolved %+v: %v", rev, err)
			}
			preview, err := p.PreviewMerge(ctx, org, repo, req)
			if err != nil || preview.Status != "clean" || preview.Target.SHA != base || preview.Sources[0].SHA != tip {
				t.Fatalf("preview %+v: %v", preview, err)
			}
			if git(bare, "for-each-ref", remoteCI) != "" {
				t.Fatal("preview retained refs")
			}
			candidate, err := p.PrepareCandidate(ctx, org, repo, MergeRequest{Target: "master", Sources: []string{tip}})
			sha := candidate.CandidateSHA
			if err != nil || sha != preview.CandidateSHA || git(bare, "rev-parse", "master") != base {
				t.Fatalf("candidate %+v: %v", candidate, err)
			}
			git(bare, "update-ref", "-d", "refs/heads/topic")
			commits, err := p.CandidateCommits(ctx, org, repo, candidate)
			if err != nil || !slices.Contains(commits, intermediate) || slices.Contains(commits, base) {
				t.Fatalf("history %v: %v", commits, err)
			}
			dir, clean, err := p.CheckoutCandidate(ctx, org, repo, sha)
			if err != nil {
				t.Fatal(err)
			}
			defer clean()
			content, err := os.ReadFile(filepath.Join(dir, "input"))
			if err != nil || string(content) != "pinned files" {
				t.Fatal("checkout mismatch")
			}
			if _, err = os.Stat(filepath.Join(dir, ".git")); !os.IsNotExist(err) {
				t.Fatal("checkout metadata exposed")
			}
			clean()
			if _, err = os.Stat(dir); !os.IsNotExist(err) {
				t.Fatal("workspace not removed")
			}
			promote := func(run string) error { return p.PromoteCandidate(ctx, org, repo, run, candidate) }
			receipt := func(run string) bool {
				t.Helper()
				ok, err := p.HasPromotion(ctx, org, repo, run, sha)
				if err != nil {
					t.Fatal(err)
				}
				return ok
			}
			for _, moved := range []string{tip, sha} {
				git(bare, "update-ref", "refs/heads/master", moved)
				if err = promote("stale"); !errors.Is(err, ErrCandidateStale) || receipt("stale") || git(bare, "rev-parse", "master") != moved {
					t.Fatalf("stale promotion %s: %v", moved, err)
				}
			}
			git(bare, "update-ref", "refs/heads/master", base)
			raceTarget.Store(true)
			if err = promote("raced"); !errors.Is(err, ErrCandidateStale) || receipt("raced") || git(bare, "rev-parse", "master") != tip {
				t.Fatalf("target moved after advertisement: %v", err)
			}
			git(bare, "update-ref", "refs/heads/master", base)
			git(bare, "config", "receive.advertiseAtomic", "false")
			if err = promote("non-atomic"); !errors.Is(err, ErrProviderUnavailable) || receipt("non-atomic") || git(bare, "rev-parse", "master") != base {
				t.Fatalf("non-atomic promotion: %v", err)
			}
			git(bare, "config", "receive.advertiseAtomic", "true")
			git(bare, "update-ref", remoteReceipt("collision"), tip)
			if err = promote("collision"); !errors.Is(err, ErrRepositoryInvalid) || git(bare, "rev-parse", "master") != base {
				t.Fatalf("receipt collision: %v", err)
			}
			loseReply.Store(true)
			if err = promote("run"); err != nil || loseReply.Load() || !receipt("run") || git(bare, "rev-parse", "master") != sha {
				t.Fatalf("promotion: %v", err)
			}
			git(bare, "update-ref", remoteCandidate(sha), tip)
			if _, _, err = p.CheckoutCandidate(ctx, org, repo, sha); !errors.Is(err, ErrRepositoryInvalid) {
				t.Fatalf("mismatched retained ref: %v", err)
			}
			if err = p.DeleteCandidate(ctx, org, repo, sha); !errors.Is(err, ErrRepositoryInvalid) {
				t.Fatalf("cleanup of mismatched ref: %v", err)
			}
			git(bare, "update-ref", remoteCandidate(sha), sha)
			for range 2 {
				if err = p.DeleteCandidate(ctx, org, repo, sha); err != nil {
					t.Fatal(err)
				}
			}
			if git(bare, "for-each-ref", remoteCandidate(sha)) != "" {
				t.Fatal("candidate retained after cleanup")
			}
			git(bare, "update-ref", "refs/heads/master", tip)
			if err = promote("run"); err != nil || git(bare, "rev-parse", "master") != tip {
				t.Fatalf("receipt replay after cleanup and movement: %v", err)
			}
			write(file, "expired")
			if ok, err := p.HasPromotion(ctx, org, repo, "run", sha); ok || !errors.Is(err, ErrProviderUnavailable) {
				t.Fatalf("unreadable receipt: %t %v", ok, err)
			}
		})
	}
}

func TestRemoteBindings(t *testing.T) {
	r := RemoteGitRepository{Provider: "github", OrganizationID: "org", Repository: "team/repo", URL: "https://github.com/team/repo.git"}
	if _, err := NewRemoteGitProvider([]RemoteGitRepository{r, r}, 0); !errors.Is(err, ErrRepositoryInvalid) {
		t.Fatal("ambiguous binding accepted")
	}
	for _, url := range []string{"file:///tmp/a", "ext::git", "http://localhost/team/repo", "https://user:pass@host/team/repo", "https://host/team/../repo", "https://host/team/%2frepo", "https://host/team/repo?token=X"} {
		r.URL = url
		if _, err := NewRemoteGitProvider([]RemoteGitRepository{r}, 0); !errors.Is(err, ErrRepositoryInvalid) {
			t.Fatalf("invalid URL accepted: %s", url)
		}
	}
}
