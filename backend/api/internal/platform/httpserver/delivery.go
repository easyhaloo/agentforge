package httpserver

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

type Principal = identity.Principal

type PrincipalResolver = identity.PrincipalResolver

type AccountRepository interface {
	CurrentAccount(context.Context, string) (identity.AccountContext, error)
}

type MembershipRepository interface {
	ListMembers(context.Context, string, int, int) ([]identity.OrganizationMember, error)
	UpdateMembership(context.Context, string, string, string, *string, *string) (identity.OrganizationMember, error)
	RemoveMembership(context.Context, string, string, string) error
	CreateInvitation(context.Context, string, string, string, string, string, time.Time) (identity.OrganizationInvitation, error)
	ListInvitations(context.Context, string, int, int) ([]identity.OrganizationInvitation, error)
	RevokeInvitation(context.Context, string, string, string) error
	ListMembershipAudit(context.Context, string, int, int) ([]identity.MembershipAuditEvent, error)
}

type DeliveryDependencies struct {
	Repository  delivery.Repository
	Identity    identity.PrincipalResolver
	CSRF        identity.CSRFValidator
	AllowedOrigin string
	OIDC          identity.OIDCHandler
	Membership    MembershipRepository
	Account       AccountRepository
}

type storedChangesetResponse struct {
	Changeset *delivery.Changeset `json:"changeset"`
	Version   int64               `json:"version"`
	CreatedAt time.Time           `json:"created_at"`
	UpdatedAt time.Time           `json:"updated_at"`
}

type changesetListResponse struct {
	Items  []storedChangesetResponse `json:"items"`
	Limit  int                       `json:"limit"`
	Offset int                       `json:"offset"`
}

type createChangesetRequest struct {
	Repository string `json:"repository"`
	Title      string `json:"title"`
}

type problemResponse struct {
	Type   string `json:"type"`
	Title  string `json:"title"`
	Status int    `json:"status"`
	Detail string `json:"detail,omitempty"`
}

func newDeliveryHandler(deps DeliveryDependencies) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/members", deps.listMembers)
	mux.HandleFunc("PATCH /api/v1/organizations/{organizationID}/members/{userID}", deps.updateMember)
	mux.HandleFunc("DELETE /api/v1/organizations/{organizationID}/members/{userID}", deps.removeMember)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/invitations", deps.listInvitations)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/invitations", deps.createInvitation)
	mux.HandleFunc("DELETE /api/v1/organizations/{organizationID}/invitations/{invitationID}", deps.revokeInvitation)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/membership-audit", deps.listMembershipAudit)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/changesets", deps.listChangesets)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/changesets", deps.createChangeset)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/changesets/{id}", deps.getChangeset)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/changesets/{id}/revisions", deps.addRevision)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/changesets/{id}/evaluations", deps.recordEvaluation)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/changesets/{id}/evidence", deps.attachEvidence)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/changesets/{id}/reviews", deps.submitReview)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/changesets/{id}/reviews/{reviewID}/decision", deps.decideReview)
	return mux
}

func (d DeliveryDependencies) listChangesets(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.Repository == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Delivery storage unavailable", "The delivery repository is not configured")
		return
	}
	limit, offset := 20, 0
	var err error
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "Invalid limit", "limit must be an integer")
			return
		}
	}
	if raw := r.URL.Query().Get("offset"); raw != "" {
		offset, err = strconv.Atoi(raw)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "Invalid offset", "offset must be an integer")
			return
		}
	}
	items, err := d.Repository.List(r.Context(), principal.OrganizationID, limit, offset)
	if errors.Is(err, delivery.ErrInvalidInput) {
		writeProblem(w, http.StatusBadRequest, "Invalid pagination", err.Error())
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to list changesets", "The changeset query failed")
		return
	}
	response := changesetListResponse{Items: make([]storedChangesetResponse, 0, len(items)), Limit: limit, Offset: offset}
	for _, item := range items {
		response.Items = append(response.Items, toChangesetResponse(item))
	}
	writeJSON(w, http.StatusOK, response)
}

func (d DeliveryDependencies) createChangeset(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.Repository == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Delivery storage unavailable", "The delivery repository is not configured")
		return
	}
	var input createChangesetRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	id, err := newID()
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to create changeset", "An identifier could not be generated")
		return
	}
	changeset, err := delivery.NewChangeset(delivery.ID(id), strings.TrimSpace(input.Repository), strings.TrimSpace(input.Title), principal.UserID, time.Now().UTC())
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid changeset", err.Error())
		return
	}
	stored, err := d.Repository.Create(r.Context(), principal.OrganizationID, changeset)
	if errors.Is(err, delivery.ErrVersionConflict) {
		writeProblem(w, http.StatusConflict, "Changeset conflict", "A changeset with this identifier already exists in this organization")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to create changeset", "The changeset could not be persisted")
		return
	}
	writeJSON(w, http.StatusCreated, toChangesetResponse(stored))
}

