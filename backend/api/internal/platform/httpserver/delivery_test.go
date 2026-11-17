package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

type memoryRepository struct {
	items map[string]delivery.StoredChangeset
}

func (m *memoryRepository) Ping(context.Context) error { return nil }

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
	handler := NewHandlerWithDependencies(DeliveryDependencies{Repository: newMemoryRepository(), CSRF: allowCSRF{}, AllowedOrigin: "https://app.example.test"})
	path := "/api/v1/organizations/org-a/changesets"
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(`{"repository":"org/repo","title":"Change","actor":"forged"}`))
	addValidCSRFCookies(request)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}

func TestDeliveryAPIUsesTrustedIdentityAndOrganizationScope(t *testing.T) {
	repository := newMemoryRepository()
	handler := NewHandlerWithDependencies(DeliveryDependencies{Repository: repository, Identity: fixedIdentity{role: "member"}, CSRF: allowCSRF{}, AllowedOrigin: "https://app.example.test"})
	path := "/api/v1/organizations/org-a/changesets"
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(`{"repository":"org/repo","title":"Add capability"}`))
	addValidCSRFCookies(request)
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
	handler := NewHandlerWithDependencies(DeliveryDependencies{Repository: newMemoryRepository(), Identity: fixedIdentity{role: "viewer"}, CSRF: allowCSRF{}, AllowedOrigin: "https://app.example.test"})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/org-a/changesets", bytes.NewBufferString(`{"repository":"org/repo","title":"Change"}`))
	addValidCSRFCookies(request)
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
	handler := NewHandlerWithDependencies(DeliveryDependencies{Repository: repository, Identity: fixedIdentity{role: "member"}, CSRF: allowCSRF{}, AllowedOrigin: "https://app.example.test"})
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
		addValidCSRFCookies(request)
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


type fakeMembershipRepository struct {
	members []identity.OrganizationMember
	updatedRole string
	updatedStatus string
	removedUser string
}

func (f *fakeMembershipRepository) ListMembers(context.Context, string, int, int) ([]identity.OrganizationMember, error) {
	return f.members, nil
}
func (f *fakeMembershipRepository) UpdateMembership(_ context.Context, _, _, userID string, role, status *string) (identity.OrganizationMember, error) {
	member := identity.OrganizationMember{UserID:userID, Role:"member", Status:"active"}
	if role != nil { member.Role = *role; f.updatedRole = *role }
	if status != nil { member.Status = *status; f.updatedStatus = *status }
	return member, nil
}
func (f *fakeMembershipRepository) RemoveMembership(_ context.Context, _, _, userID string) error {
	f.removedUser = userID
	return nil
}

func TestOrganizationMemberManagementRequiresAdminRole(t *testing.T) {
	for _, role := range []string{"member", "viewer"} {
		handler := NewHandlerWithDependencies(DeliveryDependencies{
			Repository:newMemoryRepository(), Identity:fixedIdentity{role:role}, CSRF:allowCSRF{},
			AllowedOrigin:"https://app.example.test", Membership:&fakeMembershipRepository{},
		})
		request := httptest.NewRequest(http.MethodGet, "/api/v1/organizations/org-a/members", nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusForbidden {
			t.Fatalf("role %s list members status=%d, want 403", role, response.Code)
		}
	}
}

func TestOrganizationMemberManagementUsesAuthenticatedActorAndScopedOrganization(t *testing.T) {
	repository := &fakeMembershipRepository{members:[]identity.OrganizationMember{{UserID:"member-1",Role:"member",Status:"active"}}}
	handler := NewHandlerWithDependencies(DeliveryDependencies{
		Repository:newMemoryRepository(), Identity:fixedIdentity{role:"owner"}, CSRF:allowCSRF{},
		AllowedOrigin:"https://app.example.test", Membership:repository,
	})
	listRequest := httptest.NewRequest(http.MethodGet, "/api/v1/organizations/org-a/members", nil)
	listResponse := httptest.NewRecorder()
	handler.ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK { t.Fatalf("list status=%d body=%s",listResponse.Code,listResponse.Body.String()) }

	updateRequest := httptest.NewRequest(http.MethodPatch, "/api/v1/organizations/org-a/members/member-1", bytes.NewBufferString(`{"role":"viewer"}`))
	addValidCSRFCookies(updateRequest)
	updateResponse := httptest.NewRecorder()
	handler.ServeHTTP(updateResponse, updateRequest)
	if updateResponse.Code != http.StatusOK || repository.updatedRole != "viewer" {
		t.Fatalf("update status=%d role=%q body=%s",updateResponse.Code,repository.updatedRole,updateResponse.Body.String())
	}

	removeRequest := httptest.NewRequest(http.MethodDelete, "/api/v1/organizations/org-a/members/member-1", nil)
	addValidCSRFCookies(removeRequest)
	removeResponse := httptest.NewRecorder()
	handler.ServeHTTP(removeResponse, removeRequest)
	if removeResponse.Code != http.StatusNoContent || repository.removedUser != "member-1" {
		t.Fatalf("remove status=%d target=%q",removeResponse.Code,repository.removedUser)
	}
}
