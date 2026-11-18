package postgres

import (
	"context"
	"errors"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
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
	otherItems, otherTotal, err := store.List(ctx, organizationB, delivery.ListFilter{}, 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(otherItems) != 0 || otherTotal != 0 {
		t.Fatalf("organization B received %d changesets (total %d), want 0", len(otherItems), otherTotal)
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

	items, _, err := store.List(ctx, organizationA, delivery.ListFilter{}, 100, 0)
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
	if migrationCount != 11 {
		t.Fatalf("migration count = %d, want 11", migrationCount)
	}
}

var listFilterLifecycles = []delivery.Lifecycle{
	delivery.LifecycleDraft, delivery.LifecycleEvaluationPending, delivery.LifecycleEvaluationFailed,
	delivery.LifecycleEvidenceRequired, delivery.LifecycleReviewRequired, delivery.LifecycleInReview,
	delivery.LifecycleChangesRequested, delivery.LifecycleReadyToMerge, delivery.LifecycleMerged,
}

func listFilterMust(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func listFilterOpenStore(t *testing.T) (context.Context, *Store) {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	store, err := Open(ctx, databaseURL)
	listFilterMust(t, err)
	t.Cleanup(store.Close)
	return ctx, store
}

// listFilterOrganization creates a uniquely named organization and removes it (cascading to its
// changesets) when the test ends, so repeated runs on a shared server leave nothing behind.
func listFilterOrganization(t *testing.T, ctx context.Context, store *Store, label string) string {
	t.Helper()
	id := "listfilter-" + label + "-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	_, err := store.pool.Exec(ctx, "INSERT INTO organizations (id, name) VALUES ($1, $1)", id)
	listFilterMust(t, err)
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := store.pool.Exec(cleanupCtx, "DELETE FROM organizations WHERE id = $1", id); err != nil {
			t.Errorf("remove test organization %s: %v", id, err)
		}
	})
	return id
}

type listFilterSeed struct {
	id                        delivery.ID
	repository, title, author string
	reviewer                  string
	stage                     delivery.Lifecycle
	updatedAt                 time.Time
}

// listFilterPersist stores a changeset advanced to seed.stage (draft, in_review or ready_to_merge)
// and pins its updated_at so list ordering is deterministic.
func listFilterPersist(t *testing.T, ctx context.Context, store *Store, organizationID string, seed listFilterSeed) {
	t.Helper()
	now := time.Now().UTC()
	changeset, err := delivery.NewChangeset(seed.id, seed.repository, seed.title, seed.author, now)
	listFilterMust(t, err)
	switch seed.stage {
	case delivery.LifecycleDraft:
	case delivery.LifecycleInReview, delivery.LifecycleReadyToMerge:
		listFilterMust(t, changeset.AddGitRevision("rev-1", "feature", "0123456789012345678901234567890123456789", "base", seed.author, now))
		listFilterMust(t, changeset.RecordEvaluation("eval-1", "rev-1", delivery.EvaluationPassed, "", "worker", now))
		listFilterMust(t, changeset.AttachEvidence("ev-1", "rev-1", "eval-1", "report", "artifact://sha256", "worker", now))
		listFilterMust(t, changeset.AssignReview("review-1", "rev-1", seed.reviewer, seed.author, "", now))
		if seed.stage == delivery.LifecycleReadyToMerge {
			listFilterMust(t, changeset.DecideReview("review-1", true, seed.reviewer, "", now))
		}
	default:
		t.Fatalf("listFilterPersist does not build %q", seed.stage)
	}
	if got := changeset.Lifecycle(); got != seed.stage {
		t.Fatalf("seed %s is %q, want %q", seed.id, got, seed.stage)
	}
	_, err = store.Create(ctx, organizationID, changeset)
	listFilterMust(t, err)
	_, err = store.pool.Exec(ctx, "UPDATE delivery_changesets SET updated_at = $3 WHERE organization_id = $1 AND id = $2", organizationID, string(seed.id), seed.updatedAt)
	listFilterMust(t, err)
}

func listFilterIDs(items []delivery.StoredChangeset) []delivery.ID {
	ids := make([]delivery.ID, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.Changeset.ID)
	}
	return ids
}