func (d DeliveryDependencies) getChangeset(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	stored, ok := d.load(w, r, principal.OrganizationID)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, toChangesetResponse(stored))
}

func (d DeliveryDependencies) addRevision(w http.ResponseWriter, r *http.Request) {
	if _, ok := d.principal(w, r, true); !ok {
		return
	}
	writeProblem(w, http.StatusNotImplemented, "Delivery adapter unavailable", "addRevision requires a configured, trusted Git provider adapter")
}

func (d DeliveryDependencies) recordEvaluation(w http.ResponseWriter, r *http.Request) {
	if _, ok := d.principal(w, r, true); !ok {
		return
	}
	writeProblem(w, http.StatusNotImplemented, "Delivery adapter unavailable", "recordEvaluation requires a trusted evaluation worker; clients cannot assert evaluation outcomes")
}

func (d DeliveryDependencies) attachEvidence(w http.ResponseWriter, r *http.Request) {
	if _, ok := d.principal(w, r, true); !ok {
		return
	}
	writeProblem(w, http.StatusNotImplemented, "Delivery adapter unavailable", "attachEvidence requires a trusted artifact provenance adapter")
}

func (d DeliveryDependencies) submitReview(w http.ResponseWriter, r *http.Request) {
	if _, ok := d.principal(w, r, true); !ok {
		return
	}
	writeProblem(w, http.StatusNotImplemented, "Delivery adapter unavailable", "submitReview requires a configured review assignment workflow")
}

func (d DeliveryDependencies) decideReview(w http.ResponseWriter, r *http.Request) {
	if _, ok := d.principal(w, r, true); !ok {
		return
	}
	writeProblem(w, http.StatusNotImplemented, "Delivery adapter unavailable", "decideReview requires a configured review authorization workflow")
}

func (d DeliveryDependencies) load(w http.ResponseWriter, r *http.Request, organizationID string) (delivery.StoredChangeset, bool) {
	if d.Repository == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Delivery storage unavailable", "The delivery repository is not configured")
		return delivery.StoredChangeset{}, false
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeProblem(w, http.StatusBadRequest, "Invalid changeset ID", "A changeset ID is required")
		return delivery.StoredChangeset{}, false
	}
	stored, err := d.Repository.Get(r.Context(), organizationID, delivery.ID(id))
	if errors.Is(err, delivery.ErrNotFound) {
		writeProblem(w, http.StatusNotFound, "Changeset not found", "No changeset exists in the selected organization")
		return delivery.StoredChangeset{}, false
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to load changeset", "The changeset query failed")
		return delivery.StoredChangeset{}, false
	}
	return stored, true
}

func (d DeliveryDependencies) principal(w http.ResponseWriter, r *http.Request, write bool) (Principal, bool) {
	organizationID := strings.TrimSpace(r.PathValue("organizationID"))
	if organizationID == "" {
		writeProblem(w, http.StatusBadRequest, "Organization required", "An organization ID is required")
		return Principal{}, false
	}
	if d.Identity == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Authentication unavailable", "A trusted identity and organization membership provider is not configured")
		return Principal{}, false
	}
	principal, err := d.Identity.ResolvePrincipal(r, organizationID)
	if errors.Is(err, identity.ErrUnauthenticated) {
		writeProblem(w, http.StatusUnauthorized, "Authentication required", "A valid authenticated identity and active organization membership are required")
		return Principal{}, false
	}
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Identity service unavailable", "The authenticated identity could not be verified")
		return Principal{}, false
	}
	if strings.TrimSpace(principal.UserID) == "" || principal.OrganizationID != organizationID {
		writeProblem(w, http.StatusForbidden, "Organization access denied", "The authenticated principal is not authorized for the selected organization")
		return Principal{}, false
	}
	switch principal.Role {
	case "owner", "admin", "member":
		return principal, true
	case "viewer":
		if !write {
			return principal, true
		}
	default:
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "The organization role does not permit this operation")
		return Principal{}, false
	}
	if write {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "The viewer role cannot modify delivery resources")
		return Principal{}, false
	}
	return principal, true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid request body", err.Error())
		return false
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		writeProblem(w, http.StatusBadRequest, "Invalid request body", "Only one JSON value is allowed")
		return false
	}
	return true
}

func toChangesetResponse(stored delivery.StoredChangeset) storedChangesetResponse {
	return storedChangesetResponse{Changeset: stored.Changeset, Version: stored.Version, CreatedAt: stored.CreatedAt, UpdatedAt: stored.UpdatedAt}
}

