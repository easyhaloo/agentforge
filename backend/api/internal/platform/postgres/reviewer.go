package postgres

import (
	"context"
	"strings"
)

func (s *Store) IsActiveMember(ctx context.Context, organizationID, userID string) (bool,error) {
	if strings.TrimSpace(organizationID)=="" || strings.TrimSpace(userID)=="" { return false,nil }
	var active bool
	err:=s.pool.QueryRow(ctx,`
		SELECT EXISTS (
			SELECT 1 FROM organization_memberships m
			JOIN organizations o ON o.id=m.organization_id
			WHERE m.organization_id=$1 AND m.user_id=$2
			AND m.status='active' AND o.status='active'
		)`,organizationID,userID).Scan(&active)
	return active,err
}
