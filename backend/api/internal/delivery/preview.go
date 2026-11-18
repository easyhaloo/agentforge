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
	repoPath, err := p.repositoryPath(organizationID, repository)
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
	repoPath, err := p.repositoryPath(organizationID, repository)
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
	command.Env = []string{"PATH="+os.Getenv("PATH"), "HOME="+os.TempDir(), "GIT_TERMINAL_PROMPT=0", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null"}
	var stdout, stderr bytes.Buffer
	command.Stdout = &boundedBuffer{buffer:&stdout, limit:maxOutput}
	command.Stderr = &boundedBuffer{buffer:&stderr, limit:64<<10}
	if err := command.Run(); err != nil { return nil, err }
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
