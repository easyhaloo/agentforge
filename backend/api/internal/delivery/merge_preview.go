package delivery

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// MergePreviewProvider is an optional capability of the configured Git provider.
type MergePreviewProvider interface {
	SupportsMergePreview(context.Context) bool
	PreviewMerge(context.Context, string, string, MergeRequest) (MergePreview, error)
}
type MergeRequest struct {
	Target   string   `json:"target"`
	Sources  []string `json:"sources"`
	Strategy string   `json:"strategy,omitempty"`
}
type PinnedRef struct {
	Ref string `json:"ref"`
	SHA string `json:"sha"`
}
type MergePreview struct {
	Target        PinnedRef   `json:"target"`
	Sources       []PinnedRef `json:"sources"`
	Status        string      `json:"status"`
	CandidateSHA  string      `json:"candidateSHA,omitempty"`
	TreeSHA       string      `json:"treeSHA,omitempty"`
	ConflictAt    *int        `json:"conflictAt,omitempty"`
	ConflictPaths []string    `json:"conflictPaths,omitempty"`
}

var objectID = regexp.MustCompile(`^(?:[a-f0-9]{40}|[a-f0-9]{64})$`)
var ErrPreviewUnavailable = errors.New("merge preview unavailable")

// previewGit keeps hooks, user configuration and original-repository merge drivers out of the simulation.
func previewGit(ctx context.Context, dir string, args ...string) ([]byte, error) {
	return previewGitInput(ctx, dir, nil, args...)
}
func previewGitInput(ctx context.Context, dir string, stdin io.Reader, args ...string) ([]byte, error) {
	return isolatedGit(ctx, dir, stdin, nil, args...)
}

func isolatedGit(ctx context.Context, dir string, stdin io.Reader, env []string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir, "-c", "core.hooksPath=/dev/null", "-c", "protocol.allow=never"}, args...)...)
	cmd.Stdin = stdin
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "LC_ALL=C", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_NOSYSTEM=1", "GIT_ATTR_NOSYSTEM=1", "GIT_TERMINAL_PROMPT=0", "GIT_NO_REPLACE_OBJECTS=1", "GIT_AUTHOR_NAME=AgentForge", "GIT_COMMITTER_NAME=AgentForge", "GIT_AUTHOR_EMAIL=ci@agentforge.invalid", "GIT_COMMITTER_EMAIL=ci@agentforge.invalid", "GIT_AUTHOR_DATE=2000-01-01T00:00:00Z", "GIT_COMMITTER_DATE=2000-01-01T00:00:00Z"}
	cmd.Env = append(cmd.Env, env...)
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err = cmd.Start(); err != nil {
		return nil, err
	}
	const limit = 1 << 20
	out, err := io.ReadAll(io.LimitReader(pipe, limit+1))
	if err != nil || len(out) > limit {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return nil, ErrPreviewUnavailable
	}
	return out, cmd.Wait()
}

func (p *LocalGitProvider) SupportsMergePreview(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	help, _ := previewGit(ctx, p.Root, "merge-tree", "-h")
	return bytes.Contains(help, []byte("--write-tree")) && bytes.Contains(help, []byte("--name-only"))
}

func (p *LocalGitProvider) PreviewMerge(ctx context.Context, org, repository string, input MergeRequest) (MergePreview, error) {
	return p.merge(ctx, org, repository, input, false)
}

// PrepareCandidate keeps the clean candidate reachable for a later isolated build.
func (p *LocalGitProvider) PrepareCandidate(ctx context.Context, org, repository string, input MergeRequest) (MergePreview, error) {
	return p.merge(ctx, org, repository, input, true)
}

