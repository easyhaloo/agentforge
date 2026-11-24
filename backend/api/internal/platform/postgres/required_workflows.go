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

func checkRequiredWorkflows(ctx context.Context, db requiredWorkflowQueryer, org string, c *delivery.Changeset, rev delivery.Revision, base string, required map[string]bool) error {
	checks, err := requiredWorkflowStatuses(ctx, db, org, c, rev, base, required)
	if err != nil {
		return err
	}
	for _, check := range checks {
		if check.Status != "passed" {
			return fmt.Errorf("%w: %s", githttp.ErrRequiredWorkflows, check.PipelineID)
		}
	}
	return nil
}

func (s *Store) RequiredWorkflowStatuses(ctx context.Context, org string, c *delivery.Changeset, rev delivery.Revision, base string, required map[string]bool) ([]githttp.RequiredWorkflowStatus, error) {
	return requiredWorkflowStatuses(ctx, s.pool, org, c, rev, base, required)
}

type requiredWorkflowQueryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func requiredWorkflowStatuses(ctx context.Context, db requiredWorkflowQueryer, org string, c *delivery.Changeset, rev delivery.Revision, base string, required map[string]bool) ([]githttp.RequiredWorkflowStatus, error) {
	checks := make([]githttp.RequiredWorkflowStatus, 0, len(required))
	if len(required) == 0 {
		return checks, nil
	}
	ids := slices.Sorted(maps.Keys(required))
	strict := make([]bool, len(ids))
	for i, id := range ids {
		strict[i] = required[id]
	}
	// Only original runs admitted by the enabled repository trigger qualify.
	// Schedules, manual runs, reruns and user-supplied inputs have no such event.
	rows, err := db.Query(ctx, `SELECT w.id, coalesce(p.name, w.id), EXISTS (
		SELECT FROM pipeline_trigger_bindings b
		JOIN pipeline_trigger_events e ON e.binding_id=b.id
		JOIN pipeline_runs r ON r.id=e.run_id AND (r.organization_id,r.pipeline_id,r.version)=(b.organization_id,b.pipeline_id,b.version)
		WHERE b.organization_id=$1 AND b.repository=$2 AND b.pipeline_id=p.id AND b.enabled
		  AND NOT p.disabled AND p.status<>'archived' AND r.status='succeeded'
		  AND e.source->>'kind'='changeset_revision' AND e.source->>'changesetId'=$3
		  AND e.source->>'revisionId'=$4 AND e.source->>'sha'=$5
		  AND (NOT w.strict OR e.source->>'baseSha'=$6)
		  AND EXISTS (SELECT FROM pipeline_step_runs t WHERE t.run_id=r.id AND t.status='succeeded' AND t.checked_source_sha=$5)
	)
	FROM unnest($7::text[], $8::boolean[]) AS w(id, strict)
	LEFT JOIN pipelines p ON p.organization_id=$1 AND p.repository=$2 AND p.id=w.id
	ORDER BY w.id`, org, c.Repository, string(c.ID), string(rev.ID), rev.CommitSHA, base, ids, strict)
	if err != nil {
		return nil, fmt.Errorf("verify required workflows: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var check githttp.RequiredWorkflowStatus
		var passed bool
		if err := rows.Scan(&check.PipelineID, &check.Name, &passed); err != nil {
			return nil, fmt.Errorf("read required workflow status: %w", err)
		}
		check.Status = "waiting"
		if passed {
			check.Status = "passed"
		}
		checks = append(checks, check)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read required workflow statuses: %w", err)
	}
	return checks, nil
}
