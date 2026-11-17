package postgres

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

func TestPostgresRepositoryCatalogIsOrganizationScoped(t *testing.T) {
	databaseURL:=os.Getenv("DATABASE_URL")
	if databaseURL=="" {t.Skip("DATABASE_URL is not configured")}
	ctx,cancel:=context.WithTimeout(context.Background(),20*time.Second);defer cancel()
	store,err:=Open(ctx,databaseURL);if err!=nil{t.Fatal(err)};defer store.Close()
	suffix:=strconv.FormatInt(time.Now().UnixNano(),10)
	orgA,orgB,user:="repo-org-a-"+suffix,"repo-org-b-"+suffix,"repo-user-"+suffix
	if _,err=store.pool.Exec(ctx,"INSERT INTO organizations (id,name) VALUES ($1,$1),($2,$2)",orgA,orgB);err!=nil{t.Fatal(err)}
	if _,err=store.pool.Exec(ctx,"INSERT INTO users (id,display_name) VALUES ($1,$1)",user);err!=nil{t.Fatal(err)}
	created,err:=store.RegisterRepository(ctx,delivery.RepositoryMetadata{OrganizationID:orgA,Slug:"team/service",DefaultBranch:"main",CreatedBy:user})
	if err!=nil{t.Fatal(err)}
	if created.Slug!="team/service"||created.DefaultBranch!="main"{t.Fatalf("created repository=%#v",created)}
	items,err:=store.ListRepositories(ctx,orgA);if err!=nil{t.Fatal(err)}
	if len(items)!=1||items[0].Slug!="team/service"{t.Fatalf("organization A repositories=%#v",items)}
	other,err:=store.ListRepositories(ctx,orgB);if err!=nil{t.Fatal(err)}
	if len(other)!=0{t.Fatalf("cross-organization repository leak: %#v",other)}
	if _,err=store.RegisterRepository(ctx,delivery.RepositoryMetadata{OrganizationID:orgA,Slug:"team/service",DefaultBranch:"main",CreatedBy:user});err!=delivery.ErrVersionConflict{t.Fatalf("duplicate registration error=%v",err)}
}
