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

func (s *Store) CreateInvitation(ctx context.Context, organizationID, actorID, email, role, tokenHash string, expiresAt time.Time) (identity.OrganizationInvitation, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if strings.TrimSpace(organizationID) == "" || strings.TrimSpace(actorID) == "" ||
		!validInvitationEmail(email) || (role != "admin" && role != "member" && role != "viewer") ||
		len(tokenHash) != 64 || !expiresAt.After(time.Now()) || expiresAt.After(time.Now().Add(14*24*time.Hour)) {
		return identity.OrganizationInvitation{}, identity.ErrInvalidInvitation
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil { return identity.OrganizationInvitation{}, fmt.Errorf("begin organization invitation: %w", err) }
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", organizationID); err != nil {
		return identity.OrganizationInvitation{}, fmt.Errorf("lock organization invitations: %w", err)
	}
	actorRole, err := membershipActorRole(ctx, tx, organizationID, actorID)
	if err != nil { return identity.OrganizationInvitation{}, err }
	if actorRole != "owner" && role == "admin" { return identity.OrganizationInvitation{}, identity.ErrMembershipForbidden }

	var alreadyMember bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM organization_memberships m JOIN users u ON u.id = m.user_id
		WHERE m.organization_id = $1 AND lower(u.email) = $2 AND m.status IN ('active','suspended')
	)`, organizationID, email).Scan(&alreadyMember); err != nil {
		return identity.OrganizationInvitation{}, fmt.Errorf("check existing organization member: %w", err)
	}
	if alreadyMember { return identity.OrganizationInvitation{}, identity.ErrInvitationAlreadyMember }
	if _, err := tx.Exec(ctx, `UPDATE organization_invitations SET revoked_at = now()
		WHERE organization_id = $1 AND lower(invited_email) = $2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now()`, organizationID, email); err != nil {
		return identity.OrganizationInvitation{}, fmt.Errorf("expire previous organization invitations: %w", err)
	}
	var pending bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM organization_invitations
		WHERE organization_id = $1 AND lower(invited_email) = $2 AND accepted_at IS NULL AND revoked_at IS NULL)`, organizationID, email).Scan(&pending); err != nil {
		return identity.OrganizationInvitation{}, fmt.Errorf("check pending invitation: %w", err)
	}
	if pending { return identity.OrganizationInvitation{}, identity.ErrInvitationPending }

	id, err := newSessionID()
	if err != nil { return identity.OrganizationInvitation{}, err }
	var invitation identity.OrganizationInvitation
	err = tx.QueryRow(ctx, `INSERT INTO organization_invitations
		(id, organization_id, invited_email, role, token_hash, invited_by_user_id, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING id, invited_email, role, 'pending', invited_by_user_id, expires_at, created_at`,
		id, organizationID, email, role, tokenHash, actorID, expiresAt.UTC()).Scan(
		&invitation.ID, &invitation.Email, &invitation.Role, &invitation.Status,
		&invitation.InvitedBy, &invitation.ExpiresAt, &invitation.CreatedAt)
	if err != nil { return identity.OrganizationInvitation{}, fmt.Errorf("insert organization invitation: %w", err) }
	if err := tx.Commit(ctx); err != nil { return identity.OrganizationInvitation{}, fmt.Errorf("commit organization invitation: %w", err) }
	return invitation, nil
}

