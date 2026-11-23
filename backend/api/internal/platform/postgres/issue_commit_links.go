package postgres

import (
	"context"
	"fmt"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/jackc/pgx/v5"
)

func (r *IssueRepository) listLinkedCommits(ctx context.Context, org, repo string, id issues.ID) ([]issues.CommitLink, error) {
	rows, err := r.store.pool.Query(ctx, `SELECT commit_sha, subject FROM issue_commit_links
		WHERE organization_id=$1 AND repository=$2 AND issue_id=$3
		ORDER BY linked_at DESC, commit_sha LIMIT 100`, org, repo, id)
	if err != nil {
		return nil, fmt.Errorf("query linked commits: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[issues.CommitLink])
}

func (r *IssueRepository) IssuesForCommit(ctx context.Context, org, repo, sha string) ([]int, error) {
	rows, err := r.store.pool.Query(ctx, `SELECT i.number FROM issue_commit_links l
		JOIN issues i ON (i.organization_id,i.repository,i.id)=(l.organization_id,l.repository,l.issue_id)
		WHERE l.organization_id=$1 AND l.repository=$2 AND l.commit_sha=$3
		ORDER BY i.number LIMIT 100`, org, repo, sha)
	if err != nil {
		return nil, fmt.Errorf("query issues for commit: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowTo[int])
}

// LinkCommitIssues records numbered references from a commit accepted by Git transport.
// Replaying the same commit, including from another branch, leaves existing links unchanged.
func (r *IssueRepository) LinkCommitIssues(ctx context.Context, org, repo, sha, subject, message string) error {
	numbers := issues.CommitIssueNumbers(message)
	if len(numbers) == 0 {
		return nil
	}
	_, err := r.store.pool.Exec(ctx, `INSERT INTO issue_commit_links (organization_id, repository, issue_id, commit_sha, subject)
		SELECT organization_id, repository, id, $4, $5 FROM issues
		WHERE organization_id=$1 AND repository=$2 AND number=ANY($3)
		ORDER BY id FOR SHARE
		ON CONFLICT DO NOTHING`, org, repo, numbers, sha, subject)
	if err != nil {
		return fmt.Errorf("persist commit issue links: %w", err)
	}
	return nil
}
