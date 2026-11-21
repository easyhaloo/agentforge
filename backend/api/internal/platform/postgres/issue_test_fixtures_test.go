package postgres

import (
	"context"
	"testing"
)

// ensureIssueTestFixtures creates the tenant and users required by the issue
// tracking schema before repository integration tests exercise foreign keys.
func ensureIssueTestFixtures(t *testing.T, store *Store, organizationID string) {
	t.Helper()

	ctx := context.Background()
	_, err := store.pool.Exec(ctx, `
		INSERT INTO organizations (id, name)
		VALUES ($1, $1)
		ON CONFLICT (id) DO NOTHING
	`, organizationID)
	if err != nil {
		t.Fatalf("create issue test organization %q: %v", organizationID, err)
	}

	userIDs := []string{
		"admin-001",
		"user-001", "user-002", "user-003", "user-004", "user-005",
		"user-assignee-001", "user-creator", "user-duplicate",
		"user-emoji-test", "user-keep-1", "user-keep-2",
		"user-page", "user-remove",
	}
	for _, userID := range userIDs {
		_, err := store.pool.Exec(ctx, `
			INSERT INTO users (id, display_name)
			VALUES ($1, $1)
			ON CONFLICT (id) DO NOTHING
		`, userID)
		if err != nil {
			t.Fatalf("create issue test user %q: %v", userID, err)
		}
	}
}
