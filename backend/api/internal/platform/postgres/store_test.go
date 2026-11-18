package postgres

import (
	"context"
	"errors"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

func TestPostgresStorePersistsWithOrganizationIsolation(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	store, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	if err := store.Migrate(ctx); err != nil {
		t.Fatalf("second migration run must be idempotent: %v", err)
	}

	now := time.Now().UTC()
	suffix := strconv.FormatInt(now.UnixNano(), 10)
	organizationA := "integration-a-" + suffix
	organizationB := "integration-b-" + suffix
	for _, organizationID := range []string{organizationA, organizationB} {
		_, err := store.pool.Exec(ctx, "INSERT INTO organizations (id, name) VALUES ($1, $2)", organizationID, organizationID)
		if err != nil {
			t.Fatal(err)
		}
	}

	id := delivery.ID("integration-" + suffix)
	changeset, err := delivery.NewChangeset(id, "integration/repository", "Persistence test", "test-user", now)
	if err != nil {
		t.Fatal(err)
	}

	created, err := store.Create(ctx, organizationA, changeset)
	if err != nil {
		t.Fatal(err)
	}
	if created.Version != 1 {
		t.Fatalf("initial version = %d, want 1", created.Version)
	}

	loaded, err := store.Get(ctx, organizationA, id)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Changeset.ID != id || loaded.Changeset.Title != changeset.Title {
		t.Fatalf("persisted changeset mismatch: %#v", loaded.Changeset)
	}

	if _, err := store.Get(ctx, organizationB, id); !errors.Is(err, delivery.ErrNotFound) {
		t.Fatalf("cross-organization get error = %v, want ErrNotFound", err)
	}
	if _, err := store.Update(ctx, organizationB, changeset, loaded.Version); !errors.Is(err, delivery.ErrNotFound) {
		t.Fatalf("cross-organization update error = %v, want ErrNotFound", err)
	}
	otherItems, err := store.List(ctx, organizationB, 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(otherItems) != 0 {
		t.Fatalf("organization B received %d changesets, want 0", len(otherItems))
	}

	if err := changeset.AddRevision("rev-1", "commit-1", "test-user", now); err != nil {
		t.Fatal(err)
	}
	updated, err := store.Update(ctx, organizationA, changeset, loaded.Version)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Version != 2 {
		t.Fatalf("updated version = %d, want 2", updated.Version)
	}

	if _, err := store.Update(ctx, organizationA, changeset, loaded.Version); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale update error = %v, want ErrVersionConflict", err)
	}

	items, err := store.List(ctx, organizationA, 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range items {
		if item.Changeset.ID == id {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("created changeset %q was not returned by List", id)
	}

	var migrationCount int
	if err := store.pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&migrationCount); err != nil {
		t.Fatal(err)
	}
	if migrationCount != 7 {
		t.Fatalf("migration count = %d, want 7", migrationCount)
	}
}
