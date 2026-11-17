package postgres

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

)

// changesetLockKey is the text hashed into the advisory lock key; lock and unlock share it.
// Each identifier is hex-encoded and the two are joined with ':', which never occurs in hex, so
// the key never contains NUL (PostgreSQL text cannot hold it, SQLSTATE 22021) whatever bytes the
// identifiers hold, and distinct pairs give distinct keys: ("a","b:c") and ("a:b","c") differ.
// The lock itself is a 64-bit hash of the key, so a collision could only make two unrelated
// changesets wait for each other, never let two holders in.
func changesetLockKey(organizationID, changesetID string) string {
	return hex.EncodeToString([]byte(organizationID)) + ":" + hex.EncodeToString([]byte(changesetID))
}

// lockPoolMaxConns sizes the pool reserved for changeset locks, and lockWaitTimeout bounds how long
// LockChangeset waits for a lock connection and for the lock. Both are test hooks, not configuration:
// tests set them (lockPoolMaxConns before Open) and restore them afterwards.
//
// A changeset lock is a session-level advisory lock, so a held lock pins one connection for the whole
// request and every waiter pins one too. Locks therefore get a pool of their own: on the query pool,
// lock holders and waiters could take every connection, and the holders' own queries (load, update)
// would then wait for connections that only their own release can free.
//
// ponytail: a merge takes two lock connections (the changeset lock, then the repository lock), so
// lockPoolMaxConns or more overlapping merges can each hold one and wait for a second until
// lockWaitTimeout, then answer 503. Upgrade paths: take the second lock on the connection already held,
// or use transaction-scoped locks inside one per-request transaction.
var lockPoolMaxConns int32 = 16
var lockWaitTimeout = 10 * time.Second

func (s *Store) LockChangeset(ctx context.Context,organizationID,changesetID string)(func(),error) {
	if organizationID==""||changesetID=="" {return nil,errors.New("organization and changeset identifiers are required")}
	// One deadline covers getting a lock connection and getting the lock. It is cancelled as soon as the
	// lock is held, so it never limits how long the lock is held.
	waitContext,cancel:=context.WithTimeout(ctx,lockWaitTimeout);defer cancel()
	connection,err:=s.lockPool.Acquire(waitContext);if err!=nil{return nil,fmt.Errorf("acquire lock connection: %w",err)}
	key:=changesetLockKey(organizationID,changesetID)
	if _,err=connection.Exec(waitContext,"SELECT pg_advisory_lock(hashtextextended($1,0))",key);err!=nil{connection.Release();return nil,fmt.Errorf("wait for changeset lock: %w",err)}
	release:=func(){
		unlockContext,cancel:=context.WithTimeout(context.Background(),5*time.Second);defer cancel()
		if _,unlockErr:=connection.Exec(unlockContext,"SELECT pg_advisory_unlock(hashtextextended($1,0))",key);unlockErr!=nil { _ = connection.Hijack().Close(context.Background()); return }
		connection.Release()
	}
	return release,nil
}

var _ interface{LockChangeset(context.Context,string,string)(func(),error)}=(*Store)(nil)
