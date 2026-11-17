package postgres

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// slugMigrationFile is the migration that introduces organizations.slug.
const slugMigrationFile = "007_organization_slug.sql"

type slugSeed struct {
	id, name string
	// createdSeconds orders the backfill: oldest first, then by id.
	createdSeconds int
	want           string
	// noCollision marks rows whose slug must equal identity.Slugify(name).
	noCollision bool
}

func slugSeeds() []slugSeed {
	long := strings.Repeat("a", 60)
	return []slugSeed{
		{"acme-1", "Acme Inc", 1, "acme-inc", true},
		{"acme-2", "acme inc", 2, "acme-inc-2", false},
		{"acme-3", "Acme-Inc!!", 3, "acme-inc-3", false},
		{"blank-1", "!!!", 4, "org", true},
		{"blank-2", "日本語", 5, "org-2", false},
		{"long-1", long, 6, strings.Repeat("a", 39), true},
		// The suffix must still fit in 39 characters.
		{"long-2", long, 7, strings.Repeat("a", 37) + "-2", false},
		// Truncating to 39 characters leaves a trailing hyphen that must be trimmed.
		{"trim-1", strings.Repeat("a", 38) + " b", 8, strings.Repeat("a", 38), true},
		// The reserved word counts as already taken.
		{"cur-1", "Current", 9, "current-2", false},
		{"cur-2", "current!!", 10, "current-3", false},
		// A slug must not equal a different organization's id ...
		{"zeta", "Beta Corp", 11, "beta-corp-2", false},
		{"beta-corp", "Something Else", 12, "something-else", true},
		{"w1", "Gamma", 13, "gamma-2", false},
		// ... but it may equal the organization's own id.
		{"gamma", "Gamma", 14, "gamma", true},
		{"uni-1", "Ünïcode Café 日本", 15, "n-code-caf", true},
		// Equal created_at falls back to id order, whatever the insertion order.
		{"tie-b", "Tie Name", 16, "tie-name-2", false},
		{"tie-a", "Tie Name", 16, "tie-name", true},
		// created_at decides before id: order-z is older than order-a.
		{"order-z", "Order Check", 17, "order-check", true},
		{"order-a", "Order Check", 18, "order-check-2", false},
		// The id tie-break is byte order, not the database collation: under
		// en_US "casea" sorts before "CaseB", under "C" (and here) it does not.
		{"CaseB", "Case Name", 19, "case-name", true},
		{"casea", "Case Name", 19, "case-name-2", false},
		// Only ASCII letters survive: U+0130 and U+212A lowercase to "i" and "k" in
		// Unicode-aware database locales, but must stay separators, as in Slugify.
		{"uni-2", "\u0130stanbul \u212Aelvin", 20, "stanbul-elvin", true},
	}
}

func slugOpenStore(t *testing.T) (context.Context, *Store) {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	store, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Close)
	return ctx, store
}

// slugInsertOrganization inserts an organization; an empty slug stores NULL.
func slugInsertOrganization(t *testing.T, ctx context.Context, store *Store, id, slug, status string) {
	t.Helper()
	if _, err := store.pool.Exec(ctx, "INSERT INTO organizations (id, name, slug, status) VALUES ($1, $1, NULLIF($2, ''), $3)", id, slug, status); err != nil {
		t.Fatalf("insert organization %q: %v", id, err)
	}
}

func slugInsertMember(t *testing.T, ctx context.Context, store *Store, organizationID, userID, role, status string) {
	t.Helper()
	if _, err := store.pool.Exec(ctx, "INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, $3, $4)", organizationID, userID, role, status); err != nil {
		t.Fatalf("insert membership %q/%q: %v", organizationID, userID, err)
	}
}

func slugInsertUser(t *testing.T, ctx context.Context, store *Store, userID string) {
	t.Helper()
	if _, err := store.pool.Exec(ctx, "INSERT INTO users (id, display_name) VALUES ($1, $1)", userID); err != nil {
		t.Fatalf("insert user %q: %v", userID, err)
	}
}

