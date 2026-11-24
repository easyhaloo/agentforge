package delivery

import (
	"context"
	"fmt"
	"strings"
)

// DeleteMergedBranch removes only the reviewed branch tip and only while the
// target still contains the recorded merge result. Updating the target concurrently invalidates the CAS.
func (p *LocalGitProvider) DeleteMergedBranch(ctx context.Context, org, repo, source, target, expectedSHA, mergedSHA string) error {
	if source == target || !validGitObjectID(expectedSHA) || !validGitObjectID(mergedSHA) {
		return ErrRepositoryInvalid
	}
	dir, err := p.repositoryPath(ctx, org, repo)
	if err != nil {
		return err
	}
	bare, err := p.run(ctx, dir, "rev-parse", "--is-bare-repository")
	if err != nil || bare != "true" {
		return ErrProviderUnavailable
	}
	sourceRef, targetRef := "refs/heads/"+source, "refs/heads/"+target
	for _, ref := range []string{sourceRef, targetRef} {
		if _, err := previewGit(ctx, dir, "check-ref-format", ref); err != nil {
			return ErrRepositoryInvalid
		}
	}
	head, _ := p.run(ctx, dir, "symbolic-ref", "--quiet", "HEAD")
	worktrees, err := previewGit(ctx, dir, "worktree", "list", "--porcelain", "-z")
	if err != nil || head == sourceRef || strings.Contains("\x00"+string(worktrees), "\x00branch "+sourceRef+"\x00") {
		return ErrWriteConflict
	}
	out, err := previewGit(ctx, dir, "rev-parse", "--verify", targetRef)
	targetSHA := strings.TrimSpace(string(out))
	if err != nil || !validGitObjectID(targetSHA) {
		return ErrWriteConflict
	}
	if _, err := previewGit(ctx, dir, "merge-base", "--is-ancestor", mergedSHA, targetSHA); err != nil {
		return ErrWriteConflict
	}
	sourceTip, err := p.run(ctx, dir, "rev-parse", "--verify", sourceRef)
	if err != nil || sourceTip != expectedSHA {
		return ErrWriteConflict
	}
	transaction := fmt.Sprintf("verify %s %s\ndelete %s %s\n", targetRef, targetSHA, sourceRef, expectedSHA)
	if _, err := previewGitInput(ctx, dir, strings.NewReader(transaction), "update-ref", "--no-deref", "--stdin"); err != nil {
		return fmt.Errorf("compare and delete branch: %w", err)
	}
	return nil
}
