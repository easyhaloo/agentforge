package postgres

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

var ErrVersionConflict = delivery.ErrVersionConflict

type Store struct {
	pool *pgxpool.Pool
	// lockPool is a stub that aliases the query pool until the dedicated lock pool exists.
	lockPool *pgxpool.Pool
}

func Open(ctx context.Context, databaseURL string) (*Store, error) {
	if strings.TrimSpace(databaseURL) == "" {
		return nil, errors.New("database URL is required")
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("create postgres pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect to postgres: %w", err)
	}
	store := &Store{pool: pool, lockPool: pool}
	if err := store.Migrate(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() {
	s.pool.Close()
}

func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *Store) Migrate(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin schema migration: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`); err != nil {
		return fmt.Errorf("create migration ledger: %w", err)
	}
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", int64(731904221)); err != nil {
		return fmt.Errorf("lock schema migrations: %w", err)
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
	if strings.TrimSpace(organizationID) == "" || changeset == nil || changeset.ID == "" {
		return delivery.StoredChangeset{}, delivery.ErrInvalidInput
	}
	state, err := json.Marshal(changeset)
	if err != nil {
		return delivery.StoredChangeset{}, fmt.Errorf("encode changeset: %w", err)
	}
	var stored delivery.StoredChangeset
	stored.Changeset = changeset
	err = s.pool.QueryRow(ctx, `
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

func (s *Store) List(ctx context.Context, organizationID string, limit, offset int) ([]delivery.StoredChangeset, error) {
	if strings.TrimSpace(organizationID) == "" || limit < 1 || limit > 100 || offset < 0 {
		return nil, delivery.ErrInvalidInput
	}
	rows, err := s.pool.Query(ctx, `
		SELECT state, version, created_at, updated_at
		FROM delivery_changesets
		WHERE organization_id = $1
		ORDER BY updated_at DESC, id ASC
		LIMIT $2 OFFSET $3
	`, organizationID, limit, offset)
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
