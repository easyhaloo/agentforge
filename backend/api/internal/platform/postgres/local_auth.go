package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

// FindUserByEmail looks up a user by email for local password authentication.
// Returns ErrUnauthenticated if the user is not found or has no password credentials.
// Uses the new platform_credentials table for unified identity management.
func (s *Store) FindUserByEmail(ctx context.Context, email string) (*identity.LocalUser, error) {
	email = strings.TrimSpace(email)
	if email == "" {
		return nil, identity.ErrUnauthenticated
	}

	var user identity.LocalUser
	err := s.pool.QueryRow(ctx, `
		SELECT u.id, u.email, pc.password_hash, u.display_name
		FROM users u
		JOIN platform_credentials pc ON pc.user_id = u.id
		WHERE u.email = $1
	`, email).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.DisplayName)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, identity.ErrUnauthenticated
	}
	if err != nil {
		return nil, fmt.Errorf("find user by email: %w", err)
	}

	return &user, nil
}

// EmailExists checks if an email is already registered in the system.
func (s *Store) EmailExists(ctx context.Context, email string) (bool, error) {
	email = strings.TrimSpace(email)
	if email == "" {
		return false, errors.New("email is required")
	}

	var exists bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)
	`, email).Scan(&exists)

	if err != nil {
		return false, fmt.Errorf("check email exists: %w", err)
	}

	return exists, nil
}

// CreateLocalUser creates a new local user with platform credentials.
// Returns an error if the email already exists.
// This is different from CreateOrUpdateLocalUser which updates existing users.
func (s *Store) CreateLocalUser(ctx context.Context, email, passwordHash, displayName string) (string, error) {
	email = strings.TrimSpace(email)
	displayName = strings.TrimSpace(displayName)

	if email == "" || passwordHash == "" || displayName == "" {
		return "", errors.New("email, password hash, and display name are required")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin user creation: %w", err)
	}
	defer tx.Rollback(ctx)

	// Check if user already exists
	var existingUserID string
	err = tx.QueryRow(ctx, "SELECT id FROM users WHERE email = $1", email).Scan(&existingUserID)
	if err == nil {
		return "", fmt.Errorf("user with email %q already exists", email)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("check existing user: %w", err)
	}

	// Generate new user ID
	userID, err := newSessionID()
	if err != nil {
		return "", fmt.Errorf("generate user ID: %w", err)
	}

	// Create new user
	_, err = tx.Exec(ctx, `
		INSERT INTO users (id, email, display_name, created_at, updated_at)
		VALUES ($1, $2, $3, now(), now())
	`, userID, email, displayName)
	if err != nil {
		return "", fmt.Errorf("create user: %w", err)
	}

	// Create platform credentials
	_, err = tx.Exec(ctx, `
		INSERT INTO platform_credentials (user_id, password_hash, created_at, updated_at)
		VALUES ($1, $2, now(), now())
	`, userID, passwordHash)
	if err != nil {
		return "", fmt.Errorf("create platform credentials: %w", err)
	}

	// Create external_identities entry with issuer='platform:internal'
	identityID, err := newSessionID()
	if err != nil {
		return "", fmt.Errorf("generate identity ID: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO external_identities (id, user_id, issuer, subject, created_at)
		VALUES ($1, $2, 'platform:internal', $3, now())
	`, identityID, userID, userID)
	if err != nil {
		return "", fmt.Errorf("create platform identity: %w", err)
	}

	// Create a default organization for the new user
	organizationID, err := newSessionID()
	if err != nil {
		return "", fmt.Errorf("generate organization ID: %w", err)
	}
	organizationName := displayName + "'s Workspace"
	_, err = tx.Exec(ctx, `
		INSERT INTO organizations (id, name, created_at)
		VALUES ($1, $2, now())
	`, organizationID, organizationName)
	if err != nil {
		return "", fmt.Errorf("create default organization: %w", err)
	}

	// Add user as owner of the organization
	_, err = tx.Exec(ctx, `
		INSERT INTO organization_memberships (organization_id, user_id, role, status, created_at)
		VALUES ($1, $2, 'owner', 'active', now())
	`, organizationID, userID)
	if err != nil {
		return "", fmt.Errorf("create organization membership: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit user creation: %w", err)
	}

	return userID, nil
}
