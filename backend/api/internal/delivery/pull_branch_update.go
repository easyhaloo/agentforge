package delivery

import (
	"context"
	"fmt"
	"strings"
)

// UpdatePullSource compares both tips in the same ref transaction. The caller
// holds the repository policy lock and has validated the proposed revision.
func (p *LocalGitProvider) UpdatePullSource(ctx context.Context, org, repo string, source, base PinnedRef, next string) error {
	if source.Ref == base.Ref || !validGitObjectID(source.SHA) || !validGitObjectID(base.SHA) || !validGitObjectID(next) {
		return ErrRepositoryInvalid
	}
	path, err := p.repositoryPath(ctx, org, repo)
	if err != nil {
		return err
	}
	sourceRef, baseRef := "refs/heads/"+source.Ref, "refs/heads/"+base.Ref
	for _, ref := range []string{sourceRef, baseRef} {
		if _, err := previewGit(ctx, path, "check-ref-format", ref); err != nil {
			return ErrRepositoryInvalid
		}
	}
	bare, err := p.run(ctx, path, "rev-parse", "--is-bare-repository")
	if err != nil || bare != "true" {
		return ErrProviderUnavailable
	}
	head, _ := p.run(ctx, path, "symbolic-ref", "--quiet", "HEAD")
	worktrees, err := previewGit(ctx, path, "worktree", "list", "--porcelain", "-z")
	if err != nil || head == sourceRef || strings.Contains("\x00"+string(worktrees), "\x00branch "+sourceRef+"\x00") {
		return ErrWriteConflict
	}
	transaction := fmt.Sprintf("verify %s %s\nupdate %s %s %s\n", baseRef, base.SHA, sourceRef, next, source.SHA)
	if _, err := previewGitInput(ctx, path, strings.NewReader(transaction), "update-ref", "--no-deref", "--stdin"); err != nil {
		return fmt.Errorf("update pull request source branch: %w", ErrWriteConflict)
	}
	return nil
}
