package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

type memoryRepository struct {
	items map[string]delivery.StoredChangeset
}

func newMemoryRepository() *memoryRepository {
	return &memoryRepository{items: make(map[string]delivery.StoredChangeset)}
}

func scopedKey(organizationID string, id delivery.ID) string {
	return organizationID + "\x00" + string(id)
}

func (m *memoryRepository) Create(_ context.Context, organizationID string, changeset *delivery.Changeset) (delivery.StoredChangeset, error) {
	key := scopedKey(organizationID, changeset.ID)
	if _, ok := m.items[key]; ok {
		return delivery.StoredChangeset{}, delivery.ErrVersionConflict
	}
	now := time.Now().UTC()
	item := delivery.StoredChangeset{Changeset: changeset, Version: 1, CreatedAt: now, UpdatedAt: now}
	m.items[key] = item
	return item, nil
}

func (m *memoryRepository) Update(_ context.Context, organizationID string, changeset *delivery.Changeset, version int64) (delivery.StoredChangeset, error) {
	key := scopedKey(organizationID, changeset.ID)
	item, ok := m.items[key]
	if !ok {
		return delivery.StoredChangeset{}, delivery.ErrNotFound
	}
	if item.Version != version {
		return delivery.StoredChangeset{}, delivery.ErrVersionConflict
	}
	item.Changeset = changeset
	item.Version++
	item.UpdatedAt = time.Now().UTC()
	m.items[key] = item
	return item, nil
}

func (m *memoryRepository) Get(_ context.Context, organizationID string, id delivery.ID) (delivery.StoredChangeset, error) {
	item, ok := m.items[scopedKey(organizationID, id)]
	if !ok {
		return delivery.StoredChangeset{}, delivery.ErrNotFound
	}
	return item, nil
}

func (m *memoryRepository) List(_ context.Context, organizationID string, limit, offset int) ([]delivery.StoredChangeset, error) {
	if limit < 1 || limit > 100 || offset < 0 {
		return nil, delivery.ErrInvalidInput
	}
	items := make([]delivery.StoredChangeset, 0, len(m.items))
	for key, item := range m.items {
		if len(key) >= len(organizationID)+1 && key[:len(organizationID)+1] == organizationID+"\x00" {
			items = append(items, item)
		}
	}
	if offset >= len(items) {
		return []delivery.StoredChangeset{}, nil
	}
	end := offset + limit
	if end > len(items) {
		end = len(items)
	}
	return items[offset:end], nil
}

type fixedIdentity struct {
	role string
}

func (f fixedIdentity) ResolvePrincipal(_ *http.Request, organizationID string) (Principal, error) {
	return Principal{UserID: "test-user", OrganizationID: organizationID, Role: f.role}, nil
}

func TestDeliveryAPIRequiresTrustedIdentityForWrites(t *testing.T) {
	handler := NewHandlerWithDependencies(DeliveryDependencies{Repository: newMemoryRepository()})
	path := "/api/v1/organizations/org-a/changesets"
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(`{"repository":"org/repo","title":"Change","actor":"forged"}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}

func TestDeliveryAPIUsesTrustedIdentityAndOrganizationScope(t *testing.T) {
	repository := newMemoryRepository()
	handler := NewHandlerWithDependencies(DeliveryDependencies{Repository: repository, Identity: fixedIdentity{role: "member"}})
	path := "/api/v1/organizations/org-a/changesets"
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(`{"repository":"org/repo","title":"Add capability"}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", response.Code, response.Body.String())
	}
	var stored storedChangesetResponse
	if err := json.Unmarshal(response.Body.Bytes(), &stored); err != nil {
		t.Fatal(err)
	}
	if stored.Changeset.CreatedBy != "test-user" {
		t.Fatalf("created_by=%q, want trusted identity", stored.Changeset.CreatedBy)
	}

	listRequest := httptest.NewRequest(http.MethodGet, path, nil)
	listResponse := httptest.NewRecorder()
	handler.ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", listResponse.Code, listResponse.Body.String())
	}
	var page changesetListResponse
	if err := json.Unmarshal(listResponse.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("items=%d, want 1", len(page.Items))
	}

	otherOrganizationRequest := httptest.NewRequest(http.MethodGet, "/api/v1/organizations/org-b/changesets/"+string(stored.Changeset.ID), nil)
	otherOrganizationResponse := httptest.NewRecorder()
	handler.ServeHTTP(otherOrganizationResponse, otherOrganizationRequest)
	if otherOrganizationResponse.Code != http.StatusNotFound {
		t.Fatalf("cross-organization get status=%d, want 404", otherOrganizationResponse.Code)
	}
}

func TestViewerCannotCreateChangeset(t *testing.T) {
	handler := NewHandlerWithDependencies(DeliveryDependencies{Repository: newMemoryRepository(), Identity: fixedIdentity{role: "viewer"}})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/org-a/changesets", bytes.NewBufferString(`{"repository":"org/repo","title":"Change"}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status=%d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestDeliveryAPIRejectsUnconfiguredLifecycleAdapters(t *testing.T) {
	repository := newMemoryRepository()
	now := time.Now().UTC()
	changeset, err := delivery.NewChangeset("cs-existing", "org/repo", "Change", "author", now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.Create(context.Background(), "org-a", changeset); err != nil {
		t.Fatal(err)
	}
	handler := NewHandlerWithDependencies(DeliveryDependencies{Repository: repository, Identity: fixedIdentity{role: "member"}})
	base := "/api/v1/organizations/org-a/changesets/cs-existing"
	requests := []struct{ path, body string }{
		{base + "/revisions", `{"ref":"commit-1"}`},
		{base + "/evaluations", `{"revision_id":"rev-1","status":"passed","summary":"client cannot assert success"}`},
		{base + "/evidence", `{"revision_id":"rev-1","evaluation_id":"eval-1","kind":"ci","uri":"https://example.test"}`},
		{base + "/reviews", `{"revision_id":"rev-1"}`},
		{base + "/reviews/rev-1/decision", `{"approved":true}`},
	}
	for _, item := range requests {
		request := httptest.NewRequest(http.MethodPost, item.path, bytes.NewBufferString(item.body))
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusNotImplemented {
			t.Fatalf("%s status=%d, want %d: %s", item.path, response.Code, http.StatusNotImplemented, response.Body.String())
		}
	}
	persisted, err := repository.Get(context.Background(), "org-a", "cs-existing")
	if err != nil {
		t.Fatal(err)
	}
	if len(persisted.Changeset.Revisions) != 0 || len(persisted.Changeset.Evaluations) != 0 || len(persisted.Changeset.Evidence) != 0 || len(persisted.Changeset.Reviews) != 0 {
		t.Fatal("unconfigured adapters must not mutate delivery state")
	}
}

var _ delivery.Repository = (*memoryRepository)(nil)
var _ = errors.Is
