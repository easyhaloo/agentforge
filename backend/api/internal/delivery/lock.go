package delivery

import "context"

type ChangesetLocker interface {
	LockChangeset(context.Context, string, string) (func(), error)
}
