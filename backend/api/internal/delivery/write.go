package delivery

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

var ErrWriteConflict = errors.New("repository write conflict")
var ErrWriteInvalid = errors.New("repository write input is invalid")

type RepositoryFileWriter interface {
	SaveTextFile(context.Context, string, string, string, string, string, string, []byte) (GitFileWrite, error)
}

type GitFileWrite struct {
	Branch string
	CommitSHA string
	BlobSHA string
}

var changesetBranchID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func ChangesetBranch(id string) (string, error) {
	if !changesetBranchID.MatchString(id) { return "", ErrWriteInvalid }
	return "agentforge/changesets/" + id, nil
}

func validEditablePath(path string) bool {
	if path == "" || len(path) > 1024 || !utf8.ValidString(path) || strings.ContainsAny(path, "\x00\\\r\n\t") || strings.HasPrefix(path, "/") || strings.HasSuffix(path, "/") {
		return false
	}
	for _, part := range strings.Split(path, "/") {
		if part == "" || part == "." || part == ".." { return false }
	}
	return true
}

func (p *LocalGitProvider) SaveTextFile(ctx context.Context, org, repository, changesetID, baseCommit, baseBlob, filePath string, content []byte) (GitFileWrite, error) {
	var result GitFileWrite
	branch, err := ChangesetBranch(changesetID)
	if err != nil || !objectID.MatchString(baseCommit) || !objectID.MatchString(baseBlob) || !validEditablePath(filePath) || len(content) > 1<<20 || !utf8.Valid(content) {
		return result, ErrWriteInvalid
	}
	repo, err := p.repositoryPath(ctx, org, repository)
	if err != nil { return result, err }
	original, actualBlob, err := p.ReadBlob(ctx, org, repository, baseCommit, filePath, 1<<20)
	if err != nil || actualBlob != baseBlob { return result, ErrWriteConflict }
	if !utf8.Valid(original) { return result, ErrWriteInvalid }
	// Refuse symlinks, submodules and non-regular tree entries even if their target resolves to a blob.
	entry, err := previewGit(ctx, repo, "ls-tree", "-z", baseCommit, "--", filePath)
	if err != nil { return result, ErrRepositoryInvalid }
	fields := bytes.Split(bytes.TrimSuffix(entry, []byte{0}), []byte{0})
	if len(fields) != 1 { return result, ErrWriteInvalid }
	meta, found := bytes.Cut(fields[0], []byte{'\t'})
	if !found || !bytes.HasPrefix(meta, []byte("100644 blob ")) && !bytes.HasPrefix(meta, []byte("100755 blob ")) { return result, ErrWriteInvalid }

	temp, err := os.MkdirTemp("", "agentforge-edit-*")
	if err != nil { return result, ErrProviderUnavailable }
	defer os.RemoveAll(temp)
	index := filepath.Join(temp, "index")
	env := []string{"GIT_INDEX_FILE="+index}
	blobRaw, err := isolatedGit(ctx, repo, bytes.NewReader(content), env, "hash-object", "-w", "--stdin")
	if err != nil { return result, ErrProviderUnavailable }
	blob := strings.TrimSpace(string(blobRaw))
	if !objectID.MatchString(blob) { return result, ErrProviderUnavailable }
	if _, err = isolatedGit(ctx, repo, nil, env, "read-tree", baseCommit); err != nil { return result, ErrProviderUnavailable }
	indexInfo := "100644 " + blob + "\t" + filePath + "\n"
	if _, err = isolatedGit(ctx, repo, strings.NewReader(indexInfo), env, "update-index", "--add", "--index-info"); err != nil { return result, ErrWriteInvalid }
	treeRaw, err := isolatedGit(ctx, repo, nil, env, "write-tree")
	if err != nil { return result, ErrProviderUnavailable }
	tree := strings.TrimSpace(string(treeRaw))
	commitRaw, err := isolatedGit(ctx, repo, strings.NewReader("Update "+filePath+" via AgentForge WebIDE\n"), nil, "commit-tree", tree, "-p", baseCommit)
	if err != nil { return result, ErrProviderUnavailable }
	commit := strings.TrimSpace(string(commitRaw))
	if !objectID.MatchString(commit) { return result, ErrProviderUnavailable }
	ref := "refs/heads/" + branch
	old, readErr := isolatedGit(ctx, repo, nil, nil, "rev-parse", "--verify", "--quiet", ref)
	expected := strings.TrimSpace(string(old))
	if readErr != nil { expected = strings.Repeat("0", len(commit)) }
	if expected != strings.Repeat("0", len(commit)) && expected != baseCommit { return result, ErrWriteConflict }
	if _, err = isolatedGit(ctx, repo, nil, nil, "update-ref", ref, commit, expected); err != nil { return result, ErrWriteConflict }
	return GitFileWrite{Branch:branch, CommitSHA:commit, BlobSHA:blob}, nil
}