func TestPostgresStoreListFiltersWithinTheOrganization(t *testing.T) {
	ctx, store := listFilterOpenStore(t)
	orgA := listFilterOrganization(t, ctx, store, "a")
	orgB := listFilterOrganization(t, ctx, store, "b")
	base := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)

	// Newest first: a4, a2, a3, a1. Organization B holds the newest changeset and shares a repository slug
	// and an author with organization A, so any leak across organizations shows up in every list below.
	listFilterPersist(t, ctx, store, orgA, listFilterSeed{id: "a1", repository: "team/api", title: "Add login", author: "alice", reviewer: "rita", stage: delivery.LifecycleInReview, updatedAt: base.Add(1 * time.Minute)})
	listFilterPersist(t, ctx, store, orgA, listFilterSeed{id: "a2", repository: "team/api", title: "Fix cache", author: "bob", reviewer: "rita", stage: delivery.LifecycleReadyToMerge, updatedAt: base.Add(3 * time.Minute)})
	listFilterPersist(t, ctx, store, orgA, listFilterSeed{id: "a3", repository: "team/web", title: "Refactor table", author: "alice", stage: delivery.LifecycleDraft, updatedAt: base.Add(2 * time.Minute)})
	listFilterPersist(t, ctx, store, orgA, listFilterSeed{id: "a4", repository: "team/api-v2", title: "Prefix lookalike", author: "carol", stage: delivery.LifecycleDraft, updatedAt: base.Add(4 * time.Minute)})
	listFilterPersist(t, ctx, store, orgB, listFilterSeed{id: "b1", repository: "team/api", title: "Other tenant", author: "alice", reviewer: "rita", stage: delivery.LifecycleInReview, updatedAt: base.Add(5 * time.Minute)})

	cases := []struct {
		name          string
		organization  string
		filter        delivery.ListFilter
		limit, offset int
		want          []delivery.ID
		wantTotal     int
	}{
		{"organization A without filters", orgA, delivery.ListFilter{}, 100, 0, []delivery.ID{"a4", "a2", "a3", "a1"}, 4},
		{"organization B without filters", orgB, delivery.ListFilter{}, 100, 0, []delivery.ID{"b1"}, 1},
		{"repository is exact", orgA, delivery.ListFilter{Repository: "team/api"}, 100, 0, []delivery.ID{"a2", "a1"}, 2},
		{"repository prefix lookalike", orgA, delivery.ListFilter{Repository: "team/api-v2"}, 100, 0, []delivery.ID{"a4"}, 1},
		{"same repository in the other organization", orgB, delivery.ListFilter{Repository: "team/api"}, 100, 0, []delivery.ID{"b1"}, 1},
		{"repository without changesets", orgA, delivery.ListFilter{Repository: "team/none"}, 100, 0, nil, 0},
		{"repository and status", orgA, delivery.ListFilter{Repository: "team/api", Status: delivery.LifecycleInReview}, 100, 0, []delivery.ID{"a1"}, 1},
		{"my pending review queue", orgA, delivery.ListFilter{Reviewer: "rita", Status: delivery.LifecycleInReview}, 100, 0, []delivery.ID{"a1"}, 1},
		{"reviewer with any decision", orgA, delivery.ListFilter{Reviewer: "rita"}, 100, 0, []delivery.ID{"a2", "a1"}, 2},
		{"query matches created_by case-insensitively", orgA, delivery.ListFilter{Query: "ALICE"}, 100, 0, []delivery.ID{"a3", "a1"}, 2},
		{"query matches the title", orgA, delivery.ListFilter{Query: "cache"}, 100, 0, []delivery.ID{"a2"}, 1},
		{"all filters together", orgA, delivery.ListFilter{Repository: "team/api", Reviewer: "rita", Status: delivery.LifecycleReadyToMerge, Query: "fix"}, 100, 0, []delivery.ID{"a2"}, 1},
		{"second page", orgA, delivery.ListFilter{}, 2, 2, []delivery.ID{"a3", "a1"}, 4},
		{"page beyond the end keeps the total", orgA, delivery.ListFilter{}, 2, 8, nil, 4},
		{"total counts the filtered matches, not the page", orgA, delivery.ListFilter{Repository: "team/api"}, 1, 1, []delivery.ID{"a1"}, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			items, total, err := store.List(ctx, tc.organization, tc.filter, tc.limit, tc.offset)
			if err != nil {
				t.Fatal(err)
			}
			if got := listFilterIDs(items); total != tc.wantTotal || !slices.Equal(got, tc.want) {
				t.Fatalf("got %v total=%d, want %v total=%d", got, total, tc.want, tc.wantTotal)
			}
		})
	}

	for _, page := range [][2]int{{0, 0}, {101, 0}, {-1, 0}, {20, -1}} {
		if _, _, err := store.List(ctx, orgA, delivery.ListFilter{}, page[0], page[1]); !errors.Is(err, delivery.ErrInvalidInput) {
			t.Fatalf("List(limit=%d, offset=%d) error = %v, want ErrInvalidInput", page[0], page[1], err)
		}
	}
	if _, _, err := store.List(ctx, " ", delivery.ListFilter{}, 20, 0); !errors.Is(err, delivery.ErrInvalidInput) {
		t.Fatalf("List with a blank organization error = %v, want ErrInvalidInput", err)
	}
}

