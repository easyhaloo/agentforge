package httpserver

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/authz"
)

// Lifecycle store shapes are mirrored locally instead of imported from the
// postgres package: postgres' test files import httpserver, so a
// postgres → httpserver package edge would create an import cycle. The
// postgres Store satisfies these interfaces structurally.

// LifecycleState mirrors LifecycleState.
type LifecycleState struct {
	ID                  string     `json:"id"`
	Name                string     `json:"name"`
	Slug                string     `json:"slug"`
	Status              string     `json:"status"`
	SuspendedAt         *time.Time `json:"suspended_at,omitempty"`
	SuspendedReason     string     `json:"suspended_reason,omitempty"`
	DeletionScheduledAt *time.Time `json:"deletion_scheduled_at,omitempty"`
	Version             int64      `json:"version"`
}

// LifecycleAuditEvent mirrors LifecycleAuditEvent.
type LifecycleAuditEvent struct {
	ID           string          `json:"id"`
	ActorUserID  string          `json:"actor_user_id"`
	TargetUserID string          `json:"target_user_id,omitempty"`
	Action       string          `json:"action"`
	Detail       json.RawMessage `json:"detail,omitempty"`
	CreatedAt    time.Time       `json:"created_at"`
}

// Lifecycle errors mirror the postgres package sentinels (same messages).
var (
	ErrLifecycleNotFound     = errors.New("organization not found")
	ErrLifecycleNotSuspended = errors.New("organization is not suspended")
	ErrLifecycleSlugTaken    = errors.New("slug unavailable")
	ErrLifecycleSlugInvalid  = errors.New("slug invalid")
	ErrLifecycleConflict     = delivery.ErrVersionConflict
)

// OrganizationLifecycleStore is the lifecycle surface of the Store. Declared
// on DeliveryDependencies so tests can stub it.
type OrganizationLifecycleStore interface {
	UpdateOrganization(ctx context.Context, organizationID, actorID string, name, slug *string, grace time.Duration, expectedVersion int64) (LifecycleState, error)
	TransferOrganizationOwnership(ctx context.Context, organizationID, actorID, targetUserID string) (identity.OrganizationMember, error)
	SuspendOrganization(ctx context.Context, organizationID, actorID, reason string) (LifecycleState, error)
	ResumeOrganization(ctx context.Context, organizationID, actorID string) (LifecycleState, error)
	ScheduleOrganizationDeletion(ctx context.Context, organizationID, actorID string, grace time.Duration) (LifecycleState, error)
	CancelOrganizationDeletion(ctx context.Context, organizationID, actorID string) (LifecycleState, error)
	ListOrganizationAudit(ctx context.Context, organizationID string, limit, offset int) ([]LifecycleAuditEvent, int, error)
	CreateOrganization(ctx context.Context, id, name, slug, actorID string) (LifecycleState, error)
	ResolveSlugRedirect(ctx context.Context, slug string) (string, error)
}

// organizationOwner resolves the principal and requires the owner role.
// Lifecycle endpoints bypass the blanket 423 gate (principal(..., false)) and
// rely on the store-level status checks, so owners can resume or cancel
// deletion while the organization is locked.
func (d DeliveryDependencies) organizationOwner(w http.ResponseWriter, r *http.Request) (Principal, bool) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return Principal{}, false
	}
	if principal.Role != "owner" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization owners can perform lifecycle operations")
		return Principal{}, false
	}
	return principal, true
}

// registerOrganizationLifecycleRoutes registers the lifecycle endpoints.
func (d DeliveryDependencies) registerOrganizationLifecycleRoutes(mux *http.ServeMux) {
	base := "/api/v1/organizations/{organizationID}"
	mux.HandleFunc("PATCH "+base, d.updateOrganization)
	mux.HandleFunc("POST "+base+"/transfer-ownership", d.transferOrganizationOwnership)
	mux.HandleFunc("POST "+base+"/suspend", d.suspendOrganization)
	mux.HandleFunc("POST "+base+"/resume", d.resumeOrganization)
	mux.HandleFunc("POST "+base+"/deletion", d.scheduleOrganizationDeletion)
	mux.HandleFunc("DELETE "+base+"/deletion", d.cancelOrganizationDeletion)
	mux.HandleFunc("GET "+base+"/audit", d.listOrganizationAudit)
	mux.HandleFunc("POST /api/v1/organizations", d.createOrganization)
}

