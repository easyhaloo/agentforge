package postgres

import (
	"context"
	"fmt"
	"strings"

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
		JOIN enabled_repository_issues i ON (i.organization_id,i.repository,i.id)=(l.organization_id,l.repository,l.issue_id)
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
		SELECT organization_id, repository, id, $4, $5 FROM enabled_repository_issues
		WHERE organization_id=$1 AND repository=$2 AND number=ANY($3)
		ORDER BY id FOR SHARE
		ON CONFLICT DO NOTHING`, org, repo, numbers, sha, subject)
	if err != nil {
		return fmt.Errorf("persist commit issue links: %w", err)
	}
	return nil
}

// listClosingPullRequests derives links from the current PR text and default branch.
// ponytail: prefilter in SQL, then reuse the merge parser. Index reference targets if this read becomes expensive.
func (r *IssueRepository) listClosingPullRequests(ctx context.Context, org string, issue *issues.Issue) ([]issues.PullRequestLink, error) {
	rows, err := r.store.pool.Query(ctx, `SELECT c.id, c.title, c.repository, c.state->'pull_request'->>'description'
		FROM delivery_changesets c
		JOIN delivery_repositories r ON (r.organization_id,r.slug)=(c.organization_id,c.repository)
		WHERE c.organization_id=$1 AND c.state->'pull_request'->>'base_branch'=r.default_branch
		AND position('#' || $3::integer::text IN c.state->'pull_request'->>'description') > 0
		AND (c.repository=$2 OR EXISTS (
			SELECT 1 FROM organization_memberships m
			WHERE m.organization_id=c.organization_id AND m.user_id=c.state->>'created_by' AND m.status='active'
			AND (m.role IN ('owner','admin') OR m.user_id=$4)
		)) ORDER BY c.updated_at DESC, c.id`, org, issue.Repository, issue.Number, issue.CreatedBy)
	if err != nil {
		return nil, fmt.Errorf("query closing pull requests: %w", err)
	}
	defer rows.Close()
	var links []issues.PullRequestLink
	for rows.Next() {
		var link issues.PullRequestLink
		var description string
		if err := rows.Scan(&link.ID, &link.Title, &link.Repository, &description); err != nil {
			return nil, fmt.Errorf("scan closing pull request: %w", err)
		}
		for _, ref := range issues.ClosingIssueReferences(description) {
			if int(ref.Number) == issue.Number && ((ref.Repository == "" && link.Repository == issue.Repository) ||
				(ref.Repository != "" && strings.EqualFold(ref.Repository, issue.Repository))) {
				links = append(links, link)
				break
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read closing pull requests: %w", err)
	}
	return links, nil
}