func (s *Store) ListInvitations(ctx context.Context, organizationID string, limit, offset int) ([]identity.OrganizationInvitation, error) {
	if strings.TrimSpace(organizationID) == "" || limit < 1 || limit > 100 || offset < 0 { return nil, identity.ErrInvalidInvitation }
	rows, err := s.pool.Query(ctx, `SELECT id, invited_email, role,
		CASE WHEN accepted_at IS NOT NULL THEN 'accepted' WHEN revoked_at IS NOT NULL THEN 'revoked'
		     WHEN expires_at <= now() THEN 'expired' ELSE 'pending' END,
		invited_by_user_id, expires_at, created_at
		FROM organization_invitations WHERE organization_id = $1
		ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`, organizationID, limit, offset)
	if err != nil { return nil, fmt.Errorf("list organization invitations: %w", err) }
	defer rows.Close()
	items := make([]identity.OrganizationInvitation, 0)
	for rows.Next() {
		var item identity.OrganizationInvitation
		if err := rows.Scan(&item.ID,&item.Email,&item.Role,&item.Status,&item.InvitedBy,&item.ExpiresAt,&item.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan organization invitation: %w", err)
		}
		items = append(items,item)
	}
	if err := rows.Err(); err != nil { return nil, fmt.Errorf("iterate organization invitations: %w", err) }
	return items,nil
}

func (s *Store) RevokeInvitation(ctx context.Context, organizationID, actorID, invitationID string) error {
	if strings.TrimSpace(organizationID)=="" || strings.TrimSpace(actorID)=="" || strings.TrimSpace(invitationID)=="" { return identity.ErrInvalidInvitation }
	tx, err := s.pool.Begin(ctx)
	if err != nil { return fmt.Errorf("begin invitation revocation: %w",err) }
	defer tx.Rollback(ctx)
	if _,err:=tx.Exec(ctx,"SELECT pg_advisory_xact_lock(hashtext($1))",organizationID); err!=nil { return fmt.Errorf("lock organization invitations: %w",err) }
	actorRole,err:=membershipActorRole(ctx,tx,organizationID,actorID)
	if err!=nil { return err }
	var invitedRole, invitedBy string
	err=tx.QueryRow(ctx,`SELECT role, invited_by_user_id FROM organization_invitations
		WHERE organization_id=$1 AND id=$2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`,organizationID,invitationID).Scan(&invitedRole,&invitedBy)
	if errors.Is(err,pgx.ErrNoRows) { return identity.ErrInvitationNotFound }
	if err!=nil { return fmt.Errorf("load invitation for revocation: %w",err) }
	if actorRole!="owner" && (invitedRole=="admin" || invitedBy!=actorID) { return identity.ErrMembershipForbidden }
	tag,err:=tx.Exec(ctx,`UPDATE organization_invitations SET revoked_at=now()
		WHERE organization_id=$1 AND id=$2 AND accepted_at IS NULL AND revoked_at IS NULL`,organizationID,invitationID)
	if err!=nil { return fmt.Errorf("revoke organization invitation: %w",err) }
	if tag.RowsAffected()!=1 { return identity.ErrInvitationNotFound }
	if err:=tx.Commit(ctx); err!=nil { return fmt.Errorf("commit invitation revocation: %w",err) }
	return nil
}

