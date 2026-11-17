package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

var (
	ErrMembershipNotFound = errors.New("organization membership not found")
	ErrMembershipForbidden = errors.New("membership operation forbidden")
	ErrLastActiveOwner = errors.New("organization must retain at least one active owner")
	ErrInvalidMembershipChange = errors.New("invalid membership change")
)


func (s *Store) ListMembers(ctx context.Context, organizationID string, limit, offset int) ([]identity.OrganizationMember, error) {
	if strings.TrimSpace(organizationID) == "" || limit < 1 || limit > 100 || offset < 0 {
		return nil, ErrInvalidMembershipChange
	}
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.display_name, COALESCE(u.email, ''), m.role, m.status, m.created_at, m.updated_at
		FROM organization_memberships AS m
		JOIN users AS u ON u.id = m.user_id
		JOIN organizations AS o ON o.id = m.organization_id
		WHERE m.organization_id = $1 AND o.status = 'active' AND m.status <> 'removed'
		ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
		         u.display_name ASC, u.id ASC
		LIMIT $2 OFFSET $3
	`, organizationID, limit, offset)
	if err != nil { return nil, fmt.Errorf("list organization members: %w", err) }
	defer rows.Close()
	members := make([]Member, 0)
	for rows.Next() {
		var member identity.OrganizationMember
		if err := rows.Scan(&member.UserID, &member.DisplayName, &member.Email, &member.Role, &member.Status, &member.CreatedAt, &member.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan organization member: %w", err)
		}
		members = append(members, member)
	}
	if err := rows.Err(); err != nil { return nil, fmt.Errorf("iterate organization members: %w", err) }
	return members, nil
}

func (s *Store) UpdateMembership(ctx context.Context, organizationID, actorID, targetID string, role, status *string) (identity.OrganizationMember, error) {
	if strings.TrimSpace(organizationID) == "" || strings.TrimSpace(actorID) == "" || strings.TrimSpace(targetID) == "" ||
		(role == nil && status == nil) || (role != nil && !validMembershipRole(*role)) ||
		(status != nil && *status != "active" && *status != "suspended") {
		return identity.OrganizationMember{}, ErrInvalidMembershipChange
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil { return Member{}, fmt.Errorf("begin membership update: %w", err) }
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", organizationID); err != nil {
		return Member{}, fmt.Errorf("lock organization membership changes: %w", err)
	}
	actorRole, err := membershipActorRole(ctx, tx, organizationID, actorID)
	if err != nil { return Member{}, err }
	var before identity.OrganizationMember
	err = tx.QueryRow(ctx, `
		SELECT u.id, u.display_name, COALESCE(u.email, ''), m.role, m.status, m.created_at, m.updated_at
		FROM organization_memberships m JOIN users u ON u.id = m.user_id
		WHERE m.organization_id = $1 AND m.user_id = $2 FOR UPDATE OF m
	`, organizationID, targetID).Scan(&before.UserID, &before.DisplayName, &before.Email, &before.Role, &before.Status, &before.CreatedAt, &before.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) { return Member{}, ErrMembershipNotFound }
	if err != nil { return Member{}, fmt.Errorf("load target membership: %w", err) }
	if before.Status == "removed" { return Member{}, ErrMembershipNotFound }
	if actorRole != "owner" {
		if actorRole != "admin" || before.Role == "owner" || before.Role == "admin" ||
			(role != nil && (*role == "owner" || *role == "admin")) {
			return Member{}, ErrMembershipForbidden
		}
	}
	afterRole, afterStatus := before.Role, before.Status
	if role != nil { afterRole = *role }
	if status != nil { afterStatus = *status }
	if before.Role == afterRole && before.Status == afterStatus { return before, ErrInvalidMembershipChange }
	if before.Role == "owner" && before.Status == "active" && (afterRole != "owner" || afterStatus != "active") {
		var owners int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM organization_memberships
			WHERE organization_id = $1 AND role = 'owner' AND status = 'active'`, organizationID).Scan(&owners); err != nil {
			return Member{}, fmt.Errorf("count active owners: %w", err)
		}
		if owners <= 1 { return Member{}, ErrLastActiveOwner }
	}
	if _, err := tx.Exec(ctx, `
		UPDATE organization_memberships SET role = $3, status = $4, updated_at = now()
		WHERE organization_id = $1 AND user_id = $2
	`, organizationID, targetID, afterRole, afterStatus); err != nil {
		return Member{}, fmt.Errorf("update organization membership: %w", err)
	}
	action := "role_changed"
	if before.Status != afterStatus {
		if afterStatus == "suspended" { action = "suspended" } else { action = "reactivated" }
	}
	if err := insertMembershipAudit(ctx, tx, organizationID, actorID, targetID, action, before.Role, afterRole, before.Status, afterStatus); err != nil {
		return Member{}, err
	}
	if err := tx.Commit(ctx); err != nil { return Member{}, fmt.Errorf("commit membership update: %w", err) }
	before.Role, before.Status, before.UpdatedAt = afterRole, afterStatus, time.Now().UTC()
	return before, nil
}

