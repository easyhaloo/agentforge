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

// mockIdentityRepo implements both delivery.Repository and IdentityManagementRepository for testing
type mockIdentityRepo struct {
	identities          []identity.UserIdentityRecord
	identityCount       int
	hasPlatformCreds    bool
	deleteErr           error
	changePasswordErr   error
	listErr             error
	countErr            error
	hasPlatformCredsErr error
}

// Identity management methods
func (m *mockIdentityRepo) ListUserIdentities(ctx context.Context, userID string) ([]identity.UserIdentityRecord, error) {
	if m.listErr != nil {
		return nil, m.listErr
	}
	return m.identities, nil
}

func (m *mockIdentityRepo) GetUserIdentityCount(ctx context.Context, userID string) (int, error) {
	if m.countErr != nil {
		return 0, m.countErr
	}
	return m.identityCount, nil
}

func (m *mockIdentityRepo) DeleteUserIdentity(ctx context.Context, userID, identityID string) error {
	return m.deleteErr
}

func (m *mockIdentityRepo) ChangeUserPassword(ctx context.Context, userID, currentPassword, newPassword string) error {
	return m.changePasswordErr
}

func (m *mockIdentityRepo) HasPlatformCredentials(ctx context.Context, userID string) (bool, error) {
	if m.hasPlatformCredsErr != nil {
		return false, m.hasPlatformCredsErr
	}
	return m.hasPlatformCreds, nil
}

// Stub methods for delivery.Repository interface (not used in identity tests)
func (m *mockIdentityRepo) Create(ctx context.Context, organizationID string, changeset *delivery.Changeset) (delivery.StoredChangeset, error) {
	return delivery.StoredChangeset{}, nil
}
func (m *mockIdentityRepo) Get(ctx context.Context, organizationID string, id delivery.ID) (delivery.StoredChangeset, error) {
	return delivery.StoredChangeset{}, nil
}
func (m *mockIdentityRepo) Update(ctx context.Context, organizationID string, changeset *delivery.Changeset, version int64) (delivery.StoredChangeset, error) {
	return delivery.StoredChangeset{}, nil
}
func (m *mockIdentityRepo) List(ctx context.Context, organizationID string, filter delivery.ListFilter, limit, offset int) ([]delivery.StoredChangeset, int, error) {
	return nil, 0, nil
}

// mockAccountRepo implements AccountRepository for testing
type mockAccountRepo struct {
	account identity.AccountContext
	err     error
}

func (m *mockAccountRepo) CurrentAccount(ctx context.Context, sessionToken string) (identity.AccountContext, error) {
	if m.err != nil {
		return identity.AccountContext{}, m.err
	}
	return m.account, nil
}

