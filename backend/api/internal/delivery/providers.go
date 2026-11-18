package delivery

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	ErrProviderUnavailable = errors.New("git provider is unavailable")
	ErrRepositoryInvalid = errors.New("repository reference is invalid")
	ErrEvaluationFailed = errors.New("revision evaluation failed")
)

type GitProvider interface {
	ResolveRevision(context.Context, string, string, string) (GitRevision, error)
	MergeRevision(context.Context, string, string, string, string) (GitMerge, error)
}

type GitRevision struct {
	CommitSHA string
	ParentSHA string
	Ref string
}

type GitMerge struct {
	CommitSHA string
	TargetRef string
}

type EvaluationJob struct {
	ID             string
	OrganizationID string
	ChangesetID    ID
	RevisionID     ID
	Repository     string
	BaseSHA        string
	RevisionSHA    string
}

type Evaluator interface {
	Evaluate(context.Context, EvaluationJob) (EvaluationResult, error)
}

type EvaluationResult struct {
	JobID          string
	OrganizationID string
	ChangesetID    ID
	RevisionID     ID
	BaseSHA        string
	RevisionSHA    string
	Passed         bool
	Summary        string
	Report         []byte
}

type EvidenceStore interface {
	Put(context.Context, string, string, []byte) (EvidenceArtifact, error)
}

type EvidenceArtifact struct {
	URI string
	SHA256 string
	Size int64
}

type LocalGitProvider struct {
	Root string
	Timeout time.Duration
	mu sync.Mutex
}

func NewLocalGitProvider(root string, timeout time.Duration) (*LocalGitProvider, error) {
	root = strings.TrimSpace(root)
	if root == "" { return nil, ErrProviderUnavailable }
	absolute, err := filepath.Abs(root)
	if err != nil { return nil, err }
	if err := os.MkdirAll(absolute, 0700); err != nil { return nil, err }
	absolute, err = filepath.EvalSymlinks(absolute)
	if err != nil { return nil, err }
	return &LocalGitProvider{Root:absolute, Timeout:timeout}, nil
}

func (p *LocalGitProvider) repositoryPath(ctx context.Context, organizationID, repository string) (string, error) {
	if organizationID == "" || strings.ContainsAny(organizationID, "/\\\\") || organizationID == "." || organizationID == ".." { return "", ErrRepositoryInvalid }
	parts := strings.Split(repository, "/")
	if len(parts) != 2 { return "", ErrRepositoryInvalid }
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || strings.ContainsAny(part, "\\\\:") { return "", ErrRepositoryInvalid }
	}
	path := filepath.Join(p.Root, organizationID, parts[0], parts[1])
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil { return "", ErrProviderUnavailable }
	insideOrganization := func(dir string) bool {
		rel, err := filepath.Rel(filepath.Join(p.Root, organizationID), dir)
		return err == nil && rel != "." && filepath.IsLocal(rel)
	}
	if !insideOrganization(resolved) { return "", ErrRepositoryInvalid }
	// Identify the repository explicitly so Git cannot discover one in a parent directory.
	metadata := filepath.Join(resolved, ".git")
	if _, err := os.Lstat(metadata); os.IsNotExist(err) { metadata = resolved }
	// Linked worktrees have separate administrative and common directories. Both belong to the tenant.
	dirs, err := p.run(ctx, resolved, "--git-dir="+metadata, "rev-parse", "--path-format=absolute", "--absolute-git-dir", "--git-common-dir")
	if err != nil { return "", ErrRepositoryInvalid }
	paths := strings.Split(dirs, "\n")
	if len(paths) != 2 { return "", ErrRepositoryInvalid }
	for _, dir := range paths {
		canonical, err := filepath.EvalSymlinks(dir)
		if err != nil || !insideOrganization(canonical) { return "", ErrRepositoryInvalid }
	}
	return resolved, nil
}

