package httpserver

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

type Principal struct {
	UserID         string
	OrganizationID string
	Role           string
}

type PrincipalResolver interface {
	ResolvePrincipal(*http.Request, string) (Principal, error)
}

type DeliveryDependencies struct {
	Repository delivery.Repository
	Identity   PrincipalResolver
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
	if err != nil {
		writeProblem(w, http.StatusUnauthorized, "Authentication required", "A valid authenticated identity and active organization membership are required")
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
