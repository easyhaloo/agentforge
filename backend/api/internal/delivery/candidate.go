package delivery

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var ErrCandidateStale = errors.New("candidate base has moved")

func candidateRef(sha string) string { return "refs/agentforge/integration/" + sha }

// CheckoutCandidate materializes the retained commit in a private build directory.
// Only its files are exposed to the container. No source Git metadata is mounted.
func (p *LocalGitProvider) CheckoutCandidate(ctx context.Context, org, repository, sha string) (string, func(), error) {
	if !objectID.MatchString(sha) {
		return "", nil, ErrRepositoryInvalid
	}
	path, err := p.repositoryPath(ctx, org, repository)
	if err != nil {
		return "", nil, err
	}
	temp, err := os.MkdirTemp("", "agentforge-build-*")
	if err != nil {
		return "", nil, err
	}
	cleanup := func() { os.RemoveAll(temp) }
	work := filepath.Join(temp, "src")
	ref := candidateRef(sha)
	for _, args := range [][]string{{"init", "--template=", work}, {"-C", work, "-c", "protocol.file.allow=always", "fetch", "--depth=1", "--no-tags", "--", path, ref}, {"-C", work, "checkout", "--detach", "FETCH_HEAD"}} {
		if _, err := previewGit(ctx, temp, args...); err != nil {
			cleanup()
			return "", nil, ErrProviderUnavailable
		}
	}
	head, err := previewGit(ctx, work, "rev-parse", "HEAD")
	if err != nil || strings.TrimSpace(string(head)) != sha {
		cleanup()
		return "", nil, ErrRepositoryInvalid
	}
	if err := os.RemoveAll(filepath.Join(work, ".git")); err != nil {
		cleanup()
		return "", nil, err
	}
	return work, cleanup, nil
}

// CandidateCommits enumerates the introduced history, including commits beneath a source tip.
func (p *LocalGitProvider) CandidateCommits(ctx context.Context, org, repository string, candidate MergePreview) ([]string, error) {
	if !objectID.MatchString(candidate.Target.SHA) || !objectID.MatchString(candidate.CandidateSHA) {
		return nil, ErrRepositoryInvalid
	}
	path, err := p.repositoryPath(ctx, org, repository)
	if err != nil {
		return nil, err
	}
	out, err := previewGit(ctx, path, "rev-list", candidate.Target.SHA+".."+candidateRef(candidate.CandidateSHA))
	if err != nil {
		return nil, ErrPreviewUnavailable
	}
	return strings.Fields(string(out)), nil
}

var promotionID = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)

func promotionRef(runID string) string { return "refs/agentforge/promotions/" + runID }

// HasPromotion distinguishes a missing receipt from an unreadable or mismatched one.
func (p *LocalGitProvider) HasPromotion(ctx context.Context, org, repository, runID, sha string) (bool, error) {
	if !promotionID.MatchString(runID) || !objectID.MatchString(sha) {
		return false, ErrRepositoryInvalid
	}
	path, err := p.repositoryPath(ctx, org, repository)
	if err != nil {
		return false, err
	}
	ref := promotionRef(runID)
	// Verify absence using the same ref backend as promotion. This works on Git
	// 2.38, including packed refs, and fails closed on a broken or unreadable ref.
	verifyAbsent := fmt.Sprintf("verify %s %s\n", ref, strings.Repeat("0", len(sha)))
	if _, err := previewGitInput(ctx, path, strings.NewReader(verifyAbsent), "update-ref", "--no-deref", "--stdin"); err == nil {
		return false, nil
	}
	out, err := previewGit(ctx, path, "show-ref", "--verify", "--hash", ref)
	if err != nil {
		return false, ErrProviderUnavailable
	}
	if strings.TrimSpace(string(out)) != sha {
		return false, ErrRepositoryInvalid
	}
	return true, nil
}

// PromoteCandidate advances an operator-managed bare target using Git's atomic old-OID check.
func (p *LocalGitProvider) PromoteCandidate(ctx context.Context, org, repository, runID string, preview MergePreview) error {
	base, sha, branch := preview.Target.SHA, preview.CandidateSHA, "refs/heads/"+preview.Target.Ref
	if !promotionID.MatchString(runID) || !objectID.MatchString(base) || !objectID.MatchString(sha) || preview.Target.Ref == "" {
		return ErrRepositoryInvalid
	}
	path, err := p.repositoryPath(ctx, org, repository)
	if err != nil {
		return err
	}
	if _, err := previewGit(ctx, path, "check-ref-format", branch); err != nil {
		return ErrRepositoryInvalid
	}
	bare, err := previewGit(ctx, path, "rev-parse", "--is-bare-repository")
	if err != nil || strings.TrimSpace(string(bare)) != "true" {
		return ErrProviderUnavailable
	}
	retained, err := previewGit(ctx, path, "rev-parse", "--verify", candidateRef(sha))
	if err != nil || strings.TrimSpace(string(retained)) != sha {
		return ErrRepositoryInvalid
	}
	if _, err := previewGit(ctx, path, "merge-base", "--is-ancestor", base, sha); err != nil {
		return ErrRepositoryInvalid
	}
	receipt := promotionRef(runID)
	transaction := fmt.Sprintf("start\nupdate %s %s %s\ncreate %s %s\nprepare\ncommit\n", branch, sha, base, receipt, sha)
	if _, err := previewGitInput(ctx, path, strings.NewReader(transaction), "update-ref", "--no-deref", "--stdin"); err != nil {
		// Both refs committed or neither did, including when the process lost its reply.
		recorded, readErr := previewGit(ctx, path, "rev-parse", "--verify", receipt)
		if readErr == nil && strings.TrimSpace(string(recorded)) == sha {
			return nil
		}
		head, readErr := previewGit(ctx, path, "rev-parse", "--verify", branch)
		if readErr != nil || strings.TrimSpace(string(head)) != base {
			return ErrCandidateStale
		}
		return ErrProviderUnavailable
	}
	return nil
}