func newID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", fmt.Errorf("generate identifier: %w", err)
	}
	return hex.EncodeToString(value[:]), nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeProblem(w http.ResponseWriter, status int, title, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(problemResponse{Type: "about:blank", Title: title, Status: status, Detail: detail})
}


type updateMemberRequest struct {
	Role *string `json:"role,omitempty"`
	Status *string `json:"status,omitempty"`
}

func (d DeliveryDependencies) membershipAdmin(w http.ResponseWriter, r *http.Request) (Principal, bool) {
	principal, ok := d.principal(w, r, true)
	if !ok { return Principal{}, false }
	if principal.Role != "owner" && principal.Role != "admin" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization owners and administrators can manage members")
		return Principal{}, false
	}
	if d.Membership == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Membership management unavailable", "The organization membership repository is not configured")
		return Principal{}, false
	}
	return principal, true
}

func (d DeliveryDependencies) listMembers(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.membershipAdmin(w, r)
	if !ok { return }
	limit, offset := 50, 0
	var err error
	if raw := r.URL.Query().Get("limit"); raw != "" { limit, err = strconv.Atoi(raw) }
	if err == nil {
		if raw := r.URL.Query().Get("offset"); raw != "" { offset, err = strconv.Atoi(raw) }
	}
	if err != nil || limit < 1 || limit > 100 || offset < 0 {
		writeProblem(w, http.StatusBadRequest, "Invalid pagination", "limit must be 1-100 and offset must be zero or greater")
		return
	}
	members, err := d.Membership.ListMembers(r.Context(), principal.OrganizationID, limit, offset)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to list members", "The organization membership query failed")
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Items []identity.OrganizationMember `json:"items"`
		Limit int `json:"limit"`
		Offset int `json:"offset"`
	}{Items: members, Limit: limit, Offset: offset})
}

func (d DeliveryDependencies) updateMember(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.membershipAdmin(w, r)
	if !ok { return }
	var input updateMemberRequest
	if !decodeJSON(w, r, &input) { return }
	if input.Role == nil && input.Status == nil {
		writeProblem(w, http.StatusBadRequest, "Invalid membership update", "At least one of role or status is required")
		return
	}
	member, err := d.Membership.UpdateMembership(r.Context(), principal.OrganizationID, principal.UserID, r.PathValue("userID"), input.Role, input.Status)
	if err != nil { writeMembershipError(w, err); return }
	writeJSON(w, http.StatusOK, member)
}

func (d DeliveryDependencies) removeMember(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.membershipAdmin(w, r)
	if !ok { return }
	if err := d.Membership.RemoveMembership(r.Context(), principal.OrganizationID, principal.UserID, r.PathValue("userID")); err != nil {
		writeMembershipError(w, err); return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeMembershipError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, identity.ErrMembershipNotFound):
		writeProblem(w, http.StatusNotFound, "Member not found", "No active membership exists for this user in the selected organization")
	case errors.Is(err, identity.ErrMembershipForbidden):
		writeProblem(w, http.StatusForbidden, "Membership operation forbidden", "Your organization role cannot perform this membership operation")
	case errors.Is(err, identity.ErrLastActiveOwner):
		writeProblem(w, http.StatusConflict, "Last owner protected", "An organization must retain at least one active owner")
	case errors.Is(err, identity.ErrInvalidMembershipChange):
		writeProblem(w, http.StatusBadRequest, "Invalid membership change", "The requested role or membership status is invalid or unchanged")
	default:
		writeProblem(w, http.StatusInternalServerError, "Membership update failed", "The organization membership change could not be completed")
	}
}


type createInvitationRequest struct {
	Email string `json:"email"`
	Role string `json:"role"`
}

func (d DeliveryDependencies) invitationPage(w http.ResponseWriter, r *http.Request) (Principal, int, int, bool) {
	principal, ok := d.membershipAdmin(w, r)
	if !ok { return Principal{},0,0,false }
	limit,offset:=50,0
	var err error
	if raw:=r.URL.Query().Get("limit"); raw!="" { limit,err=strconv.Atoi(raw) }
	if err==nil { if raw:=r.URL.Query().Get("offset"); raw!="" { offset,err=strconv.Atoi(raw) } }
	if err!=nil || limit<1 || limit>100 || offset<0 {
		writeProblem(w,http.StatusBadRequest,"Invalid pagination","limit must be 1-100 and offset must be zero or greater")
		return Principal{},0,0,false
	}
	return principal,limit,offset,true
}

