package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/jackc/pgx/v5"
)

// EnqueueTagRuns inserts one trigger event per enabled tag binding whose pattern matches the
// pushed tag. Pattern filtering happens here so a push never even enqueues events for bindings
// it does not match; the dispatch path re-checks the binding's current pattern in case the rule
// changed between enqueue and dispatch. The unique index on (binding, ref, sha) makes replays
// idempotent, so journal recovery can call this again without duplicating runs. The caller peels
// annotation tags with ResolveRevision, so sha is always the commit, never the tag object.
// ref must be a full "refs/tags/<name>".
func (s *Store) EnqueueTagRuns(ctx context.Context, org, repository, ref, sha string) error {
	const tagPrefix = "refs/tags/"
	if !strings.HasPrefix(ref, tagPrefix) || strings.Trim(sha, "0") == "" {
		return nil
	}
	tag := ref[len(tagPrefix):]
	if tag == "" || len(tag) > pipeline.MaxTagPatternLength {
		return nil
	}
	rows, _ := s.pool.Query(ctx, `SELECT b.id,b.tag_pattern FROM pipeline_trigger_bindings b
	JOIN pipelines p ON (p.organization_id,p.id)=(b.organization_id,b.pipeline_id)
	JOIN delivery_repositories r ON (r.organization_id,r.slug)=(b.organization_id,b.repository)
	WHERE b.enabled AND NOT p.disabled AND NOT r.actions_disabled AND p.status<>'archived'
	  AND b.organization_id=$1 AND b.repository=$2 AND b.tag_pattern IS NOT NULL`, org, repository)
	bindings, err := pgx.CollectRows(rows, pgx.RowToStructByPos[tagBinding])
	if err != nil {
		return fmt.Errorf("list tag trigger bindings: %w", err)
	}
	for _, b := range bindings {
		if !pipeline.MatchTagPattern(b.Pattern, tag) {
			continue
		}
		if _, err := s.pool.Exec(ctx, `INSERT INTO pipeline_trigger_events(binding_id,source)
		VALUES($1,jsonb_build_object('kind','tag','bindingId',$1,'repository',$2,'ref',$3,'tag',$4,'sha',$5))
		ON CONFLICT DO NOTHING`, b.ID, repository, ref, tag, sha); err != nil {
			return fmt.Errorf("enqueue tag trigger events: %w", err)
		}
	}
	return nil
}

type tagBinding struct {
	ID      string
	Pattern string
}