// TestPostgresStoreRoundTripsTheLifecycleStatus drives one changeset through the whole delivery
// lifecycle with real persistence (create, update, reload) and checks, after every step, that the
// reloaded changeset and the list filters agree on its status and on who is a current reviewer.
func TestPostgresStoreRoundTripsTheLifecycleStatus(t *testing.T) {
	ctx, store := listFilterOpenStore(t)
	org := listFilterOrganization(t, ctx, store, "roundtrip")
	now := time.Now().UTC()
	const sha = "0123456789012345678901234567890123456789"
	const id = delivery.ID("roundtrip-1")

	changeset, err := delivery.NewChangeset(id, "team/api", "Round trip", "author", now)
	listFilterMust(t, err)
	stored, err := store.Create(ctx, org, changeset)
	listFilterMust(t, err)
	version := stored.Version

	// step applies one transition (nil for none), persists it with the expected version, then verifies
	// the reloaded status, the list filter for every status, and which reviewers currently match.
	step := func(name string, apply func() error, want delivery.Lifecycle, reviewers ...string) {
		t.Helper()
		if apply != nil {
			if err := apply(); err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			updated, err := store.Update(ctx, org, changeset, version)
			if err != nil {
				t.Fatalf("%s: update: %v", name, err)
			}
			version = updated.Version
		}
		loaded, err := store.Get(ctx, org, id)
		if err != nil {
			t.Fatalf("%s: get: %v", name, err)
		}
		if got := loaded.Changeset.Lifecycle(); got != want {
			t.Fatalf("%s: reloaded status = %q, want %q", name, got, want)
		}
		for _, status := range listFilterLifecycles {
			_, total, err := store.List(ctx, org, delivery.ListFilter{Status: status}, 100, 0)
			if err != nil {
				t.Fatalf("%s: list %s: %v", name, status, err)
			}
			if listed := total == 1; listed != (status == want) {
				t.Fatalf("%s: status=%s filter matched=%v, want %v (status is %s)", name, status, listed, status == want, want)
			}
		}
		for _, reviewer := range []string{"reviewer-1", "reviewer-2"} {
			_, total, err := store.List(ctx, org, delivery.ListFilter{Reviewer: reviewer}, 100, 0)
			if err != nil {
				t.Fatalf("%s: list reviewer %s: %v", name, reviewer, err)
			}
			if listed := total == 1; listed != slices.Contains(reviewers, reviewer) {
				t.Fatalf("%s: reviewer=%s matched=%v, want %v", name, reviewer, listed, slices.Contains(reviewers, reviewer))
			}
		}
	}

	step("created", nil, delivery.LifecycleDraft)
	step("revision added", func() error { return changeset.AddGitRevision("rev-1", "feature", sha, "base", "author", now) }, delivery.LifecycleEvaluationPending)
	step("evaluation failed", func() error {
		return changeset.RecordEvaluation("eval-1", "rev-1", delivery.EvaluationFailed, "", "worker", now)
	}, delivery.LifecycleEvaluationFailed)
	step("evaluation passed", func() error {
		return changeset.RecordEvaluation("eval-2", "rev-1", delivery.EvaluationPassed, "", "worker", now)
	}, delivery.LifecycleEvidenceRequired)
	step("evidence attached", func() error {
		return changeset.AttachEvidence("ev-1", "rev-1", "eval-2", "report", "artifact://sha256", "worker", now)
	}, delivery.LifecycleReviewRequired)
	step("review assigned", func() error { return changeset.AssignReview("review-1", "rev-1", "reviewer-1", "author", "", now) }, delivery.LifecycleInReview, "reviewer-1")
	step("review rejected", func() error { return changeset.DecideReview("review-1", false, "reviewer-1", "", now) }, delivery.LifecycleChangesRequested, "reviewer-1")
	step("second review assigned", func() error { return changeset.AssignReview("review-2", "rev-1", "reviewer-2", "author", "", now) }, delivery.LifecycleInReview, "reviewer-1", "reviewer-2")
	step("review approved", func() error { return changeset.DecideReview("review-2", true, "reviewer-2", "", now) }, delivery.LifecycleReadyToMerge, "reviewer-1", "reviewer-2")

	// A new revision makes the evaluation, evidence and both reviews stale: nobody is a current reviewer.
	step("new revision", func() error { return changeset.AddGitRevision("rev-2", "feature", sha, "base", "author", now) }, delivery.LifecycleEvaluationPending)
	step("new revision evaluated", func() error {
		return changeset.RecordEvaluation("eval-3", "rev-2", delivery.EvaluationPassed, "", "worker", now)
	}, delivery.LifecycleEvidenceRequired)
	step("new revision evidence", func() error {
		return changeset.AttachEvidence("ev-2", "rev-2", "eval-3", "report", "artifact://sha256", "worker", now)
	}, delivery.LifecycleReviewRequired)
	step("new revision review assigned", func() error { return changeset.AssignReview("review-3", "rev-2", "reviewer-2", "author", "", now) }, delivery.LifecycleInReview, "reviewer-2")
	step("new revision approved", func() error { return changeset.DecideReview("review-3", true, "reviewer-2", "", now) }, delivery.LifecycleReadyToMerge, "reviewer-2")
	step("merged", func() error { return changeset.CompleteMerge("merge-1", "maintainer", "main", sha, now) }, delivery.LifecycleMerged, "reviewer-2")
}

