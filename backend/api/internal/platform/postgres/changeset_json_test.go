package postgres

import (
	"context"
	"encoding/json"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

// The OpenAPI contract declares these five changeset properties as required
// arrays, so null is never a valid value for any of them.
var changesetJSONFields = []string{"revisions", "evaluations", "evidence", "reviews", "audit"}

// newChangesetJSONStore opens the configured database and creates a scratch
// organization. The organization is deleted when the test ends; its changesets
// go with it (delivery_changesets.organization_id is ON DELETE CASCADE).
func newChangesetJSONStore(t *testing.T) (*Store, string) {
	t.Helper()
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
	t.Cleanup(store.Close)
	organizationID := "nulls-org-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	if _, err := store.pool.Exec(ctx, "INSERT INTO organizations (id, name) VALUES ($1, $1)", organizationID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cancelCleanup := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelCleanup()
		if _, err := store.pool.Exec(cleanupCtx, "DELETE FROM organizations WHERE id = $1", organizationID); err != nil {
			t.Errorf("delete scratch organization %s: %v", organizationID, err)
		}
	})
	return store, organizationID
}

// persistedChangesetState reads the JSONB state of one row with a raw SELECT,
// bypassing Store.Get and the domain type.
func persistedChangesetState(t *testing.T, store *Store, organizationID, id string) (map[string]any, string) {
	t.Helper()
	var raw []byte
	err := store.pool.QueryRow(context.Background(),
		"SELECT state FROM delivery_changesets WHERE organization_id = $1 AND id = $2", organizationID, id).Scan(&raw)
	if err != nil {
		t.Fatalf("select state of %s: %v", id, err)
	}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil {
		t.Fatalf("decode state of %s: %v: %s", id, err, raw)
	}
	return object, string(raw)
}

// requireChangesetJSONArrays fails for every contract-required field that is
// not a real JSON array (null and absent both fail) or that has the wrong
// number of elements. wantLengths follows the order of changesetJSONFields.
func requireChangesetJSONArrays(t *testing.T, step string, object map[string]any, raw string, wantLengths [5]int) {
	t.Helper()
	failed := false
	for i, field := range changesetJSONFields {
		value, present := object[field]
		if !present {
			t.Errorf("%s: %s: key is absent, want a JSON array", step, field)
			failed = true
			continue
		}
		array, ok := value.([]any)
		if !ok {
			t.Errorf("%s: %s: got %T(%v), want a JSON array", step, field, value, value)
			failed = true
			continue
		}
		if len(array) != wantLengths[i] {
			t.Errorf("%s: %s: got %d elements, want %d", step, field, len(array), wantLengths[i])
			failed = true
		}
	}
	if failed {
		t.Logf("%s: JSON was %s", step, raw)
	}
}

func marshalledChangesetObject(t *testing.T, changeset *delivery.Changeset) (map[string]any, string) {
	t.Helper()
	raw, err := json.Marshal(changeset)
	if err != nil {
		t.Fatal(err)
	}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil {
		t.Fatalf("decode %s: %v", raw, err)
	}
	return object, string(raw)
}

func TestStorePersistsEmptyArraysNotNull(t *testing.T) {
	store, organizationID := newChangesetJSONStore(t)
	ctx := context.Background()
	now := time.Now().UTC()

	changeset, err := delivery.NewChangeset("nulls-created", "team/repo", "Fresh", "author", now)
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(ctx, organizationID, changeset)
	if err != nil {
		t.Fatal(err)
	}
	// A new changeset has only its creation event in audit.
	state, raw := persistedChangesetState(t, store, organizationID, "nulls-created")
	requireChangesetJSONArrays(t, "state after Create", state, raw, [5]int{0, 0, 0, 0, 1})

	if err := changeset.AddRevision("rev-1", "feature", "author", now); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Update(ctx, organizationID, changeset, created.Version); err != nil {
		t.Fatal(err)
	}
	state, raw = persistedChangesetState(t, store, organizationID, "nulls-created")
	requireChangesetJSONArrays(t, "state after Update", state, raw, [5]int{1, 0, 0, 0, 2})
}

func TestStoreReturnsLegacyNullArraysAsEmptyArrays(t *testing.T) {
	store, organizationID := newChangesetJSONStore(t)
	ctx := context.Background()
	rows := []struct {
		id         string
		state      string
		wantAudits int
	}{
		// Exactly what the pre-fix code persisted for a changeset without revisions, evaluations, evidence or reviews.
		{"nulls-legacy-four", `{"id":"nulls-legacy-four","created_by":"author","repository":"team/repo","title":"Legacy","revisions":null,"evaluations":null,"evidence":null,"reviews":null,"audit":[{"sequence":1,"actor":"author","operation":"changeset.created","target_id":"nulls-legacy-four","outcome":"succeeded","at":"2026-11-17T10:00:00Z"}]}`, 1},
		{"nulls-legacy-all", `{"id":"nulls-legacy-all","created_by":"author","repository":"team/repo","title":"Legacy","revisions":null,"evaluations":null,"evidence":null,"reviews":null,"audit":null}`, 0},
	}
	wantAudits := map[delivery.ID]int{}
	for _, row := range rows {
		_, err := store.pool.Exec(ctx,
			"INSERT INTO delivery_changesets (organization_id, id, repository, title, state) VALUES ($1, $2, 'team/repo', 'Legacy', $3)",
			organizationID, row.id, []byte(row.state))
		if err != nil {
			t.Fatal(err)
		}
		// The fixture must really hold JSON null in the database, otherwise this test proves nothing.
		state, raw := persistedChangesetState(t, store, organizationID, row.id)
		for _, field := range changesetJSONFields[:4] {
			if value, present := state[field]; !present || value != nil {
				t.Fatalf("fixture %s is not a legacy row: %s=%v (present=%v): %s", row.id, field, value, present, raw)
			}
		}
		wantAudits[delivery.ID(row.id)] = row.wantAudits
	}

	for _, row := range rows {
		stored, err := store.Get(ctx, organizationID, delivery.ID(row.id))
		if err != nil {
			t.Fatal(err)
		}
		object, raw := marshalledChangesetObject(t, stored.Changeset)
		requireChangesetJSONArrays(t, "Get "+row.id, object, raw, [5]int{0, 0, 0, 0, row.wantAudits})
	}

	items, err := store.List(ctx, organizationID, 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != len(rows) {
		t.Fatalf("List returned %d changesets, want %d", len(items), len(rows))
	}
	for _, item := range items {
		want, known := wantAudits[item.Changeset.ID]
		if !known {
			t.Fatalf("List returned unexpected changeset %q", item.Changeset.ID)
		}
		object, raw := marshalledChangesetObject(t, item.Changeset)
		requireChangesetJSONArrays(t, "List "+string(item.Changeset.ID), object, raw, [5]int{0, 0, 0, 0, want})
	}
}
