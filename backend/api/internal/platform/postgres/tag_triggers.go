package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
)

// EnqueueTagRuns inserts one trigger event per enabled tag binding of the repository.
// The unique index on (binding, ref, sha) makes replays idempotent, so journal recovery can
// call this again without duplicating runs. The caller peels annotation tags with
// ResolveRevision, so sha is always the commit, never the tag object.
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
	_, err := s.pool.Exec(ctx, `INSERT INTO pipeline_trigger_events(binding_id,source)
	SELECT b.id,jsonb_build_object('kind','tag','bindingId',b.id,'repository',b.repository,'ref',$3,'tag',$4,'sha',$5)
	FROM pipeline_trigger_bindings b
	JOIN pipelines p ON (p.organization_id,p.id)=(b.organization_id,b.pipeline_id)
	JOIN delivery_repositories r ON (r.organization_id,r.slug)=(b.organization_id,b.repository)
	WHERE b.enabled AND NOT p.disabled AND NOT r.actions_disabled AND p.status<>'archived'
	  AND b.organization_id=$1 AND b.repository=$2 AND b.tag_pattern IS NOT NULL
	ON CONFLICT DO NOTHING`, org, repository, ref, tag, sha)
	if err != nil {
		return fmt.Errorf("enqueue tag trigger events: %w", err)
	}
	return nil
}