// listFilterPoison inserts a row whose JSONB state is valid JSON but cannot be decoded into a
// delivery.Changeset, so any code path that decodes the row fails.
func listFilterPoison(t *testing.T, ctx context.Context, store *Store, organizationID, id, repository string, updatedAt time.Time) {
	t.Helper()
	_, err := store.pool.Exec(ctx, `
		INSERT INTO delivery_changesets (organization_id, id, repository, title, state, updated_at)
		VALUES ($1, $2, $3, 'poisoned', '{"revisions":"x"}', $4)`, organizationID, id, repository, updatedAt)
	listFilterMust(t, err)
}

// TestPostgresStoreListDecodesOnlyThePageWithoutStatusReviewerOrQuery proves with undecodable rows
// that a list narrowed by nothing, or by repository alone, is ordered and paged in SQL and decodes
// only the requested page, while every request that needs the Go filters has to decode every row.
func TestPostgresStoreListDecodesOnlyThePageWithoutStatusReviewerOrQuery(t *testing.T) {
	ctx, store := listFilterOpenStore(t)
	org := listFilterOrganization(t, ctx, store, "page")
	base := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)

	// The four readable changesets are the newest (v4, v3, v2, v1); the five undecodable rows are older.
	listFilterPersist(t, ctx, store, org, listFilterSeed{id: "v1", repository: "team/api", title: "One", author: "alice", stage: delivery.LifecycleDraft, updatedAt: base.Add(30 * time.Minute)})
	listFilterPersist(t, ctx, store, org, listFilterSeed{id: "v2", repository: "team/api", title: "Two", author: "alice", stage: delivery.LifecycleDraft, updatedAt: base.Add(40 * time.Minute)})
	listFilterPersist(t, ctx, store, org, listFilterSeed{id: "v3", repository: "team/web", title: "Three", author: "alice", stage: delivery.LifecycleDraft, updatedAt: base.Add(50 * time.Minute)})
	listFilterPersist(t, ctx, store, org, listFilterSeed{id: "v4", repository: "team/api", title: "Four", author: "alice", stage: delivery.LifecycleDraft, updatedAt: base.Add(60 * time.Minute)})
	for i, repository := range []string{"team/api", "team/web", "team/api", "team/web", "team/api"} {
		listFilterPoison(t, ctx, store, org, "p"+strconv.Itoa(i), repository, base.Add(time.Duration(i)*time.Minute))
	}

	readable := []struct {
		name          string
		filter        delivery.ListFilter
		limit, offset int
		want          []delivery.ID
		wantTotal     int
	}{
		{"first page", delivery.ListFilter{}, 3, 0, []delivery.ID{"v4", "v3", "v2"}, 9},
		{"page ending on the last readable row", delivery.ListFilter{}, 2, 2, []delivery.ID{"v2", "v1"}, 9},
		{"repository alone", delivery.ListFilter{Repository: "team/api"}, 3, 0, []delivery.ID{"v4", "v2", "v1"}, 6},
		{"a blank query is no filter", delivery.ListFilter{Query: "  "}, 3, 0, []delivery.ID{"v4", "v3", "v2"}, 9},
		{"repository with a blank query", delivery.ListFilter{Repository: "team/web", Query: " "}, 1, 0, []delivery.ID{"v3"}, 3},
		{"offset past the end", delivery.ListFilter{}, 3, 100, nil, 9},
	}
	for _, tc := range readable {
		t.Run(tc.name, func(t *testing.T) {
			items, total, err := store.List(ctx, org, tc.filter, tc.limit, tc.offset)
			if err != nil {
				t.Fatalf("List must decode only the requested page, got: %v", err)
			}
			if got := listFilterIDs(items); total != tc.wantTotal || !slices.Equal(got, tc.want) {
				t.Fatalf("got %v total=%d, want %v total=%d", got, total, tc.want, tc.wantTotal)
			}
		})
	}

	undecodable := []struct {
		name          string
		filter        delivery.ListFilter
		limit, offset int
	}{
		// The probe works: rows of the requested page are decoded, and a failure to decode is reported.
		{"a page that reaches the undecodable rows", delivery.ListFilter{}, 3, 3},
		// Control: each of these needs the Go filters, hence every row of the organization.
		{"status needs every row", delivery.ListFilter{Status: delivery.LifecycleDraft}, 3, 0},
		{"reviewer needs every row", delivery.ListFilter{Reviewer: "nobody"}, 3, 0},
		{"query needs every row", delivery.ListFilter{Query: "one"}, 3, 0},
		{"repository and status need every row of the repository", delivery.ListFilter{Repository: "team/api", Status: delivery.LifecycleDraft}, 3, 0},
	}
	for _, tc := range undecodable {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := store.List(ctx, org, tc.filter, tc.limit, tc.offset); err == nil || !strings.Contains(err.Error(), "decode listed changeset") {
				t.Fatalf("error = %v, want a decode failure on the undecodable rows", err)
			}
		})
	}
}

