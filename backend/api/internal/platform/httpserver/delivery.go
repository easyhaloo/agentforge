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
	"strconv"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/jackc/pgx/v5"
)

type ActorResolver interface {
	ResolveActor(*http.Request) (string, error)
}

type DeliveryDependencies struct {
	Repository delivery.Repository
	Identity   ActorResolver
}

type storedChangesetResponse struct {
	Changeset *delivery.Changeset `json:"changeset"`
	Version int64 `json:"version"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type changesetListResponse struct {
	Items []storedChangesetResponse `json:"items"`
	Limit int `json:"limit"`
	Offset int `json:"offset"`
}

type createChangesetRequest struct {
	Repository string `json:"repository"`
	Title string `json:"title"`
}

type addRevisionRequest struct {
	Ref string `json:"ref"`
}

type recordEvaluationRequest struct {
	RevisionID delivery.ID `json:"revision_id"`
	Status delivery.Status `json:"status"`
	Summary string `json:"summary"`
}

type attachEvidenceRequest struct {
	RevisionID delivery.ID `json:"revision_id"`
	EvaluationID delivery.ID `json:"evaluation_id"`
	Kind string `json:"kind"`
	URI string `json:"uri"`
}

type submitReviewRequest struct {
	RevisionID delivery.ID `json:"revision_id"`
	Comment string `json:"comment"`
}

type decideReviewRequest struct {
	Approved bool `json:"approved"`
	Comment string `json:"comment"`
}

type problemResponse struct {
	Type string `json:"type"`
	Title string `json:"title"`
	Status int `json:"status"`
	Detail string `json:"detail,omitempty"`
}

func newDeliveryHandler(deps DeliveryDependencies) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/changesets", deps.listChangesets)
	mux.HandleFunc("POST /api/v1/changesets", deps.createChangeset)
	mux.HandleFunc("GET /api/v1/changesets/{id}", deps.getChangeset)
	mux.HandleFunc("POST /api/v1/changesets/{id}/revisions", deps.addRevision)
	mux.HandleFunc("POST /api/v1/changesets/{id}/evaluations", deps.recordEvaluation)
	mux.HandleFunc("POST /api/v1/changesets/{id}/evidence", deps.attachEvidence)
	mux.HandleFunc("POST /api/v1/changesets/{id}/reviews", deps.submitReview)
	mux.HandleFunc("POST /api/v1/changesets/{id}/reviews/{reviewID}/decision", deps.decideReview)
	return mux
}

func (d DeliveryDependencies) listChangesets(w http.ResponseWriter, r *http.Request) {
	if _, ok := d.actor(w, r); !ok { return }
	if d.Repository == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Delivery storage unavailable", "The delivery repository is not configured")
		return
	}
	limit, offset := 20, 0
	var err error
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil { writeProblem(w, http.StatusBadRequest, "Invalid limit", "limit must be an integer"); return }
	}
	if raw := r.URL.Query().Get("offset"); raw != "" {
		offset, err = strconv.Atoi(raw)
		if err != nil { writeProblem(w, http.StatusBadRequest, "Invalid offset", "offset must be an integer"); return }
	}
	items, err := d.Repository.List(r.Context(), limit, offset)
	if errors.Is(err, delivery.ErrInvalidInput) {
		writeProblem(w, http.StatusBadRequest, "Invalid pagination", err.Error()); return
	}
	if err != nil { writeProblem(w, http.StatusInternalServerError, "Unable to list changesets", "The changeset query failed"); return }
	response := changesetListResponse{Items: make([]storedChangesetResponse, 0, len(items)), Limit: limit, Offset: offset}
	for _, item := range items { response.Items = append(response.Items, toChangesetResponse(item)) }
	writeJSON(w, http.StatusOK, response)
}

func (d DeliveryDependencies) createChangeset(w http.ResponseWriter, r *http.Request) {
	actor, ok := d.actor(w, r); if !ok { return }
	if d.Repository == nil { writeProblem(w, http.StatusServiceUnavailable, "Delivery storage unavailable", "The delivery repository is not configured"); return }
	var input createChangesetRequest
	if !decodeJSON(w, r, &input) { return }
	id, err := newID(); if err != nil { writeProblem(w, http.StatusInternalServerError, "Unable to create changeset", "An identifier could not be generated"); return }
	changeset, err := delivery.NewChangeset(delivery.ID(id), strings.TrimSpace(input.Repository), strings.TrimSpace(input.Title), actor, time.Now().UTC())
	if err != nil { writeProblem(w, http.StatusBadRequest, "Invalid changeset", err.Error()); return }
	stored, err := d.Repository.Create(r.Context(), changeset)
	if errors.Is(err, pgx.ErrNoRows) { writeProblem(w, http.StatusConflict, "Changeset conflict", "The changeset could not be created"); return }
	if err != nil { writeProblem(w, http.StatusInternalServerError, "Unable to create changeset", "The changeset could not be persisted"); return }
	writeJSON(w, http.StatusCreated, toChangesetResponse(stored))
}

func (d DeliveryDependencies) getChangeset(w http.ResponseWriter, r *http.Request) {
	if _, ok := d.actor(w, r); !ok { return }
	stored, ok := d.load(w, r); if !ok { return }
	writeJSON(w, http.StatusOK, toChangesetResponse(stored))
}

func (d DeliveryDependencies) addRevision(w http.ResponseWriter, r *http.Request) {
	actor, ok := d.actor(w, r); if !ok { return }
	var input addRevisionRequest; if !decodeJSON(w, r, &input) { return }
	d.mutate(w, r, actor, func(c *delivery.Changeset, now time.Time) error {
		id, err := newID(); if err != nil { return err }
		return c.AddRevision(delivery.ID(id), strings.TrimSpace(input.Ref), actor, now)
	})
}

func (d DeliveryDependencies) recordEvaluation(w http.ResponseWriter, r *http.Request) {
	actor, ok := d.actor(w, r); if !ok { return }
	var input recordEvaluationRequest; if !decodeJSON(w, r, &input) { return }
	d.mutate(w, r, actor, func(c *delivery.Changeset, now time.Time) error {
		id, err := newID(); if err != nil { return err }
		return c.RecordEvaluation(delivery.ID(id), input.RevisionID, input.Status, input.Summary, actor, now)
	})
}

func (d DeliveryDependencies) attachEvidence(w http.ResponseWriter, r *http.Request) {
	actor, ok := d.actor(w, r); if !ok { return }
	var input attachEvidenceRequest; if !decodeJSON(w, r, &input) { return }
	d.mutate(w, r, actor, func(c *delivery.Changeset, now time.Time) error {
		id, err := newID(); if err != nil { return err }
		return c.AttachEvidence(delivery.ID(id), input.RevisionID, input.EvaluationID, input.Kind, input.URI, actor, now)
	})
}

func (d DeliveryDependencies) submitReview(w http.ResponseWriter, r *http.Request) {
	actor, ok := d.actor(w, r); if !ok { return }
	var input submitReviewRequest; if !decodeJSON(w, r, &input) { return }
	d.mutate(w, r, actor, func(c *delivery.Changeset, now time.Time) error {
		id, err := newID(); if err != nil { return err }
		return c.SubmitReview(delivery.ID(id), input.RevisionID, actor, input.Comment, now)
	})
}

func (d DeliveryDependencies) decideReview(w http.ResponseWriter, r *http.Request) {
	actor, ok := d.actor(w, r); if !ok { return }
	var input decideReviewRequest; if !decodeJSON(w, r, &input) { return }
	d.mutate(w, r, actor, func(c *delivery.Changeset, now time.Time) error {
		return c.DecideReview(delivery.ID(r.PathValue("reviewID")), input.Approved, actor, input.Comment, now)
	})
}

func (d DeliveryDependencies) mutate(w http.ResponseWriter, r *http.Request, actor string, operation func(*delivery.Changeset, time.Time) error) {
	stored, ok := d.load(w, r); if !ok { return }
	now := time.Now().UTC()
	if err := operation(stored.Changeset, now); err != nil { writeDomainError(w, err); return }
	updated, err := d.Repository.Update(r.Context(), stored.Changeset, stored.Version)
	if errors.Is(err, delivery.ErrVersionConflict) { writeProblem(w, http.StatusConflict, "Changeset version conflict", "Reload the changeset and retry against its current version"); return }
	if err != nil { writeProblem(w, http.StatusInternalServerError, "Unable to update changeset", "The changeset could not be persisted"); return }
	writeJSON(w, http.StatusOK, toChangesetResponse(updated))
}

func (d DeliveryDependencies) load(w http.ResponseWriter, r *http.Request) (delivery.StoredChangeset, bool) {
	if d.Repository == nil { writeProblem(w, http.StatusServiceUnavailable, "Delivery storage unavailable", "The delivery repository is not configured"); return delivery.StoredChangeset{}, false }
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" { writeProblem(w, http.StatusBadRequest, "Invalid changeset ID", "A changeset ID is required"); return delivery.StoredChangeset{}, false }
	stored, err := d.Repository.Get(r.Context(), delivery.ID(id))
	if errors.Is(err, delivery.ErrNotFound) { writeProblem(w, http.StatusNotFound, "Changeset not found", "No changeset exists with the supplied ID"); return delivery.StoredChangeset{}, false }
	if err != nil { writeProblem(w, http.StatusInternalServerError, "Unable to load changeset", "The changeset query failed"); return delivery.StoredChangeset{}, false }
	return stored, true
}

func (d DeliveryDependencies) actor(w http.ResponseWriter, r *http.Request) (string, bool) {
	if d.Identity == nil { writeProblem(w, http.StatusServiceUnavailable, "Authentication unavailable", "A trusted identity provider is not configured; write operations are disabled"); return "", false }
	actor, err := d.Identity.ResolveActor(r)
	if err != nil || strings.TrimSpace(actor) == "" { writeProblem(w, http.StatusUnauthorized, "Authentication required", "A valid authenticated identity is required"); return "", false }
	return actor, true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body); decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil { writeProblem(w, http.StatusBadRequest, "Invalid request body", err.Error()); return false }
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) { writeProblem(w, http.StatusBadRequest, "Invalid request body", "Only one JSON value is allowed"); return false }
	return true
}

func writeDomainError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, delivery.ErrInvalidInput): writeProblem(w, http.StatusBadRequest, "Invalid delivery operation", err.Error())
	case errors.Is(err, delivery.ErrRevisionNotCurrent): writeProblem(w, http.StatusConflict, "Revision is stale", err.Error())
	case errors.Is(err, delivery.ErrEvaluationRequired), errors.Is(err, delivery.ErrEvidenceRequired), errors.Is(err, delivery.ErrReviewRequired): writeProblem(w, http.StatusUnprocessableEntity, "Delivery prerequisite not met", err.Error())
	case errors.Is(err, delivery.ErrAlreadyMerged): writeProblem(w, http.StatusConflict, "Changeset already merged", err.Error())
	default: writeProblem(w, http.StatusInternalServerError, "Delivery operation failed", "The operation could not be completed")
	}
}

func toChangesetResponse(stored delivery.StoredChangeset) storedChangesetResponse {
	return storedChangesetResponse{Changeset: stored.Changeset, Version: stored.Version, CreatedAt: stored.CreatedAt, UpdatedAt: stored.UpdatedAt}
}

func newID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil { return "", fmt.Errorf("generate identifier: %w", err) }
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

var _ context.Context
