package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

// ListSessions retrieves all active sessions for a user.
func (s *Store) ListSessions(ctx context.Context, userID, currentSessionToken string) ([]identity.SessionInfo, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("user ID is required")
	}

	rows, err := s.pool.Query(ctx, `
		SELECT left(token_hash, 16), user_id, created_at, token_hash = $2,
		       COALESCE(user_agent, '') as user_agent,
		       COALESCE(ip_address, '') as ip_address
		FROM sessions
		WHERE user_id = $1 AND expires_at > now() AND revoked_at IS NULL
		ORDER BY created_at DESC
	`, userID, identity.HashToken(currentSessionToken))
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	sessions := []identity.SessionInfo{}
	for rows.Next() {
		var userAgent string
		var session identity.SessionInfo

		if err := rows.Scan(&session.SessionID, &session.UserID, &session.CreatedAt, &session.IsCurrent, &userAgent, &session.IPAddress); err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}

		session.LastActiveAt = session.CreatedAt // TODO: Track last activity separately if needed

		// Parse user agent to extract browser, OS, and device type
		session.Browser, session.OS, session.DeviceType = parseUserAgent(userAgent)

		sessions = append(sessions, session)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sessions: %w", err)
	}

	return sessions, nil
}

// RevokeSessionByID revokes a specific session by its exact public handle.
func (s *Store) RevokeSessionByID(ctx context.Context, userID, sessionID string) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(sessionID) == "" {
		return errors.New("user ID and session ID are required")
	}

	tag, err := s.pool.Exec(ctx, `
		UPDATE sessions
		SET revoked_at = now()
		WHERE user_id = $1
		  AND left(token_hash, 16) = $2
		  AND revoked_at IS NULL
		  AND expires_at > now()
	`, userID, sessionID)

	if err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}

	if tag.RowsAffected() == 0 {
		return errors.New("session not found or already revoked")
	}

	return nil
}

// RevokeAllOtherSessions revokes all sessions except the current one.
func (s *Store) RevokeAllOtherSessions(ctx context.Context, userID, currentSessionToken string) (int, error) {
	if strings.TrimSpace(userID) == "" || currentSessionToken == "" {
		return 0, errors.New("user ID and current session are required")
	}

	tag, err := s.pool.Exec(ctx, `
		UPDATE sessions
		SET revoked_at = now()
		WHERE user_id = $1
		  AND token_hash != $2
		  AND revoked_at IS NULL
		  AND expires_at > now()
	`, userID, identity.HashToken(currentSessionToken))

	if err != nil {
		return 0, fmt.Errorf("revoke other sessions: %w", err)
	}

	return int(tag.RowsAffected()), nil
}

// parseUserAgent extracts browser, OS, and device type from a User-Agent string.
// This is a simplified parser - consider using a library like ua-parser for production.
func parseUserAgent(userAgent string) (browser, os, deviceType string) {
	ua := strings.ToLower(userAgent)

	// Detect browser
	switch {
	case strings.Contains(ua, "chrome"):
		browser = "Chrome"
	case strings.Contains(ua, "firefox"):
		browser = "Firefox"
	case strings.Contains(ua, "safari"):
		browser = "Safari"
	case strings.Contains(ua, "edge"):
		browser = "Edge"
	case strings.Contains(ua, "opera"):
		browser = "Opera"
	default:
		browser = "Unknown"
	}

	// Detect OS
	switch {
	case strings.Contains(ua, "windows"):
		os = "Windows"
	case strings.Contains(ua, "mac os x") || strings.Contains(ua, "macos"):
		os = "macOS"
	case strings.Contains(ua, "linux"):
		os = "Linux"
	case strings.Contains(ua, "android"):
		os = "Android"
	case strings.Contains(ua, "ios") || strings.Contains(ua, "iphone") || strings.Contains(ua, "ipad"):
		os = "iOS"
	default:
		os = "Unknown"
	}

	// Detect device type
	switch {
	case strings.Contains(ua, "mobile") || strings.Contains(ua, "android") || strings.Contains(ua, "iphone"):
		deviceType = "mobile"
	case strings.Contains(ua, "tablet") || strings.Contains(ua, "ipad"):
		deviceType = "tablet"
	default:
		deviceType = "desktop"
	}

	return browser, os, deviceType
}

// GetAuthenticationInfo retrieves authentication details for a user.
func (s *Store) GetAuthenticationInfo(ctx context.Context, userID string) (identity.AuthenticationInfo, error) {
	if strings.TrimSpace(userID) == "" {
		return identity.AuthenticationInfo{}, errors.New("user ID is required")
	}

	var info identity.AuthenticationInfo

	// Get primary identity and email
	var issuer string
	err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(u.email, ''), COALESCE(ei.issuer, '')
		FROM users u
		LEFT JOIN external_identities ei ON ei.user_id = u.id
		WHERE u.id = $1
		ORDER BY ei.created_at ASC
		LIMIT 1
	`, userID).Scan(&info.LoginEmail, &issuer)

	if errors.Is(err, pgx.ErrNoRows) {
		return identity.AuthenticationInfo{}, errors.New("user not found")
	}
	if err != nil {
		return identity.AuthenticationInfo{}, fmt.Errorf("get authentication info: %w", err)
	}

	// Determine OIDC provider
	if issuer == "platform:internal" {
		info.OIDCProvider = "platform:internal"
		info.OIDCProviderURL = ""
	} else {
		info.OIDCProvider = issuer
		info.OIDCProviderURL = issuer
	}

	// Get last login time from sessions
	err = s.pool.QueryRow(ctx, `
		SELECT created_at
		FROM sessions
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`, userID).Scan(&info.LastLoginAt)

	if errors.Is(err, pgx.ErrNoRows) {
		// No sessions yet, that's okay
		info.LastLoginAt = nil
	} else if err != nil {
		return identity.AuthenticationInfo{}, fmt.Errorf("get last login: %w", err)
	}

	return info, nil
}