func TestListIdentities(t *testing.T) {
	now := time.Now().UTC()
	mockRepo := &mockIdentityRepo{
		identities: []identity.UserIdentityRecord{
			{
				ID:          "id-platform",
				UserID:      "user-123",
				Issuer:      "platform:internal",
				Subject:     "user-123",
				Email:       "user@example.com",
				DisplayName: "Test User",
				CreatedAt:   now.Add(-7 * 24 * time.Hour),
			},
			{
				ID:          "id-google",
				UserID:      "user-123",
				Issuer:      "https://accounts.google.com",
				Subject:     "google-subject-456",
				Email:       "user@example.com",
				DisplayName: "Test User",
				CreatedAt:   now,
			},
		},
	}

	mockAccount := &mockAccountRepo{
		account: identity.AccountContext{
			UserID:      "user-123",
			DisplayName: "Test User",
			Email:       "user@example.com",
		},
	}

	deps := DeliveryDependencies{
		Repository: mockRepo,
		Account:    mockAccount,
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/identities", nil)
	req.AddCookie(&http.Cookie{
		Name:  identity.SessionCookieName,
		Value: "valid-session-token",
	})
	w := httptest.NewRecorder()

	deps.listIdentities(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response listIdentitiesResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if len(response.Identities) != 2 {
		t.Errorf("expected 2 identities, got %d", len(response.Identities))
	}

	// Verify platform identity formatting
	if response.Identities[0].ProviderDisplay != "Platform Password" {
		t.Errorf("expected Platform Password, got %s", response.Identities[0].ProviderDisplay)
	}

	// Verify Google identity formatting
	if response.Identities[1].ProviderDisplay != "Google" {
		t.Errorf("expected Google, got %s", response.Identities[1].ProviderDisplay)
	}
}

func TestListIdentities_Unauthenticated(t *testing.T) {
	mockRepo := &mockIdentityRepo{}
	mockAccount := &mockAccountRepo{
		err: identity.ErrUnauthenticated,
	}

	deps := DeliveryDependencies{
		Repository: mockRepo,
		Account:    mockAccount,
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/identities", nil)
	req.AddCookie(&http.Cookie{
		Name:  identity.SessionCookieName,
		Value: "invalid-session-token",
	})
	w := httptest.NewRecorder()

	deps.listIdentities(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", w.Code)
	}
}

func TestChangePassword_Success(t *testing.T) {
	mockRepo := &mockIdentityRepo{
		hasPlatformCreds: true,
	}

	mockAccount := &mockAccountRepo{
		account: identity.AccountContext{
			UserID:      "user-123",
			DisplayName: "Test User",
			Email:       "user@example.com",
		},
	}

	deps := DeliveryDependencies{
		Repository: mockRepo,
		Account:    mockAccount,
	}

	reqBody := changePasswordRequest{
		CurrentPassword: "old-password",
		NewPassword:     "new-password-12345",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/me/password", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{
		Name:  identity.SessionCookieName,
		Value: "valid-session-token",
	})
	w := httptest.NewRecorder()

	deps.changePassword(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("expected status 204, got %d: %s", w.Code, w.Body.String())
	}
}

func TestChangePassword_InvalidCurrentPassword(t *testing.T) {
	mockRepo := &mockIdentityRepo{
		hasPlatformCreds:  true,
		changePasswordErr: identity.ErrUnauthenticated,
	}

	mockAccount := &mockAccountRepo{
		account: identity.AccountContext{
			UserID:      "user-123",
			DisplayName: "Test User",
			Email:       "user@example.com",
		},
	}

	deps := DeliveryDependencies{
		Repository: mockRepo,
		Account:    mockAccount,
	}

	reqBody := changePasswordRequest{
		CurrentPassword: "wrong-password",
		NewPassword:     "new-password-12345",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/me/password", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{
		Name:  identity.SessionCookieName,
		Value: "valid-session-token",
	})
	w := httptest.NewRecorder()

	deps.changePassword(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", w.Code)
	}
}

func TestChangePassword_NoPlatformCredentials(t *testing.T) {
	mockRepo := &mockIdentityRepo{
		hasPlatformCreds: false,
	}

	mockAccount := &mockAccountRepo{
		account: identity.AccountContext{
			UserID:      "user-123",
			DisplayName: "Test User",
			Email:       "user@example.com",
		},
	}

	deps := DeliveryDependencies{
		Repository: mockRepo,
		Account:    mockAccount,
	}

	reqBody := changePasswordRequest{
		CurrentPassword: "old-password",
		NewPassword:     "new-password-12345",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/me/password", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{
		Name:  identity.SessionCookieName,
		Value: "valid-session-token",
	})
	w := httptest.NewRecorder()

	deps.changePassword(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}

	var problem problemResponse
	if err := json.NewDecoder(w.Body).Decode(&problem); err != nil {
		t.Fatalf("decode problem: %v", err)
	}

	if problem.Title != "No platform credentials" {
		t.Errorf("expected 'No platform credentials', got %s", problem.Title)
	}
}

