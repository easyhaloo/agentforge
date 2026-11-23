package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
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

func (m *memoryRepository) List(_ context.Context, organizationID string, filter delivery.ListFilter, limit, offset int) ([]delivery.StoredChangeset, int, error) {
	if limit < 1 || limit > 100 || offset < 0 {
		return nil, 0, delivery.ErrInvalidInput
	}
	all := make([]delivery.StoredChangeset, 0, len(m.items))
	for key, item := range m.items {
		if len(key) >= len(organizationID)+1 && key[:len(organizationID)+1] == organizationID+"\x00" {
			all = append(all, item)
		}
	}
	items, total := delivery.FilterAndPage(all, filter, limit, offset)
	return items, total, nil
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
	}
	for _, item := range requests {
		request := httptest.NewRequest(http.MethodPost, item.path, bytes.NewBufferString(item.body))
		addValidCSRFCookies(request)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s status=%d, want %d: %s", item.path, response.Code, http.StatusServiceUnavailable, response.Body.String())
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
	members          []identity.OrganizationMember
	updatedRole      string
	updatedStatus    string
	removedUser      string
	invitations      []identity.OrganizationInvitation
	audit            []identity.MembershipAuditEvent
	createdTokenHash string
}

func (f *fakeMembershipRepository) FindMemberMentions(context.Context, string, string) ([]identity.MemberMention, error) {
	return []identity.MemberMention{}, nil
}

func (f *fakeMembershipRepository) ListMembers(context.Context, string, int, int) ([]identity.OrganizationMember, error) {
	return f.members, nil
}
func (f *fakeMembershipRepository) UpdateMembership(_ context.Context, _, _, userID string, role, status *string) (identity.OrganizationMember, error) {
	member := identity.OrganizationMember{UserID: userID, Role: "member", Status: "active"}
	if role != nil {
		member.Role = *role
		f.updatedRole = *role
	}
	if status != nil {
		member.Status = *status
		f.updatedStatus = *status
	}
	return member, nil
}
func (f *fakeMembershipRepository) RemoveMembership(_ context.Context, _, _, userID string) error {
	f.removedUser = userID
	return nil
}
func (f *fakeMembershipRepository) CreateInvitation(_ context.Context, org, actor, email, role, tokenHash string, expires time.Time) (identity.OrganizationInvitation, error) {
	f.createdTokenHash = tokenHash
	return identity.OrganizationInvitation{ID: "invite-1", Email: email, Role: role, Status: "pending", InvitedBy: actor, ExpiresAt: expires}, nil
}
func (f *fakeMembershipRepository) ListInvitations(context.Context, string, int, int) ([]identity.OrganizationInvitation, error) {
	return f.invitations, nil
}
func (f *fakeMembershipRepository) RevokeInvitation(context.Context, string, string, string) error {
	return nil
}
func (f *fakeMembershipRepository) ListMembershipAudit(context.Context, string, int, int) ([]identity.MembershipAuditEvent, error) {
	return f.audit, nil
}

