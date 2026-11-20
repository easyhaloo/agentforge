package postgres

import (
	"context"
	"os"
	"testing"
)

func TestMigration022IssuesAndComments(t *testing.T) {
	// RED: This test verifies that migration 022 can be applied successfully
	// and creates all required tables for Issue tracking and Comments
	// Expected to FAIL because migration 022 doesn't exist yet

	ctx := context.Background()

	// Get test database URL or skip
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL not set, skipping integration test")
	}

	// Open store (which applies migrations)
	store, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("failed to open store: %v", err)
	}
	defer store.Close()

	// Verify tables exist (migration 022 should create these)
	tables := []string{
		"resource_number_counters",
		"issues",
		"labels",
		"milestones",
		"issue_labels",
		"issue_assignees",
		"issue_changeset_links",
		"comments",
		"reactions",
		"issue_events",
		"changeset_events",
	}

	for _, table := range tables {
		var exists bool
		err := store.pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT FROM information_schema.tables
				WHERE table_schema = 'public'
				AND table_name = $1
			)
		`, table).Scan(&exists)

		if err != nil {
			t.Fatalf("failed to check table %s: %v", table, err)
		}

		if !exists {
			t.Errorf("expected table %s to exist after migration 022", table)
		}
	}
}