func writeLifecycleError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrLifecycleNotFound):
		writeProblem(w, http.StatusNotFound, "Organization not found", "No organization exists under this handle")
	case errors.Is(err, ErrLifecycleNotSuspended):
		writeProblem(w, http.StatusConflict, "Invalid lifecycle transition", "The organization is not in the required lifecycle state for this operation")
	case errors.Is(err, ErrLifecycleSlugTaken):
		writeProblem(w, http.StatusConflict, "Slug unavailable", "The requested organization URL is already in use or still reserved")
	case errors.Is(err, ErrLifecycleSlugInvalid):
		writeProblem(w, http.StatusBadRequest, "Invalid organization URL", "Organization URLs must be 3-39 lowercase letters, digits or hyphens, without leading or trailing hyphens")
	case errors.Is(err, ErrLifecycleConflict):
		writeProblem(w, http.StatusConflict, "Version conflict", "The organization was modified concurrently; reload and retry")
	case errors.Is(err, identity.ErrLastActiveOwner):
		writeProblem(w, http.StatusConflict, "Last owner protected", "An organization must retain at least one active owner")
	case errors.Is(err, identity.ErrMembershipNotFound):
		writeProblem(w, http.StatusNotFound, "Member not found", "The target user is not an active member of this organization")
	case errors.Is(err, identity.ErrMembershipForbidden):
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization owners can perform lifecycle operations")
	case errors.Is(err, identity.ErrInvalidMembershipChange):
		writeProblem(w, http.StatusBadRequest, "Invalid request", "The lifecycle request payload is invalid")
	case errors.Is(err, ErrLifecycleNotSuspended):
		writeProblem(w, http.StatusConflict, "Organization locked", authz.ErrLockedDetail)
	default:
		writeProblem(w, http.StatusInternalServerError, "Lifecycle operation failed", "The organization lifecycle change could not be completed")
	}
}

type updateOrganizationRequest struct {
	Name            *string `json:"name,omitempty"`
	Slug            *string `json:"slug,omitempty"`
	ExpectedVersion int64   `json:"expected_version,omitempty"`
}

func (d DeliveryDependencies) updateOrganization(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.organizationOwner(w, r)
	if !ok {
		return
	}
	if d.Lifecycle == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Lifecycle unavailable", "The organization lifecycle store is not configured")
		return
	}
	var input updateOrganizationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	lifecycle, err := d.Lifecycle.UpdateOrganization(r.Context(), principal.OrganizationID, principal.UserID, input.Name, input.Slug, d.OrganizationDeletionGrace, input.ExpectedVersion)
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, lifecycle)
}

type transferOwnershipRequest struct {
	UserID string `json:"user_id"`
}

func (d DeliveryDependencies) transferOrganizationOwnership(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.organizationOwner(w, r)
	if !ok {
		return
	}
	if d.Lifecycle == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Lifecycle unavailable", "The organization lifecycle store is not configured")
		return
	}
	var input transferOwnershipRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.UserID) == "" {
		writeProblem(w, http.StatusBadRequest, "Invalid request", "user_id is required")
		return
	}
	member, err := d.Lifecycle.TransferOrganizationOwnership(r.Context(), principal.OrganizationID, principal.UserID, input.UserID)
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, member)
}

type suspendRequest struct {
	Reason string `json:"reason"`
}

