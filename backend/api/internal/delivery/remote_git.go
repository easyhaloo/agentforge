package delivery

import (
	"context"
	"encoding/base64"
	"errors"
	"net"
	"net/netip"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// RemoteGitRepository binds an API repository to an operator-selected HTTPS endpoint.
// TokenFile and CAFile are optional absolute paths on the host.
type RemoteGitRepository struct {
	Provider       string `json:"provider"`
	OrganizationID string `json:"organizationId"`
	Repository     string `json:"repository"`
	URL            string `json:"url"`
	TokenFile      string `json:"tokenFile,omitempty"`
	CAFile         string `json:"caFile,omitempty"`
}

type RemoteGitProvider struct {
	repos   map[[2]string]RemoteGitRepository
	timeout time.Duration
}

var repoPath = regexp.MustCompile(`^[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+$`)

func validRepoPath(path string) bool {
	if !repoPath.MatchString(path) {
		return false
	}
	for _, s := range strings.Split(path, "/") {
		if s == "." || s == ".." {
			return false
		}
	}
	return true
}

func NewRemoteGitProvider(repos []RemoteGitRepository, timeout time.Duration) (*RemoteGitProvider, error) {
	if len(repos) == 0 {
		return nil, ErrRepositoryInvalid
	}
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	p := &RemoteGitProvider{make(map[[2]string]RemoteGitRepository), timeout}
	upstreams := make(map[string]bool, len(repos))
	for _, r := range repos {
		u, err := url.Parse(r.URL)
		key := [2]string{r.OrganizationID, r.Repository}
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil ||
			strings.ContainsAny(r.URL, "%?#\\") || !validRepoPath(strings.TrimPrefix(u.Path, "/")) {
			return nil, ErrRepositoryInvalid
		}
		if (r.Provider != "github" && r.Provider != "gitlab") || r.OrganizationID == "" || !validRepoPath(r.Repository) {
			return nil, ErrRepositoryInvalid
		}
		if (r.TokenFile != "" && !filepath.IsAbs(r.TokenFile)) || (r.CAFile != "" && !filepath.IsAbs(r.CAFile)) {
			return nil, ErrRepositoryInvalid
		}
		if _, exists := p.repos[key]; exists {
			return nil, ErrRepositoryInvalid
		}
		// Hosted repository paths are case-insensitive and the .git suffix is optional.
		host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
		if ip, err := netip.ParseAddr(host); err == nil {
			host = ip.Unmap().String()
		}
		port := uint64(443)
		if u.Port() != "" {
			port, err = strconv.ParseUint(u.Port(), 10, 16)
			if err != nil || port == 0 {
				return nil, ErrRepositoryInvalid
			}
		}
		upstream := net.JoinHostPort(host, strconv.FormatUint(port, 10)) + strings.TrimSuffix(strings.ToLower(u.Path), ".git")
		if upstreams[upstream] {
			return nil, ErrRepositoryInvalid
		}
		upstreams[upstream] = true
		p.repos[key] = r
	}
	return p, nil
}

// A fresh repository per operation keeps refs, configuration and object stores tenant-private.
func (p *RemoteGitProvider) workspace(ctx context.Context, org, repo string) (*remoteWork, func(), error) {
	r, ok := p.repos[[2]string{org, repo}]
	if !ok {
		return nil, nil, ErrRepositoryInvalid
	}
	dir, err := os.MkdirTemp("", "agentforge-remote-*")
	if err != nil {
		return nil, nil, ErrProviderUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, p.timeout)
	cleanup := func() { cancel(); os.RemoveAll(dir) }
	w := &remoteWork{ctx: ctx, dir: filepath.Join(dir, "src"), repo: r}
	if _, err := previewGit(ctx, dir, "init", "--quiet", "--template=", "--initial-branch=agentforge/workspace", w.dir); err != nil {
		cleanup()
		return nil, nil, ErrProviderUnavailable
	}
	return w, cleanup, nil
}

type remoteWork struct {
	ctx  context.Context
	dir  string
	repo RemoteGitRepository
}

func (w *remoteWork) git(args ...string) ([]byte, error) { return previewGit(w.ctx, w.dir, args...) }
func (w *remoteWork) network(args ...string) ([]byte, error) {
	opts := []string{"-c", "protocol.https.allow=always", "-c", "http.followRedirects=false"}
	env := []string{"HOME=" + w.dir}
	if w.repo.CAFile != "" {
		opts = append(opts, "-c", "http.sslCAInfo="+w.repo.CAFile)
	}
	if w.repo.TokenFile != "" {
		raw, err := os.ReadFile(w.repo.TokenFile)
		if err != nil {
			return nil, ErrProviderUnavailable
		}
		token := strings.TrimSpace(string(raw))
		if token == "" || strings.ContainsAny(token, "\x00\n\r") {
			return nil, ErrProviderUnavailable
		}
		username := "x-access-token"
		if w.repo.Provider == "gitlab" {
			username = "oauth2"
		}
		env = append(env, "AF_GIT_AUTH=Authorization: Basic "+base64.StdEncoding.EncodeToString([]byte(username+":"+token)))
		opts = append(opts, "--config-env=http.extraHeader=AF_GIT_AUTH")
	}
	return isolatedGit(w.ctx, w.dir, nil, env, append(opts, args...)...)
}

const remoteCI = "refs/heads/agentforge/"

func remoteCandidate(sha string) string { return remoteCI + "integration/" + sha }
func remoteReceipt(run string) string   { return remoteCI + "promotions/" + run }
func (w *remoteWork) branch(ref string) (string, error) {
	name := "refs/heads/" + ref
	if ref == "" || len(ref) > 255 || strings.HasPrefix(ref, "agentforge/") {
		return "", ErrRepositoryInvalid
	}
	if _, err := w.git("check-ref-format", name); err != nil {
		return "", ErrRepositoryInvalid
	}
	return name, nil
}
func (w *remoteWork) fetch(refs ...string) error {
	_, err := w.network(append([]string{"fetch", "--no-tags", "--no-recurse-submodules", "--", w.repo.URL}, refs...)...)
	if err != nil {
		return ErrProviderUnavailable
	}
	return nil
}
func (w *remoteWork) inputRef(ref string) (string, error) {
	if objectID.MatchString(ref) {
		return ref, nil
	}
	branch, err := w.branch(ref)
	if err != nil {
		return "", err
	}
	return branch + ":" + branch, nil
}
func (p *RemoteGitProvider) SupportsMergePreview(ctx context.Context) bool {
	return (&LocalGitProvider{Root: os.TempDir()}).SupportsMergePreview(ctx)
}
func (p *RemoteGitProvider) PreviewMerge(ctx context.Context, org, repo string, in MergeRequest) (MergePreview, error) {
	return p.merge(ctx, org, repo, in, false)
}
func (p *RemoteGitProvider) PrepareCandidate(ctx context.Context, org, repo string, in MergeRequest) (MergePreview, error) {
	return p.merge(ctx, org, repo, in, true)
}
func (p *RemoteGitProvider) merge(ctx context.Context, org, repo string, in MergeRequest, retain bool) (MergePreview, error) {
	if len(in.Sources) == 0 || len(in.Sources) > 32 || (in.Strategy != "" && in.Strategy != "merge-commit" && in.Strategy != "ff-only") {
		return MergePreview{}, ErrRepositoryInvalid
	}
	w, done, err := p.workspace(ctx, org, repo)
	if err != nil {
		return MergePreview{}, err
	}
	defer done()
	refs := []string{}
	for _, ref := range append([]string{in.Target}, in.Sources...) {
		spec, err := w.inputRef(ref)
		if err != nil {
			return MergePreview{}, err
		}
		refs = append(refs, spec)
	}
	if err = w.fetch(refs...); err != nil {
		return MergePreview{}, err
	}
	res, err := simulateMerge(w.ctx, w.dir, in)
	if err != nil || res.Status != "clean" || !retain {
		return res, err
	}
	ref := remoteCandidate(res.CandidateSHA)
	if _, err = w.network("push", "--force-with-lease="+ref+":", "--", w.repo.URL, res.CandidateSHA+":"+ref); err != nil {
		return MergePreview{}, ErrProviderUnavailable
	}
	return res, nil
}
func (p *RemoteGitProvider) ResolveRevision(ctx context.Context, org, repo, ref string) (GitRevision, error) {
	w, done, err := p.workspace(ctx, org, repo)
	if err != nil {
		return GitRevision{}, err
	}
	defer done()
	var spec string
	if branch, qualified := strings.CutPrefix(ref, "refs/heads/"); qualified {
		spec, err = w.branch(branch)
	} else {
		spec, err = w.inputRef(ref)
	}
	if err != nil {
		return GitRevision{}, err
	}
	if err = w.fetch(spec); err != nil {
		return GitRevision{}, err
	}
	out, err := w.git("rev-list", "--parents", "-n1", "FETCH_HEAD")
	f := strings.Fields(string(out))
	if err != nil || len(f) == 0 || !objectID.MatchString(f[0]) {
		return GitRevision{}, ErrRepositoryInvalid
	}
	rev := GitRevision{CommitSHA: f[0], Ref: ref}
	if len(f) > 1 {
		rev.ParentSHA = f[1]
	}
	return rev, nil
}

// Only integration promotion can write a remote target.
func (*RemoteGitProvider) MergeRevision(context.Context, string, string, string, string, string) (GitMerge, error) {
	return GitMerge{}, ErrProviderUnavailable
}
func (w *remoteWork) retained(sha string) error {
	if !objectID.MatchString(sha) {
		return ErrRepositoryInvalid
	}
	if err := w.fetch(remoteCandidate(sha)); err != nil {
		return err
	}
	out, err := w.git("rev-parse", "--verify", "FETCH_HEAD^{commit}")
	if err != nil || strings.TrimSpace(string(out)) != sha {
		return ErrRepositoryInvalid
	}
	return nil
}
func (p *RemoteGitProvider) CheckoutCandidate(ctx context.Context, org, repo, sha string) (string, func(), error) {
	w, done, err := p.workspace(ctx, org, repo)
	if err != nil {
		return "", nil, err
	}
	if err = w.retained(sha); err == nil {
		_, err = w.git("checkout", "--detach", sha)
	}
	if err == nil {
		err = os.RemoveAll(filepath.Join(w.dir, ".git"))
	}
	if err != nil {
		done()
		return "", nil, err
	}
	return w.dir, done, nil
}
func (w *remoteWork) verifyCandidate(in MergePreview) error {
	if !objectID.MatchString(in.Target.SHA) {
		return ErrRepositoryInvalid
	}
	if err := w.retained(in.CandidateSHA); err != nil {
		return err
	}
	if _, err := w.git("merge-base", "--is-ancestor", in.Target.SHA, in.CandidateSHA); err != nil {
		return ErrRepositoryInvalid
	}
	return nil
}
func (p *RemoteGitProvider) CandidateCommits(ctx context.Context, org, repo string, in MergePreview) ([]string, error) {
	w, done, err := p.workspace(ctx, org, repo)
	if err != nil {
		return nil, err
	}
	defer done()
	if err = w.verifyCandidate(in); err != nil {
		return nil, err
	}
	out, err := w.git("rev-list", in.Target.SHA+".."+in.CandidateSHA)
	if err != nil {
		return nil, ErrProviderUnavailable
	}
	return strings.Fields(string(out)), nil
}

// readRef distinguishes a confirmed absent ref from a failed read, including authorization failures.
func (w *remoteWork) readRef(ref string) (string, error) {
	out, err := w.network("ls-remote", "--refs", "--exit-code", "--", w.repo.URL, ref)
	if err != nil {
		var e *exec.ExitError
		if errors.As(err, &e) && e.ExitCode() == 2 {
			return "", nil
		}
		return "", ErrProviderUnavailable
	}
	f := strings.Fields(string(out))
	if len(f) != 2 || !objectID.MatchString(f[0]) || f[1] != ref {
		return "", ErrProviderUnavailable
	}
	return f[0], nil
}
func (w *remoteWork) receipt(run, sha string) (bool, error) {
	if !promotionID.MatchString(run) || !objectID.MatchString(sha) {
		return false, ErrRepositoryInvalid
	}
	got, err := w.readRef(remoteReceipt(run))
	if err != nil || got == "" {
		return false, err
	}
	if got != sha {
		return false, ErrRepositoryInvalid
	}
	return true, nil
}
func (p *RemoteGitProvider) HasPromotion(ctx context.Context, org, repo, run, sha string) (bool, error) {
	w, done, err := p.workspace(ctx, org, repo)
	if err != nil {
		return false, err
	}
	defer done()
	return w.receipt(run, sha)
}

// Git omits up-to-date refs even with an explicit lease. Require both commands in the
// actual send set or an independently advanced target could acquire a false receipt.
const promotionGuard = `#!/bin/sh
target=0
receipt=0
while read -r local_ref new remote_ref old; do
  case "$remote_ref" in
    refs/heads/agentforge/promotions/*) receipt=1 ;;
    refs/heads/*) target=1 ;;
    *) exit 1 ;;
  esac
done
[ "$target$receipt" = 11 ]
`

func (p *RemoteGitProvider) PromoteCandidate(ctx context.Context, org, repo, run string, in MergePreview) error {
	w, done, err := p.workspace(ctx, org, repo)
	if err != nil {
		return err
	}
	defer done()
	branch, err := w.branch(in.Target.Ref)
	if err != nil {
		return err
	}
	base, sha := in.Target.SHA, in.CandidateSHA
	if !objectID.MatchString(base) {
		return ErrRepositoryInvalid
	}
	if ok, err := w.receipt(run, sha); err != nil || ok {
		return err
	}
	if err = w.verifyCandidate(in); err != nil {
		return err
	}
	if base == sha {
		return ErrRepositoryInvalid
	}
	hooks := filepath.Join(w.dir, ".git", "hooks")
	if err = os.MkdirAll(hooks, 0700); err != nil {
		return ErrProviderUnavailable
	}
	if err = os.WriteFile(filepath.Join(hooks, "pre-push"), []byte(promotionGuard), 0700); err != nil {
		return ErrProviderUnavailable
	}
	receipt := remoteReceipt(run)
	_, err = w.network("-c", "core.hooksPath="+hooks, "push", "--atomic", "--force-with-lease="+branch+":"+base, "--force-with-lease="+receipt+":", "--", w.repo.URL, sha+":"+branch, sha+":"+receipt)
	if err == nil {
		return nil
	}
	if ok, err := w.receipt(run, sha); err != nil || ok {
		return err
	}
	head, err := w.readRef(branch)
	if err != nil {
		return err
	}
	if head != base {
		return ErrCandidateStale
	}
	return ErrProviderUnavailable
}

// DeleteCandidate requires the caller to exclude active users and new reservations for this SHA.
func (p *RemoteGitProvider) DeleteCandidate(ctx context.Context, org, repo, sha string) error {
	if !objectID.MatchString(sha) {
		return ErrRepositoryInvalid
	}
	w, done, err := p.workspace(ctx, org, repo)
	if err != nil {
		return err
	}
	defer done()
	ref := remoteCandidate(sha)
	got, err := w.readRef(ref)
	if err != nil || got == "" {
		return err
	}
	if got != sha {
		return ErrRepositoryInvalid
	}
	if _, err = w.network("push", "--force-with-lease="+ref+":"+sha, "--", w.repo.URL, ":"+ref); err != nil {
		return ErrProviderUnavailable
	}
	return nil
}
