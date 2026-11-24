package httpserver

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"unicode/utf8"

	"github.com/google/uuid"
)

type RepositoryWebhookStore interface {
	ListRepositoryWebhooks(ctx context.Context, organizationID, repository string) (json.RawMessage, error)
	CreateRepositoryWebhook(ctx context.Context, organizationID, repository, url, secret string, events []string, active bool) (json.RawMessage, error)
	UpdateRepositoryWebhook(ctx context.Context, organizationID, repository, id string, url, secret *string, events []string, active *bool) (json.RawMessage, error)
	DeleteRepositoryWebhook(ctx context.Context, organizationID, repository, id string) error
	ListRepositoryWebhookDeliveries(ctx context.Context, organizationID, repository, id string) (json.RawMessage, error)
}

func (d DeliveryDependencies) repositoryWebhookRoutes(mux *http.ServeMux) {
	const base = "/api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/webhooks"
	mux.HandleFunc("GET "+base, d.repositoryWebhooks)
	mux.HandleFunc("POST "+base, d.repositoryWebhooks)
	mux.HandleFunc("PATCH "+base+"/{webhookID}", d.repositoryWebhooks)
	mux.HandleFunc("DELETE "+base+"/{webhookID}", d.repositoryWebhooks)
	mux.HandleFunc("GET "+base+"/{webhookID}/deliveries", d.repositoryWebhooks)
}

func (d DeliveryDependencies) repositoryWebhooks(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, r.Method != http.MethodGet && r.Method != http.MethodHead)
	if !ok {
		return
	}
	if principal.Role != "owner" && principal.Role != "admin" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization owners and administrators can manage repository webhooks")
		return
	}
	repo, ok := d.registeredRepository(w, r, principal)
	if !ok {
		return
	}
	store := d.RepositoryWebhooks
	if store == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Repository webhooks unavailable", "Repository webhook storage is not configured")
		return
	}
	id := r.PathValue("webhookID")
	if id != "" {
		parsed, err := uuid.Parse(id)
		if err != nil || parsed.String() != id {
			writeProblem(w, http.StatusNotFound, "Webhook not found", "The webhook does not exist in the selected repository")
			return
		}
	}
	w.Header().Set("Cache-Control", "private, no-store")
	ctx, org := r.Context(), principal.OrganizationID
	var data json.RawMessage
	var err error
	status, envelope := http.StatusOK, ""
	switch r.Method {
	case http.MethodGet, http.MethodHead:
		if id == "" {
			data, err = store.ListRepositoryWebhooks(ctx, org, repo.Slug)
			envelope = "webhooks"
		} else {
			data, err = store.ListRepositoryWebhookDeliveries(ctx, org, repo.Slug, id)
			envelope = "deliveries"
		}
	case http.MethodDelete:
		err = store.DeleteRepositoryWebhook(ctx, org, repo.Slug, id)
		status = http.StatusNoContent
	case http.MethodPost, http.MethodPatch:
		var input struct {
			URL    *string  `json:"url"`
			Secret *string  `json:"secret"`
			Events []string `json:"events"`
			Active *bool    `json:"active"`
		}
		if !decodeRepositoryWebhookInput(w, r, &input) {
			return
		}
		if r.Method == http.MethodPost {
			if input.URL == nil || input.Secret == nil || input.Events == nil {
				writeProblem(w, http.StatusBadRequest, "Webhook configuration required", "Specify url, secret, and events")
				return
			}
			data, err = store.CreateRepositoryWebhook(ctx, org, repo.Slug, *input.URL, *input.Secret, input.Events, input.Active == nil || *input.Active)
			if err == nil && data == nil {
				writeProblem(w, http.StatusConflict, "Webhook limit reached", "Delete an existing repository webhook before creating another")
				return
			}
			status = http.StatusCreated
		} else {
			if input.URL == nil && input.Secret == nil && input.Events == nil && input.Active == nil {
				writeProblem(w, http.StatusBadRequest, "Webhook changes required", "Specify at least one configuration field")
				return
			}
			data, err = store.UpdateRepositoryWebhook(ctx, org, repo.Slug, id, input.URL, input.Secret, input.Events, input.Active)
		}
	}
	switch {
	case errors.Is(err, fs.ErrInvalid):
		writeProblem(w, http.StatusBadRequest, "Invalid webhook configuration", err.Error())
	case errors.Is(err, sql.ErrNoRows):
		writeProblem(w, http.StatusNotFound, "Webhook not found", "The webhook or repository no longer exists")
	case err != nil:
		writeProblem(w, http.StatusInternalServerError, "Webhook operation failed", "The repository webhook operation could not be completed")
	case status == http.StatusNoContent:
		w.WriteHeader(status)
	case envelope != "":
		writeJSON(w, status, map[string]json.RawMessage{envelope: data})
	default:
		writeJSON(w, status, data)
	}
}

// Go's JSON decoder replaces malformed UTF-8. Reject it before decoding secrets.
func decodeRepositoryWebhookInput(w http.ResponseWriter, r *http.Request, input any) bool {
	body := http.MaxBytesReader(w, r.Body, 8192)
	defer body.Close()
	data, err := io.ReadAll(body)
	if err != nil || !utf8.Valid(data) {
		writeProblem(w, http.StatusBadRequest, "Invalid webhook configuration", "Provide a UTF-8 JSON object of at most 8192 bytes")
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(input); err != nil || !errors.Is(decoder.Decode(new(any)), io.EOF) {
		writeProblem(w, http.StatusBadRequest, "Invalid webhook configuration", "Provide a single JSON object with valid configuration fields")
		return false
	}
	return true
}
