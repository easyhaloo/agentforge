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

func TestPostgresStorePersistsAndRejectsStaleWrites(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	store, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	now := time.Now().UTC()
	id := delivery.ID("integration-" + strconv.FormatInt(now.UnixNano(), 10))
	changeset, err := delivery.NewChangeset(id, "integration/repository", "Persistence test", "test", now)
	if err != nil {
		t.Fatal(err)
	}

	created, err := store.Create(ctx, changeset)
	if err != nil {
		t.Fatal(err)
	}
	if created.Version != 1 {
		t.Fatalf("initial version = %d, want 1", created.Version)
	}

	loaded, err := store.Get(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Changeset.ID != id || loaded.Changeset.Title != changeset.Title {
		t.Fatalf("persisted changeset mismatch: %#v", loaded.Changeset)
	}

	if err := changeset.AddRevision("rev-1", "commit-1", "test", now); err != nil {
		t.Fatal(err)
	}
	updated, err := store.Update(ctx, changeset, loaded.Version)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Version != 2 {
		t.Fatalf("updated version = %d, want 2", updated.Version)
	}

	if _, err := store.Update(ctx, changeset, loaded.Version); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale update error = %v, want ErrVersionConflict", err)
	}

	items, err := store.List(ctx, 100, 0)
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
}