// slugNewSession creates a session for userID and returns a request carrying its cookie plus the raw token.
func slugNewSession(t *testing.T, ctx context.Context, store *Store, userID string) (*http.Request, string) {
	t.Helper()
	credentials, err := identity.GenerateCredentials()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateSession(ctx, userID, credentials.SessionToken, credentials.CSRFToken, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.AddCookie(&http.Cookie{Name: identity.SessionCookieName, Value: credentials.SessionToken})
	return request, credentials.SessionToken
}

func slugScratchDatabase(t *testing.T, databaseURL string, sequence int) string {
	t.Helper()
	name := fmt.Sprintf("agentforge_slug_%d_%d", time.Now().UnixNano(), sequence)
	identifier := pgx.Identifier{name}.Sanitize()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	admin, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close(ctx)
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+identifier); err != nil {
		t.Fatalf("create scratch database: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		admin, err := pgx.Connect(ctx, databaseURL)
		if err != nil {
			t.Errorf("connect to drop scratch database %s: %v", name, err)
			return
		}
		defer admin.Close(ctx)
		if _, err := admin.Exec(ctx, "DROP DATABASE IF EXISTS "+identifier+" WITH (FORCE)"); err != nil {
			t.Errorf("drop scratch database %s: %v", name, err)
		}
	})
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	parsed.Path = "/" + name
	return parsed.String()
}

