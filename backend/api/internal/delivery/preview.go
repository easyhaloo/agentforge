package delivery

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type PreviewEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Kind string `json:"kind"`
	Mode string `json:"mode"`
	SHA string `json:"sha"`
	Size int64 `json:"size,omitempty"`
}

// Optional read-only capability; existing GitProvider implementations need not change.
type RepositoryPreviewReader interface {
	ListTree(context.Context, string, string, string, string) ([]PreviewEntry, error)
	ReadBlob(context.Context, string, string, string, string, int64) ([]byte, string, error)
}

var (
	ErrPreviewPathInvalid = errors.New("repository preview path is invalid")
	ErrPreviewTooLarge = errors.New("repository preview exceeds the size limit")
)

func (p *LocalGitProvider) ListTree(ctx context.Context, organizationID, repository, commitSHA, directory string) ([]PreviewEntry, error) {
	if !validGitObjectID(commitSHA) || !validRepositoryPath(directory) { return nil, ErrPreviewPathInvalid }
	repoPath, err := p.repositoryPath(ctx, organizationID, repository)
	if err != nil { return nil, err }
	treeish := commitSHA
	if directory != "" { treeish += ":" + directory }
	output, err := p.runPreview(ctx, repoPath, 2<<20, "ls-tree", "-z", "--long", treeish)
	if errors.Is(err, ErrPreviewTooLarge) { return nil, ErrPreviewTooLarge }
	if err != nil { return nil, ErrRepositoryInvalid }
	records := bytes.Split(output, []byte{0})
	entries := make([]PreviewEntry, 0, len(records))
	for _, raw := range records {
		if len(raw) == 0 { continue }
		metadata, name, ok := bytes.Cut(raw, []byte{'\t'})
		if !ok { return nil, ErrRepositoryInvalid }
		fields := strings.Fields(string(metadata))
		if len(fields) < 3 { return nil, ErrRepositoryInvalid }
		mode, objectType, sha := fields[0], fields[1], fields[2]
		kind := objectType
		switch mode { case "040000": kind = "tree"; case "120000": kind = "symlink"; default: if objectType == "blob" { kind = "file" } }
		var size int64
		if len(fields) > 3 && fields[3] != "-" { size, _ = strconv.ParseInt(fields[3], 10, 64) }
		entryName := string(name)
		entryPath := entryName
		if directory != "" { entryPath = directory + "/" + entryName }
		entries = append(entries, PreviewEntry{Name:entryName, Path:entryPath, Kind:kind, Mode:mode, SHA:sha, Size:size})
		if len(entries) > 2000 { return nil, ErrPreviewTooLarge }
	}
	return entries, nil
}

func (p *LocalGitProvider) ReadBlob(ctx context.Context, organizationID, repository, commitSHA, filePath string, maxBytes int64) ([]byte, string, error) {
	if !validGitObjectID(commitSHA) || !validRepositoryPath(filePath) || filePath == "" { return nil, "", ErrPreviewPathInvalid }
	repoPath, err := p.repositoryPath(ctx, organizationID, repository)
	if err != nil { return nil, "", err }
	if maxBytes <= 0 || maxBytes > 2<<20 { maxBytes = 1 << 20 }
	object, err := p.run(ctx, repoPath, "rev-parse", "--verify", "--end-of-options", commitSHA+":"+filePath)
	if err != nil || !validGitObjectID(object) { return nil, "", ErrRepositoryInvalid }
	objectType, err := p.run(ctx, repoPath, "cat-file", "-t", object)
	if err != nil || objectType != "blob" { return nil, "", ErrPreviewPathInvalid }
	rawSize, err := p.run(ctx, repoPath, "cat-file", "-s", object)
	if err != nil { return nil, "", ErrRepositoryInvalid }
	size, err := strconv.ParseInt(rawSize, 10, 64)
	if err != nil || size < 0 { return nil, "", ErrRepositoryInvalid }
	if size > maxBytes { return nil, object, ErrPreviewTooLarge }
	content, err := p.runPreview(ctx, repoPath, maxBytes, "cat-file", "blob", object)
	if err != nil { return nil, "", fmt.Errorf("read git blob: %w", err) }
	if int64(len(content)) != size { return nil, "", ErrRepositoryInvalid }
	return content, object, nil
}

