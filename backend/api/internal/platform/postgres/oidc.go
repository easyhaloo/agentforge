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

var ErrOwnerAlreadyExists = errors.New("organization already has an owner")
var ErrOrganizationInactive = errors.New("organization is not active")

func (s *Store) UpsertExternalIdentity(ctx context.Context, issuer, subject, email, displayName string) (string, error) {
	if err := validateExternalIdentity(issuer, subject, email, displayName); err != nil {
		return "", err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin external identity upsert: %w", err)
	}
	defer tx.Rollback(ctx)

	userID, err := upsertExternalIdentityTx(ctx, tx, issuer, subject, email, displayName)
	if err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit external identity upsert: %w", err)
	}
	return userID, nil
}

func (s *Store) BootstrapFirstOwner(ctx context.Context, issuer, subject, organizationID, organizationName string) (string, error) {
	if err := validateExternalIdentity(issuer, subject, "", ""); err != nil {
		return "", err
	}
	organizationID = strings.TrimSpace(organizationID)
	organizationName = strings.TrimSpace(organizationName)
	if organizationID == "" || organizationName == "" || len(organizationID) > 128 || len(organizationName) > 256 {
		return "", errors.New("organization ID and name are required and must be within supported lengths")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin first-owner bootstrap: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", organizationID); err != nil {
		return "", fmt.Errorf("lock organization bootstrap: %w", err)
	}
	if _, err := tx.Exec(ctx, "INSERT INTO organizations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", organizationID, organizationName); err != nil {
		return "", fmt.Errorf("create bootstrap organization: %w", err)
	}
	var organizationStatus string
	if err := tx.QueryRow(ctx, "SELECT status FROM organizations WHERE id = $1", organizationID).Scan(&organizationStatus); err != nil {
		return "", fmt.Errorf("load bootstrap organization: %w", err)
	}
	if organizationStatus != "active" {
		return "", ErrOrganizationInactive
	}

	var ownerExists bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND role = 'owner')", organizationID).Scan(&ownerExists); err != nil {
		return "", fmt.Errorf("check existing organization owner: %w", err)
	}
	if ownerExists {
		return "", ErrOwnerAlreadyExists
	}

	userID, err := upsertExternalIdentityTx(ctx, tx, issuer, subject, "", "")
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO organization_memberships (organization_id, user_id, role, status)
		VALUES ($1, $2, 'owner', 'active')
		ON CONFLICT (organization_id, user_id)
		DO UPDATE SET role = 'owner', status = 'active', updated_at = now()
	`, organizationID, userID); err != nil {
		return "", fmt.Errorf("assign first organization owner: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit first-owner bootstrap: %w", err)
	}
	return userID, nil
}

func validateExternalIdentity(issuer, subject, email, displayName string) error {
	if strings.TrimSpace(issuer) == "" || strings.TrimSpace(subject) == "" ||
		len(issuer) > 2048 || len(subject) > 255 || len(email) > 320 || len(displayName) > 256 {
		return errors.New("invalid external identity profile")
	}
	return nil
}

func upsertExternalIdentityTx(ctx context.Context, tx pgx.Tx, issuer, subject, email, displayName string) (string, error) {
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", issuer, subject); err != nil {
		return "", fmt.Errorf("lock external identity: %w", err)
	}

	var userID string
	err := tx.QueryRow(ctx, "SELECT user_id FROM external_identities WHERE issuer = $1 AND subject = $2", issuer, subject).Scan(&userID)
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
		return userID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("lookup external identity: %w", err)
	}

	userID, err = newSessionID()
	if err != nil {
		return "", err
	}
	identityID, err := newSessionID()
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, "INSERT INTO users (id, display_name, email) VALUES ($1, $2, NULLIF($3, ''))", userID, displayName, email); err != nil {
		return "", fmt.Errorf("create local user: %w", err)
	}
	if _, err := tx.Exec(ctx, "INSERT INTO external_identities (id, user_id, issuer, subject) VALUES ($1, $2, $3, $4)", identityID, userID, issuer, subject); err != nil {
		return "", fmt.Errorf("create external identity: %w", err)
	}
	return userID, nil
}
