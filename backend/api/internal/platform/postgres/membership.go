package postgres

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrInvitationExists = identity.ErrInvitationExists
	ErrInvitationNotFound = identity.ErrInvitationNotFound
	ErrInvitationEmailMismatch = identity.ErrInvitationEmailMismatch
	ErrAlreadyMember = identity.ErrAlreadyMember
	ErrOwnerProtected = identity.ErrOwnerProtected
	ErrMemberNotFound = identity.ErrMemberNotFound
	ErrMembershipDenied = identity.ErrMembershipDenied
)

func (s *Store) ListMembers(ctx context.Context, organizationID string) ([]identity.Member, error) {
	if strings.TrimSpace(organizationID) == "" {
		return nil, errors.New("organization ID is required")
	}
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.display_name, COALESCE(CASE WHEN u.email_verified THEN u.email ELSE NULL END, ''),
		       m.role, m.status, m.created_at, m.updated_at
		FROM organization_memberships AS m
		JOIN users AS u ON u.id = m.user_id
		WHERE m.organization_id = $1
		ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
		         u.display_name ASC, u.id ASC
	`, organizationID)
	if err != nil {
		return nil, fmt.Errorf("list organization members: %w", err)
	}
	defer rows.Close()

	members := make([]identity.Member, 0)
	for rows.Next() {
		var member identity.Member
		if err := rows.Scan(&member.UserID, &member.DisplayName, &member.Email, &member.Role, &member.Status, &member.CreatedAt, &member.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan organization member: %w", err)
		}
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate organization members: %w", err)
	}
	return members, nil
}

func (s *Store) CreateInvitation(ctx context.Context, organizationID, actorID, actorRole, email, role, tokenHash string, expiresAt time.Time) (identity.Invitation, error) {
	email = strings.TrimSpace(email)
	parsedEmail, err := mail.ParseAddress(email)
	if err != nil || parsedEmail.Address != email || len(email) > 320 {
		return identity.Invitation{}, errors.New("a valid email address is required")
	}
	email = strings.ToLower(email)
	if len(tokenHash) != 64 || !expiresAt.After(time.Now()) ||
		(role != "admin" && role != "member" && role != "viewer") {
		return identity.Invitation{}, errors.New("invalid invitation parameters")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return identity.Invitation{}, fmt.Errorf("begin organization invitation: %w", err)
	}
	defer tx.Rollback(ctx)

	actualRole, err := activeActorRole(ctx, tx, organizationID, actorID)
	if err != nil {
		return identity.Invitation{}, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE organization_invitations SET revoked_at = now()
		WHERE organization_id = $1 AND lower(email) = $2
		  AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now()
	`, organizationID, email); err != nil {
		return identity.Invitation{}, fmt.Errorf("expire stale organization invitations: %w", err)
	}
	if actualRole != actorRole || !identity.CanInviteRole(actualRole, role) {
		return identity.Invitation{}, ErrMembershipDenied
	}

	id, err := newSessionID()
	if err != nil {
		return identity.Invitation{}, err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO organization_invitations (id, organization_id, email, role, token_hash, invited_by_user_id, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, id, organizationID, email, role, tokenHash, actorID, expiresAt.UTC())
	if err != nil {
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "23505" {
			return identity.Invitation{}, ErrInvitationExists
		}
		return identity.Invitation{}, fmt.Errorf("insert organization invitation: %w", err)
	}
	if err := insertMembershipEvent(ctx, tx, organizationID, actorID, "", "invitation.created", email, "", role, "", "invited"); err != nil {
		return identity.Invitation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return identity.Invitation{}, fmt.Errorf("commit organization invitation: %w", err)
	}
	return identity.Invitation{ID: id, Email: email, Role: role, ExpiresAt: expiresAt.UTC()}, nil
}