func (p *RemoteGitProvider) SaveTextFile(ctx context.Context, org, repository, changesetID, baseCommit, baseBlob, filePath string, content []byte) (GitFileWrite, error) {
	var result GitFileWrite
	branch, err := ChangesetBranch(changesetID)
	if err != nil || !objectID.MatchString(baseCommit) || !objectID.MatchString(baseBlob) || !validEditablePath(filePath) || len(content) > 1<<20 || !utf8.Valid(content) {
		return result, ErrWriteInvalid
	}
	w, done, err := p.workspace(ctx, org, repository)
	if err != nil { return result, err }
	defer done()
	ref := "refs/heads/" + branch
	old, err := w.readRef(ref)
	if err != nil { return result, err }
	if old != "" && old != baseCommit { return result, ErrWriteConflict }
	// Fetch the immutable parent and, when present, the current changeset branch.
	fetchArgs := []string{"fetch", "--no-tags", "--no-recurse-submodules", "--", w.repo.URL, baseCommit}
	if old != "" { fetchArgs = append(fetchArgs, ref+":"+ref) }
	if _, err = w.network(fetchArgs...); err != nil { return result, ErrProviderUnavailable }
	objectRaw, err := w.git("rev-parse", "--verify", "--end-of-options", baseCommit+":"+filePath)
	object := strings.TrimSpace(string(objectRaw))
	if err != nil || !objectID.MatchString(object) { return result, ErrWriteConflict }
	objectType, err := w.git("cat-file", "-t", object)
	if err != nil || strings.TrimSpace(string(objectType)) != "blob" { return result, ErrWriteInvalid }
	objectSize, err := w.git("cat-file", "-s", object)
	if err != nil { return result, ErrProviderUnavailable }
	size, sizeErr := strconv.ParseInt(strings.TrimSpace(string(objectSize)), 10, 64)
	if sizeErr != nil || size < 0 || size > 1<<20 { return result, ErrWriteInvalid }
	if object != baseBlob { return result, ErrWriteConflict }
	blobContent, err := w.git("cat-file", "blob", object)
	if err != nil || int64(len(blobContent)) != size || !utf8.Valid(blobContent) { return result, ErrWriteInvalid }
	entry, err := w.git("ls-tree", "-z", baseCommit, "--", filePath)
	if err != nil { return result, ErrRepositoryInvalid }
	fields := bytes.Split(bytes.TrimSuffix(entry, []byte{0}), []byte{0})
	if len(fields) != 1 { return result, ErrWriteInvalid }
	meta, found := bytes.Cut(fields[0], []byte{'\t'})
	if !found || !bytes.HasPrefix(meta, []byte("100644 blob ")) && !bytes.HasPrefix(meta, []byte("100755 blob ")) { return result, ErrWriteInvalid }

	temp := filepath.Join(w.dir, ".agentforge-edit-index")
	env := []string{"GIT_INDEX_FILE="+temp}
	blobRaw, err := isolatedGit(w.ctx, w.dir, bytes.NewReader(content), env, "hash-object", "-w", "--stdin")
	if err != nil { return result, ErrProviderUnavailable }
	blob := strings.TrimSpace(string(blobRaw))
	if !objectID.MatchString(blob) { return result, ErrProviderUnavailable }
	if _, err = isolatedGit(w.ctx, w.dir, nil, env, "read-tree", baseCommit); err != nil { return result, ErrProviderUnavailable }
	indexInfo := "100644 " + blob + "\\t" + filePath + "\\n"
	if _, err = isolatedGit(w.ctx, w.dir, strings.NewReader(indexInfo), env, "update-index", "--add", "--index-info"); err != nil { return result, ErrWriteInvalid }
	treeRaw, err := isolatedGit(w.ctx, w.dir, nil, env, "write-tree")
	if err != nil { return result, ErrProviderUnavailable }
	tree := strings.TrimSpace(string(treeRaw))
	commitRaw, err := isolatedGit(w.ctx, w.dir, strings.NewReader("Update "+filePath+" via AgentForge WebIDE\n"), nil, "commit-tree", tree, "-p", baseCommit)
	if err != nil { return result, ErrProviderUnavailable }
	commit := strings.TrimSpace(string(commitRaw))
	if !objectID.MatchString(commit) { return result, ErrProviderUnavailable }
	lease := ref + ":"
	if old != "" { lease = ref + ":" + old }
	if _, err = w.network("push", "--force-with-lease="+lease, "--", w.repo.URL, commit+":"+ref); err != nil {
		latest, readErr := w.readRef(ref)
		if readErr != nil { return result, readErr }
		if latest != old { return result, ErrWriteConflict }
		return result, fmt.Errorf("%w: push rejected", ErrProviderUnavailable)
	}
	return GitFileWrite{Branch:branch, CommitSHA:commit, BlobSHA:blob}, nil
}
