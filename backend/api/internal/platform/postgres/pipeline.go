package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/jackc/pgx/v5"
)

func (s *Store) ListPipelines(ctx context.Context, org string) ([]pipeline.Summary, error) {
	rows, err := s.pool.Query(ctx, `SELECT disabled,coalesce(repository,''),id,name,status,revision,version FROM pipelines WHERE organization_id=$1 ORDER BY name,id`, org)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[pipeline.Summary])
}
func scanPipeline(row pgx.Row) (pipeline.Pipeline, error) {
	var p pipeline.Pipeline
	err := row.Scan(&p.Disabled, &p.Repository, &p.ID, &p.Name, &p.Status, &p.Revision, &p.Version, &p.Definition)
	if errors.Is(err, pgx.ErrNoRows) {
		err = pipeline.ErrMissing
	}
	return p, err
}

const pipelineQuery = `SELECT disabled,coalesce(repository,''),id,name,status,revision,version,definition FROM pipelines WHERE organization_id=$1 AND id=$2`

func (s *Store) GetPipeline(ctx context.Context, org, id string) (pipeline.Pipeline, error) {
	return scanPipeline(s.pool.QueryRow(ctx, pipelineQuery, org, id))
}
func (s *Store) ChangePipeline(ctx context.Context, org, id, actor, action string, revision int, definition *pipeline.Definition) (pipeline.Pipeline, error) {
	return s.changePipeline(ctx, org, id, actor, action, revision, definition, "")
}

func (s *Store) CreateRepositoryPipeline(ctx context.Context, org, id, actor, repository string, definition *pipeline.Definition) (pipeline.Pipeline, error) {
	return s.changePipeline(ctx, org, id, actor, "create", 0, definition, repository)
}

func (s *Store) changePipeline(ctx context.Context, org, id, actor, action string, revision int, definition *pipeline.Definition, repository string) (pipeline.Pipeline, error) {
	var p pipeline.Pipeline
	p.Repository = repository
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return p, err
	}
	defer tx.Rollback(ctx)
	if action != "create" {
		p, err = scanPipeline(tx.QueryRow(ctx, pipelineQuery+` FOR UPDATE`, org, id))
		if err != nil {
			return p, err
		}
		if p.Status == "archived" || p.Revision != revision {
			return p, pipeline.ErrConflict
		}
	}
	switch action {
	case "create", "save":
		if definition == nil {
			return p, errors.New("missing definition")
		}
		if err := definition.Validate(); err != nil {
			return p, err
		}
		p.Definition = *definition
		p.Name = definition.Name
		p.Status = "draft"
		p.ID = id
	case "publish":
		if p.Status != "draft" {
			return p, pipeline.ErrConflict
		}
		if err := p.Definition.Validate(); err != nil {
			return p, err
		}
		p.Status = "published"
		p.Version++
		raw, err := json.Marshal(p.Definition)
		if err != nil {
			return p, err
		}
		_, err = tx.Exec(ctx, `INSERT INTO pipeline_versions(organization_id,pipeline_id,number,definition,checksum) VALUES($1,$2,$3,$4,$5)`, org, id, p.Version, raw, fmt.Sprintf("%x", sha256.Sum256(raw)))
		if err != nil {
			return p, err
		}
	case "disable", "enable":
		if p.Repository == "" || p.Version == 0 || p.Disabled == (action == "disable") {
			return p, pipeline.ErrConflict
		}
		p.Disabled = action == "disable"
	case "archive":
		p.Status = "archived"
	default:
		return p, errors.New("invalid pipeline action")
	}
	p.Revision++
	if action == "create" {
		_, err = tx.Exec(ctx, `INSERT INTO pipelines(organization_id,id,name,status,definition,repository) VALUES($1,$2,$3,$4,$5,NULLIF($6,''))`, org, id, p.Name, p.Status, p.Definition, p.Repository)
	} else {
		_, err = tx.Exec(ctx, `UPDATE pipelines SET name=$3,status=$4,definition=$5,revision=$6,version=$7,disabled=$8 WHERE organization_id=$1 AND id=$2`, org, id, p.Name, p.Status, p.Definition, p.Revision, p.Version, p.Disabled)
	}
	if err != nil {
		return p, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO pipeline_audit(organization_id,pipeline_id,actor_id,action,revision) VALUES($1,$2,$3,$4,$5)`, org, id, actor, action, p.Revision)
	if err != nil {
		return p, err
	}
	return p, tx.Commit(ctx)
}
func (s *Store) PipelineVersions(ctx context.Context, org, id string) ([]pipeline.Version, error) {
	if _, err := s.GetPipeline(ctx, org, id); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT number,checksum,published_at,definition FROM pipeline_versions WHERE organization_id=$1 AND pipeline_id=$2 ORDER BY number DESC`, org, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[pipeline.Version])
}

func (s *Store) PipelineVersion(ctx context.Context, org, id string, number int) (pipeline.Version, error) {
	var v pipeline.Version
	err := s.pool.QueryRow(ctx, `SELECT number,checksum,published_at,definition FROM pipeline_versions WHERE organization_id=$1 AND pipeline_id=$2 AND number=$3`, org, id, number).Scan(&v.Number, &v.Checksum, &v.PublishedAt, &v.Definition)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, pipeline.ErrMissing
	}
	return v, err
}