// slugApplyMigrationsBefore applies and records every embedded migration that
// sorts before stopAt, reproducing a production database that has not yet
// received the slug migration.
func slugApplyMigrationsBefore(ctx context.Context, conn *pgx.Conn, stopAt string) error {
	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`); err != nil {
		return err
	}
	entries, err := fs.ReadDir(migrations, "migrations")
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		if entry.Name() >= stopAt {
			break
		}
		migration, err := migrations.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return err
		}
		if _, err := conn.Exec(ctx, string(migration)); err != nil {
			return fmt.Errorf("apply %s: %w", entry.Name(), err)
		}
		if _, err := conn.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ($1)", entry.Name()); err != nil {
			return err
		}
	}
	return nil
}

// slugUpgrade seeds a scratch database that is one migration behind, inserting
// the organizations in the given order, then lets Store.Open apply the slug
// migration exactly as a deployment would.
func slugUpgrade(t *testing.T, ctx context.Context, databaseURL string, sequence int, seeds []slugSeed) *Store {
	t.Helper()
	scratchURL := slugScratchDatabase(t, databaseURL, sequence)
	conn, err := pgx.Connect(ctx, scratchURL)
	if err != nil {
		t.Fatal(err)
	}
	if err := slugApplyMigrationsBefore(ctx, conn, slugMigrationFile); err != nil {
		t.Fatal(err)
	}
	epoch := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, seed := range seeds {
		if _, err := conn.Exec(ctx, "INSERT INTO organizations (id, name, created_at) VALUES ($1, $2, $3)",
			seed.id, seed.name, epoch.Add(time.Duration(seed.createdSeconds)*time.Second)); err != nil {
			t.Fatalf("seed organization %q: %v", seed.id, err)
		}
	}
	conn.Close(ctx)

	store, err := Open(ctx, scratchURL)
	if err != nil {
		t.Fatalf("open scratch database and migrate: %v", err)
	}
	t.Cleanup(store.Close)
	var applied bool
	if err := store.pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)", slugMigrationFile).Scan(&applied); err != nil {
		t.Fatal(err)
	}
	if !applied {
		t.Fatalf("migration %s was not applied by Open", slugMigrationFile)
	}
	return store
}

func slugOrganizationSlugs(t *testing.T, ctx context.Context, store *Store) map[string]string {
	t.Helper()
	rows, err := store.pool.Query(ctx, "SELECT id, slug FROM organizations")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	slugs := map[string]string{}
	for rows.Next() {
		var id string
		var slug *string
		if err := rows.Scan(&id, &slug); err != nil {
			t.Fatal(err)
		}
		slugs[id] = "<NULL>"
		if slug != nil {
			slugs[id] = *slug
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return slugs
}

func TestOrganizationSlugMigrationBackfillsExistingOrganizations(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	seeds := slugSeeds()
	reversed := slices.Clone(seeds)
	slices.Reverse(reversed)
	store := slugUpgrade(t, ctx, databaseURL, 1, seeds)
	reversedStore := slugUpgrade(t, ctx, databaseURL, 2, reversed)

	got := slugOrganizationSlugs(t, ctx, store)
	for _, seed := range seeds {
		if got[seed.id] != seed.want {
			t.Errorf("organization %q (%q) slug = %q, want %q", seed.id, seed.name, got[seed.id], seed.want)
		}
		if seed.noCollision && identity.Slugify(seed.name) != seed.want {
			t.Errorf("identity.Slugify(%q) = %q, but the SQL backfill rule gives %q", seed.name, identity.Slugify(seed.name), seed.want)
		}
	}
	if len(got) != len(seeds) {
		t.Errorf("backfill left %d organizations, want %d", len(got), len(seeds))
	}
	if !reflect.DeepEqual(got, slugOrganizationSlugs(t, ctx, reversedStore)) {
		t.Errorf("backfill depends on insertion order:\nforward:  %v\nreversed: %v", got, slugOrganizationSlugs(t, ctx, reversedStore))
	}

	owners := map[string]string{}
	for id, slug := range got {
		if err := identity.ValidateOrganizationSlug(slug); err != nil {
			t.Errorf("organization %q backfilled slug %q is invalid: %v", id, slug, err)
		}
		if other, taken := owners[slug]; taken {
			t.Errorf("organizations %q and %q share slug %q", other, id, slug)
		}
		owners[slug] = id
		if _, isID := got[slug]; isID && slug != id {
			t.Errorf("organization %q slug %q is a different organization's id", id, slug)
		}
	}

	if err := store.Migrate(ctx); err != nil {
		t.Fatalf("second Migrate must be idempotent: %v", err)
	}
	if !reflect.DeepEqual(got, slugOrganizationSlugs(t, ctx, store)) {
		t.Errorf("second Migrate changed slugs: %v", slugOrganizationSlugs(t, ctx, store))
	}
	// The file itself is also safe to replay, independent of the ledger.
	migration, err := migrations.ReadFile("migrations/" + slugMigrationFile)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.pool.Exec(ctx, string(migration)); err != nil {
		t.Fatalf("replaying %s: %v", slugMigrationFile, err)
	}
	if !reflect.DeepEqual(got, slugOrganizationSlugs(t, ctx, store)) {
		t.Errorf("replaying %s changed slugs: %v", slugMigrationFile, slugOrganizationSlugs(t, ctx, store))
	}
	var recorded int
	if err := store.pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations WHERE version = $1", slugMigrationFile).Scan(&recorded); err != nil {
		t.Fatal(err)
	}
	if recorded != 1 {
		t.Errorf("%s recorded %d times, want 1", slugMigrationFile, recorded)
	}
}

func TestOrganizationSlugConstraintsMatchGoRules(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	store := slugUpgrade(t, ctx, databaseURL, 1, slugSeeds())

	// Legacy inserts without a slug keep working: the column is nullable.
	if _, err := store.pool.Exec(ctx, "INSERT INTO organizations (id, name) VALUES ('legacy-insert', 'Legacy')"); err != nil {
		t.Fatalf("insert without slug: %v", err)
	}

	candidates := []string{
		"valid-slug", "a", "0", "a--b", strings.Repeat("b", 39),
		"current", "Current", "-lead", "trail-", "under_score", "dot.ted", "café",
		strings.Repeat("a", 40), "", "slug\n", " slug",
	}
	for index, candidate := range candidates {
		tx, err := store.pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		_, err = tx.Exec(ctx, "INSERT INTO organizations (id, name, slug) VALUES ($1, $1, $2)", fmt.Sprintf("slug-probe-%d", index), candidate)
		tx.Rollback(ctx)
		goValid := identity.ValidateOrganizationSlug(candidate) == nil
		if goValid != (err == nil) {
			t.Errorf("slug %q: Go validation accepts=%v, database insert error=%v", candidate, goValid, err)
			continue
		}
		var pgError *pgconn.PgError
		if err != nil && (!errors.As(err, &pgError) || pgError.Code != "23514") {
			t.Errorf("slug %q rejected with %v, want check_violation 23514", candidate, err)
		}
	}

	_, err := store.pool.Exec(ctx, "UPDATE organizations SET slug = 'acme-inc' WHERE id = 'acme-2'")
	var pgError *pgconn.PgError
	if !errors.As(err, &pgError) || pgError.Code != "23505" {
		t.Errorf("duplicate slug error = %v, want unique_violation 23505", err)
	}
}
