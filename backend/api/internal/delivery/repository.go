package delivery

import (
	"context"
	"errors"
	"time"
)

var ErrNotFound = errors.New("changeset not found")

type StoredChangeset struct {
	Changeset *Changeset
	Version   int64
	CreatedAt time.Time
	UpdatedAt time.Time
}

type Repository interface {
	Create(context.Context, *Changeset) (StoredChangeset, error)
	Update(context.Context, *Changeset, int64) (StoredChangeset, error)
	Get(context.Context, ID) (StoredChangeset, error)
	List(context.Context, int, int) ([]StoredChangeset, error)
}