func (s *Store) RemoveMembership(ctx context.Context, organizationID, actorID, targetID string) error {
	if strings.TrimSpace(organizationID) == "" || strings.TrimSpace(actorID) == "" || strings.TrimSpace(targetID) == "" {
		return ErrInvalidMembershipChange
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil { return fmt.Errorf("begin membership removal: %w", err) }
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", organizationID); err != nil {
		return fmt.Errorf("lock organization membership changes: %w", err)
	}
	actorRole, err := membershipActorRole(ctx, tx, organizationID, actorID)
	if err != nil { return err }
	var before Member
	err = tx.QueryRow(ctx, `
		SELECT u.id, u.display_name, COALESCE(u.email, ''), m.role, m.status, m.created_at, m.updated_at
		FROM organization_memberships m JOIN users u ON u.id = m.user_id
		WHERE m.organization_id = $1 AND m.user_id = $2 FOR UPDATE OF m
	`, organizationID, targetID).Scan(&before.UserID, &before.DisplayName, &before.Email, &before.Role, &before.Status, &before.CreatedAt, &before.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) || before.Status == "removed" { return ErrMembershipNotFound }
	if err != nil { return fmt.Errorf("load target membership: %w", err) }
	if actorRole != "owner" && (actorRole != "admin" || before.Role == "owner" || before.Role == "admin") {
		return ErrMembershipForbidden
	}
	if before.Role == "owner" && before.Status == "active" {
		var owners int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM organization_memberships
			WHERE organization_id = $1 AND role = 'owner' AND status = 'active'`, organizationID).Scan(&owners); err != nil {
			return fmt.Errorf("count active owners: %w", err)
		}
		if owners <= 1 { return ErrLastActiveOwner }
	}
	if _, err := tx.Exec(ctx, `UPDATE organization_memberships SET status = 'removed', updated_at = now()
		WHERE organization_id = $1 AND user_id = $2`, organizationID, targetID); err != nil {
		return fmt.Errorf("remove organization membership: %w", err)
	}
	if err := insertMembershipAudit(ctx, tx, organizationID, actorID, targetID, "removed", before.Role, before.Role, before.Status, "removed"); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil { return fmt.Errorf("commit membership removal: %w", err) }
	return nil
}

func membershipActorRole(ctx context.Context, tx pgx.Tx, organizationID, actorID string) (string, error) {
	var role string
	err := tx.QueryRow(ctx, `SELECT m.role FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
		WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active' AND o.status = 'active'`, organizationID, actorID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) { return "", ErrMembershipForbidden }
	if err != nil { return "", fmt.Errorf("verify membership administrator: %w", err) }
	if role != "owner" && role != "admin" { return "", ErrMembershipForbidden }
	return role, nil
}

func insertMembershipAudit(ctx context.Context, tx pgx.Tx, organizationID, actorID, targetID, action, beforeRole, afterRole, beforeStatus, afterStatus string) error {
	id, err := newSessionID()
	if err != nil { return fmt.Errorf("generate membership audit ID: %w", err) }
	_, err = tx.Exec(ctx, `INSERT INTO organization_membership_audit
		(id, organization_id, actor_user_id, target_user_id, action, before_role, after_role, before_status, after_status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		id, organizationID, actorID, targetID, action, beforeRole, afterRole, beforeStatus, afterStatus)
	if err != nil { return fmt.Errorf("record membership audit: %w", err) }
	return nil
}

func validMembershipRole(role string) bool {
	switch role { case "owner", "admin", "member", "viewer": return true }
	return false
}

var _ = errors.Is
