package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

// Organization lifecycle errors. ErrLastOwner is unused for now (ownership
// transfer demotes the actor only after promoting the target) but guards the
// invariant in tests.
var (
	ErrOrganizationNotFound     = errors.New("organization not found")
	ErrOrganizationNotSuspended = errors.New("organization is not suspended")
	ErrSlugUnavailable          = errors.New("slug unavailable")
	ErrSlugInvalid              = errors.New("slug invalid")
	ErrLastOwner                = identity.ErrLastActiveOwner
)

// organizationSlugPattern is the SPEC's stricter client-facing pattern
// (3–39 characters) used for user-supplied slugs; migration 007's check
// constraint allows 1–39 for legacy rows.
var organizationSlugPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{1,37}[a-z0-9])$`)

// ValidOrganizationSlug reports whether slug is acceptable for the URL check
// constraint. 'current' is reserved by the delivery web routes. Delegates to
// identity.ValidateOrganizationSlug, which enforces the same pattern as the
// organizations_slug_check constraint and the SPEC URL regex.
func ValidOrganizationSlug(slug string) bool {
	return identity.ValidateOrganizationSlug(slug) == nil
}

// OrganizationLifecycle is the persisted lifecycle state of an organization.
type OrganizationLifecycle struct {
	ID                  string     `json:"id"`
	Name                string     `json:"name"`
	Slug                string     `json:"slug"`
	Status              string     `json:"status"`
	SuspendedAt         *time.Time `json:"suspended_at,omitempty"`
	SuspendedReason     string     `json:"suspended_reason,omitempty"`
	DeletionScheduledAt *time.Time `json:"deletion_scheduled_at,omitempty"`
	Version             int64      `json:"version"`
}

// organizationAuditActions are the lifecycle events recorded in
// organization_audit_events.
const (
	auditRenamed      = "organization.renamed"
	auditSlugChanged  = "organization.slug_changed"
	auditTransferred  = "organization.ownership_transferred"
	auditSuspended    = "organization.suspended"
	auditResumed      = "organization.resumed"
	auditDeletionSet  = "organization.deletion_scheduled"
	auditDeletionGone = "organization.deletion_cancelled"
	auditCreated      = "organization.created"
)

func insertOrganizationAudit(ctx context.Context, tx pgx.Tx, organizationID, actorID, action string, detail map[string]any) error {
	payload, err := json.Marshal(detail)
	if err != nil {
		return fmt.Errorf("encode lifecycle audit detail: %w", err)
	}
	id, err := newSessionID()
	if err != nil {
		return fmt.Errorf("generate lifecycle audit id: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO organization_audit_events (id, organization_id, actor_user_id, action, detail)
		VALUES ($1, $2, $3, $4, $5)
	`, id, organizationID, actorID, action, payload); err != nil {
		return fmt.Errorf("insert lifecycle audit: %w", err)
	}
	return nil
}

