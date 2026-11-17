package postgres

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"

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
}

func Open(ctx context.Context, databaseURL string) (*Store, error) {
	if databaseURL == "" {
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
	store := &Store{pool: pool}
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
	migration, err := migrations.ReadFile("migrations/001_delivery_changesets.sql")
	if err != nil {
		return fmt.Errorf("read delivery migration: %w", err)
	}
	if _, err := s.pool.Exec(ctx, string(migration)); err != nil {
		return fmt.Errorf("apply delivery migration: %w", err)
	}
	return nil
}

func (s *Store) Create(ctx context.Context, changeset *delivery.Changeset) (delivery.StoredChangeset, error) {
	if changeset == nil || changeset.ID == "" {
		return delivery.StoredChangeset{}, delivery.ErrInvalidInput
	}
	state, err := json.Marshal(changeset)
	if err != nil {
		return delivery.StoredChangeset{}, fmt.Errorf("encode changeset: %w", err)
	}
	var stored delivery.StoredChangeset
	stored.Changeset = changeset
	err = s.pool.QueryRow(ctx, `
		INSERT INTO delivery_changesets (id, repository, title, state)
		VALUES ($1, $2, $3, $4)
		RETURNING version, created_at, updated_at
	`, string(changeset.ID), changeset.Repository, changeset.Title, state).
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

func (s *Store) Update(ctx context.Context, changeset *delivery.Changeset, expectedVersion int64) (delivery.StoredChangeset, error) {
	if changeset == nil || changeset.ID == "" || expectedVersion < 1 {
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
		SET repository = $2, title = $3, state = $4, version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $5
		RETURNING version, created_at, updated_at
	`, string(changeset.ID), changeset.Repository, changeset.Title, state, expectedVersion).
		Scan(&stored.Version, &stored.CreatedAt, &stored.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return delivery.StoredChangeset{}, ErrVersionConflict
	}
	if err != nil {
		return delivery.StoredChangeset{}, fmt.Errorf("update changeset: %w", err)
	}
	return stored, nil
}

func (s *Store) Get(ctx context.Context, id delivery.ID) (delivery.StoredChangeset, error) {
	var stored delivery.StoredChangeset
	var state []byte
	err := s.pool.QueryRow(ctx, `
		SELECT state, version, created_at, updated_at
		FROM delivery_changesets WHERE id = $1
	`, string(id)).Scan(&state, &stored.Version, &stored.CreatedAt, &stored.UpdatedAt)
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

func (s *Store) List(ctx context.Context, limit, offset int) ([]delivery.StoredChangeset, error) {
	if limit < 1 || limit > 100 || offset < 0 {
		return nil, delivery.ErrInvalidInput
	}
	rows, err := s.pool.Query(ctx, `
		SELECT state, version, created_at, updated_at
		FROM delivery_changesets
		ORDER BY updated_at DESC, id ASC
		LIMIT $1 OFFSET $2
	`, limit, offset)
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