func (p *LocalGitProvider) runPreview(ctx context.Context, repoPath string, maxOutput int64, args ...string) ([]byte, error) {
	timeout := p.Timeout
	if timeout <= 0 { timeout = 30 * time.Second }
	commandCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	command := exec.CommandContext(commandCtx, "git", append([]string{"-C", repoPath}, args...)...)
	command.Env = []string{"PATH="+os.Getenv("PATH"), "HOME="+os.TempDir(), "GIT_TERMINAL_PROMPT=0", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_OPTIONAL_LOCKS=0", "GIT_NO_REPLACE_OBJECTS=1"}
	var stdout, stderr bytes.Buffer
	command.Stdout = &boundedBuffer{buffer:&stdout, limit:maxOutput}
	command.Stderr = &boundedBuffer{buffer:&stderr, limit:64<<10}
	if err := command.Run(); err != nil { return nil, fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String())) }
	return stdout.Bytes(), nil
}

type boundedBuffer struct { buffer *bytes.Buffer; limit int64 }
func (b *boundedBuffer) Write(value []byte) (int, error) {
	if int64(b.buffer.Len()+len(value)) > b.limit { return 0, ErrPreviewTooLarge }
	return b.buffer.Write(value)
}

func validGitObjectID(value string) bool {
	if len(value) != 40 && len(value) != 64 { return false }
	for _, char := range value {
		if !(char >= '0' && char <= '9') && !(char >= 'a' && char <= 'f') { return false }
	}
	return true
}

func validRepositoryPath(value string) bool {
	if strings.ContainsAny(value, "\x00\\\\") || strings.HasPrefix(value, "/") || strings.HasSuffix(value, "/") { return false }
	if value == "" { return true }
	for _, part := range strings.Split(value, "/") {
		if part == "" || part == "." || part == ".." { return false }
	}
	return true
}

type RepositoryCommit struct {
	SHA string `json:"sha"`
	Parents []string `json:"parents"`
	Author string `json:"author"`
	AuthoredAt string `json:"authored_at"`
	Subject string `json:"subject"`
}

type RepositoryHistoryReader interface {
	ListHistory(context.Context, string, string, string, int) ([]RepositoryCommit, error)
}

func (p *LocalGitProvider) ListHistory(ctx context.Context, organizationID, repository, commitSHA string, limit int) ([]RepositoryCommit, error) {
	if !validGitObjectID(commitSHA) { return nil, ErrPreviewPathInvalid }
	if limit < 1 || limit > 100 { return nil, ErrPreviewPathInvalid }
	repoPath, err := p.repositoryPath(ctx, organizationID, repository)
	if err != nil { return nil, err }
	format := "%H%x00%P%x00%an%x00%aI%x00%s"
	output, err := p.runPreview(ctx, repoPath, 1<<20, "log", "-z", "--no-show-signature", "--format="+format, "--max-count="+strconv.Itoa(limit), commitSHA, "--")
	if errors.Is(err, ErrPreviewTooLarge) { return nil, ErrPreviewTooLarge }
	if err != nil { return nil, fmt.Errorf("%w: %v", ErrRepositoryInvalid, err) }
	fields := bytes.Split(output, []byte{0})
	commits := make([]RepositoryCommit, 0, limit)
	for i := 0; i+4 < len(fields); i += 5 {
		if len(fields[i]) == 0 { continue }
		sha := string(fields[i])
		if !validGitObjectID(sha) { return nil, ErrRepositoryInvalid }
		parents := strings.Fields(string(fields[i+1]))
		for _, parent := range parents { if !validGitObjectID(parent) { return nil, ErrRepositoryInvalid } }
		commits = append(commits, RepositoryCommit{SHA:sha, Parents:parents, Author:string(fields[i+2]), AuthoredAt:string(fields[i+3]), Subject:string(fields[i+4])})
	}
	return commits, nil
}


