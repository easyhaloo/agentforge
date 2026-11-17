package postgres

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

// ResolvePrincipal resolves the organization handle from a request path, which
// is either an organization id or slug, among the caller's own active
// memberships only. A handle that is unknown, or that belongs to an
// organization the caller cannot access, yields the same ErrUnauthenticated.
// Principal.OrganizationID is always the canonical id, never the slug. If one
// organization matches by id and another by slug, the id match wins.
func (s *Store) ResolvePrincipal(request *http.Request, organizationHandle string) (identity.Principal, error) {
	cookie, err := request.Cookie(identity.SessionCookieName)
	if err != nil || cookie.Value == "" || len(cookie.Value) > 128 || strings.TrimSpace(organizationHandle) == "" {
		return identity.Principal{}, identity.ErrUnauthenticated
	}

	var principal identity.Principal
	err = s.pool.QueryRow(request.Context(), `
		SELECT s.user_id, m.organization_id, m.role
		FROM sessions AS s
		JOIN organization_memberships AS m ON m.user_id = s.user_id
		JOIN organizations AS o ON o.id = m.organization_id
		WHERE s.token_hash = $1
		  AND s.expires_at > now()
		  AND s.revoked_at IS NULL
		  AND (m.organization_id = $2 OR o.slug = $3)
		  AND m.status = 'active'
		  AND o.status = 'active'
		ORDER BY (m.organization_id = $2) DESC
		LIMIT 1
	`, identity.HashToken(cookie.Value), organizationHandle, foldASCIICase(organizationHandle)).Scan(
		&principal.UserID, &principal.OrganizationID, &principal.Role,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.Principal{}, identity.ErrUnauthenticated
	}
	if err != nil {
		return identity.Principal{}, fmt.Errorf("resolve organization session: %w", err)
	}
	return principal, nil
}

func (s *Store) HasActiveMembership(ctx context.Context, userID string) (bool, error) {
	if strings.TrimSpace(userID) == "" {
		return false, errors.New("user ID is required")
	}
	var active bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM organization_memberships AS m
			JOIN organizations AS o ON o.id = m.organization_id
			WHERE m.user_id = $1 AND m.status = 'active' AND o.status = 'active'
		)
	`, userID).Scan(&active)
	if err != nil {
		return false, fmt.Errorf("check active organization membership: %w", err)
	}
	return active, nil
}

func (s *Store) CreateSession(ctx context.Context, userID, sessionToken, csrfToken string, expiresAt time.Time) (string, error) {
	if strings.TrimSpace(userID) == "" || len(sessionToken) < 32 || len(sessionToken) > 128 ||
		len(csrfToken) < 32 || len(csrfToken) > 128 || !expiresAt.After(time.Now()) {
		return "", errors.New("invalid session parameters")
	}
	id, err := newSessionID()
	if err != nil {
		return "", err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO sessions (id, token_hash, csrf_token_hash, user_id, expires_at)
		VALUES ($1, $2, $3, $4, $5)
	`, id, identity.HashToken(sessionToken), identity.HashToken(csrfToken), userID, expiresAt.UTC())
	if err != nil {
		return "", fmt.Errorf("create session: %w", err)
	}
	return id, nil
}

func (s *Store) ValidateCSRF(ctx context.Context, sessionToken, csrfToken string) error {
	if len(sessionToken) < 32 || len(sessionToken) > 128 || len(csrfToken) < 32 || len(csrfToken) > 128 {
		return identity.ErrUnauthenticated
	}
	var valid bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM sessions
			WHERE token_hash = $1
			  AND csrf_token_hash = $2
			  AND expires_at > now()
			  AND revoked_at IS NULL
		)
	`, identity.HashToken(sessionToken), identity.HashToken(csrfToken)).Scan(&valid)
	if err != nil {
		return fmt.Errorf("validate session CSRF token: %w", err)
	}
	if !valid {
		return identity.ErrUnauthenticated
	}
	return nil
}

func (s *Store) RevokeSession(ctx context.Context, sessionToken string) error {
	if len(sessionToken) < 32 || len(sessionToken) > 128 {
		return identity.ErrUnauthenticated
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE sessions SET revoked_at = now()
		WHERE token_hash = $1 AND revoked_at IS NULL
	`, identity.HashToken(sessionToken))
	if err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return identity.ErrUnauthenticated
	}
	return nil
}

// foldASCIICase lowercases only A-Z so slug matching does not depend on Unicode
// case rules or the database locale (stored slugs are lowercase ASCII).
func foldASCIICase(value string) string {
	return strings.Map(func(r rune) rune {
		if r >= 'A' && r <= 'Z' {
			return r + 'a' - 'A'
		}
		return r
	}, value)
}

func newSessionID() (string, error) {
	value := make([]byte, 16)
	_, err := rand.Read(value)
	if err != nil {
		return "", fmt.Errorf("generate session ID: %w", err)
	}
	return hex.EncodeToString(value), nil
}
