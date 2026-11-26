package postgres

import (
	"context"
	"fmt"
	"strings"
)

// PlatformAdminMatch reports whether the session belongs to a user whose
// external identity (issuer, subject) appears in the configured
// PLATFORM_ADMIN_SUBJECTS allowlist (`issuer|subject` pairs). Platform
// administration never keys off organization roles.
func (s *Store) PlatformAdminMatch(ctx context.Context, sessionTokenHash string, subjects []string) (bool, error) {
	if len(subjects) == 0 || strings.TrimSpace(sessionTokenHash) == "" {
		return false, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT e.issuer, e.subject
		FROM sessions AS s
		JOIN external_identities AS e ON e.user_id = s.user_id
		WHERE s.token_hash = $1
		  AND s.expires_at > now()
		  AND s.revoked_at IS NULL
	`, sessionTokenHash)
	if err != nil {
		return false, fmt.Errorf("resolve platform admin session: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var issuer, subject string
		if err := rows.Scan(&issuer, &subject); err != nil {
			return false, fmt.Errorf("scan platform admin identity: %w", err)
		}
		for _, candidate := range subjects {
			parts := strings.SplitN(candidate, "|", 2)
			if len(parts) == 2 && parts[0] == issuer && parts[1] == subject {
				return true, nil
			}
		}
	}
	return false, rows.Err()
}