func TestOrganizationMemberManagementRequiresAdminRole(t *testing.T) {
	for _, role := range []string{"member", "viewer"} {
		handler := NewHandlerWithDependencies(DeliveryDependencies{
			Repository: newMemoryRepository(), Identity: fixedIdentity{role: role}, CSRF: allowCSRF{},
			AllowedOrigin: "https://app.example.test", Membership: &fakeMembershipRepository{},
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
	repository := &fakeMembershipRepository{members: []identity.OrganizationMember{{UserID: "member-1", Role: "member", Status: "active"}}}
	handler := NewHandlerWithDependencies(DeliveryDependencies{
		Repository: newMemoryRepository(), Identity: fixedIdentity{role: "owner"}, CSRF: allowCSRF{},
		AllowedOrigin: "https://app.example.test", Membership: repository,
	})
	listRequest := httptest.NewRequest(http.MethodGet, "/api/v1/organizations/org-a/members", nil)
	listResponse := httptest.NewRecorder()
	handler.ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", listResponse.Code, listResponse.Body.String())
	}

	updateRequest := httptest.NewRequest(http.MethodPatch, "/api/v1/organizations/org-a/members/member-1", bytes.NewBufferString(`{"role":"viewer"}`))
	addValidCSRFCookies(updateRequest)
	updateResponse := httptest.NewRecorder()
	handler.ServeHTTP(updateResponse, updateRequest)
	if updateResponse.Code != http.StatusOK || repository.updatedRole != "viewer" {
		t.Fatalf("update status=%d role=%q body=%s", updateResponse.Code, repository.updatedRole, updateResponse.Body.String())
	}

	removeRequest := httptest.NewRequest(http.MethodDelete, "/api/v1/organizations/org-a/members/member-1", nil)
	addValidCSRFCookies(removeRequest)
	removeResponse := httptest.NewRecorder()
	handler.ServeHTTP(removeResponse, removeRequest)
	if removeResponse.Code != http.StatusNoContent || repository.removedUser != "member-1" {
		t.Fatalf("remove status=%d target=%q", removeResponse.Code, repository.removedUser)
	}
}

func TestOrganizationInvitationsAndAuditEndpoints(t *testing.T) {
	repository := &fakeMembershipRepository{}
	handler := NewHandlerWithDependencies(DeliveryDependencies{
		Repository: newMemoryRepository(), Identity: fixedIdentity{role: "owner"}, CSRF: allowCSRF{},
		AllowedOrigin: "https://app.example.test", Membership: repository,
	})
	create := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/org-a/invitations", bytes.NewBufferString(`{"email":"new@example.test","role":"member"}`))
	addValidCSRFCookies(create)
	created := httptest.NewRecorder()
	handler.ServeHTTP(created, create)
	if created.Code != http.StatusCreated {
		t.Fatalf("create invitation status=%d body=%s", created.Code, created.Body.String())
	}
	var payload struct {
		Invitation    identity.OrganizationInvitation `json:"invitation"`
		InvitationURL string                          `json:"invitation_url"`
		Token         string                          `json:"token"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Token == "" || repository.createdTokenHash != identity.HashToken(payload.Token) {
		t.Fatal("invitation token must be returned once while only its hash is passed to persistence")
	}
	parsed, err := url.Parse(payload.InvitationURL)
	if err != nil || parsed.Host != "app.example.test" || parsed.Query().Get("token") != payload.Token {
		t.Fatalf("invalid invitation URL %q err=%v", payload.InvitationURL, err)
	}

	list := httptest.NewRequest(http.MethodGet, "/api/v1/organizations/org-a/invitations", nil)
	listResponse := httptest.NewRecorder()
	handler.ServeHTTP(listResponse, list)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list invitations status=%d", listResponse.Code)
	}

	audit := httptest.NewRequest(http.MethodGet, "/api/v1/organizations/org-a/membership-audit", nil)
	auditResponse := httptest.NewRecorder()
	handler.ServeHTTP(auditResponse, audit)
	if auditResponse.Code != http.StatusOK {
		t.Fatalf("audit status=%d body=%s", auditResponse.Code, auditResponse.Body.String())
	}

	revoke := httptest.NewRequest(http.MethodDelete, "/api/v1/organizations/org-a/invitations/invite-1", nil)
	addValidCSRFCookies(revoke)
	revokeResponse := httptest.NewRecorder()
	handler.ServeHTTP(revokeResponse, revoke)
	if revokeResponse.Code != http.StatusNoContent {
		t.Fatalf("revoke status=%d body=%s", revokeResponse.Code, revokeResponse.Body.String())
	}
}

type fakeAccountRepository struct {
	account identity.AccountContext
	token   string
}

func (f *fakeAccountRepository) CurrentAccount(_ context.Context, token string) (identity.AccountContext, error) {
	f.token = token
	return f.account, nil
}

func TestCurrentAccountRequiresSessionAndReturnsOrganizationContext(t *testing.T) {
	repository := &fakeAccountRepository{account: identity.AccountContext{
		UserID: "user-1", DisplayName: "Test User", Email: "test@example.test",
		Organizations: []identity.OrganizationSummary{{ID: "org-a", Name: "Organization A", Role: "owner"}},
	}}
	handler := NewHandlerWithDependencies(DeliveryDependencies{Account: repository, AllowedOrigin: "https://app.example.test"})
	unauthenticated := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	unauthenticatedResponse := httptest.NewRecorder()
	handler.ServeHTTP(unauthenticatedResponse, unauthenticated)
	if unauthenticatedResponse.Code != http.StatusUnauthorized {
		t.Fatalf("without session status=%d", unauthenticatedResponse.Code)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	request.AddCookie(&http.Cookie{Name: identity.SessionCookieName, Value: "session-token-with-enough-length-to-be-valid"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || repository.token != "session-token-with-enough-length-to-be-valid" {
		t.Fatalf("current account status=%d token=%q body=%s", response.Code, repository.token, response.Body.String())
	}
	var account identity.AccountContext
	if err := json.Unmarshal(response.Body.Bytes(), &account); err != nil {
		t.Fatal(err)
	}
	if account.UserID != "user-1" || len(account.Organizations) != 1 || account.Organizations[0].ID != "org-a" {
		t.Fatalf("account context=%#v", account)
	}
}

// The helpers and tests below cover the changeset list filters and the server-derived status
// (page-system B2). They decode the wire JSON into local structs so they assert the API contract,
// not the handler's Go types.

type listFilterWireItem struct {
	Changeset struct {
		ID          string `json:"id"`
		Evaluations []struct {
			ID string `json:"id"`
		} `json:"evaluations"`
		Reviews []struct {
			ID string `json:"id"`
		} `json:"reviews"`
	} `json:"changeset"`
	Status *string `json:"status"`
}

type listFilterWirePage struct {
	Items  []listFilterWireItem `json:"items"`
	Total  *int                 `json:"total"`
	Limit  int                  `json:"limit"`
	Offset int                  `json:"offset"`
}

func listFilterRequest(handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	if method != http.MethodGet {
		addValidCSRFCookies(request)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func listFilterFetchPage(t *testing.T, handler http.Handler, path string) listFilterWirePage {
	t.Helper()
	response := listFilterRequest(handler, http.MethodGet, path, "")
	if response.Code != http.StatusOK {
		t.Fatalf("GET %s: status=%d body=%s", path, response.Code, response.Body.String())
	}
	var page listFilterWirePage
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	if page.Total == nil {
		t.Fatalf("GET %s: response has no total: %s", path, response.Body.String())
	}
	return page
}

func listFilterPageIDs(page listFilterWirePage) []string {
	ids := make([]string, 0, len(page.Items))
	for _, item := range page.Items {
		ids = append(ids, item.Changeset.ID)
	}
	return ids
}

// listFilterSeedMemory stores a changeset advanced to stage (draft, in_review or ready_to_merge)
// with a pinned updated_at so the newest-first order is deterministic.
func listFilterSeedMemory(t *testing.T, repository *memoryRepository, organizationID string, id delivery.ID, repositoryName, title, author, reviewer string, stage delivery.Lifecycle, updatedAt time.Time) {
	t.Helper()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now().UTC()
	changeset, err := delivery.NewChangeset(id, repositoryName, title, author, now)
	must(err)
	switch stage {
	case delivery.LifecycleDraft:
	case delivery.LifecycleInReview, delivery.LifecycleReadyToMerge:
		must(changeset.AddGitRevision("rev-1", "feature", "0123456789012345678901234567890123456789", "base", author, now))
		must(changeset.RecordEvaluation("eval-1", "rev-1", delivery.EvaluationPassed, "", "worker", now))
		must(changeset.AttachEvidence("ev-1", "rev-1", "eval-1", "report", "artifact://sha256", "worker", now))
		must(changeset.AssignReview("review-1", "rev-1", reviewer, author, "", now))
		if stage == delivery.LifecycleReadyToMerge {
			must(changeset.DecideReview("review-1", true, reviewer, "", now))
		}
	default:
		t.Fatalf("listFilterSeedMemory does not build %q", stage)
	}
	if got := changeset.Lifecycle(); got != stage {
		t.Fatalf("seed %s is %q, want %q", id, got, stage)
	}
	repository.items[scopedKey(organizationID, id)] = delivery.StoredChangeset{Changeset: changeset, Version: 1, CreatedAt: updatedAt, UpdatedAt: updatedAt}
}

func TestListChangesetsAppliesQueryFilters(t *testing.T) {
	repository := newMemoryRepository()
	base := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)
	// Newest first in organization A: a4, a2, a3, a1. Organization B's changeset is the newest of all.
	listFilterSeedMemory(t, repository, "org-a", "a1", "team/api", "Add login", "alice", "rita", delivery.LifecycleInReview, base.Add(1*time.Minute))
	listFilterSeedMemory(t, repository, "org-a", "a2", "team/api", "Fix cache", "bob", "rita", delivery.LifecycleReadyToMerge, base.Add(3*time.Minute))
	listFilterSeedMemory(t, repository, "org-a", "a3", "team/web", "Refactor table", "alice", "", delivery.LifecycleDraft, base.Add(2*time.Minute))
	listFilterSeedMemory(t, repository, "org-a", "a4", "team/web", "Needs review", "carol", "sam", delivery.LifecycleInReview, base.Add(4*time.Minute))
	listFilterSeedMemory(t, repository, "org-b", "b1", "team/api", "Other tenant", "alice", "rita", delivery.LifecycleInReview, base.Add(5*time.Minute))

	handlerFor := func(user, role string) http.Handler {
		return NewHandlerWithDependencies(DeliveryDependencies{Repository: repository, Identity: namedIdentity{user: user, role: role}, CSRF: allowCSRF{}, AllowedOrigin: "https://app.example.test"})
	}
	rita, sam := handlerFor("rita", "member"), handlerFor("sam", "viewer")
	const orgA, orgB = "/api/v1/organizations/org-a/changesets", "/api/v1/organizations/org-b/changesets"

	cases := []struct {
		name      string
		handler   http.Handler
		path      string
		want      []string
		wantTotal int
	}{
		{"no filters", rita, orgA, []string{"a4", "a2", "a3", "a1"}, 4},
		{"empty filter values mean no filter", rita, orgA + "?repository=&status=&reviewer=&q=", []string{"a4", "a2", "a3", "a1"}, 4},
		{"repository", rita, orgA + "?repository=team/api", []string{"a2", "a1"}, 2},
		{"repository is exact", rita, orgA + "?repository=team/ap", nil, 0},
		{"status", rita, orgA + "?status=in_review", []string{"a4", "a1"}, 2},
		{"status draft", rita, orgA + "?status=draft", []string{"a3"}, 1},
		{"reviewer by user id", rita, orgA + "?reviewer=sam", []string{"a4"}, 1},
		{"reviewer me resolves to the authenticated user", rita, orgA + "?reviewer=me", []string{"a2", "a1"}, 2},
		{"reviewer me follows the principal, not a literal", sam, orgA + "?reviewer=me", []string{"a4"}, 1},
		{"my pending review queue", rita, orgA + "?reviewer=me&status=in_review", []string{"a1"}, 1},
		{"reviewer nobody", rita, orgA + "?reviewer=nobody", nil, 0},
		{"q is case-insensitive", rita, orgA + "?q=ALICE", []string{"a3", "a1"}, 2},
		{"q is trimmed", rita, orgA + "?q=%20cache%20", []string{"a2"}, 1},
		{"filters are ANDed", rita, orgA + "?repository=team/api&reviewer=me&status=ready_to_merge", []string{"a2"}, 1},
		{"repository and q", rita, orgA + "?repository=team/web&q=carol", []string{"a4"}, 1},
		{"total counts matches before paging", rita, orgA + "?repository=team/api&limit=1&offset=1", []string{"a1"}, 2},
		{"unfiltered second page", rita, orgA + "?limit=2&offset=2", []string{"a3", "a1"}, 4},
		{"page beyond the end keeps the total", rita, orgA + "?limit=2&offset=10", nil, 4},
		{"organization B only sees its own", rita, orgB, []string{"b1"}, 1},
		{"organization A's repository is empty in organization B", rita, orgB + "?repository=team/web", nil, 0},
		{"viewers can filter", sam, orgA + "?status=draft", []string{"a3"}, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			page := listFilterFetchPage(t, tc.handler, tc.path)
			if got := listFilterPageIDs(page); !slices.Equal(got, tc.want) || *page.Total != tc.wantTotal {
				t.Fatalf("got %v total=%d, want %v total=%d", got, *page.Total, tc.want, tc.wantTotal)
			}
		})
	}

	page := listFilterFetchPage(t, rita, orgA+"?limit=1&offset=1")
	if page.Limit != 1 || page.Offset != 1 {
		t.Fatalf("limit=%d offset=%d, want the requested 1 and 1", page.Limit, page.Offset)
	}
	if body := listFilterRequest(rita, http.MethodGet, orgA+"?reviewer=nobody", "").Body.String(); !strings.Contains(body, `"items":[]`) || !strings.Contains(body, `"total":0`) {
		t.Fatalf("an empty result must encode items as [] and total as 0: %s", body)
	}
}

func TestListChangesetsRejectsInvalidParameters(t *testing.T) {
	handler := NewHandlerWithDependencies(DeliveryDependencies{Repository: newMemoryRepository(), Identity: namedIdentity{user: "rita", role: "member"}, CSRF: allowCSRF{}, AllowedOrigin: "https://app.example.test"})
	const path = "/api/v1/organizations/org-a/changesets?"

	rejected := []struct{ name, query, title string }{
		{"unknown status", "status=bogus", "Invalid status"},
		{"status is case-sensitive", "status=Draft", "Invalid status"},
		{"status uses underscores", "status=ready-to-merge", "Invalid status"},
		{"query over 200 characters", "q=" + strings.Repeat("a", 201), "Invalid query"},
		{"query over 200 multi-byte characters", "q=" + url.QueryEscape(strings.Repeat("变", 201)), "Invalid query"},
		{"non-integer limit", "limit=abc", "Invalid limit"},
		{"non-integer offset", "offset=abc", "Invalid offset"},
		{"limit zero", "limit=0", "Invalid pagination"},
		{"limit above 100", "limit=101", "Invalid pagination"},
		{"negative offset", "offset=-1", "Invalid pagination"},
	}
	for _, tc := range rejected {
		t.Run(tc.name, func(t *testing.T) {
			response := listFilterRequest(handler, http.MethodGet, path+tc.query, "")
			if response.Code != http.StatusBadRequest || response.Header().Get("Content-Type") != "application/problem+json" {
				t.Fatalf("status=%d content-type=%q body=%s, want a 400 problem", response.Code, response.Header().Get("Content-Type"), response.Body.String())
			}
			var problem problemResponse
			if err := json.Unmarshal(response.Body.Bytes(), &problem); err != nil {
				t.Fatal(err)
			}
			if problem.Status != http.StatusBadRequest || problem.Title != tc.title {
				t.Fatalf("problem=%+v, want status 400 titled %q", problem, tc.title)
			}
		})
	}

	accepted := []struct{ name, query string }{
		{"query of exactly 200 characters", "q=" + strings.Repeat("a", 200)},
		{"query counts characters, not bytes", "q=" + url.QueryEscape(strings.Repeat("变", 200))},
		{"status draft", "status=draft"},
		{"status evaluation_pending", "status=evaluation_pending"},
		{"status evaluation_failed", "status=evaluation_failed"},
		{"status evidence_required", "status=evidence_required"},
		{"status review_required", "status=review_required"},
		{"status in_review", "status=in_review"},
		{"status changes_requested", "status=changes_requested"},
		{"status ready_to_merge", "status=ready_to_merge"},
		{"status merged", "status=merged"},
	}
	for _, tc := range accepted {
		t.Run(tc.name, func(t *testing.T) {
			if response := listFilterRequest(handler, http.MethodGet, path+tc.query, ""); response.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s, want 200", response.Code, response.Body.String())
			}
		})
	}
}

// TestChangesetResponsesCarryTheServerDerivedStatus walks one changeset through the whole HTTP
// lifecycle and checks that every stored-changeset response (create, get, list and each mutation)
// reports the status the server derives, next to version rather than inside the changeset.
func TestChangesetResponsesCarryTheServerDerivedStatus(t *testing.T) {
	repository := newMemoryRepository()
	deps := DeliveryDependencies{Repository: repository, Catalog: &lifecycleCatalog{}, Identity: namedIdentity{user: "author-1", role: "owner"}, CSRF: allowCSRF{}, AllowedOrigin: "https://app.example.test", Git: lifecycleGit{}, Evaluator: lifecycleEvaluator{}, Evidence: lifecycleEvidence{}, Reviewers: lifecycleReviewers{}, Locker: lifecycleLocker{}}
	author := NewHandlerWithDependencies(deps)
	deps.Identity = namedIdentity{user: "reviewer-1", role: "member"}
	reviewer := NewHandlerWithDependencies(deps)
	const base = "/api/v1/organizations/org-a"

	var latest listFilterWireItem
	step := func(name string, handler http.Handler, method, path, body string, wantCode int, wantStatus string) {
		t.Helper()
		response := listFilterRequest(handler, method, path, body)
		if response.Code != wantCode {
			t.Fatalf("%s: status=%d body=%s, want %d", name, response.Code, response.Body.String(), wantCode)
		}
		latest = listFilterWireItem{}
		if err := json.Unmarshal(response.Body.Bytes(), &latest); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if latest.Status == nil || *latest.Status != wantStatus {
			t.Fatalf("%s: status field = %v, want %q: %s", name, latest.Status, wantStatus, response.Body.String())
		}
	}

	if response := listFilterRequest(author, http.MethodPost, base+"/repositories", `{"slug":"team/repo","default_branch":"main"}`); response.Code != http.StatusCreated {
		t.Fatalf("register repository: %d %s", response.Code, response.Body.String())
	}
	step("create", author, http.MethodPost, base+"/changesets", `{"repository":"team/repo","title":"Deliver feature"}`, http.StatusCreated, "draft")
	changePath := base + "/changesets/" + latest.Changeset.ID
	step("get", author, http.MethodGet, changePath, "", http.StatusOK, "draft")
	step("add revision", author, http.MethodPost, changePath+"/revisions", `{"ref":"feature"}`, http.StatusOK, "evaluation_pending")
	step("evaluate", author, http.MethodPost, changePath+"/evaluations", `{}`, http.StatusOK, "review_required")
	step("attach evidence", author, http.MethodPost, changePath+"/evidence", `{"evaluation_id":"`+latest.Changeset.Evaluations[0].ID+`"}`, http.StatusOK, "review_required")
	step("assign review", author, http.MethodPost, changePath+"/reviews", `{"reviewer_id":"reviewer-1"}`, http.StatusCreated, "in_review")
	step("request changes", reviewer, http.MethodPost, changePath+"/reviews/"+latest.Changeset.Reviews[0].ID+"/decision", `{"approved":false}`, http.StatusOK, "changes_requested")
	step("assign a second review", author, http.MethodPost, changePath+"/reviews", `{"reviewer_id":"reviewer-1"}`, http.StatusCreated, "in_review")
	step("approve", reviewer, http.MethodPost, changePath+"/reviews/"+latest.Changeset.Reviews[1].ID+"/decision", `{"approved":true}`, http.StatusOK, "ready_to_merge")
	step("get before merge", author, http.MethodGet, changePath, "", http.StatusOK, "ready_to_merge")

	listed := listFilterFetchPage(t, author, base+"/changesets")
	if len(listed.Items) != 1 || listed.Items[0].Status == nil || *listed.Items[0].Status != "ready_to_merge" {
		t.Fatalf("list item status = %+v, want one item that is ready_to_merge", listed.Items)
	}
	if page := listFilterFetchPage(t, author, base+"/changesets?status=ready_to_merge"); *page.Total != 1 {
		t.Fatalf("status=ready_to_merge total=%d, want 1", *page.Total)
	}
	if page := listFilterFetchPage(t, author, base+"/changesets?status=in_review"); *page.Total != 0 {
		t.Fatalf("status=in_review total=%d, want 0", *page.Total)
	}

	merged := listFilterRequest(author, http.MethodPost, changePath+"/merge", `{"target_ref":"main"}`)
	if merged.Code != http.StatusOK {
		t.Fatalf("merge: %d %s", merged.Code, merged.Body.String())
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(merged.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	if string(raw["status"]) != `"merged"` {
		t.Fatalf("merge response status = %s, want \"merged\": %s", raw["status"], merged.Body.String())
	}
	if _, ok := raw["version"]; !ok {
		t.Fatal("merge response lost its version")
	}
	var inner map[string]json.RawMessage
	if err := json.Unmarshal(raw["changeset"], &inner); err != nil {
		t.Fatal(err)
	}
	if _, ok := inner["status"]; ok {
		t.Fatal("status belongs beside version, not inside the changeset")
	}
	if page := listFilterFetchPage(t, author, base+"/changesets?status=merged"); *page.Total != 1 {
		t.Fatalf("status=merged total=%d, want 1", *page.Total)
	}
}

// listFilterActiveReviewers authorizes the listed users as active members of every organization.
type listFilterActiveReviewers map[string]bool

func (r listFilterActiveReviewers) IsActiveMember(_ context.Context, _, user string) (bool, error) {
	return r[user], nil
}

type listFilterReviewWire struct {
	Changeset struct {
		ID      string `json:"id"`
		Reviews []struct {
			ID       string `json:"id"`
			Reviewer string `json:"reviewer"`
			Status   string `json:"status"`
		} `json:"reviews"`
		Audit []struct {
			Operation string `json:"operation"`
			TargetID  string `json:"target_id"`
			Outcome   string `json:"outcome"`
		} `json:"audit"`
	} `json:"changeset"`
	Status string `json:"status"`
}

// TestOneActiveReviewPerRevisionOverHTTP walks the single-active-review rule through the real
// handler: a second assignment supersedes the pending review (and the reviewer filter follows), the
// superseded review cannot be decided, and once the current revision is approved a further
// assignment is a 409 until a new revision is added.
func TestOneActiveReviewPerRevisionOverHTTP(t *testing.T) {
	deps := DeliveryDependencies{
		Repository: newMemoryRepository(), Catalog: &lifecycleCatalog{}, CSRF: allowCSRF{}, AllowedOrigin: "https://app.example.test",
		Git: lifecycleGit{}, Evaluator: lifecycleEvaluator{}, Evidence: lifecycleEvidence{}, Locker: lifecycleLocker{},
		Reviewers: listFilterActiveReviewers{"reviewer-1": true, "reviewer-2": true},
	}
	handlerFor := func(user, role string) http.Handler {
		deps.Identity = namedIdentity{user: user, role: role}
		return NewHandlerWithDependencies(deps)
	}
	author, reviewer1, reviewer2 := handlerFor("author-1", "owner"), handlerFor("reviewer-1", "member"), handlerFor("reviewer-2", "member")
	const base = "/api/v1/organizations/org-a"

	var latest listFilterReviewWire
	call := func(name string, handler http.Handler, method, path, body string, want int) {
		t.Helper()
		response := listFilterRequest(handler, method, path, body)
		if response.Code != want {
			t.Fatalf("%s: status=%d body=%s, want %d", name, response.Code, response.Body.String(), want)
		}
		latest = listFilterReviewWire{}
		if response.Header().Get("Content-Type") == "application/json" {
			if err := json.Unmarshal(response.Body.Bytes(), &latest); err != nil {
				t.Fatalf("%s: %v", name, err)
			}
		}
	}
	expectStatus := func(name, want string) {
		t.Helper()
		if latest.Status != want {
			t.Fatalf("%s: status field = %q, want %q", name, latest.Status, want)
		}
	}

	call("register repository", author, http.MethodPost, base+"/repositories", `{"slug":"team/repo","default_branch":"main"}`, http.StatusCreated)
	call("create", author, http.MethodPost, base+"/changesets", `{"repository":"team/repo","title":"One active review"}`, http.StatusCreated)
	changePath := base + "/changesets/" + latest.Changeset.ID
	call("add revision", author, http.MethodPost, changePath+"/revisions", `{"ref":"feature"}`, http.StatusOK)
	call("evaluate", author, http.MethodPost, changePath+"/evaluations", `{}`, http.StatusOK)
	expectStatus("evaluate", "review_required")

	// the second assignment supersedes the first pending review
	call("assign reviewer-1", author, http.MethodPost, changePath+"/reviews", `{"reviewer_id":"reviewer-1"}`, http.StatusCreated)
	expectStatus("assign reviewer-1", "in_review")
	call("assign reviewer-2", author, http.MethodPost, changePath+"/reviews", `{"reviewer_id":"reviewer-2"}`, http.StatusCreated)
	expectStatus("assign reviewer-2", "in_review")
	if len(latest.Changeset.Reviews) != 2 || latest.Changeset.Reviews[0].Status != "stale" || latest.Changeset.Reviews[1].Status != "pending" || latest.Changeset.Reviews[1].Reviewer != "reviewer-2" {
		t.Fatalf("reviews after the second assignment = %+v, want [stale, pending reviewer-2]", latest.Changeset.Reviews)
	}
	superseded, current := latest.Changeset.Reviews[0].ID, latest.Changeset.Reviews[1].ID
	found := false
	for _, event := range latest.Changeset.Audit {
		found = found || (event.Operation == "review.superseded" && event.TargetID == superseded && event.Outcome == "stale")
	}
	if !found {
		t.Fatalf("audit = %+v, want a review.superseded event for %s with outcome stale", latest.Changeset.Audit, superseded)
	}

	// the reviewer filter follows: reviewer-1's queue is empty, reviewer-2's has the changeset
	for _, tc := range []struct {
		reviewer string
		want     int
	}{{"reviewer-1", 0}, {"reviewer-2", 1}} {
		if page := listFilterFetchPage(t, author, base+"/changesets?status=in_review&reviewer="+tc.reviewer); *page.Total != tc.want {
			t.Fatalf("reviewer=%s&status=in_review total=%d, want %d", tc.reviewer, *page.Total, tc.want)
		}
	}

	// the superseded review can no longer be decided
	call("decide the superseded review", reviewer1, http.MethodPost, changePath+"/reviews/"+superseded+"/decision", `{"approved":true}`, http.StatusConflict)
	call("approve the current review", reviewer2, http.MethodPost, changePath+"/reviews/"+current+"/decision", `{"approved":true}`, http.StatusOK)
	expectStatus("approve", "ready_to_merge")
	approvedAudit := len(latest.Changeset.Audit)

	// once the revision is approved, another assignment is a 409 and changes nothing
	for _, reviewer := range []string{"reviewer-1", "reviewer-2"} {
		response := listFilterRequest(author, http.MethodPost, changePath+"/reviews", `{"reviewer_id":"`+reviewer+`"}`)
		listFilterProblem(t, response, http.StatusConflict, "Review already approved")
		var problem problemResponse
		if err := json.Unmarshal(response.Body.Bytes(), &problem); err != nil {
			t.Fatal(err)
		}
		if want := "The current revision already has an approved review. Add a new revision to request another review."; problem.Detail != want {
			t.Fatalf("detail = %q, want %q", problem.Detail, want)
		}
	}
	call("get after the refusals", author, http.MethodGet, changePath, "", http.StatusOK)
	expectStatus("get after the refusals", "ready_to_merge")
	if len(latest.Changeset.Reviews) != 2 || len(latest.Changeset.Audit) != approvedAudit {
		t.Fatalf("a refused assignment changed the changeset: %d reviews, %d audit events (was %d)", len(latest.Changeset.Reviews), len(latest.Changeset.Audit), approvedAudit)
	}

	// a new revision lifts the refusal
	call("add a second revision", author, http.MethodPost, changePath+"/revisions", `{"ref":"feature-2"}`, http.StatusOK)
	expectStatus("add a second revision", "evaluation_pending")
	call("evaluate the second revision", author, http.MethodPost, changePath+"/evaluations", `{}`, http.StatusOK)
	call("assign on the second revision", author, http.MethodPost, changePath+"/reviews", `{"reviewer_id":"reviewer-1"}`, http.StatusCreated)
	expectStatus("assign on the second revision", "in_review")
}
