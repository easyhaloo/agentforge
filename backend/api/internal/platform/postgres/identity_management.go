package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

// ListUserIdentities returns all identities connected to a user account.
func (s *Store) ListUserIdentities(ctx context.Context, userID string) ([]identity.UserIdentityRecord, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("user ID is required")
	}

	rows, err := s.pool.Query(ctx, `
		SELECT ei.id, ei.user_id, ei.issuer, ei.subject,
		       COALESCE(u.email, ''), COALESCE(u.display_name, ''), ei.created_at
		FROM external_identities ei
		JOIN users u ON u.id = ei.user_id
		WHERE ei.user_id = $1
		ORDER BY ei.created_at ASC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list user identities: %w", err)
	}
	defer rows.Close()

	var identities []identity.UserIdentityRecord
	for rows.Next() {
		var record identity.UserIdentityRecord
		if err := rows.Scan(&record.ID, &record.UserID, &record.Issuer, &record.Subject,
			&record.Email, &record.DisplayName, &record.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan identity: %w", err)
		}
		identities = append(identities, record)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate identities: %w", err)
	}

	return identities, nil
}

// GetUserIdentityCount returns the number of identities a user has.
// Used to enforce the requirement that users must have at least one identity.
func (s *Store) GetUserIdentityCount(ctx context.Context, userID string) (int, error) {
	if strings.TrimSpace(userID) == "" {
		return 0, errors.New("user ID is required")
	}

	var count int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM external_identities WHERE user_id = $1
	`, userID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count user identities: %w", err)
	}

	return count, nil
}

// DeleteUserIdentity removes an identity from a user account.
// Returns ErrUnauthenticated if the identity doesn't exist or doesn't belong to the user.
func (s *Store) DeleteUserIdentity(ctx context.Context, userID, identityID string) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(identityID) == "" {
		return errors.New("user ID and identity ID are required")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin delete identity: %w", err)
	}
	defer tx.Rollback(ctx)

	// Verify the identity belongs to this user
	var issuer, subject string
	err = tx.QueryRow(ctx, `
		SELECT issuer, subject FROM external_identities
		WHERE id = $1 AND user_id = $2
	`, identityID, userID).Scan(&issuer, &subject)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.ErrUnauthenticated
	}
	if err != nil {
		return fmt.Errorf("verify identity ownership: %w", err)
	}

	// Delete the identity
	tag, err := tx.Exec(ctx, `
		DELETE FROM external_identities WHERE id = $1 AND user_id = $2
	`, identityID, userID)
	if err != nil {
		return fmt.Errorf("delete identity: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return identity.ErrUnauthenticated
	}

	// If this was a platform identity, also delete platform_credentials
	if issuer == "platform:internal" {
		_, err = tx.Exec(ctx, `
			DELETE FROM platform_credentials WHERE user_id = $1
		`, userID)
		if err != nil {
			return fmt.Errorf("delete platform credentials: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit delete identity: %w", err)
	}

	return nil
}

// ChangeUserPassword updates the password for a user's platform credentials.
// Verifies the current password before updating.
// Returns ErrUnauthenticated if the current password is incorrect.
func (s *Store) ChangeUserPassword(ctx context.Context, userID, currentPassword, newPassword string) error {
	if strings.TrimSpace(userID) == "" || currentPassword == "" || newPassword == "" {
		return errors.New("user ID and passwords are required")
	}

	// Get current password hash
	var currentHash string
	err := s.pool.QueryRow(ctx, `
		SELECT password_hash FROM platform_credentials WHERE user_id = $1
	`, userID).Scan(&currentHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("user has no platform credentials")
	}
	if err != nil {
		return fmt.Errorf("get current password: %w", err)
	}

	// Verify current password
	if err := identity.VerifyPassword(currentHash, currentPassword); err != nil {
		return err // Returns ErrUnauthenticated if password doesn't match
	}

	// Hash new password
	newHash, err := identity.HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("hash new password: %w", err)
	}

	// Update password
	tag, err := s.pool.Exec(ctx, `
		UPDATE platform_credentials
		SET password_hash = $1, updated_at = now()
		WHERE user_id = $2
	`, newHash, userID)
	if err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("user has no platform credentials")
	}

	return nil
}

// HasPlatformCredentials checks if a user has platform password credentials.
func (s *Store) HasPlatformCredentials(ctx context.Context, userID string) (bool, error) {
	if strings.TrimSpace(userID) == "" {
		return false, errors.New("user ID is required")
	}

	var exists bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM platform_credentials WHERE user_id = $1)
	`, userID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check platform credentials: %w", err)
	}

	return exists, nil
}
