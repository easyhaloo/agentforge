// Package githttp runs Git's Smart HTTP CGI backend for authorized local bare repositories.
package githttp

import (
	"bufio"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/textproto"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
)

const (
	UploadPack     = "git-upload-pack"
	ReceivePack    = "git-receive-pack"
	maxBody        = 64 << 20
	maxResponse    = 256 << 20
	maxHeader      = 16 << 10
	requestTimeout = 2 * time.Minute
)

var segment = regexp.MustCompile(`^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$`)

func ValidSegment(value string) bool {
	return segment.MatchString(value) && !strings.Contains(value, "..")
}

type CredentialSummary struct {
	ID        string    `json:"id"`
	Scope     string    `json:"scope"`
	ExpiresAt time.Time `json:"expires_at"`
}

type Transport struct {
	root, git, backend, helper, runtime string
	shutdown                            context.Context
	slots                               chan struct{}
}

// New uses the Git installation on the server's PATH. The helper is this API executable.
func New(shutdown context.Context, root, helper string) (*Transport, error) {
	root, err := filepath.EvalSymlinks(root)
	if err != nil || !filepath.IsAbs(root) || !filepath.IsAbs(helper) {
		return nil, errors.New("Git HTTP requires absolute storage and helper paths")
	}
	git, err := exec.LookPath("git")
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, git, "--exec-path")
	cmd.Env = []string{"PATH=/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null"}
	out, err := cmd.Output()
	backend := filepath.Join(strings.TrimSpace(string(out)), "git-http-backend")
	stat, statErr := os.Stat(backend)
	if err != nil || statErr != nil || !filepath.IsAbs(backend) || !stat.Mode().IsRegular() || stat.Mode().Perm()&0111 == 0 {
		return nil, errors.New("git-http-backend is unavailable")
	}
	return &Transport{root: root, git: git, helper: helper, backend: backend, runtime: filepath.Dir(backend), shutdown: shutdown, slots: make(chan struct{}, 4)}, nil
}

// repositoryPath accepts only the exact standalone bare repository minted by the catalog.
func (t *Transport) repositoryPath(organization, repository string) (string, error) {
	owner, name, ok := strings.Cut(repository, "/")
	if !ok || !ValidSegment(organization) || !ValidSegment(owner) || !ValidSegment(name) {
		return "", os.ErrNotExist
	}
	path := t.root
	for _, part := range []string{organization, owner, name} {
		path = filepath.Join(path, part)
		if info, err := os.Lstat(path); err != nil || !info.IsDir() {
			return "", os.ErrNotExist
		}
	}
	for _, file := range []string{"HEAD", "config", "objects", "objects/info", "objects/pack", "refs"} {
		info, err := os.Lstat(filepath.Join(path, file))
		if err != nil || (file == "HEAD" || file == "config") && !info.Mode().IsRegular() ||
			(file != "HEAD" && file != "config") && !info.IsDir() {
			return "", os.ErrNotExist
		}
	}
	for _, prohibited := range []string{".git", "commondir", "objects/info/alternates", "objects/info/http-alternates"} {
		if _, err := os.Lstat(filepath.Join(path, prohibited)); !errors.Is(err, os.ErrNotExist) {
			return "", os.ErrNotExist
		}
	}
	return path, nil
}

func (t *Transport) Available(organization, repository string) bool {
	_, err := t.repositoryPath(organization, repository)
	return err == nil
}

func (t *Transport) DefaultBranchMatches(organization, repository, branch string) bool {
	path, err := t.repositoryPath(organization, repository)
	return err == nil && defaultBranchMatches(path, "refs/heads/"+branch)
}

func defaultBranchMatches(path, ref string) bool {
	head, err := os.ReadFile(filepath.Join(path, "HEAD"))
	return err == nil && strings.TrimSpace(string(head)) == "ref: "+ref
}

// SyncDefaultBranch uses the catalog as the source of truth for the advertised HEAD.
// Callers hold the same row lock used to protect the push destination.
func (t *Transport) SyncDefaultBranch(ctx context.Context, organization, repository, branch string) error {
	path, err := t.repositoryPath(organization, repository)
	if err != nil {
		return err
	}
	ref := "refs/heads/" + branch
	if defaultBranchMatches(path, ref) {
		return nil
	}
	cmd := exec.CommandContext(ctx, t.git, "--git-dir="+path, "symbolic-ref", "HEAD", ref)
	cmd.Env = []string{"GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null"}
	return cmd.Run()
}

