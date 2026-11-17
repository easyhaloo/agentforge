package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Store) LockChangeset(ctx context.Context,organizationID,changesetID string)(func(),error) {
	if organizationID==""||changesetID=="" {return nil,errors.New("organization and changeset identifiers are required")}
	connection,err:=s.pool.Acquire(ctx);if err!=nil{return nil,err}
	key:=organizationID+"\x00"+changesetID
	if _,err=connection.Exec(ctx,"SELECT pg_advisory_lock(hashtextextended($1,0))",key);err!=nil{connection.Release();return nil,err}
	release:=func(){
		unlockContext,cancel:=context.WithTimeout(context.Background(),5*time.Second);defer cancel()
		_,unlockErr:=connection.Exec(unlockContext,"SELECT pg_advisory_unlock(hashtextextended($1,0))",key)
		if unlockErr!=nil&&!errors.Is(unlockErr,pgx.ErrNoRows) {
			// Releasing the connection also releases session-scoped advisory locks.
		}
		connection.Release()
	}
	return release,nil
}

var _ interface{LockChangeset(context.Context,string,string)(func(),error)}=(*Store)(nil)
