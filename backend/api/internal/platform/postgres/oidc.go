package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateOIDCAuthTransaction(ctx context.Context, stateHash, nonceHash string, expiresAt time.Time) error {
	if len(stateHash) != 64 || len(nonceHash) != 64 || !expiresAt.After(time.Now()) {
		return errors.New("invalid OIDC authorization transaction")
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO oidc_auth_transactions (state_hash, nonce_hash, expires_at)
		VALUES ($1, $2, $3)
	`, stateHash, nonceHash, expiresAt.UTC())
	if err != nil {
		return fmt.Errorf("create OIDC authorization transaction: %w", err)
	}
	return nil
}

func (s *Store) ConsumeOIDCAuthTransaction(ctx context.Context, stateHash string) (string, error) {
	if len(stateHash) != 64 {
		return "", identity.ErrUnauthenticated
	}
	var nonceHash string
	err := s.pool.QueryRow(ctx, `
		UPDATE oidc_auth_transactions
		SET consumed_at = now()
		WHERE state_hash = $1 AND expires_at > now() AND consumed_at IS NULL
		RETURNING nonce_hash
	`, stateHash).Scan(&nonceHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", identity.ErrUnauthenticated
	}
	if err != nil {
		return "", fmt.Errorf("consume OIDC authorization transaction: %w", err)
	}
	return nonceHash, nil
}

func (s *Store) UpsertExternalIdentity(ctx context.Context, issuer, subject, email, displayName string) (string, error) {
	if strings.TrimSpace(issuer) == "" || strings.TrimSpace(subject) == "" ||
		len(issuer) > 2048 || len(subject) > 255 || len(email) > 320 || len(displayName) > 256 {
		return "", errors.New("invalid external identity profile")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin external identity upsert: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", issuer, subject); err != nil {
		return "", fmt.Errorf("lock external identity: %w", err)
	}

	var userID string
	err = tx.QueryRow(ctx, "SELECT user_id FROM external_identities WHERE issuer = $1 AND subject = $2", issuer, subject).Scan(&userID)
	if err == nil {
		_, err = tx.Exec(ctx, `
			UPDATE users
			SET display_name = COALESCE(NULLIF($2, ''), display_name),
			    email = COALESCE(NULLIF($3, ''), email),
			    updated_at = now()
			WHERE id = $1
		`, userID, displayName, email)
		if err != nil {
			return "", fmt.Errorf("update local user profile: %w", err)
		}
	} else if errors.Is(err, pgx.ErrNoRows) {
		userID, err = newSessionID()
		if err != nil {
			return "", err
		}
		identityID, idErr := newSessionID()
		if idErr != nil {
			return "", idErr
		}
		_, err = tx.Exec(ctx, "INSERT INTO users (id, display_name, email) VALUES ($1, $2, NULLIF($3, ''))", userID, displayName, email)
		if err != nil {
			return "", fmt.Errorf("create local user: %w", err)
		}
		_, err = tx.Exec(ctx, "INSERT INTO external_identities (id, user_id, issuer, subject) VALUES ($1, $2, $3, $4)", identityID, userID, issuer, subject)
		if err != nil {
			return "", fmt.Errorf("create external identity: %w", err)
		}
	} else {
		return "", fmt.Errorf("lookup external identity: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit external identity upsert: %w", err)
	}
	return userID, nil
}