func TestChangePassword_PasswordTooShort(t *testing.T) {
	mockRepo := &mockIdentityRepo{
		hasPlatformCreds: true,
	}

	mockAccount := &mockAccountRepo{
		account: identity.AccountContext{
			UserID:      "user-123",
			DisplayName: "Test User",
			Email:       "user@example.com",
		},
	}

	deps := DeliveryDependencies{
		Repository: mockRepo,
		Account:    mockAccount,
	}

	reqBody := changePasswordRequest{
		CurrentPassword: "old-password",
		NewPassword:     "short",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/me/password", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{
		Name:  identity.SessionCookieName,
		Value: "valid-session-token",
	})
	w := httptest.NewRecorder()

	deps.changePassword(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestDeleteIdentity_Success(t *testing.T) {
	mockRepo := &mockIdentityRepo{
		identityCount: 2, // User has 2 identities, can delete one
	}

	mockAccount := &mockAccountRepo{
		account: identity.AccountContext{
			UserID:      "user-123",
			DisplayName: "Test User",
			Email:       "user@example.com",
		},
	}

	deps := DeliveryDependencies{
		Repository: mockRepo,
		Account:    mockAccount,
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/me/identities/identity-id-456", nil)
	req.SetPathValue("identityID", "identity-id-456")
	req.AddCookie(&http.Cookie{
		Name:  identity.SessionCookieName,
		Value: "valid-session-token",
	})
	w := httptest.NewRecorder()

	deps.deleteIdentity(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("expected status 204, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteIdentity_LastIdentity(t *testing.T) {
	mockRepo := &mockIdentityRepo{
		identityCount: 1, // User has only 1 identity, cannot delete
	}

	mockAccount := &mockAccountRepo{
		account: identity.AccountContext{
			UserID:      "user-123",
			DisplayName: "Test User",
			Email:       "user@example.com",
		},
	}

	deps := DeliveryDependencies{
		Repository: mockRepo,
		Account:    mockAccount,
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/me/identities/identity-id-456", nil)
	req.SetPathValue("identityID", "identity-id-456")
	req.AddCookie(&http.Cookie{
		Name:  identity.SessionCookieName,
		Value: "valid-session-token",
	})
	w := httptest.NewRecorder()

	deps.deleteIdentity(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}

	var problem problemResponse
	if err := json.NewDecoder(w.Body).Decode(&problem); err != nil {
		t.Fatalf("decode problem: %v", err)
	}

	if problem.Title != "Cannot delete last identity" {
		t.Errorf("expected 'Cannot delete last identity', got %s", problem.Title)
	}
}

func TestDeleteIdentity_NotFound(t *testing.T) {
	mockRepo := &mockIdentityRepo{
		identityCount: 2,
		deleteErr:     identity.ErrUnauthenticated, // Identity doesn't belong to user
	}

	mockAccount := &mockAccountRepo{
		account: identity.AccountContext{
			UserID:      "user-123",
			DisplayName: "Test User",
			Email:       "user@example.com",
		},
	}

	deps := DeliveryDependencies{
		Repository: mockRepo,
		Account:    mockAccount,
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/me/identities/other-user-identity", nil)
	req.SetPathValue("identityID", "other-user-identity")
	req.AddCookie(&http.Cookie{
		Name:  identity.SessionCookieName,
		Value: "valid-session-token",
	})
	w := httptest.NewRecorder()

	deps.deleteIdentity(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestFormatProviderDisplay(t *testing.T) {
	tests := []struct {
		issuer   string
		expected string
	}{
		{"platform:internal", "Platform Password"},
		{"https://accounts.google.com", "Google"},
		{"https://github.com/login/oauth", "GitHub"},
		{"https://gitlab.com/oauth", "GitLab"},
		{"https://login.microsoftonline.com", "Microsoft"},
		{"https://some-other-provider.com", "External Provider"},
	}

	for _, tt := range tests {
		t.Run(tt.issuer, func(t *testing.T) {
			result := formatProviderDisplay(tt.issuer)
			if result != tt.expected {
				t.Errorf("formatProviderDisplay(%q) = %q, want %q", tt.issuer, result, tt.expected)
			}
		})
	}
}