func (d DeliveryDependencies) listInvitations(w http.ResponseWriter,r *http.Request) {
	principal,limit,offset,ok:=d.invitationPage(w,r); if !ok { return }
	items,err:=d.Membership.ListInvitations(r.Context(),principal.OrganizationID,limit,offset)
	if err!=nil { writeProblem(w,http.StatusInternalServerError,"Unable to list invitations","The organization invitation query failed"); return }
	writeJSON(w,http.StatusOK,struct {
		Items []identity.OrganizationInvitation `json:"items"`
		Limit int `json:"limit"`
		Offset int `json:"offset"`
	}{items,limit,offset})
}

func (d DeliveryDependencies) createInvitation(w http.ResponseWriter,r *http.Request) {
	principal,ok:=d.membershipAdmin(w,r); if !ok { return }
	var input createInvitationRequest
	if !decodeJSON(w,r,&input) { return }
	token,err:=identity.GenerateToken()
	if err!=nil { writeProblem(w,http.StatusInternalServerError,"Unable to create invitation","A secure invitation token could not be generated"); return }
	expiresAt:=time.Now().UTC().Add(7*24*time.Hour)
	invitation,err:=d.Membership.CreateInvitation(r.Context(),principal.OrganizationID,principal.UserID,input.Email,input.Role,identity.HashToken(token),expiresAt)
	if err!=nil { writeInvitationError(w,err); return }
	writeJSON(w,http.StatusCreated,struct {
		Invitation identity.OrganizationInvitation `json:"invitation"`
		InvitationURL string `json:"invitation_url"`
		Token string `json:"token"`
	}{invitation,strings.TrimRight(d.AllowedOrigin,"/")+"/auth/invitations/accept?token="+url.QueryEscape(token),token})
}

func (d DeliveryDependencies) revokeInvitation(w http.ResponseWriter,r *http.Request) {
	principal,ok:=d.membershipAdmin(w,r); if !ok { return }
	if err:=d.Membership.RevokeInvitation(r.Context(),principal.OrganizationID,principal.UserID,r.PathValue("invitationID")); err!=nil { writeInvitationError(w,err); return }
	w.WriteHeader(http.StatusNoContent)
}

func (d DeliveryDependencies) listMembershipAudit(w http.ResponseWriter,r *http.Request) {
	principal,limit,offset,ok:=d.invitationPage(w,r); if !ok { return }
	events,err:=d.Membership.ListMembershipAudit(r.Context(),principal.OrganizationID,limit,offset)
	if err!=nil { writeProblem(w,http.StatusInternalServerError,"Unable to load membership audit","The organization audit query failed"); return }
	writeJSON(w,http.StatusOK,struct {
		Items []identity.MembershipAuditEvent `json:"items"`
		Limit int `json:"limit"`
		Offset int `json:"offset"`
	}{events,limit,offset})
}

func writeInvitationError(w http.ResponseWriter,err error) {
	switch {
	case errors.Is(err,identity.ErrInvitationNotFound):
		writeProblem(w,http.StatusNotFound,"Invitation not found","The invitation is expired, revoked, accepted, or does not belong to this organization")
	case errors.Is(err,identity.ErrInvitationAlreadyMember):
		writeProblem(w,http.StatusConflict,"Already a member","This verified email already belongs to an active or suspended organization member")
	case errors.Is(err,identity.ErrInvitationPending):
		writeProblem(w,http.StatusConflict,"Invitation already pending","A pending invitation already exists for this email in this organization")
	case errors.Is(err,identity.ErrMembershipForbidden):
		writeProblem(w,http.StatusForbidden,"Invitation operation forbidden","Your organization role cannot perform this invitation operation")
	case errors.Is(err,identity.ErrInvalidInvitation):
		writeProblem(w,http.StatusBadRequest,"Invalid invitation","Provide a valid email and an allowed organization role")
	default:
		writeProblem(w,http.StatusInternalServerError,"Invitation operation failed","The organization invitation could not be processed")
	}
}


func (d DeliveryDependencies) currentAccount(w http.ResponseWriter,r *http.Request) {
	if d.Account==nil {
		writeProblem(w,http.StatusServiceUnavailable,"Account context unavailable","The authenticated account repository is not configured")
		return
	}
	cookie,err:=r.Cookie(identity.SessionCookieName)
	if err!=nil || cookie.Value=="" {
		writeProblem(w,http.StatusUnauthorized,"Authentication required","A valid application session is required")
		return
	}
	account,err:=d.Account.CurrentAccount(r.Context(),cookie.Value)
	if errors.Is(err,identity.ErrUnauthenticated) {
		writeProblem(w,http.StatusUnauthorized,"Authentication required","A valid application session with active organization membership is required")
		return
	}
	if err!=nil {
		writeProblem(w,http.StatusServiceUnavailable,"Account context unavailable","The authenticated account and organization context could not be loaded")
		return
	}
	writeJSON(w,http.StatusOK,account)
}