func (p *LocalGitProvider) merge(ctx context.Context, org, repository string, input MergeRequest, retain bool) (MergePreview, error) {
	var result MergePreview
	if input.Strategy != "" && input.Strategy != "merge-commit" && input.Strategy != "ff-only" {
		return result, ErrRepositoryInvalid
	}
	if len(input.Sources) == 0 || len(input.Sources) > 32 {
		return result, ErrRepositoryInvalid
	}
	path, err := p.repositoryPath(ctx, org, repository)
	if err != nil {
		return result, err
	}
	limit := p.Timeout
	if limit <= 0 {
		limit = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, limit)
	defer cancel()
	temp, err := os.MkdirTemp("", "agentforge-merge-*")
	if err != nil {
		return result, ErrPreviewUnavailable
	}
	defer os.RemoveAll(temp)
	if _, err = previewGit(ctx, temp, "-c", "protocol.file.allow=always", "clone", "--bare", "--local", "--shared", "--no-tags", "--template=", "--", path, "."); err != nil {
		return result, ErrPreviewUnavailable
	}
	result, err = simulateMerge(ctx, temp, input)
	if err != nil || result.Status != "clean" {
		return result, err
	}
	if retain {
		ref := candidateRef(result.CandidateSHA)
		if _, err := previewGit(ctx, temp, "update-ref", ref, result.CandidateSHA); err != nil {
			return result, ErrPreviewUnavailable
		}
		if _, err := previewGit(ctx, path, "-c", "protocol.file.allow=always", "fetch", "--no-tags", "--no-write-fetch-head", "--no-auto-maintenance", "--", temp, ref+":"+ref); err != nil {
			return result, ErrPreviewUnavailable
		}
	}
	return result, nil
}

func simulateMerge(ctx context.Context, temp string, input MergeRequest) (MergePreview, error) {
	var result MergePreview
	var err error
	pin := func(ref string) (PinnedRef, error) {
		if ref == "" || len(ref) > 255 {
			return PinnedRef{}, ErrRepositoryInvalid
		}
		name := ref
		if !objectID.MatchString(ref) {
			name = "refs/heads/" + ref
			if _, err := previewGit(ctx, temp, "check-ref-format", name); err != nil {
				return PinnedRef{}, ErrRepositoryInvalid
			}
		}
		raw, err := previewGit(ctx, temp, "rev-parse", "--verify", "--end-of-options", name+"^{commit}")
		sha := strings.TrimSpace(string(raw))
		if err != nil || !objectID.MatchString(sha) {
			return PinnedRef{}, ErrRepositoryInvalid
		}
		return PinnedRef{Ref: ref, SHA: sha}, nil
	}
	result.Target, err = pin(input.Target)
	if err != nil {
		return result, err
	}
	seen := map[string]bool{}
	for _, ref := range input.Sources {
		src, err := pin(ref)
		if err != nil {
			return result, err
		}
		if seen[src.SHA] {
			return result, ErrRepositoryInvalid
		}
		seen[src.SHA] = true
		result.Sources = append(result.Sources, src)
	}
	current := result.Target.SHA
	for i, source := range result.Sources {
		if input.Strategy == "ff-only" {
			if _, err := previewGit(ctx, temp, "merge-base", "--is-ancestor", current, source.SHA); err != nil {
				var exit *exec.ExitError
				if !errors.As(err, &exit) || exit.ExitCode() != 1 {
					return result, ErrPreviewUnavailable
				}
				result.Status = "non_fast_forward"
				result.ConflictAt = &i
				result.TreeSHA = ""
				return result, nil
			}
			current = source.SHA
			raw, err := previewGit(ctx, temp, "rev-parse", current+"^{tree}")
			if err != nil {
				return result, ErrPreviewUnavailable
			}
			result.TreeSHA = strings.TrimSpace(string(raw))
			continue
		}
		out, err := previewGit(ctx, temp, "merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", current, source.SHA)
		fields := bytes.Split(bytes.TrimSuffix(out, []byte{0}), []byte{0})
		if !objectID.Match(fields[0]) {
			return result, ErrPreviewUnavailable
		}
		if err != nil {
			var exit *exec.ExitError
			if !errors.As(err, &exit) || exit.ExitCode() != 1 {
				return result, ErrPreviewUnavailable
			}
			result.Status = "conflict"
			result.TreeSHA = ""
			result.ConflictAt = &i
			for _, path := range fields[1:] {
				if len(path) > 0 {
					result.ConflictPaths = append(result.ConflictPaths, string(path))
				}
			}
			return result, nil
		}
		tree := string(fields[0])
		parents := []string{"commit-tree", tree, "-p", current}
		if source.SHA != current {
			parents = append(parents, "-p", source.SHA)
		}
		parents = append(parents, "-m", "AgentForge integration candidate")
		raw, err := previewGit(ctx, temp, parents...)
		if err != nil {
			return result, ErrPreviewUnavailable
		}
		current = strings.TrimSpace(string(raw))
		if !objectID.MatchString(current) {
			return result, ErrPreviewUnavailable
		}
		result.TreeSHA = tree
	}
	result.Status = "clean"
	result.CandidateSHA = current
	return result, nil
}