// TestPostgresStoreListSQLPathMatchesFilterAndPage checks that the SQL ordering, paging and count
// used when only the repository narrows the list give exactly what delivery.FilterAndPage gives
// over all rows: same items, same order, same total. The data has many equal updated_at values, ids
// that sort differently bytewise and under the database collation, offsets past the end, a
// repository filter and a second organization whose newer changesets must never show up.
func TestPostgresStoreListSQLPathMatchesFilterAndPage(t *testing.T) {
	ctx, store := listFilterOpenStore(t)
	rng := rand.New(rand.NewPCG(20261117, 1))
	base := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)
	repositories := []string{"team/api", "team/web", "team/Api", "team/api-v2"}
	alphabet := []rune("aAbBzZ09_-.é")

	// seed stores count changesets in a new organization: six distinct updated_at values (so many
	// ties) starting at offset, repositories of the list above and unique random ids.
	seed := func(label string, count int, offset time.Duration) (string, []delivery.StoredChangeset) {
		organization := listFilterOrganization(t, ctx, store, label)
		used := map[delivery.ID]bool{}
		var all []delivery.StoredChangeset
		for len(all) < count {
			runes := make([]rune, 1+rng.IntN(4))
			for i := range runes {
				runes[i] = alphabet[rng.IntN(len(alphabet))]
			}
			id := delivery.ID(runes)
			if used[id] {
				continue
			}
			used[id] = true
			listFilterPersist(t, ctx, store, organization, listFilterSeed{
				id: id, repository: repositories[rng.IntN(len(repositories))], title: "Random " + string(id), author: "alice",
				stage: delivery.LifecycleDraft, updatedAt: base.Add(offset + time.Duration(rng.IntN(6))*time.Minute),
			})
			stored, err := store.Get(ctx, organization, id)
			listFilterMust(t, err)
			all = append(all, stored)
		}
		return organization, all
	}
	orgA, rowsA := seed("equiv-a", 60, 0)
	orgB, rowsB := seed("equiv-b", 25, time.Hour) // newer than every row of organization A

	filters := []delivery.ListFilter{
		{},
		{Repository: "team/api"}, {Repository: "team/web"}, {Repository: "team/Api"}, {Repository: "team/api-v2"}, {Repository: "team/none"},
		{Query: "  "}, {Repository: "team/web", Query: "\t "},
	}
	for _, organization := range []struct {
		id   string
		rows []delivery.StoredChangeset
	}{{orgA, rowsA}, {orgB, rowsB}} {
		n := len(organization.rows)
		for _, filter := range filters {
			for _, limit := range []int{1, 5, 17, 100} {
				for _, offset := range []int{0, 1, 7, n - 1, n, n + 25} {
					want, wantTotal := delivery.FilterAndPage(organization.rows, filter, limit, offset)
					got, gotTotal, err := store.List(ctx, organization.id, filter, limit, offset)
					if err != nil {
						t.Fatalf("%s %+v limit=%d offset=%d: %v", organization.id, filter, limit, offset, err)
					}
					same := gotTotal == wantTotal && len(got) == len(want)
					for i := 0; same && i < len(got); i++ {
						same = got[i].Changeset.ID == want[i].Changeset.ID && got[i].Version == want[i].Version &&
							got[i].CreatedAt.Equal(want[i].CreatedAt) && got[i].UpdatedAt.Equal(want[i].UpdatedAt)
					}
					if !same {
						t.Fatalf("%s %+v limit=%d offset=%d:\n got %v total=%d\nwant %v total=%d", organization.id, filter, limit, offset,
							listFilterIDs(got), gotTotal, listFilterIDs(want), wantTotal)
					}
				}
			}
		}
	}
}

