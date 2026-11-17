package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func (s *Store) RegisterRepository(ctx context.Context, input delivery.RepositoryMetadata) (delivery.RepositoryMetadata,error) {
	input.OrganizationID=strings.TrimSpace(input.OrganizationID)
	input.Slug=strings.TrimSpace(input.Slug)
	input.DefaultBranch=strings.TrimSpace(input.DefaultBranch)
	input.CreatedBy=strings.TrimSpace(input.CreatedBy)
	if input.OrganizationID==""||input.Slug==""||input.DefaultBranch==""||input.CreatedBy=="" {return delivery.RepositoryMetadata{},delivery.ErrInvalidInput}
	err:=s.pool.QueryRow(ctx,`
		INSERT INTO delivery_repositories (organization_id,slug,default_branch,created_by)
		VALUES ($1,$2,$3,$4)
		RETURNING created_at,updated_at
	`,input.OrganizationID,input.Slug,input.DefaultBranch,input.CreatedBy).Scan(&input.CreatedAt,&input.UpdatedAt)
	if err!=nil {
		var pgError *pgconn.PgError
		if errors.As(err,&pgError)&&pgError.Code=="23505" {return delivery.RepositoryMetadata{},delivery.ErrVersionConflict}
		return delivery.RepositoryMetadata{},fmt.Errorf("register repository: %w",err)
	}
	return input,nil
}

func (s *Store) ListRepositories(ctx context.Context, organizationID string) ([]delivery.RepositoryMetadata,error) {
	if strings.TrimSpace(organizationID)=="" {return nil,delivery.ErrInvalidInput}
	rows,err:=s.pool.Query(ctx,`
		SELECT organization_id,slug,default_branch,created_by,created_at,updated_at
		FROM delivery_repositories WHERE organization_id=$1 ORDER BY slug ASC
	`,organizationID)
	if err!=nil{return nil,fmt.Errorf("list repositories: %w",err)}
	defer rows.Close()
	items:=make([]delivery.RepositoryMetadata,0)
	for rows.Next() {
		var item delivery.RepositoryMetadata
		if err:=rows.Scan(&item.OrganizationID,&item.Slug,&item.DefaultBranch,&item.CreatedBy,&item.CreatedAt,&item.UpdatedAt);err!=nil{return nil,err}
		items=append(items,item)
	}
	if err:=rows.Err();err!=nil{return nil,err}
	return items,nil
}

var _ delivery.RepositoryCatalog=(*Store)(nil)
var _ = pgx.ErrNoRows
