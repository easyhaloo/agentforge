package postgres

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"slices"
	"sort"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/artifact"
	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

var ErrVersionConflict = delivery.ErrVersionConflict

type Store struct {
	objects *artifact.Storage
	pool    *pgxpool.Pool
	// lockPool serves only changeset advisory locks (LockChangeset) and never shares a connection with pool.
	lockPool *pgxpool.Pool
}

func Open(ctx context.Context, databaseURL string) (*Store, error) {
	if strings.TrimSpace(databaseURL) == "" {
		return nil, errors.New("database URL is required")
	}
	objects, err := artifact.FromEnv(ctx)
	if err != nil {
		return nil, err
	}
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("create postgres pool: %w", err)
	}
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create postgres pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect to postgres: %w", err)
	}
	// The lock pool shares the connection settings but has its own size, and opens no connection
	// until a lock needs one, whatever pool_min_conns asks of the query pool.
	lockConfig := config.Copy()
	lockConfig.MaxConns = lockPoolMaxConns
	lockConfig.MinConns = 0
	lockPool, err := pgxpool.NewWithConfig(ctx, lockConfig)
	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("create postgres lock pool: %w", err)
	}
	store := &Store{pool: pool, lockPool: lockPool, objects: objects}
	if err := store.Migrate(ctx); err != nil {
		store.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() {
	s.lockPool.Close()
	s.pool.Close()
}

func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

// Pool returns the underlying connection pool for use by other subsystems.
func (s *Store) Pool() *pgxpool.Pool {
	return s.pool
}

func (s *Store) Migrate(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin schema migration: %w", err)
	}
	defer tx.Rollback(ctx)

	// Acquire advisory lock BEFORE creating the table to serialize concurrent migration initialization.
	// This prevents pg_type_typname_nsp_index conflicts when PostgreSQL creates the implicit composite type.
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", int64(731904221)); err != nil {
		return fmt.Errorf("lock schema migrations: %w", err)
	}

	if _, err := tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`); err != nil {
		return fmt.Errorf("create migration ledger: %w", err)
	}

	entries, err := fs.ReadDir(migrations, "migrations")
	if err != nil {
		return fmt.Errorf("list schema migrations: %w", err)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		var applied bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)", entry.Name()).Scan(&applied); err != nil {
			return fmt.Errorf("check migration %q: %w", entry.Name(), err)
		}
		if applied {
			continue
		}
		migration, err := migrations.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return fmt.Errorf("read migration %q: %w", entry.Name(), err)
		}
		if _, err := tx.Exec(ctx, string(migration)); err != nil {
			return fmt.Errorf("apply migration %q: %w", entry.Name(), err)
		}
		if _, err := tx.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ($1)", entry.Name()); err != nil {
			return fmt.Errorf("record migration %q: %w", entry.Name(), err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit schema migrations: %w", err)
	}
	return nil
}

func (s *Store) Create(ctx context.Context, organizationID string, changeset *delivery.Changeset) (delivery.StoredChangeset, error) {
	return createChangeset(ctx, s.pool, organizationID, changeset)
}

func createChangeset(ctx context.Context, db interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, organizationID string, changeset *delivery.Changeset) (delivery.StoredChangeset, error) {
	if strings.TrimSpace(organizationID) == "" || changeset == nil || changeset.ID == "" {
		return delivery.StoredChangeset{}, delivery.ErrInvalidInput
	}
	state, err := json.Marshal(changeset)
	if err != nil {
		return delivery.StoredChangeset{}, fmt.Errorf("encode changeset: %w", err)
	}
	var stored delivery.StoredChangeset
	stored.Changeset = changeset
	err = db.QueryRow(ctx, `
		INSERT INTO delivery_changesets (organization_id, id, repository, title, state)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING version, created_at, updated_at
	`, organizationID, string(changeset.ID), changeset.Repository, changeset.Title, state).
		Scan(&stored.Version, &stored.CreatedAt, &stored.UpdatedAt)
	if err != nil {
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "23505" {
			return delivery.StoredChangeset{}, ErrVersionConflict
		}
		return delivery.StoredChangeset{}, fmt.Errorf("create changeset: %w", err)
	}
	return stored, nil
}

func (s *Store) Update(ctx context.Context, organizationID string, changeset *delivery.Changeset, expectedVersion int64) (delivery.StoredChangeset, error) {
	if strings.TrimSpace(organizationID) == "" || changeset == nil || changeset.ID == "" || expectedVersion < 1 {
		return delivery.StoredChangeset{}, delivery.ErrInvalidInput
	}
	state, err := json.Marshal(changeset)
	if err != nil {
		return delivery.StoredChangeset{}, fmt.Errorf("encode changeset: %w", err)
	}
	var stored delivery.StoredChangeset
	stored.Changeset = changeset
	err = s.pool.QueryRow(ctx, `
		UPDATE delivery_changesets
		SET repository = $3, title = $4, state = $5, version = version + 1, updated_at = now()
		WHERE organization_id = $1 AND id = $2 AND version = $6
		RETURNING version, created_at, updated_at
	`, organizationID, string(changeset.ID), changeset.Repository, changeset.Title, state, expectedVersion).
		Scan(&stored.Version, &stored.CreatedAt, &stored.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		var exists bool
		if checkErr := s.pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM delivery_changesets WHERE organization_id = $1 AND id = $2)", organizationID, string(changeset.ID)).Scan(&exists); checkErr != nil {
			return delivery.StoredChangeset{}, fmt.Errorf("check changeset after update conflict: %w", checkErr)
		}
		if !exists {
			return delivery.StoredChangeset{}, delivery.ErrNotFound
		}
		return delivery.StoredChangeset{}, ErrVersionConflict
	}
	if err != nil {
		return delivery.StoredChangeset{}, fmt.Errorf("update changeset: %w", err)
	}
	return stored, nil
}

func (s *Store) Get(ctx context.Context, organizationID string, id delivery.ID) (delivery.StoredChangeset, error) {
	if strings.TrimSpace(organizationID) == "" || id == "" {
		return delivery.StoredChangeset{}, delivery.ErrInvalidInput
	}
	var stored delivery.StoredChangeset
	var state []byte
	err := s.pool.QueryRow(ctx, `
		SELECT state, version, created_at, updated_at
		FROM delivery_changesets WHERE organization_id = $1 AND id = $2
	`, organizationID, string(id)).Scan(&state, &stored.Version, &stored.CreatedAt, &stored.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return delivery.StoredChangeset{}, delivery.ErrNotFound
	}
	if err != nil {
		return delivery.StoredChangeset{}, fmt.Errorf("get changeset: %w", err)
	}
	var changeset delivery.Changeset
	if err := json.Unmarshal(state, &changeset); err != nil {
		return delivery.StoredChangeset{}, fmt.Errorf("decode changeset %q: %w", id, err)
	}
	stored.Changeset = &changeset
	return stored, nil
}

// List returns one page of the organization's changesets matching filter, ordered by updated_at
// descending then id ascending, and the number of matches before paging. Every query keeps
// organization_id = $1.
//
// When only repository narrows the list (status, reviewer and q are empty; a blank q is no filter,
// as in delivery.FilterAndPage) the ordering, paging and counting happen in SQL, so only the
// requested page is transferred and decoded. The database still scans the organization's rows to
// sort and count them (an index covering the order would avoid the sort), but without decoding
// their state. The id tie-break uses COLLATE "C" because FilterAndPage compares ids bytewise: both
// paths must return the same page whatever the database collation is
// (TestPostgresStoreListSQLPathMatchesFilterAndPage pins that).
//
// Any other request loads the organization's changesets (those of the repository when one is
// given) and lets delivery.FilterAndPage match, order and page them.
//
// ponytail: a request that filters by status, reviewer or q loads and decodes every changeset of the
// organization (of the repository when one is given), so it costs O(changesets per organization).
// Upgrade path: denormalize the lifecycle status and the current reviewers into indexed columns and
// push those filters down to SQL as well.
func (s *Store) List(ctx context.Context, organizationID string, filter delivery.ListFilter, limit, offset int) ([]delivery.StoredChangeset, int, error) {
	if strings.TrimSpace(organizationID) == "" || limit < 1 || limit > 100 || offset < 0 {
		return nil, 0, delivery.ErrInvalidInput
	}
	where := "organization_id = $1"
	args := []any{organizationID}
	if filter.Repository != "" {
		where += " AND repository = $2"
		args = append(args, filter.Repository)
	}
	if filter.State == "" && filter.Status == "" && filter.Reviewer == "" && strings.TrimSpace(filter.Query) == "" {
		var total int
		if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM delivery_changesets WHERE "+where, args...).Scan(&total); err != nil {
			return nil, 0, fmt.Errorf("count changesets: %w", err)
		}
		items, err := s.queryChangesets(ctx, fmt.Sprintf(`
			SELECT state, version, created_at, updated_at
			FROM delivery_changesets
			WHERE %s
			ORDER BY updated_at DESC, id COLLATE "C" ASC
			LIMIT $%d OFFSET $%d`, where, len(args)+1, len(args)+2), append(slices.Clone(args), limit, offset)...)
		if err != nil {
			return nil, 0, err
		}
		return items, total, nil
	}
	candidates, err := s.queryChangesets(ctx, `
		SELECT state, version, created_at, updated_at
		FROM delivery_changesets
		WHERE `+where, args...)
	if err != nil {
		return nil, 0, err
	}
	items, total := delivery.FilterAndPage(candidates, filter, limit, offset)
	return items, total, nil
}

// queryChangesets runs a query selecting (state, version, created_at, updated_at) and decodes every
// row it returns.
func (s *Store) queryChangesets(ctx context.Context, query string, args ...any) ([]delivery.StoredChangeset, error) {
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list changesets: %w", err)
	}
	defer rows.Close()

	items := make([]delivery.StoredChangeset, 0)
	for rows.Next() {
		var stored delivery.StoredChangeset
		var state []byte
		if err := rows.Scan(&state, &stored.Version, &stored.CreatedAt, &stored.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan changeset: %w", err)
		}
		var changeset delivery.Changeset
		if err := json.Unmarshal(state, &changeset); err != nil {
			return nil, fmt.Errorf("decode listed changeset: %w", err)
		}
		stored.Changeset = &changeset
		items = append(items, stored)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate changesets: %w", err)
	}
	return items, nil
}

var _ delivery.Repository = (*Store)(nil)