// AcceptInvitation consumes a single-use token only after OIDC has supplied a verified email.
func (s *Store) AcceptInvitation(ctx context.Context, tokenHash, verifiedEmail, userID string) (string, error) {
	email:=strings.ToLower(strings.TrimSpace(verifiedEmail))
	if len(tokenHash)!=64 || !validInvitationEmail(email) || strings.TrimSpace(userID)=="" { return "",identity.ErrInvitationNotFound }
	tx,err:=s.pool.Begin(ctx)
	if err!=nil { return "",fmt.Errorf("begin invitation acceptance: %w",err) }
	defer tx.Rollback(ctx)

	// Acquire the organization lock before locking the invitation row. All
	// invitation writers use this order, avoiding row/advisory-lock inversion.
	var organizationID string
	err=tx.QueryRow(ctx,"SELECT organization_id FROM organization_invitations WHERE token_hash=$1",tokenHash).Scan(&organizationID)
	if errors.Is(err,pgx.ErrNoRows) { return "",identity.ErrInvitationNotFound }
	if err!=nil { return "",fmt.Errorf("locate invitation organization: %w",err) }
	if _,err:=tx.Exec(ctx,"SELECT pg_advisory_xact_lock(hashtext($1))",organizationID); err!=nil {
		return "",fmt.Errorf("lock invitation organization: %w",err)
	}

	var role,inviterID string
	err=tx.QueryRow(ctx,`SELECT role, invited_by_user_id FROM organization_invitations
		WHERE token_hash=$1 AND organization_id=$2 AND lower(invited_email)=$3 AND expires_at>now()
		  AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE`,tokenHash,organizationID,email).Scan(&role,&inviterID)
	if errors.Is(err,pgx.ErrNoRows) { return "",identity.ErrInvitationNotFound }
	if err!=nil { return "",fmt.Errorf("verify organization invitation: %w",err) }
	var organizationActive bool
	if err:=tx.QueryRow(ctx,"SELECT status='active' FROM organizations WHERE id=$1",organizationID).Scan(&organizationActive); err!=nil {
		return "",fmt.Errorf("verify invitation organization: %w",err)
	}
	if !organizationActive { return "",identity.ErrInvitationNotFound }
	var existingStatus string
	err=tx.QueryRow(ctx,"SELECT status FROM organization_memberships WHERE organization_id=$1 AND user_id=$2 FOR UPDATE",organizationID,userID).Scan(&existingStatus)
	if err==nil && existingStatus!="removed" { return "",identity.ErrInvitationAlreadyMember }
	if err!=nil && !errors.Is(err,pgx.ErrNoRows) { return "",fmt.Errorf("check existing invitation membership: %w",err) }
	if _,err:=tx.Exec(ctx,`INSERT INTO organization_memberships (organization_id,user_id,role,status)
		VALUES ($1,$2,$3,'active')
		ON CONFLICT (organization_id,user_id) DO UPDATE SET role=EXCLUDED.role,status='active',updated_at=now()`,
		organizationID,userID,role); err!=nil { return "",fmt.Errorf("activate invited organization member: %w",err) }
	tag,err:=tx.Exec(ctx,`UPDATE organization_invitations SET accepted_at=now(),accepted_by_user_id=$2
		WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL`,tokenHash,userID)
	if err!=nil { return "",fmt.Errorf("consume organization invitation: %w",err) }
	if tag.RowsAffected()!=1 { return "",identity.ErrInvitationNotFound }
	beforeStatus:="invited"
	if existingStatus=="removed" { beforeStatus="removed" }
	if err:=insertMembershipAudit(ctx,tx,organizationID,inviterID,userID,"invite_accepted",role,role,beforeStatus,"active"); err!=nil { return "",err }
	if err:=tx.Commit(ctx); err!=nil { return "",fmt.Errorf("commit invitation acceptance: %w",err) }
	return organizationID,nil
}

func (s *Store) ListMembershipAudit(ctx context.Context, organizationID string, limit, offset int) ([]identity.MembershipAuditEvent,error) {
	if strings.TrimSpace(organizationID)=="" || limit<1 || limit>100 || offset<0 { return nil,identity.ErrInvalidMembershipChange }
	rows,err:=s.pool.Query(ctx,`SELECT id,actor_user_id,target_user_id,action,before_role,after_role,before_status,after_status,created_at
		FROM organization_membership_audit WHERE organization_id=$1
		ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,organizationID,limit,offset)
	if err!=nil { return nil,fmt.Errorf("list membership audit history: %w",err) }
	defer rows.Close()
	events:=make([]identity.MembershipAuditEvent,0)
	for rows.Next() {
		var event identity.MembershipAuditEvent
		if err:=rows.Scan(&event.ID,&event.ActorUserID,&event.TargetUserID,&event.Action,&event.BeforeRole,&event.AfterRole,&event.BeforeStatus,&event.AfterStatus,&event.CreatedAt); err!=nil {
			return nil,fmt.Errorf("scan membership audit event: %w",err)
		}
		events=append(events,event)
	}
	if err:=rows.Err();err!=nil { return nil,fmt.Errorf("iterate membership audit history: %w",err) }
	return events,nil
}

func validInvitationEmail(email string) bool {
	return len(email)>3 && len(email)<=320 && strings.Contains(email,"@") && !strings.ContainsAny(email," \t\r\n")
}
