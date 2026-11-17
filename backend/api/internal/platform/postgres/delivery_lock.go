package postgres

import (
	"context"
	"encoding/hex"
	"errors"
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

// Stubs: declared for the tests, not used yet.
var lockPoolMaxConns int32 = 16
var lockWaitTimeout = 10 * time.Second

func (s *Store) LockChangeset(ctx context.Context,organizationID,changesetID string)(func(),error) {
	if organizationID==""||changesetID=="" {return nil,errors.New("organization and changeset identifiers are required")}
	connection,err:=s.pool.Acquire(ctx);if err!=nil{return nil,err}
	key:=changesetLockKey(organizationID,changesetID)
	if _,err=connection.Exec(ctx,"SELECT pg_advisory_lock(hashtextextended($1,0))",key);err!=nil{connection.Release();return nil,err}
	release:=func(){
		unlockContext,cancel:=context.WithTimeout(context.Background(),5*time.Second);defer cancel()
		if _,unlockErr:=connection.Exec(unlockContext,"SELECT pg_advisory_unlock(hashtextextended($1,0))",key);unlockErr!=nil { _ = connection.Hijack().Close(context.Background()); return }
		connection.Release()
	}
	return release,nil
}

var _ interface{LockChangeset(context.Context,string,string)(func(),error)}=(*Store)(nil)
