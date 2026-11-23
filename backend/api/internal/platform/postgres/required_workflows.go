package postgres

import (
	"context"
	"fmt"
	"maps"
	"slices"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
	"github.com/jackc/pgx/v5"
)

func (s *Store) ValidateRequiredWorkflows(ctx context.Context, org, repository string, rules []githttp.RefRule) error {
	for _, rule := range rules {
		if rule.RequiredWorkflows == nil {
			continue
		}
		var eligible int
		err := s.pool.QueryRow(ctx, `SELECT count(DISTINCT b.pipeline_id)
			FROM pipeline_trigger_bindings b
			JOIN pipelines p ON (p.organization_id,p.id)=(b.organization_id,b.pipeline_id)
			WHERE b.organization_id=$1 AND b.repository=$2 AND b.enabled
			  AND p.repository=$2 AND NOT p.disabled AND p.status<>'archived'
			  AND b.pipeline_id=ANY($3)`, org, repository, rule.RequiredWorkflows.PipelineIDs).Scan(&eligible)
		if err != nil {
			return fmt.Errorf("validate required workflows: %w", err)
		}
		if eligible != len(rule.RequiredWorkflows.PipelineIDs) {
			return fmt.Errorf("ruleset %q: %w", rule.Name, githttp.ErrIneligibleRequiredWorkflow)
		}
	}
	return nil
}

func (s *Store) CheckRequiredWorkflows(ctx context.Context, org string, c *delivery.Changeset, rev delivery.Revision, base string, required map[string]bool) error {
	return checkRequiredWorkflows(ctx, s.pool, org, c, rev, base, required)
}

func checkRequiredWorkflows(ctx context.Context, db interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, org string, c *delivery.Changeset, rev delivery.Revision, base string, required map[string]bool) error {
	for _, workflow := range slices.Sorted(maps.Keys(required)) {
		var passed bool
		// Only original runs admitted by the enabled repository trigger qualify.
		// Schedules, manual runs, reruns and user-supplied inputs have no such event.
		err := db.QueryRow(ctx, `SELECT EXISTS (
			SELECT FROM pipeline_trigger_bindings b
			JOIN pipelines p ON (p.organization_id,p.id)=(b.organization_id,b.pipeline_id)
			JOIN pipeline_trigger_events e ON e.binding_id=b.id
			JOIN pipeline_runs r ON r.id=e.run_id AND (r.organization_id,r.pipeline_id,r.version)=(b.organization_id,b.pipeline_id,b.version)
			WHERE b.organization_id=$1 AND b.repository=$2 AND b.pipeline_id=$3 AND b.enabled
			  AND p.repository=$2 AND NOT p.disabled AND p.status<>'archived' AND r.status='succeeded'
			  AND e.source->>'kind'='changeset_revision' AND e.source->>'changesetId'=$4
			  AND e.source->>'revisionId'=$5 AND e.source->>'sha'=$6
			  AND (NOT $7 OR e.source->>'baseSha'=$8)
			  AND EXISTS (SELECT FROM pipeline_step_runs t WHERE t.run_id=r.id AND t.status='succeeded' AND t.checked_source_sha=$6)
		)`, org, c.Repository, workflow, string(c.ID), string(rev.ID), rev.CommitSHA, required[workflow], base).Scan(&passed)
		if err != nil {
			return fmt.Errorf("verify required workflow: %w", err)
		}
		if !passed {
			return fmt.Errorf("%w: %s", githttp.ErrRequiredWorkflows, workflow)
		}
	}
	return nil
}
