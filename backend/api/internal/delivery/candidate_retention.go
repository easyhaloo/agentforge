package delivery

import (
	"context"
	"strings"
)

// DeleteCandidate removes only the named retention ref at the expected object ID.
func (p *LocalGitProvider) DeleteCandidate(ctx context.Context, org, repo, sha string) error {
	if !objectID.MatchString(sha) || strings.Trim(sha, "0") == "" {
		return ErrRepositoryInvalid
	}
	path, err := p.repositoryPath(ctx, org, repo)
	if err != nil {
		return err
	}
	ref := candidateRef(sha)
	out, err := previewGit(ctx, path, "for-each-ref", "--format=%(refname) %(objectname) %(symref)", ref)
	if err != nil {
		return ErrProviderUnavailable
	}
	if len(out) == 0 {
		return nil
	}
	if strings.TrimSuffix(string(out), "\n") != ref+" "+sha+" " {
		return ErrRepositoryInvalid
	}
	_, err = previewGit(ctx, path, "update-ref", "--no-deref", "-d", ref, sha)
	return err
}
