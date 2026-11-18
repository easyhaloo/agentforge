package postgres

import "context"

// CandidateInUse is for quiesced maintenance: Git can retain a candidate before its run is committed.
func (s *Store) CandidateInUse(ctx context.Context, org, repo, sha string) (bool, error) {
	var keep bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (
   SELECT FROM pipeline_runs r WHERE r.organization_id=d.organization_id AND r.integration->>'repository'=d.slug
   AND r.integration->>'candidateSHA'=$3 AND (r.status IN ('queued','running') OR
     (r.status='succeeded' AND NOT EXISTS(SELECT FROM integration_promotions p WHERE p.run_id=r.id)
       AND (NOT (r.integration ? 'queueEntry') OR EXISTS(SELECT FROM merge_queue_entries q WHERE q.run_id=r.id AND `+activeQueue+`))))
   ) FROM delivery_repositories d WHERE organization_id=$1 AND slug=$2`, org, repo, sha).Scan(&keep)
	return keep, err
}