func (d DeliveryDependencies) suspendOrganization(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.organizationOwner(w, r)
	if !ok {
		return
	}
	if d.Lifecycle == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Lifecycle unavailable", "The organization lifecycle store is not configured")
		return
	}
	var input suspendRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	lifecycle, err := d.Lifecycle.SuspendOrganization(r.Context(), principal.OrganizationID, principal.UserID, input.Reason)
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, lifecycle)
}

func (d DeliveryDependencies) resumeOrganization(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.organizationOwner(w, r)
	if !ok {
		return
	}
	if d.Lifecycle == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Lifecycle unavailable", "The organization lifecycle store is not configured")
		return
	}
	lifecycle, err := d.Lifecycle.ResumeOrganization(r.Context(), principal.OrganizationID, principal.UserID)
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, lifecycle)
}

func (d DeliveryDependencies) scheduleOrganizationDeletion(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.organizationOwner(w, r)
	if !ok {
		return
	}
	if d.Lifecycle == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Lifecycle unavailable", "The organization lifecycle store is not configured")
		return
	}
	lifecycle, err := d.Lifecycle.ScheduleOrganizationDeletion(r.Context(), principal.OrganizationID, principal.UserID, d.OrganizationDeletionGrace)
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, lifecycle)
}

func (d DeliveryDependencies) cancelOrganizationDeletion(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.organizationOwner(w, r)
	if !ok {
		return
	}
	if d.Lifecycle == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Lifecycle unavailable", "The organization lifecycle store is not configured")
		return
	}
	lifecycle, err := d.Lifecycle.CancelOrganizationDeletion(r.Context(), principal.OrganizationID, principal.UserID)
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, lifecycle)
}

func (d DeliveryDependencies) listOrganizationAudit(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.membershipAdmin(w, r)
	if !ok {
		return
	}
	if d.Lifecycle == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Lifecycle unavailable", "The organization lifecycle store is not configured")
		return
	}
	limit, offset := 50, 0
	var err error
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
	}
	if err == nil {
		if raw := r.URL.Query().Get("offset"); raw != "" {
			offset, err = strconv.Atoi(raw)
		}
	}
	if err != nil || limit < 1 || limit > 100 || offset < 0 {
		writeProblem(w, http.StatusBadRequest, "Invalid pagination", "limit must be 1-100 and offset must be zero or greater")
		return
	}
	events, total, err := d.Lifecycle.ListOrganizationAudit(r.Context(), principal.OrganizationID, limit, offset)
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Items  []LifecycleAuditEvent `json:"items"`
		Total  int                   `json:"total"`
		Limit  int                   `json:"limit"`
		Offset int                   `json:"offset"`
	}{Items: events, Total: total, Limit: limit, Offset: offset})
}

type createOrganizationRequest struct {
	Name string `json:"name"`
	Slug string `json:"slug"`
}

func (d DeliveryDependencies) createOrganization(w http.ResponseWriter, r *http.Request) {
	if !d.OrgSelfServiceCreate {
		writeProblem(w, http.StatusNotFound, "Not found", "Self-service organization creation is disabled")
		return
	}
	if d.Identity == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Authentication unavailable", "A trusted identity provider is not configured")
		return
	}
	// Resolve without an organization scope: the caller may not belong to any
	// organization yet, so a fresh membership check on the session is needed.
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}
	if d.Lifecycle == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Lifecycle unavailable", "The organization lifecycle store is not configured")
		return
	}
	var input createOrganizationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.Slug) == "" {
		writeProblem(w, http.StatusBadRequest, "Invalid request", "name and slug are required")
		return
	}
	idBytes := make([]byte, 16)
	if _, err := rand.Read(idBytes); err != nil {
		writeProblem(w, http.StatusInternalServerError, "Creation failed", "An organization identifier could not be generated")
		return
	}
	id := hex.EncodeToString(idBytes)
	lifecycle, err := d.Lifecycle.CreateOrganization(r.Context(), id, input.Name, input.Slug, userID)
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, lifecycle)
}
