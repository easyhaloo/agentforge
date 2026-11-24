package delivery

import (
	"context"
	"regexp"
	"strings"
)

var issueBranchSuffix = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{0,79}$`)

// CreateIssueBranch uses a reserved Git namespace, so the association and the
// branch exist together. The base pin and create-only update prevent ref races.
func (p *LocalGitProvider) CreateIssueBranch(ctx context.Context, organizationID, repository, issueID, suffix, base, expectedSHA string, check BranchWriteCheck) (RepositoryRef, error) {
	if !changesetBranchID.MatchString(issueID) || !issueBranchSuffix.MatchString(suffix) ||
		!strings.HasPrefix(base, "refs/heads/") || strings.ContainsAny(base, " \t\n\r\x00") || !validGitObjectID(expectedSHA) {
		return RepositoryRef{}, ErrWriteInvalid
	}
	path, err := p.repositoryPath(ctx, organizationID, repository)
	if err != nil {
		return RepositoryRef{}, err
	}
	if _, err := isolatedGit(ctx, path, nil, nil, "check-ref-format", base); err != nil {
		return RepositoryRef{}, ErrWriteInvalid
	}
	revision, err := p.ResolveRevision(ctx, organizationID, repository, base)
	if err != nil || revision.CommitSHA != expectedSHA {
		return RepositoryRef{}, ErrWriteConflict
	}
	name := "agentforge/issues/" + issueID + "/" + suffix
	ref := "refs/heads/" + name
	if ref == base {
		return RepositoryRef{}, ErrWriteConflict
	}
	if err := check(ref, true); err != nil {
		return RepositoryRef{}, err
	}
	commands := "verify " + base + " " + expectedSHA + "\ncreate " + ref + " " + expectedSHA + "\n"
	if _, err := isolatedGit(ctx, path, strings.NewReader(commands), nil, "update-ref", "--no-deref", "--stdin"); err != nil {
		return RepositoryRef{}, ErrWriteConflict
	}
	return RepositoryRef{Name: name, Kind: "branch", SHA: expectedSHA}, nil
}