// UpdateOrganization renames the organization and/or changes its slug.
// Slug changes retire the previous slug into organization_slug_history for
// the grace window, where it redirects and cannot be claimed. expectedVersion
// implements optimistic concurrency on organizations.updated_at.
func (s *Store) UpdateOrganization(ctx context.Context, organizationID, actorID string, name, slug *string, grace time.Duration, expectedVersion int64) (OrganizationLifecycle, error) {
	if strings.TrimSpace(organizationID) == "" || strings.TrimSpace(actorID) == "" || (name == nil && slug == nil) {
		return OrganizationLifecycle{}, ErrInvalidMembershipChange
	}
	if name != nil && strings.TrimSpace(*name) == "" {
		return OrganizationLifecycle{}, ErrSlugInvalid
	}
	if slug != nil {
		*slug = strings.ToLower(strings.TrimSpace(*slug))
		if !ValidOrganizationSlug(*slug) {
			return OrganizationLifecycle{}, ErrSlugInvalid
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("begin organization update: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext('agentforge:organization-handles'))"); err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("lock organization handles: %w", err)
	}
	var current OrganizationLifecycle
	var updatedAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT id, name, COALESCE(slug, id), status, suspended_at, suspended_reason, deletion_scheduled_at,
		       EXTRACT(EPOCH FROM updated_at)::bigint AS version, updated_at
		FROM organizations WHERE id = $1 FOR UPDATE
	`, organizationID).Scan(&current.ID, &current.Name, &current.Slug, &current.Status,
		&current.SuspendedAt, &current.SuspendedReason, &current.DeletionScheduledAt, &current.Version, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return OrganizationLifecycle{}, ErrOrganizationNotFound
	}
	if err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("load organization: %w", err)
	}
	if current.Status != "active" {
		return OrganizationLifecycle{}, ErrOrganizationInactive
	}
	if expectedVersion > 0 && updatedAt.Unix() != expectedVersion {
		return OrganizationLifecycle{}, ErrVersionConflict
	}

	newName, newSlug := current.Name, current.Slug
	if name != nil {
		newName = strings.TrimSpace(*name)
	}
	if slug != nil && *slug != current.Slug {
		if err := reserveSlug(ctx, tx, *slug, organizationID, current.Slug, grace); err != nil {
			return OrganizationLifecycle{}, err
		}
		newSlug = *slug
	}
	if newName == current.Name && newSlug == current.Slug {
		return current, nil
	}
	if _, err := tx.Exec(ctx, `UPDATE organizations SET name = $2, slug = $3, updated_at = now() WHERE id = $1`,
		organizationID, newName, newSlug); err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("update organization: %w", err)
	}
	if newName != current.Name {
		if err := insertOrganizationAudit(ctx, tx, organizationID, actorID, auditRenamed,
			map[string]any{"from": current.Name, "to": newName}); err != nil {
			return OrganizationLifecycle{}, err
		}
	}
	if newSlug != current.Slug {
		if err := insertOrganizationAudit(ctx, tx, organizationID, actorID, auditSlugChanged,
			map[string]any{"from": current.Slug, "to": newSlug, "redirect_expires_at": time.Now().Add(grace).UTC()}); err != nil {
			return OrganizationLifecycle{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("commit organization update: %w", err)
	}
	current.Name, current.Slug = newName, newSlug
	return current, nil
}

// reserveSlug verifies that candidate is free against live slugs and
// unexpired retired slugs, then retires currentSlug into the history table.
func reserveSlug(ctx context.Context, tx pgx.Tx, candidate, organizationID, currentSlug string, grace time.Duration) error {
	expires := time.Now().Add(grace).UTC()
	var taken bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM organizations WHERE slug = $1 AND id <> $2)
		  OR EXISTS (SELECT 1 FROM organization_slug_history WHERE slug = $1 AND expires_at > now() AND organization_id <> $2)
	`, candidate, organizationID).Scan(&taken); err != nil {
		return fmt.Errorf("probe slug availability: %w", err)
	}
	if taken {
		return ErrSlugUnavailable
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO organization_slug_history (organization_id, slug, retired_at, expires_at)
		VALUES ($1, $2, now(), $3)
		ON CONFLICT (organization_id, slug) DO UPDATE SET retired_at = now(), expires_at = EXCLUDED.expires_at
	`, organizationID, currentSlug, expires); err != nil {
		return fmt.Errorf("retire slug: %w", err)
	}
	return nil
}

// ResolveSlugRedirect maps a retired slug to the organization that owned it,
// if the reservation has not expired.
func (s *Store) ResolveSlugRedirect(ctx context.Context, slug string) (string, error) {
	var organizationID string
	err := s.pool.QueryRow(ctx, `
		SELECT organization_id FROM organization_slug_history
		WHERE slug = $1 AND expires_at > now()
	`, strings.ToLower(strings.TrimSpace(slug))).Scan(&organizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrOrganizationNotFound
	}
	if err != nil {
		return "", fmt.Errorf("resolve retired slug: %w", err)
	}
	return organizationID, nil
}

// SuspendOrganization marks the organization suspended and records the reason.
func (s *Store) SuspendOrganization(ctx context.Context, organizationID, actorID, reason string) (OrganizationLifecycle, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("begin suspend: %w", err)
	}
	defer tx.Rollback(ctx)
	var lifecycle OrganizationLifecycle
	err = tx.QueryRow(ctx, `
		UPDATE organizations SET status = 'suspended', suspended_at = now(), suspended_reason = $2, updated_at = now()
		WHERE id = $1 AND status = 'active'
		RETURNING id, name, COALESCE(slug, id), status, suspended_at, suspended_reason, deletion_scheduled_at
	`, organizationID, strings.TrimSpace(reason)).Scan(&lifecycle.ID, &lifecycle.Name, &lifecycle.Slug, &lifecycle.Status,
		&lifecycle.SuspendedAt, &lifecycle.SuspendedReason, &lifecycle.DeletionScheduledAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return OrganizationLifecycle{}, ErrOrganizationNotSuspended
	}
	if err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("suspend organization: %w", err)
	}
	if err := insertOrganizationAudit(ctx, tx, organizationID, actorID, auditSuspended,
		map[string]any{"reason": strings.TrimSpace(reason)}); err != nil {
		return OrganizationLifecycle{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("commit suspend: %w", err)
	}
	return lifecycle, nil
}

// ResumeOrganization returns a suspended organization to active. Pending
// deletion organizations must cancel deletion first.
func (s *Store) ResumeOrganization(ctx context.Context, organizationID, actorID string) (OrganizationLifecycle, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("begin resume: %w", err)
	}
	defer tx.Rollback(ctx)
	var lifecycle OrganizationLifecycle
	err = tx.QueryRow(ctx, `
		UPDATE organizations SET status = 'active', suspended_at = NULL, suspended_reason = '', updated_at = now()
		WHERE id = $1 AND status = 'suspended'
		RETURNING id, name, COALESCE(slug, id), status, suspended_at, suspended_reason, deletion_scheduled_at
	`, organizationID).Scan(&lifecycle.ID, &lifecycle.Name, &lifecycle.Slug, &lifecycle.Status,
		&lifecycle.SuspendedAt, &lifecycle.SuspendedReason, &lifecycle.DeletionScheduledAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return OrganizationLifecycle{}, ErrOrganizationNotSuspended
	}
	if err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("resume organization: %w", err)
	}
	if err := insertOrganizationAudit(ctx, tx, organizationID, actorID, auditResumed, map[string]any{}); err != nil {
		return OrganizationLifecycle{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("commit resume: %w", err)
	}
	return lifecycle, nil
}

// ScheduleOrganizationDeletion marks a suspended organization pending_deletion
// and stamps the deadline (deletion_scheduled_at = now() + grace).
func (s *Store) ScheduleOrganizationDeletion(ctx context.Context, organizationID, actorID string, grace time.Duration) (OrganizationLifecycle, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("begin deletion schedule: %w", err)
	}
	defer tx.Rollback(ctx)
	var lifecycle OrganizationLifecycle
	err = tx.QueryRow(ctx, `
		UPDATE organizations
		SET status = 'pending_deletion', deletion_scheduled_at = now() + make_interval(secs => $2), updated_at = now()
		WHERE id = $1 AND status = 'suspended'
		RETURNING id, name, COALESCE(slug, id), status, suspended_at, suspended_reason, deletion_scheduled_at
	`, organizationID, grace.Seconds()).Scan(&lifecycle.ID, &lifecycle.Name, &lifecycle.Slug, &lifecycle.Status,
		&lifecycle.SuspendedAt, &lifecycle.SuspendedReason, &lifecycle.DeletionScheduledAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return OrganizationLifecycle{}, ErrOrganizationNotSuspended
	}
	if err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("schedule deletion: %w", err)
	}
	if err := insertOrganizationAudit(ctx, tx, organizationID, actorID, auditDeletionSet,
		map[string]any{"scheduled_at": lifecycle.DeletionScheduledAt}); err != nil {
		return OrganizationLifecycle{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("commit deletion schedule: %w", err)
	}
	return lifecycle, nil
}

// CancelOrganizationDeletion restores a pending_deletion organization to
// suspended (SPEC: deletion can only be cancelled back to suspended).
func (s *Store) CancelOrganizationDeletion(ctx context.Context, organizationID, actorID string) (OrganizationLifecycle, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("begin deletion cancel: %w", err)
	}
	defer tx.Rollback(ctx)
	var lifecycle OrganizationLifecycle
	err = tx.QueryRow(ctx, `
		UPDATE organizations SET status = 'suspended', deletion_scheduled_at = NULL, updated_at = now()
		WHERE id = $1 AND status = 'pending_deletion'
		RETURNING id, name, COALESCE(slug, id), status, suspended_at, suspended_reason, deletion_scheduled_at
	`, organizationID).Scan(&lifecycle.ID, &lifecycle.Name, &lifecycle.Slug, &lifecycle.Status,
		&lifecycle.SuspendedAt, &lifecycle.SuspendedReason, &lifecycle.DeletionScheduledAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return OrganizationLifecycle{}, ErrOrganizationNotSuspended
	}
	if err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("cancel deletion: %w", err)
	}
	if err := insertOrganizationAudit(ctx, tx, organizationID, actorID, auditDeletionGone, map[string]any{}); err != nil {
		return OrganizationLifecycle{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("commit deletion cancel: %w", err)
	}
	return lifecycle, nil
}

// MarkOrganizationsDeleted stamps deleted_at on organizations whose grace
// window has expired. This version only marks; data purge is intentionally
// deferred (documented in the SPEC deviation notes).
func (s *Store) MarkOrganizationsDeleted(ctx context.Context) (int, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE organizations SET deleted_at = now(), updated_at = now()
		WHERE status = 'pending_deletion' AND deletion_scheduled_at <= now() AND deleted_at IS NULL
	`)
	if err != nil {
		return 0, fmt.Errorf("mark deleted organizations: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// TransferOrganizationOwnership hands the owner role to targetUserID inside
// one transaction: an advisory lock serializes concurrent transfers, the
// target must be an active member, and the actor's owner role is demoted to
// admin, so the organization always keeps at least one active owner.
func (s *Store) TransferOrganizationOwnership(ctx context.Context, organizationID, actorID, targetUserID string) (identity.OrganizationMember, error) {
	if strings.TrimSpace(organizationID) == "" || strings.TrimSpace(actorID) == "" ||
		strings.TrimSpace(targetUserID) == "" || actorID == targetUserID {
		return identity.OrganizationMember{}, ErrInvalidMembershipChange
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return identity.OrganizationMember{}, fmt.Errorf("begin ownership transfer: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", organizationID); err != nil {
		return identity.OrganizationMember{}, fmt.Errorf("lock organization membership changes: %w", err)
	}
	actorRole, err := membershipActorRole(ctx, tx, organizationID, actorID)
	if err != nil {
		return identity.OrganizationMember{}, err
	}
	if actorRole != "owner" {
		return identity.OrganizationMember{}, ErrMembershipForbidden
	}
	var status string
	err = tx.QueryRow(ctx, `
		SELECT m.status FROM organization_memberships m
		WHERE m.organization_id = $1 AND m.user_id = $2 FOR UPDATE OF m
	`, organizationID, targetUserID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.OrganizationMember{}, ErrMembershipNotFound
	}
	if err != nil {
		return identity.OrganizationMember{}, fmt.Errorf("load transfer target: %w", err)
	}
	if status != "active" {
		return identity.OrganizationMember{}, ErrInvalidMembershipChange
	}
	if _, err := tx.Exec(ctx, `
		UPDATE organization_memberships SET role = 'admin', updated_at = now()
		WHERE organization_id = $1 AND user_id = $2 AND role = 'owner'
	`, organizationID, actorID); err != nil {
		return identity.OrganizationMember{}, fmt.Errorf("demote previous owner: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE organization_memberships SET role = 'owner', updated_at = now()
		WHERE organization_id = $1 AND user_id = $2
	`, organizationID, targetUserID); err != nil {
		return identity.OrganizationMember{}, fmt.Errorf("promote new owner: %w", err)
	}
	var member identity.OrganizationMember
	err = tx.QueryRow(ctx, `
		SELECT u.id, u.display_name, COALESCE(u.email, ''), m.role, m.status, m.created_at, m.updated_at
		FROM organization_memberships m JOIN users u ON u.id = m.user_id
		WHERE m.organization_id = $1 AND m.user_id = $2
	`, organizationID, targetUserID).Scan(&member.UserID, &member.DisplayName, &member.Email, &member.Role, &member.Status, &member.CreatedAt, &member.UpdatedAt)
	if err != nil {
		return identity.OrganizationMember{}, fmt.Errorf("reload new owner: %w", err)
	}
	if err := insertMembershipAudit(ctx, tx, organizationID, actorID, targetUserID, "role_changed", "member", "owner", "active", "active"); err != nil {
		return identity.OrganizationMember{}, err
	}
	if err := insertOrganizationAudit(ctx, tx, organizationID, actorID, auditTransferred,
		map[string]any{"from": actorID, "to": targetUserID}); err != nil {
		return identity.OrganizationMember{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return identity.OrganizationMember{}, fmt.Errorf("commit ownership transfer: %w", err)
	}
	return member, nil
}

// OrganizationAuditEvent is one merged entry for the audit page: membership
// audit rows and lifecycle events share the shape.
type OrganizationAuditEvent struct {
	ID           string          `json:"id"`
	ActorUserID  string          `json:"actor_user_id"`
	TargetUserID string          `json:"target_user_id,omitempty"`
	Action       string          `json:"action"`
	Detail       json.RawMessage `json:"detail,omitempty"`
	CreatedAt    time.Time       `json:"created_at"`
}

// ListOrganizationAudit merges membership audit rows and lifecycle events,
// newest first, with server-side pagination (SPEC section 2).
func (s *Store) ListOrganizationAudit(ctx context.Context, organizationID string, limit, offset int) ([]OrganizationAuditEvent, int, error) {
	if limit < 1 || limit > 100 || offset < 0 {
		return nil, 0, ErrInvalidMembershipChange
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, actor_user_id, target_user_id, action, NULL::jsonb AS detail, created_at
		FROM organization_membership_audit WHERE organization_id = $1
		UNION ALL
		SELECT id, actor_user_id, '' , action, detail, created_at
		FROM organization_audit_events WHERE organization_id = $1
		ORDER BY created_at DESC, id DESC
		LIMIT $2 OFFSET $3
	`, organizationID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list organization audit: %w", err)
	}
	defer rows.Close()
	events := []OrganizationAuditEvent{}
	for rows.Next() {
		var event OrganizationAuditEvent
		if err := rows.Scan(&event.ID, &event.ActorUserID, &event.TargetUserID, &event.Action, &event.Detail, &event.CreatedAt); err != nil {
			return nil, 0, fmt.Errorf("scan organization audit: %w", err)
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate organization audit: %w", err)
	}
	var total int
	if err := s.pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM organization_membership_audit WHERE organization_id = $1)
		     + (SELECT count(*) FROM organization_audit_events WHERE organization_id = $1)
	`, organizationID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count organization audit: %w", err)
	}
	return events, total, nil
}

// CreateOrganization provisions an organization with the actor as sole owner
// (self-service path). The global handles lock serializes slug allocation
// with UpdateOrganization and the bootstrap path.
func (s *Store) CreateOrganization(ctx context.Context, id, name, slug, actorID string) (OrganizationLifecycle, error) {
	name = strings.TrimSpace(name)
	slug = strings.ToLower(strings.TrimSpace(slug))
	if strings.TrimSpace(id) == "" || name == "" || !ValidOrganizationSlug(slug) || strings.TrimSpace(actorID) == "" {
		return OrganizationLifecycle{}, ErrSlugInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("begin organization create: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext('agentforge:organization-handles'))"); err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("lock organization handles: %w", err)
	}
	var taken bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM organizations WHERE id = $1)
		  OR EXISTS (SELECT 1 FROM organizations WHERE slug = $2)
		  OR EXISTS (SELECT 1 FROM organization_slug_history WHERE slug = $2 AND expires_at > now())
	`, id, slug).Scan(&taken); err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("probe organization availability: %w", err)
	}
	if taken {
		return OrganizationLifecycle{}, ErrSlugUnavailable
	}
	if _, err := tx.Exec(ctx, `INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)`, id, name, slug); err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("insert organization: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO organization_memberships (organization_id, user_id, role, status)
		VALUES ($1, $2, 'owner', 'active')
	`, id, actorID); err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("insert owner membership: %w", err)
	}
	if err := insertOrganizationAudit(ctx, tx, id, actorID, auditCreated, map[string]any{"name": name, "slug": slug}); err != nil {
		return OrganizationLifecycle{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return OrganizationLifecycle{}, fmt.Errorf("commit organization create: %w", err)
	}
	return OrganizationLifecycle{ID: id, Name: name, Slug: slug, Status: "active"}, nil
}