func (s *Store) UpdateMembership(ctx context.Context, organizationID, actorID, actorRole, targetUserID, nextRole, nextStatus string) (identity.Member, error) {
	if strings.TrimSpace(organizationID) == "" || strings.TrimSpace(targetUserID) == "" ||
		(nextRole != "admin" && nextRole != "member" && nextRole != "viewer") ||
		(nextStatus != "active" && nextStatus != "suspended") {
		return identity.Member{}, errors.New("invalid membership update")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return identity.Member{}, fmt.Errorf("begin membership update: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", organizationID); err != nil {
		return identity.Member{}, fmt.Errorf("lock organization membership: %w", err)
	}
	actualActorRole, err := activeActorRole(ctx, tx, organizationID, actorID)
	if err != nil {
		return identity.Member{}, err
	}
	if actualActorRole != actorRole {
		return identity.Member{}, ErrMembershipDenied
	}

	var previousRole, previousStatus string
	err = tx.QueryRow(ctx, `
		SELECT role, status FROM organization_memberships
		WHERE organization_id = $1 AND user_id = $2 FOR UPDATE
	`, organizationID, targetUserID).Scan(&previousRole, &previousStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.Member{}, ErrMemberNotFound
	}
	if err != nil {
		return identity.Member{}, fmt.Errorf("load target membership: %w", err)
	}
	if previousRole == "owner" {
		return identity.Member{}, ErrOwnerProtected
	}
	if !identity.CanChangeMember(actualActorRole, previousRole, nextRole) {
		return identity.Member{}, ErrMembershipDenied
	}

	_, err = tx.Exec(ctx, `
		UPDATE organization_memberships
		SET role = $3, status = $4, updated_at = now()
		WHERE organization_id = $1 AND user_id = $2
	`, organizationID, targetUserID, nextRole, nextStatus)
	if err != nil {
		return identity.Member{}, fmt.Errorf("update organization membership: %w", err)
	}
	eventType := "member.role_changed"
	if previousRole == nextRole && previousStatus != nextStatus {
		if nextStatus == "suspended" {
			eventType = "member.suspended"
		} else {
			eventType = "member.reactivated"
		}
	}
	if err := insertMembershipEvent(ctx, tx, organizationID, actorID, targetUserID, eventType, "", previousRole, nextRole, previousStatus, nextStatus); err != nil {
		return identity.Member{}, err
	}

	var member identity.Member
	err = tx.QueryRow(ctx, `
		SELECT u.id, u.display_name, CASE WHEN u.email_verified THEN u.email ELSE NULL END,
		       m.role, m.status, m.created_at, m.updated_at
		FROM organization_memberships AS m
		JOIN users AS u ON u.id = m.user_id
		WHERE m.organization_id = $1 AND m.user_id = $2
	`, organizationID, targetUserID).Scan(&member.UserID, &member.DisplayName, &member.Email, &member.Role, &member.Status, &member.CreatedAt, &member.UpdatedAt)
	if err != nil {
		return identity.Member{}, fmt.Errorf("load updated membership: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return identity.Member{}, fmt.Errorf("commit membership update: %w", err)
	}
	return member, nil
}

func (s *Store) RemoveMembership(ctx context.Context, organizationID, actorID, actorRole, targetUserID string) error {
	if strings.TrimSpace(organizationID) == "" || strings.TrimSpace(targetUserID) == "" {
		return errors.New("organization and target user IDs are required")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin membership removal: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", organizationID); err != nil {
		return fmt.Errorf("lock organization membership: %w", err)
	}
	actualActorRole, err := activeActorRole(ctx, tx, organizationID, actorID)
	if err != nil {
		return err
	}
	if actualActorRole != actorRole {
		return ErrMembershipDenied
	}

	var targetRole, targetStatus string
	err = tx.QueryRow(ctx, "SELECT role, status FROM organization_memberships WHERE organization_id = $1 AND user_id = $2 FOR UPDATE", organizationID, targetUserID).Scan(&targetRole, &targetStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrMemberNotFound
	}
	if err != nil {
		return fmt.Errorf("load target membership: %w", err)
	}
	if targetRole == "owner" {
		return ErrOwnerProtected
	}
	if !identity.CanRemoveMember(actualActorRole, targetRole) {
		return ErrMembershipDenied
	}
	if err := insertMembershipEvent(ctx, tx, organizationID, actorID, targetUserID, "member.removed", "", targetRole, "", targetStatus, "removed"); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "DELETE FROM organization_memberships WHERE organization_id = $1 AND user_id = $2", organizationID, targetUserID); err != nil {
		return fmt.Errorf("delete organization membership: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit membership removal: %w", err)
	}
	return nil
}

func (s *Store) AcceptInvitation(ctx context.Context, sessionToken, invitationToken string) (string, error) {
	if len(sessionToken) < 32 || len(sessionToken) > 128 || len(invitationToken) < 32 || len(invitationToken) > 128 {
		return "", identity.ErrUnauthenticated
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin invitation acceptance: %w", err)
	}
	defer tx.Rollback(ctx)

	var userID, email string
	var emailVerified bool
	err = tx.QueryRow(ctx, `
		SELECT u.id, COALESCE(u.email, ''), u.email_verified
		FROM sessions AS s JOIN users AS u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.expires_at > now() AND s.revoked_at IS NULL
		FOR SHARE OF s
	`, identity.HashToken(sessionToken)).Scan(&userID, &email, &emailVerified)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", identity.ErrUnauthenticated
	}
	if err != nil {
		return "", fmt.Errorf("resolve invitation accepting session: %w", err)
	}

	var invitationID, organizationID, invitedEmail, role string
	err = tx.QueryRow(ctx, `
		SELECT i.id, i.organization_id, i.email, i.role
		FROM organization_invitations AS i
		JOIN organizations AS o ON o.id = i.organization_id AND o.status = 'active'
		WHERE i.token_hash = $1 AND i.expires_at > now()
		  AND i.accepted_at IS NULL AND i.revoked_at IS NULL
		FOR UPDATE
	`, identity.HashToken(invitationToken)).Scan(&invitationID, &organizationID, &invitedEmail, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrInvitationNotFound
	}
	if err != nil {
		return "", fmt.Errorf("load invitation: %w", err)
	}
	if !emailVerified || !strings.EqualFold(strings.TrimSpace(email), invitedEmail) {
		return "", ErrInvitationEmailMismatch
	}

	var existingRole, existingStatus string
	err = tx.QueryRow(ctx, "SELECT role, status FROM organization_memberships WHERE organization_id = $1 AND user_id = $2 FOR UPDATE", organizationID, userID).Scan(&existingRole, &existingStatus)
	if err == nil {
		if existingRole == "owner" || existingStatus == "active" {
			return "", ErrAlreadyMember
		}
		_, err = tx.Exec(ctx, `
			UPDATE organization_memberships SET role = $3, status = 'active', updated_at = now()
			WHERE organization_id = $1 AND user_id = $2
		`, organizationID, userID, role)
	} else if errors.Is(err, pgx.ErrNoRows) {
		_, err = tx.Exec(ctx, `
			INSERT INTO organization_memberships (organization_id, user_id, role, status)
			VALUES ($1, $2, $3, 'active')
		`, organizationID, userID, role)
	}
	if err != nil {
		return "", fmt.Errorf("create invited organization membership: %w", err)
	}

	if _, err := tx.Exec(ctx, "UPDATE organization_invitations SET accepted_at = now(), accepted_by_user_id = $2 WHERE id = $1", invitationID, userID); err != nil {
		return "", fmt.Errorf("mark invitation accepted: %w", err)
	}
	if err := insertMembershipEvent(ctx, tx, organizationID, userID, userID, "invitation.accepted", invitedEmail, "", role, "", "active"); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit invitation acceptance: %w", err)
	}
	return organizationID, nil
}

