package delivery

import (
	"context"
	"errors"
	"os"
	"os/exec"
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

func (p *LocalGitProvider) repositoryPath(organizationID, repository string) (string, error) {
	if organizationID == "" || strings.ContainsAny(organizationID, "/\\\\") || organizationID == "." || organizationID == ".." { return "", ErrRepositoryInvalid }
	parts := strings.Split(repository, "/")
	if len(parts) != 2 { return "", ErrRepositoryInvalid }
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || strings.ContainsAny(part, "\\\\:") { return "", ErrRepositoryInvalid }
	}
	path := filepath.Join(p.Root, organizationID, parts[0], parts[1])
	absolute, err := filepath.Abs(path)
	if err != nil { return "", err }
	relative, err := filepath.Rel(p.Root, absolute)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) { return "", ErrRepositoryInvalid }
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil { return "", ErrProviderUnavailable }
	relative, err = filepath.Rel(p.Root, resolved)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) { return "", ErrRepositoryInvalid }
	info, err := os.Stat(resolved)
	if err != nil || !info.IsDir() { return "", ErrProviderUnavailable }
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
	path, err := p.repositoryPath(organizationID, repository); if err != nil { return GitRevision{}, err }
	ref = strings.TrimSpace(ref)
	if ref == "" || strings.HasPrefix(ref, "-") || strings.ContainsAny(ref, "\x00\n\r") { return GitRevision{}, ErrRepositoryInvalid }
	commit, err := p.run(ctx, path, "rev-parse", "--verify", "--end-of-options", ref+"^{commit}")
	if err != nil { return GitRevision{}, ErrRepositoryInvalid }
	parent, _ := p.run(ctx, path, "rev-parse", commit+"^")
	return GitRevision{CommitSHA:commit, ParentSHA:parent, Ref:ref}, nil
}

func (p *LocalGitProvider) MergeRevision(ctx context.Context, organizationID, repository, revisionSHA, targetRef string) (GitMerge, error) {
	path, err := p.repositoryPath(organizationID, repository); if err != nil { return GitMerge{}, err }
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