// RepositoryCompareReader exposes a bounded, read-only diff between immutable commits.
type RepositoryCompareReader interface {
	Compare(context.Context, string, string, string, string) (string, error)
}

func (p *LocalGitProvider) Compare(ctx context.Context, organizationID, repository, baseSHA, headSHA string) (string, error) {
	if !validGitObjectID(baseSHA) || !validGitObjectID(headSHA) {
		return "", ErrPreviewPathInvalid
	}
	repoPath, err := p.repositoryPath(ctx, organizationID, repository)
	if err != nil {
		return "", err
	}
	output, err := p.runPreview(ctx, repoPath, 1<<20,
		"diff", "--no-ext-diff", "--no-renames", "--no-color",
		"--src-prefix=a/", "--dst-prefix=b/", baseSHA, headSHA, "--")
	if errors.Is(err, ErrPreviewTooLarge) {
		return "", ErrPreviewTooLarge
	}
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrRepositoryInvalid, err)
	}
	return string(output), nil
}


type RepositoryFileHistoryReader interface {
	ListFileHistory(context.Context, string, string, string, string, int) ([]RepositoryCommit, error)
}

func (p *LocalGitProvider) ListFileHistory(ctx context.Context, organizationID, repository, commitSHA, filePath string, limit int) ([]RepositoryCommit, error) {
	if !validGitObjectID(commitSHA) || !validRepositoryPath(filePath) || filePath == "" || limit < 1 || limit > 100 {
		return nil, ErrPreviewPathInvalid
	}
	repoPath, err := p.repositoryPath(ctx, organizationID, repository)
	if err != nil { return nil, err }
	format := "%H%x00%P%x00%an%x00%aI%x00%s"
	output, err := p.runPreview(ctx, repoPath, 1<<20, "log", "-z", "--no-show-signature", "--format="+format, "--max-count="+strconv.Itoa(limit), commitSHA, "--", filePath)
	if errors.Is(err, ErrPreviewTooLarge) { return nil, ErrPreviewTooLarge }
	if err != nil { return nil, fmt.Errorf("%w: %v", ErrRepositoryInvalid, err) }
	fields := bytes.Split(output, []byte{0})
	commits := make([]RepositoryCommit, 0, limit)
	for i := 0; i+4 < len(fields); i += 5 {
		if len(fields[i]) == 0 { continue }
		sha := string(fields[i])
		if !validGitObjectID(sha) { return nil, ErrRepositoryInvalid }
		parents := strings.Fields(string(fields[i+1]))
		commits = append(commits, RepositoryCommit{SHA:sha, Parents:parents, Author:string(fields[i+2]), AuthoredAt:string(fields[i+3]), Subject:string(fields[i+4])})
	}
	return commits, nil
}

type RepositoryBlameLine struct {
	Line int `json:"line"`
	CommitSHA string `json:"commit_sha"`
	Author string `json:"author"`
	AuthoredAt string `json:"authored_at"`
	Summary string `json:"summary"`
	Content string `json:"content"`
}

type RepositoryBlameReader interface {
	Blame(context.Context, string, string, string, string, int, int) ([]RepositoryBlameLine, error)
}

