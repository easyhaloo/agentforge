package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

func (s *Store) CurrentAccount(ctx context.Context, sessionToken string) (identity.AccountContext, error) {
	if len(sessionToken) < 32 || len(sessionToken) > 128 {
		return identity.AccountContext{}, identity.ErrUnauthenticated
	}
	var account identity.AccountContext
	err := s.pool.QueryRow(ctx, `SELECT u.id,u.display_name,COALESCE(u.email,'')
		FROM sessions s JOIN users u ON u.id=s.user_id
		WHERE s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL`,
		identity.HashToken(sessionToken)).Scan(&account.UserID, &account.DisplayName, &account.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.AccountContext{}, identity.ErrUnauthenticated
	}
	if err != nil {
		return identity.AccountContext{}, fmt.Errorf("load authenticated account: %w", err)
	}
	rows, err := s.pool.Query(ctx, `SELECT o.id,COALESCE(o.slug,o.id),o.name,m.role,COALESCE(o.personal_owner_id=m.user_id,false)
		FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id
		WHERE m.user_id=$1 AND m.status='active' AND o.status='active'
		ORDER BY o.name,o.id`, account.UserID)
	if err != nil {
		return identity.AccountContext{}, fmt.Errorf("list account organizations: %w", err)
	}
	defer rows.Close()
	account.Organizations = make([]identity.OrganizationSummary, 0)
	for rows.Next() {
		var organization identity.OrganizationSummary
		if err := rows.Scan(&organization.ID, &organization.Slug, &organization.Name, &organization.Role, &organization.Personal); err != nil {
			return identity.AccountContext{}, fmt.Errorf("scan account organization: %w", err)
		}
		account.Organizations = append(account.Organizations, organization)
	}
	if err := rows.Err(); err != nil {
		return identity.AccountContext{}, fmt.Errorf("iterate account organizations: %w", err)
	}
	if len(account.Organizations) == 0 {
		return identity.AccountContext{}, identity.ErrUnauthenticated
	}
	return account, nil
}

const profileColumns = "id, display_name, COALESCE(email, ''), bio, location, created_at, updated_at"

func scanProfile(row pgx.Row) (identity.UserProfile, error) {
	var p identity.UserProfile
	err := row.Scan(&p.UserID, &p.DisplayName, &p.Email, &p.Bio, &p.Location, &p.CreatedAt, &p.UpdatedAt)
	return p, err
}

func (s *Store) GetUserProfile(ctx context.Context, userID string) (identity.UserProfile, error) {
	return scanProfile(s.pool.QueryRow(ctx, `SELECT `+profileColumns+` FROM users WHERE id = $1`, userID))
}

func (s *Store) UpdateUserProfile(ctx context.Context, userID string, displayName, bio, location *string) (identity.UserProfile, error) {
	return scanProfile(s.pool.QueryRow(ctx, `UPDATE users SET display_name = COALESCE($2, display_name),
		bio = COALESCE($3, bio), location = COALESCE($4, location), updated_at = now()
		WHERE id = $1 RETURNING `+profileColumns, userID, displayName, bio, location))
}
