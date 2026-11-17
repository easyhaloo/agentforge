package postgres

import (
	"context"
	"errors"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

func TestPostgresCurrentAccountListsOnlyActiveOrganizations(t *testing.T) {
	databaseURL:=os.Getenv("DATABASE_URL")
	if databaseURL=="" { t.Skip("DATABASE_URL is not configured") }
	ctx,cancel:=context.WithTimeout(context.Background(),20*time.Second)
	defer cancel()
	store,err:=Open(ctx,databaseURL); if err!=nil { t.Fatal(err) }; defer store.Close()
	suffix:=strconv.FormatInt(time.Now().UnixNano(),10)
	user:="account-user-"+suffix
	orgA:="account-org-a-"+suffix
	orgB:="account-org-b-"+suffix
	for _,org:=range []string{orgA,orgB} {
		if _,err:=store.pool.Exec(ctx,"INSERT INTO organizations(id,name) VALUES($1,$1)",org); err!=nil { t.Fatal(err) }
	}
	if _,err:=store.pool.Exec(ctx,"INSERT INTO users(id,display_name,email) VALUES($1,'Account User',$2)",user,"account@example.test"); err!=nil { t.Fatal(err) }
	if _,err:=store.pool.Exec(ctx,"INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,'owner','active'),($3,$2,'viewer','suspended')",orgA,user,orgB); err!=nil { t.Fatal(err) }
	token,err:=identity.GenerateToken(); if err!=nil { t.Fatal(err) }
	csrf,err:=identity.GenerateToken(); if err!=nil { t.Fatal(err) }
	if _,err:=store.CreateSession(ctx,user,token,csrf,time.Now().Add(time.Hour)); err!=nil { t.Fatal(err) }
	account,err:=store.CurrentAccount(ctx,token)
	if err!=nil { t.Fatal(err) }
	if account.UserID!=user || account.DisplayName!="Account User" || account.Email!="account@example.test" { t.Fatalf("account=%#v",account) }
	if len(account.Organizations)!=1 || account.Organizations[0].ID!=orgA || account.Organizations[0].Role!="owner" {
		t.Fatalf("active organizations=%#v, want only active organization",account.Organizations)
	}
	if _,err:=store.CurrentAccount(ctx,"invalid"); !errors.Is(err,identity.ErrUnauthenticated) { t.Fatalf("invalid session error=%v",err) }
	if err:=store.RevokeSession(ctx,token); err!=nil { t.Fatal(err) }
	if _,err:=store.CurrentAccount(ctx,token); !errors.Is(err,identity.ErrUnauthenticated) { t.Fatalf("revoked session error=%v",err) }
}