func (p *LocalGitProvider) Blame(ctx context.Context, organizationID, repository, commitSHA, filePath string, startLine, endLine int) ([]RepositoryBlameLine, error) {
	if !validGitObjectID(commitSHA) || !validRepositoryPath(filePath) || filePath == "" || startLine < 1 || endLine < startLine || endLine-startLine >= 500 {
		return nil, ErrPreviewPathInvalid
	}
	repoPath, err := p.repositoryPath(ctx, organizationID, repository)
	if err != nil { return nil, err }
	output, err := p.runPreview(ctx, repoPath, 1<<20, "blame", "--line-porcelain", "-L", strconv.Itoa(startLine)+","+strconv.Itoa(endLine), commitSHA, "--", filePath)
	if errors.Is(err, ErrPreviewTooLarge) { return nil, ErrPreviewTooLarge }
	if err != nil { return nil, fmt.Errorf("%w: %v", ErrRepositoryInvalid, err) }
	lines := strings.Split(string(output), "\n")
	result := make([]RepositoryBlameLine, 0, endLine-startLine+1)
	for i := 0; i < len(lines); {
		if strings.TrimSpace(lines[i]) == "" {
			break
		}
		header := strings.Fields(lines[i])
		if len(header) < 3 { return nil, ErrRepositoryInvalid }
		blamedSHA := strings.TrimPrefix(header[0], "^")
		if !validGitObjectID(blamedSHA) { return nil, ErrRepositoryInvalid }
		lineNumber, parseErr := strconv.Atoi(header[2])
		if parseErr != nil { return nil, ErrRepositoryInvalid }
		item := RepositoryBlameLine{Line:lineNumber, CommitSHA:blamedSHA}
		i++
		for i < len(lines) && !strings.HasPrefix(lines[i], "\t") {
			key, value, ok := strings.Cut(lines[i], " ")
			if ok {
				switch key {
				case "author": item.Author = value
				case "author-time":
					if seconds, parseErr := strconv.ParseInt(value, 10, 64); parseErr == nil { item.AuthoredAt = time.Unix(seconds, 0).UTC().Format(time.RFC3339) }
				case "summary": item.Summary = value
				}
			}
			i++
		}
		if i >= len(lines) { break }
		item.Content = strings.TrimPrefix(lines[i], "\t")
		result = append(result, item)
		i++
		if len(result) > 500 { return nil, ErrPreviewTooLarge }
	}
	return result, nil
}

type RepositoryRef struct { Name string `json:"name"`; Kind string `json:"kind"`; SHA string `json:"sha"` }
type RepositoryRefsReader interface { ListRefs(context.Context, string, string) ([]RepositoryRef, error) }

// ListRefs returns bounded branch and tag metadata. Consumers resolve a selected
// ref to an immutable commit before reading repository content.
func (p *LocalGitProvider) ListRefs(ctx context.Context, organizationID, repository string) ([]RepositoryRef, error) {
	repoPath, err := p.repositoryPath(ctx, organizationID, repository)
	if err != nil { return nil, err }
	output, err := p.runPreview(ctx, repoPath, 1<<20, "for-each-ref", "--format=%(refname)%00%(objectname)%00%(objecttype)", "refs/heads", "refs/tags")
	if errors.Is(err, ErrPreviewTooLarge) { return nil, ErrPreviewTooLarge }
	if err != nil { return nil, fmt.Errorf("%w: %v", ErrRepositoryInvalid, err) }
	refs := make([]RepositoryRef, 0, 32)
	for _, record := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		if record == "" { continue }
		fields := strings.Split(record, "\x00")
		if len(fields) != 3 || !validGitObjectID(fields[1]) { return nil, ErrRepositoryInvalid }
		kind, name := "", ""
		switch {
		case strings.HasPrefix(fields[0], "refs/heads/"): kind, name = "branch", strings.TrimPrefix(fields[0], "refs/heads/")
		case strings.HasPrefix(fields[0], "refs/tags/"): kind, name = "tag", strings.TrimPrefix(fields[0], "refs/tags/")
		default: continue
		}
		if name == "" { return nil, ErrRepositoryInvalid }
		refs = append(refs, RepositoryRef{Name:name, Kind:kind, SHA:fields[1]})
		if len(refs) > 1000 { return nil, ErrPreviewTooLarge }
	}
	return refs, nil
}
