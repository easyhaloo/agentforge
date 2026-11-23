package delivery

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
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
	Target      string            `json:"target"`
	Sources     []string          `json:"sources"`
	Strategy    string            `json:"strategy,omitempty"`
	PullMessage *PullMergeMessage `json:"-"`
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

// PullMergeIntent pins the verified decision before an atomic Git promotion.
// The saved intent and receipt allow a retry to finish the database update.
type PullMergeIntent struct {
	ID         ID           `json:"id"`
	RevisionID ID           `json:"revision_id"`
	Actor      string       `json:"actor"`
	CreatedAt  time.Time    `json:"created_at"`
	Candidate  MergePreview `json:"candidate"`
}

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
	switch input.Strategy {
	case "", "merge-commit", "ff-only":
	case "squash", "rebase":
		if !retain {
			return result, ErrRepositoryInvalid
		}
	default:
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
		if input.Strategy == "rebase" {
			worktree := filepath.Join(temp, "replay")
			if i == 0 {
				if _, err := previewGit(ctx, temp, "worktree", "add", "--quiet", "--detach", worktree, source.SHA); err != nil {
					return result, ErrPreviewUnavailable
				}
			} else if _, err := previewGit(ctx, worktree, "checkout", "--quiet", "--detach", source.SHA, "--"); err != nil {
				return result, ErrPreviewUnavailable
			}
			sha, paths, err := replayCandidate(ctx, worktree, current, tree)
			if err != nil {
				return result, err
			}
			if sha == "" {
				result.Status = "conflict"
				result.ConflictAt = &i
				result.ConflictPaths = paths
				result.TreeSHA = ""
				return result, nil
			}
			current, result.TreeSHA = sha, tree
			continue
		}
		parents := []string{"commit-tree", tree, "-p", current}
		if input.Strategy != "squash" && source.SHA != current {
			parents = append(parents, "-p", source.SHA)
		}
		message := "AgentForge integration candidate"
		if input.PullMessage != nil {
			message, err = input.PullMessage.render(ctx, temp, input.Strategy, current, source.SHA)
			if err != nil {
				return result, err
			}
		}
		raw, err := previewGitInput(ctx, temp, strings.NewReader(message+"\n"), parents...)
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

// replayCandidate returns an empty SHA for conflicts or a replay that changes the merge result.
func replayCandidate(ctx context.Context, worktree, base, mergeTree string) (string, []string, error) {
	_, err := previewGit(ctx, worktree, "rebase", "--merge", "--no-rebase-merges", "--no-fork-point",
		"--force-rebase", "--no-keep-empty", "--empty=drop", base)
	if err != nil {
		out, diffErr := previewGit(ctx, worktree, "diff", "--name-only", "--diff-filter=U", "-z")
		if diffErr != nil || len(out) == 0 {
			return "", nil, ErrPreviewUnavailable
		}
		return "", strings.Split(strings.TrimSuffix(string(out), "\x00"), "\x00"), nil
	}
	out, err := previewGit(ctx, worktree, "rev-parse", "HEAD", "HEAD^{tree}")
	revs := strings.Fields(string(out))
	if err != nil || len(revs) != 2 || !objectID.MatchString(revs[0]) || !objectID.MatchString(revs[1]) {
		return "", nil, ErrPreviewUnavailable
	}
	// Flattening a source merge can lose changes recorded only in its merge commit.
	if revs[1] != mergeTree {
		return "", nil, nil
	}
	return revs[0], nil, nil
}
