package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateGitCredential(ctx context.Context, id, organizationID, repository, actorID, scope string, hash []byte, expiresAt time.Time) error {
	result, err := s.pool.Exec(ctx, `
		INSERT INTO git_http_credentials (id, organization_id, repository, actor_id, scope, token_hash, expires_at)
		SELECT $1, r.organization_id, r.slug, m.user_id, $5, $6, $7
		FROM delivery_repositories r
		JOIN organizations o ON o.id = r.organization_id AND o.status = 'active'
		JOIN organization_memberships m ON m.organization_id = o.id AND m.status = 'active'
		WHERE r.organization_id = $2 AND r.slug = $3 AND m.user_id = $4
		  AND ($5 = 'read' OR ($5 = 'write' AND m.role IN ('owner', 'admin', 'member')))
	`, id, organizationID, repository, actorID, scope, hash, expiresAt)
	if err != nil {
		return fmt.Errorf("create Git credential: %w", err)
	}
	if result.RowsAffected() != 1 {
		return identity.ErrUnauthenticated
	}
	return nil
}

func (s *Store) RevokeGitCredential(ctx context.Context, id, organizationID, repository, actorID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE git_http_credentials SET revoked_at = now()
		WHERE id = $1 AND organization_id = $2 AND repository = $3 AND actor_id = $4 AND revoked_at IS NULL
	`, id, organizationID, repository, actorID)
	if err != nil {
		return fmt.Errorf("revoke Git credential: %w", err)
	}
	return nil
}

// AuthorizeGitCredential uses the exact repository slug and checks current access.
func (s *Store) AuthorizeGitCredential(ctx context.Context, hash []byte, organization, repository string, write bool) (organizationID, actorID, defaultBranch string, err error) {
	err = s.pool.QueryRow(ctx, `
		UPDATE git_http_credentials c SET last_used_at = now()
		FROM organizations o, organization_memberships m, delivery_repositories r
		WHERE c.token_hash = $1 AND c.repository = $3
		  AND c.revoked_at IS NULL AND c.expires_at > now()
		  AND o.id = c.organization_id AND o.status = 'active'
		  AND (o.id = $2 OR (o.slug = $5 AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = $2)))
		  AND m.organization_id = o.id AND m.user_id = c.actor_id AND m.status = 'active'
		  AND r.organization_id = o.id AND r.slug = c.repository
		  AND (NOT $4 OR (c.scope = 'write' AND m.role IN ('owner', 'admin', 'member')))
		RETURNING c.organization_id, c.actor_id, r.default_branch
	`, hash, organization, repository, write, foldASCIICase(organization)).Scan(&organizationID, &actorID, &defaultBranch)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", "", identity.ErrUnauthenticated
	}
	if err != nil {
		return "", "", "", fmt.Errorf("authorize Git credential: %w", err)
	}
	return organizationID, actorID, defaultBranch, nil
}

// LockGitPolicy serializes native pushes and regular merges against concurrent
// repository policy updates. Integration promotion takes the same row lock.
func (s *Store) LockGitPolicy(ctx context.Context, organization, repository string) (githttp.PushPolicy, func(), error) {
	tx, err := s.lockPool.Begin(ctx)
	if err != nil {
		return githttp.PushPolicy{}, nil, fmt.Errorf("begin Git branch lock: %w", err)
	}
	release := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = tx.Rollback(ctx)
	}
	policy, err := lockGitPolicyRow(ctx, tx, organization, repository)
	if err != nil {
		release()
		return githttp.PushPolicy{}, nil, err
	}
	return policy, release, nil
}

func lockGitPolicyRow(ctx context.Context, tx pgx.Tx, organization, repository string) (githttp.PushPolicy, error) {
	var policy githttp.PushPolicy
	if err := tx.QueryRow(ctx, `SELECT default_branch, push_ref_limit, protected_refs, ref_rules, web_commit_signoff_required FROM delivery_repositories
		WHERE organization_id = $1 AND slug = $2 FOR NO KEY UPDATE NOWAIT`, organization, repository).Scan(&policy.DefaultBranch, &policy.RefLimit, &policy.ProtectedRefs, &policy.RefRules, &policy.WebCommitSignoffRequired); err != nil {
		return githttp.PushPolicy{}, fmt.Errorf("lock Git repository policy: %w", err)
	}
	return policy, nil
}

func (s *Store) ListGitCredentials(ctx context.Context, organizationID, repository, actorID string) ([]githttp.CredentialSummary, error) {
	rows, err := s.pool.Query(ctx, `
        SELECT id, scope, expires_at FROM git_http_credentials
        WHERE organization_id = $1 AND repository = $2 AND actor_id = $3
          AND revoked_at IS NULL AND expires_at > now()
        ORDER BY expires_at DESC, id
    `, organizationID, repository, actorID)
	if err != nil {
		return nil, fmt.Errorf("list Git credentials: %w", err)
	}
	defer rows.Close()
	items := make([]githttp.CredentialSummary, 0)
	for rows.Next() {
		var item githttp.CredentialSummary
		if err := rows.Scan(&item.ID, &item.Scope, &item.ExpiresAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
