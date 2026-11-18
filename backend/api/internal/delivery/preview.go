package delivery

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// PreviewEntry is one direct child of a Git tree. Paths are repository-relative
// and always refer to the immutable commit returned by ResolveRevision.
type PreviewEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Kind string `json:"kind"`
	Mode string `json:"mode"`
	SHA string `json:"sha"`
	Size int64 `json:"size,omitempty"`
}

// RepositoryPreviewReader is an optional read-only capability. Keeping it
// separate from GitProvider avoids forcing third-party merge/evaluation
// adapters to implement browser-oriented source browsing.
type RepositoryPreviewReader interface {
	ListTree(context.Context, string, string, string, string) ([]PreviewEntry, error)
	ReadBlob(context.Context, string, string, string, string, int64) ([]byte, string, error)
}

var (
	ErrPreviewPathInvalid = errors.New("repository preview path is invalid")
	ErrPreviewTooLarge = errors.New("repository preview file exceeds the size limit")
)

// ListTree lists only direct children of a directory at a pinned commit.
func (p *LocalGitProvider) ListTree(ctx context.Context, organizationID, repository, commitSHA, directory string) ([]PreviewEntry, error) {
	path, err := p.repositoryPath(organizationID, repository)
	if err != nil { return nil, err }
	if !validGitObjectID(commitSHA) || !validRepositoryPath(directory) { return nil, ErrPreviewPathInvalid }
	treeish := commitSHA
	if directory != "" { treeish += ":" + directory }
	output, err := p.run(ctx, path, "ls-tree", "-z", "--long", "--full-tree", treeish)
	if err != nil { return nil, ErrRepositoryInvalid }
	records := strings.Split(output, "\x00")
	entries := make([]PreviewEntry, 0, len(records))
	for _, record := range records {
		if record == "" { continue }
		metadata, name, ok := strings.Cut(record, "\t")
		if !ok { return nil, ErrRepositoryInvalid }
		fields := strings.Fields(metadata)
		if len(fields) < 3 { return nil, ErrRepositoryInvalid }
		mode, objectType, sha := fields[0], fields[1], fields[2]
		kind := objectType
		if mode == "040000" { kind = "tree" } else if mode == "120000" { kind = "symlink" } else if objectType == "blob" { kind = "file" }
		var size int64
		if len(fields) > 3 && fields[3] != "-" { size, _ = strconv.ParseInt(fields[3], 10, 64) }
		entryPath := name
		if directory != "" { entryPath = directory + "/" + name }
		entries = append(entries, PreviewEntry{Name:name, Path:entryPath, Kind:kind, Mode:mode, SHA:sha, Size:size})
		if len(entries) > 2000 { return nil, ErrPreviewTooLarge }
	}
	return entries, nil
}

// ReadBlob returns UTF-8 or binary bytes only for a regular Git blob. Symlinks
// are not dereferenced. The caller must enforce the requested content policy.
func (p *LocalGitProvider) ReadBlob(ctx context.Context, organizationID, repository, commitSHA, filePath string, maxBytes int64) ([]byte, string, error) {
	path, err := p.repositoryPath(organizationID, repository)
	if err != nil { return nil, "", err }
	if !validGitObjectID(commitSHA) || !validRepositoryPath(filePath) || filePath == "" { return nil, "", ErrPreviewPathInvalid }
	if maxBytes <= 0 || maxBytes > 2<<20 { maxBytes = 1 << 20 }
	object, err := p.run(ctx, path, "rev-parse", "--verify", "--end-of-options", commitSHA+":"+filePath)
	if err != nil || !validGitObjectID(object) { return nil, "", ErrRepositoryInvalid }
	objectType, err := p.run(ctx, path, "cat-file", "-t", object)
	if err != nil || objectType != "blob" { return nil, "", ErrPreviewPathInvalid }
	rawSize, err := p.run(ctx, path, "cat-file", "-s", object)
	if err != nil { return nil, "", ErrRepositoryInvalid }
	size, err := strconv.ParseInt(rawSize, 10, 64)
	if err != nil || size < 0 { return nil, "", ErrRepositoryInvalid }
	if size > maxBytes { return nil, object, ErrPreviewTooLarge }
	content, err := p.run(ctx, path, "cat-file", "blob", object)
	if err != nil { return nil, "", fmt.Errorf("read git blob: %w", err) }
	return []byte(content), object, nil
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
