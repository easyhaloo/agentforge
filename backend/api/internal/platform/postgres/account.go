package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

func (s *Store) CurrentAccount(ctx context.Context, sessionToken string) (identity.AccountContext, error) {
	if len(sessionToken)<32 || len(sessionToken)>128 { return identity.AccountContext{},identity.ErrUnauthenticated }
	var account identity.AccountContext
	err:=s.pool.QueryRow(ctx,`SELECT u.id,u.display_name,COALESCE(u.email,'')
		FROM sessions s JOIN users u ON u.id=s.user_id
		WHERE s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL`,
		identity.HashToken(sessionToken)).Scan(&account.UserID,&account.DisplayName,&account.Email)
	if errors.Is(err,pgx.ErrNoRows) { return identity.AccountContext{},identity.ErrUnauthenticated }
	if err!=nil { return identity.AccountContext{},fmt.Errorf("load authenticated account: %w",err) }
	rows,err:=s.pool.Query(ctx,`SELECT o.id,COALESCE(o.slug,o.id),o.name,m.role
		FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id
		WHERE m.user_id=$1 AND m.status='active' AND o.status='active'
		ORDER BY o.name,o.id`,account.UserID)
	if err!=nil { return identity.AccountContext{},fmt.Errorf("list account organizations: %w",err) }
	defer rows.Close()
	account.Organizations=make([]identity.OrganizationSummary,0)
	for rows.Next() {
		var organization identity.OrganizationSummary
		if err:=rows.Scan(&organization.ID,&organization.Slug,&organization.Name,&organization.Role); err!=nil {
			return identity.AccountContext{},fmt.Errorf("scan account organization: %w",err)
		}
		account.Organizations=append(account.Organizations,organization)
	}
	if err:=rows.Err();err!=nil { return identity.AccountContext{},fmt.Errorf("iterate account organizations: %w",err) }
	if len(account.Organizations)==0 { return identity.AccountContext{},identity.ErrUnauthenticated }
	return account,nil
}

// GetUserProfile retrieves a user's profile information.
// Fields not yet in the database schema (bio, location, avatar_url, username) return empty values.
func (s *Store) GetUserProfile(ctx context.Context, userID string) (identity.UserProfile, error) {
	var profile identity.UserProfile
	err := s.pool.QueryRow(ctx, `
		SELECT id, display_name, COALESCE(email, ''), created_at, updated_at
		FROM users
		WHERE id = $1`,
		userID).Scan(&profile.UserID, &profile.DisplayName, &profile.Email, &profile.CreatedAt, &profile.UpdatedAt)

	if errors.Is(err, pgx.ErrNoRows) {
		return identity.UserProfile{}, fmt.Errorf("user not found: %s", userID)
	}
	if err != nil {
		return identity.UserProfile{}, fmt.Errorf("load user profile: %w", err)
	}

	// Set fields not yet in DB schema to empty values
	profile.Username = ""      // TODO: Add username column to users table
	profile.AvatarURL = nil    // TODO: Add avatar_url column to users table
	profile.Bio = ""           // TODO: Add bio column to users table
	profile.Location = ""      // TODO: Add location column to users table

	return profile, nil
}

// UpdateUserProfile updates a user's profile information.
// Currently only supports updating display_name. Other fields will be supported when DB schema is extended.
func (s *Store) UpdateUserProfile(ctx context.Context, userID string, displayName string) (identity.UserProfile, error) {
	var profile identity.UserProfile
	err := s.pool.QueryRow(ctx, `
		UPDATE users
		SET display_name = $2, updated_at = now()
		WHERE id = $1
		RETURNING id, display_name, COALESCE(email, ''), created_at, updated_at`,
		userID, displayName).Scan(&profile.UserID, &profile.DisplayName, &profile.Email, &profile.CreatedAt, &profile.UpdatedAt)

	if errors.Is(err, pgx.ErrNoRows) {
		return identity.UserProfile{}, fmt.Errorf("user not found: %s", userID)
	}
	if err != nil {
		return identity.UserProfile{}, fmt.Errorf("update user profile: %w", err)
	}

	// Set fields not yet in DB schema to empty values
	profile.Username = ""
	profile.AvatarURL = nil
	profile.Bio = ""
	profile.Location = ""

	return profile, nil
}
