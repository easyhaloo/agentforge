package delivery

import (
	"context"
	"errors"
	"time"
)

var (
	ErrNotFound = errors.New("changeset not found")
	ErrVersionConflict = errors.New("changeset version conflict")
)

type StoredChangeset struct {
	Changeset *Changeset
	Version   int64
	CreatedAt time.Time
	UpdatedAt time.Time
}

type Repository interface {
	Create(context.Context, string, *Changeset) (StoredChangeset, error)
	Update(context.Context, string, *Changeset, int64) (StoredChangeset, error)
	Get(context.Context, string, ID) (StoredChangeset, error)
	// List returns one page of the organization's changesets matching filter, newest first, and the
	// number of matches before paging. Implementations reject limit outside 1-100 or a negative
	// offset with ErrInvalidInput and share FilterAndPage so they cannot diverge.
	List(ctx context.Context, organizationID string, filter ListFilter, limit, offset int) ([]StoredChangeset, int, error)
}