// Serve takes server-resolved identity and catalog fields, never a user-supplied filesystem path.
func (t *Transport) Serve(w http.ResponseWriter, r *http.Request, service, organization, repository, actor string, policy PushPolicy) {
	if service != UploadPack && service != ReceivePack {
		http.NotFound(w, r)
		return
	}
	path, err := t.repositoryPath(organization, repository)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	select {
	case t.slots <- struct{}{}:
		defer func() { <-t.slots }()
	default:
		w.Header().Set("Retry-After", "1")
		http.Error(w, "Git transport busy", http.StatusServiceUnavailable)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
	defer cancel()
	stopShutdown := context.AfterFunc(t.shutdown, cancel)
	defer stopShutdown()
	deadline, _ := ctx.Deadline()
	controller := http.NewResponseController(w)
	_ = controller.SetReadDeadline(deadline)
	_ = controller.SetWriteDeadline(deadline)
	_ = controller.EnableFullDuplex()
	deadlineSet := make(chan struct{})
	stopDeadline := context.AfterFunc(ctx, func() {
		_ = controller.SetReadDeadline(time.Now())
		close(deadlineSet)
	})
	defer func() {
		if !stopDeadline() {
			<-deadlineSet
		}
		_ = controller.SetReadDeadline(time.Time{})
		_ = controller.SetWriteDeadline(time.Time{})
	}()

	endpoint, query, contentLength := "/info/refs", "service="+service, ""
	var body io.Reader
	if r.Method == http.MethodPost {
		endpoint, query = "/"+service, ""
		if r.ContentLength > maxBody {
			http.Error(w, "Git request too large", http.StatusRequestEntityTooLarge)
			return
		}
		if r.Header.Get("Content-Type") != "application/x-"+service+"-request" {
			http.Error(w, "Invalid Git content type", http.StatusUnsupportedMediaType)
			return
		}
		body = http.MaxBytesReader(w, r.Body, maxBody)
		switch r.Header.Get("Content-Encoding") {
		case "", "identity":
			if r.ContentLength >= 0 {
				contentLength = fmt.Sprint(r.ContentLength)
			}
		case "gzip":
			gz, err := gzip.NewReader(body)
			if err != nil {
				http.Error(w, "Invalid compressed Git request", http.StatusBadRequest)
				return
			}
			defer gz.Close()
			body = http.MaxBytesReader(w, gz, maxBody)
		default:
			http.Error(w, "Invalid Git content encoding", http.StatusUnsupportedMediaType)
			return
		}
	}
	work, err := os.MkdirTemp("", "agentforge-git-http-")
	if err != nil {
		http.Error(w, "Git transport unavailable", http.StatusServiceUnavailable)
		return
	}
	defer os.RemoveAll(work)
	hooks := filepath.Join(work, "hooks")
	if err := os.Mkdir(hooks, 0700); err != nil {
		http.Error(w, "Git transport unavailable", http.StatusServiceUnavailable)
		return
	}
	var pushEnv []string
	if service == ReceivePack && r.Method == http.MethodPost {
		// HEAD is also protected if it differs from the catalog's configured default.
		if policy.DefaultBranch == "" || !ValidProtectedRefs(policy.ProtectedRefs) || !ValidRefRules(policy.RefRules) {
			http.Error(w, "Push policy unavailable", http.StatusServiceUnavailable)
			return
		}
		journal := t.journal()
		if err := prepareHooks(hooks, journal, t.helper); err != nil {
			http.Error(w, "Push policy unavailable", http.StatusServiceUnavailable)
			return
		}
		if err := t.reconcileRepository(ctx, organization, repository); err != nil {
			http.Error(w, "Push recovery pending", http.StatusServiceUnavailable)
			return
		}
		// Read the base before receive changes any refs, while the repository is locked.
		base := exec.CommandContext(ctx, t.git, "--git-dir="+path, "rev-parse", "--verify", "--end-of-options", "refs/heads/"+policy.DefaultBranch+"^{commit}")
		base.Env = []string{"PATH=" + t.runtime + ":/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_NO_REPLACE_OBJECTS=1"}
		out, err := base.Output()
		baseSHA := strings.TrimSpace(string(out))
		if err != nil || !validObjectID(baseSHA) {
			http.Error(w, "Push policy unavailable", http.StatusServiceUnavailable)
			return
		}
		protectedRefs, _ := json.Marshal(policy.ProtectedRefs) // A string slice always marshals.
		rules, _ := json.Marshal(policy.RefRules)              // Rules contain only serializable fields.
		pushEnv = []string{"AF_GIT_BASE=" + baseSHA, "AF_GIT_JOURNAL=" + journal, "AF_GIT_ORG=" + organization, "AF_GIT_REPO=" + repository,
			"AF_GIT_ACTOR=" + actor, "AF_GIT_DEFAULT=" + policy.DefaultBranch, "AF_GIT_PUSH_REF_LIMIT=" + strconv.Itoa(policy.RefLimit),
			"AF_GIT_PROTECTED_REFS=" + string(protectedRefs), "AF_GIT_REF_RULES=" + string(rules), "AF_GIT_BINARY=" + t.git, "AF_GIT_INTENT=" + uuid.NewString()}
	}
	cmd := exec.CommandContext(ctx, t.helper, helperCommand, t.backend)
	cmd.Dir = work
	cmd.Env = append([]string{
		"PATH=" + t.runtime + ":/usr/bin:/bin", "LC_ALL=C", "HOME=" + work, "XDG_CONFIG_HOME=" + work,
		"GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_ATTR_NOSYSTEM=1", "GIT_TERMINAL_PROMPT=0",
		"GIT_NO_REPLACE_OBJECTS=1", "GIT_ALLOW_PROTOCOL=", "GIT_HTTP_EXPORT_ALL=1",
		"REQUEST_METHOD=" + r.Method, "PATH_TRANSLATED=" + path + endpoint, "QUERY_STRING=" + query,
		"CONTENT_TYPE=" + r.Header.Get("Content-Type"), "CONTENT_LENGTH=" + contentLength, "REMOTE_USER=git",
	}, pushEnv...)
	// Pass only supported protocol versions into Git's CGI environment.
	switch protocol := r.Header.Get("Git-Protocol"); protocol {
	case "version=1", "version=2":
		cmd.Env = append(cmd.Env, "HTTP_GIT_PROTOCOL="+protocol)
	}
	configs := [][2]string{
		{"core.hooksPath", hooks}, {"http.getanyfile", "false"}, {"http.uploadpack", "true"},
		{"http.receivepack", fmt.Sprint(service == ReceivePack)}, {"receive.maxInputSize", fmt.Sprint(maxBody)},
		{"receive.fsckObjects", "true"}, {"receive.advertisePushOptions", "false"}, {"receive.autogc", "false"},
		{"maintenance.auto", "false"}, {"pack.threads", "1"}, {"pack.windowMemory", "32m"}, {"core.fsmonitor", "false"},
		{"core.fsync", "committed,reference"}, {"core.fsyncMethod", "fsync"},
	}
	cmd.Env = append(cmd.Env, fmt.Sprintf("GIT_CONFIG_COUNT=%d", len(configs)))
	for i, config := range configs {
		cmd.Env = append(cmd.Env, fmt.Sprintf("GIT_CONFIG_KEY_%d=%s", i, config[0]), fmt.Sprintf("GIT_CONFIG_VALUE_%d=%s", i, config[1]))
	}
	cmd.Stdin = body
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = time.Second
	out, err := cmd.StdoutPipe()
	if err != nil || cmd.Start() != nil {
		http.Error(w, "Git transport unavailable", http.StatusServiceUnavailable)
		return
	}
	waited := false
	defer func() {
		if !waited {
			cancel()
			_ = cmd.Wait()
		}
	}()
	expected := "application/x-" + service + "-advertisement"
	if r.Method == http.MethodPost {
		expected = "application/x-" + service + "-result"
	}
	stream := bufio.NewReaderSize(out, maxHeader)
	if readCGIHeader(stream) != expected {
		if ctx.Err() != nil {
			http.Error(w, "Git request timed out", http.StatusGatewayTimeout)
		} else {
			http.Error(w, "Git backend unavailable", http.StatusBadGateway)
		}
		return
	}
	w.Header().Set("Content-Type", expected)
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusOK)
	if n, err := io.Copy(w, io.LimitReader(stream, maxResponse)); err != nil || n == maxResponse || ctx.Err() != nil {
		panic(http.ErrAbortHandler)
	}
	err = cmd.Wait()
	waited = true
	if err != nil {
		panic(http.ErrAbortHandler)
	}
}

func readCGIHeader(stream *bufio.Reader) string {
	var contentType string
	for remaining := maxHeader; remaining > 0; {
		line, err := stream.ReadSlice('\n')
		if err != nil || len(line) > remaining {
			return ""
		}
		remaining -= len(line)
		value := strings.TrimRight(string(line), "\r\n")
		if value == "" {
			return contentType
		}
		key, value, ok := strings.Cut(value, ":")
		if !ok {
			return ""
		}
		switch textproto.CanonicalMIMEHeaderKey(key) {
		case "Status":
			if !strings.HasPrefix(strings.TrimSpace(value), "200 ") {
				return ""
			}
		case "Content-Type":
			if contentType != "" {
				return ""
			}
			contentType = strings.TrimSpace(value)
		}
	}
	return ""
}