// listFilterMemberIdentity resolves every request to a member of the requested organization.
type listFilterMemberIdentity struct{}

func (listFilterMemberIdentity) ResolvePrincipal(_ *http.Request, organizationID string) (httpserver.Principal, error) {
	return httpserver.Principal{UserID: "listfilter-user", OrganizationID: organizationID, Role: "member"}, nil
}

// TestPostgresBackedListRefusesMalformedTextWithA400 drives the real handler over the real store:
// PostgreSQL cannot store NUL or invalid UTF-8 in text (SQLSTATE 22021), so a repository filter
// such as ?repository=%00 used to surface as a 500. Malformed text must be a 400 and a well-formed
// request must still be served.
func TestPostgresBackedListRefusesMalformedTextWithA400(t *testing.T) {
	ctx, store := listFilterOpenStore(t)
	org := listFilterOrganization(t, ctx, store, "malformed")
	listFilterPersist(t, ctx, store, org, listFilterSeed{id: "m1", repository: "team/api", title: "Readable", author: "alice", stage: delivery.LifecycleDraft, updatedAt: time.Now().UTC()})
	handler := httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{Repository: store, Identity: listFilterMemberIdentity{}})
	get := func(path string) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		return response
	}
	base := "/api/v1/organizations/" + org + "/changesets"

	for _, target := range []string{
		base + "?repository=%00", base + "?repository=a%00b", base + "?repository=%ff", base + "?repository=%e5%8f",
		base + "?q=%00", base + "?reviewer=%ff", base + "?status=%00",
		base + "/%00", base + "/%ff",
		"/api/v1/organizations/%00/changesets",
	} {
		if response := get(target); response.Code != http.StatusBadRequest || response.Header().Get("Content-Type") != "application/problem+json" {
			t.Errorf("GET %s: status=%d content-type=%q body=%s, want a 400 problem", target, response.Code, response.Header().Get("Content-Type"), response.Body.String())
		}
	}
	if response := get(base + "?repository=team%2Fapi&q=%E5%8F%98"); response.Code != http.StatusOK {
		t.Fatalf("well-formed list: status=%d body=%s, want 200", response.Code, response.Body.String())
	}
	if response := get(base + "/m1"); response.Code != http.StatusOK {
		t.Fatalf("well-formed get: status=%d body=%s, want 200", response.Code, response.Body.String())
	}
}