func (p *LocalGitProvider) run(ctx context.Context, repository string, args ...string) (string, error) {
	timeout := p.Timeout
	if timeout <= 0 { timeout = 30*time.Second }
	commandContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	command := exec.CommandContext(commandContext, "git", append([]string{"-C", repository}, args...)...)
	command.Env = []string{"PATH="+os.Getenv("PATH"), "HOME="+os.TempDir(), "GIT_TERMINAL_PROMPT=0", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null"}
	output, err := command.CombinedOutput()
	if err != nil { return strings.TrimSpace(string(output)), err }
	return strings.TrimSpace(string(output)), nil
}

func (p *LocalGitProvider) ResolveRevision(ctx context.Context, organizationID, repository, ref string) (GitRevision, error) {
	path, err := p.repositoryPath(ctx, organizationID, repository); if err != nil { return GitRevision{}, err }
	ref = strings.TrimSpace(ref)
	if ref == "" || strings.HasPrefix(ref, "-") || strings.ContainsAny(ref, "\x00\n\r") { return GitRevision{}, ErrRepositoryInvalid }
	commit, err := p.run(ctx, path, "rev-parse", "--verify", "--end-of-options", ref+"^{commit}")
	if err != nil { return GitRevision{}, ErrRepositoryInvalid }
	parent, _ := p.run(ctx, path, "rev-parse", commit+"^")
	return GitRevision{CommitSHA:commit, ParentSHA:parent, Ref:ref}, nil
}

func (p *LocalGitProvider) MergeRevision(ctx context.Context, organizationID, repository, revisionSHA, targetRef string) (GitMerge, error) {
	path, err := p.repositoryPath(ctx, organizationID, repository); if err != nil { return GitMerge{}, err }
	p.mu.Lock(); defer p.mu.Unlock()
	if strings.TrimSpace(targetRef)=="" || strings.HasPrefix(targetRef,"-") { return GitMerge{}, ErrRepositoryInvalid }
	target, err := p.run(ctx,path,"rev-parse","--verify","--end-of-options",targetRef+"^{commit}")
	if err != nil { return GitMerge{}, ErrRepositoryInvalid }
	revision, err := p.run(ctx,path,"rev-parse","--verify","--end-of-options",revisionSHA+"^{commit}")
	if err != nil { return GitMerge{}, ErrRepositoryInvalid }
	branch, branchErr := p.run(ctx,path,"symbolic-ref","--quiet","--short","HEAD")
	if branchErr != nil || branch != targetRef { return GitMerge{}, errors.New("local repository must have the registered target branch checked out") }
	current, err := p.run(ctx,path,"rev-parse","HEAD")
	if err != nil || current != target { return GitMerge{}, errors.New("local repository HEAD does not match target ref; synchronize the repository before merging") }
	if _, ancestorErr := p.run(ctx,path,"merge-base","--is-ancestor",revision,target); ancestorErr == nil {
		return GitMerge{CommitSHA:target,TargetRef:targetRef},nil
	}
	if _, err = p.run(ctx,path,"-c","core.hooksPath=/dev/null","-c","user.name=AgentForge","-c","user.email=agentforge@localhost","merge","--no-ff","--no-edit",revision); err != nil { return GitMerge{}, errors.New("git merge failed; resolve conflicts and retry") }
	merged, err := p.run(ctx,path,"rev-parse","HEAD")
	if err != nil { return GitMerge{}, err }
	return GitMerge{CommitSHA:merged,TargetRef:targetRef},nil
}

const (
	maxWorkspaceRevisionFiles = 2000
	maxWorkspaceRevisionBytes = 32 << 20
)

func (p *LocalGitProvider) CreateWorkspaceRevision(ctx context.Context, organizationID, repository, baseSHA, changesetID, revisionID, actor string, files []WorkspaceRevisionFile) (GitRevision, error) {
	repositoryPath, err := p.repositoryPath(ctx, organizationID, repository)
	if err != nil {
		return GitRevision{}, err
	}
	if !validCommitObjectID(baseSHA) || !validRefComponent(changesetID) || !validRefComponent(revisionID) ||
		len(files) == 0 || len(files) > maxWorkspaceRevisionFiles {
		return GitRevision{}, ErrRepositoryInvalid
	}
	if _, err := p.run(ctx, repositoryPath, "cat-file", "-e", baseSHA+"^{commit}"); err != nil {
		return GitRevision{}, ErrRepositoryInvalid
	}
	var total int
	seen := make(map[string]struct{}, len(files))
	for _, file := range files {
		if !validWorkspaceRevisionPath(file.Path) || len(file.Content) > 2<<20 {
			return GitRevision{}, ErrRepositoryInvalid
		}
		if _, exists := seen[file.Path]; exists {
			return GitRevision{}, ErrRepositoryInvalid
		}
		seen[file.Path] = struct{}{}
		total += len(file.Content)
		if total > maxWorkspaceRevisionBytes {
			return GitRevision{}, ErrRepositoryInvalid
		}
	}
	index, err := os.CreateTemp("", "agentforge-workspace-index-*")
	if err != nil {
		return GitRevision{}, err
	}
	indexPath := index.Name()
	if err := index.Close(); err != nil {
		_ = os.Remove(indexPath)
		return GitRevision{}, err
	}
	if err := os.Remove(indexPath); err != nil {
		return GitRevision{}, err
	}
	defer os.Remove(indexPath)

	run := func(input []byte, args ...string) (string, error) {
		return p.runWithEnvInput(ctx, repositoryPath, map[string]string{"GIT_INDEX_FILE": indexPath}, input, args...)
	}
	if _, err := run(nil, "read-tree", baseSHA); err != nil {
		return GitRevision{}, err
	}
	for _, file := range files {
		blob, err := run(file.Content, "hash-object", "-w", "--stdin")
		if err != nil || !validCommitObjectID(blob) {
			return GitRevision{}, errors.Join(err, ErrRepositoryInvalid)
		}
		if _, err := run(nil, "update-index", "--add", "--cacheinfo", "100644", blob, file.Path); err != nil {
			return GitRevision{}, err
		}
	}
	treeSHA, err := run(nil, "write-tree")
	if err != nil || !validCommitObjectID(treeSHA) {
		return GitRevision{}, errors.Join(err, ErrRepositoryInvalid)
	}
	actor = strings.TrimSpace(actor)
	if actor == "" || strings.ContainsAny(actor, "\x00\r\n") {
		return GitRevision{}, ErrRepositoryInvalid
	}
	message := "Workspace changeset " + changesetID
	commitSHA, err := p.runWithEnvInput(ctx, repositoryPath, map[string]string{
		"GIT_AUTHOR_NAME": actor, "GIT_AUTHOR_EMAIL": "agentforge@localhost",
		"GIT_COMMITTER_NAME": actor, "GIT_COMMITTER_EMAIL": "agentforge@localhost",
	}, []byte(message+"\n"), "commit-tree", treeSHA, "-p", baseSHA)
	if err != nil || !validCommitObjectID(commitSHA) {
		return GitRevision{}, errors.Join(err, ErrRepositoryInvalid)
	}
	ref := "refs/agentforge/changesets/" + changesetID + "/" + revisionID
	zero := strings.Repeat("0", len(commitSHA))
	if _, err := p.run(ctx, repositoryPath, "update-ref", ref, commitSHA, zero); err != nil {
		return GitRevision{}, err
	}
	return GitRevision{CommitSHA: commitSHA, ParentSHA: baseSHA, Ref: ref}, nil
}

func (p *LocalGitProvider) runWithEnvInput(ctx context.Context, repository string, extra map[string]string, input []byte, args ...string) (string, error) {
	timeout := p.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	commandContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	command := exec.CommandContext(commandContext, "git", append([]string{"-C", repository}, args...)...)
	command.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + os.TempDir(), "GIT_TERMINAL_PROMPT=0", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null"}
	for key, value := range extra {
		command.Env = append(command.Env, key+"="+value)
	}
	command.Stdin = bytes.NewReader(input)
	output, err := command.CombinedOutput()
	if err != nil {
		return strings.TrimSpace(string(output)), err
	}
	return strings.TrimSpace(string(output)), nil
}

func validCommitObjectID(value string) bool {
	if len(value) != 40 && len(value) != 64 {
		return false
	}
	for _, char := range value {
		if !(char >= '0' && char <= '9') && !(char >= 'a' && char <= 'f') {
			return false
		}
	}
	return true
}

func validRefComponent(value string) bool {
	if value == "" || value == "." || value == ".." || strings.ContainsAny(value, "/\\\\~^:?*[\x00\r\n") {
		return false
	}
	return !strings.HasPrefix(value, ".") && !strings.HasSuffix(value, ".lock")
}

func validWorkspaceRevisionPath(value string) bool {
	if value == "" || len(value) > 1024 || strings.ContainsAny(value, "\x00\\\\") || strings.HasPrefix(value, "/") ||
		strings.IndexFunc(value, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0 ||
		path.Clean(value) != value || value == "." || value == ".." || strings.HasPrefix(value, "../") {
		return false
	}
	for _, segment := range strings.Split(value, "/") {
		if strings.EqualFold(segment, ".git") {
			return false
		}
	}
	return true
}