func activeActorRole(ctx context.Context, tx pgx.Tx, organizationID, actorID string) (string, error) {
	var role string
	err := tx.QueryRow(ctx, `
		SELECT m.role FROM organization_memberships AS m
		JOIN organizations AS o ON o.id = m.organization_id
		WHERE m.organization_id = $1 AND m.user_id = $2
		  AND m.status = 'active' AND o.status = 'active'
	`, organizationID, actorID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrMembershipDenied
	}
	if err != nil {
		return "", fmt.Errorf("resolve acting organization membership: %w", err)
	}
	return role, nil
}

func insertMembershipEvent(ctx context.Context, tx pgx.Tx, organizationID, actorID, targetID, eventType, email, previousRole, newRole, previousStatus, newStatus string) error {
	id, err := newSessionID()
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO organization_membership_events (
			id, organization_id, actor_user_id, target_user_id, event_type, email,
			previous_role, new_role, previous_status, new_status
		) VALUES ($1, $2, $3, NULLIF($4, ''), $5, NULLIF($6, ''),
		          NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''), NULLIF($10, ''))
	`, id, organizationID, actorID, targetID, eventType, email, previousRole, newRole, previousStatus, newStatus)
	if err != nil {
		return fmt.Errorf("append organization membership event: %w", err)
	}
	return nil
}
