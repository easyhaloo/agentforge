package identity

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHashPasswordProducesValidBcryptHash(t *testing.T) {
	password := "test-password-123"
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if len(hash) < 50 {
		t.Fatal("bcrypt hash must be at least 50 characters")
	}
	if !strings.HasPrefix(hash, "$2a$") && !strings.HasPrefix(hash, "$2b$") {
		t.Fatal("hash must be valid bcrypt format")
	}
	// Verify the hash works
	if err := VerifyPassword(hash, password); err != nil {
		t.Fatalf("valid password should verify: %v", err)
	}
	// Verify wrong password fails
	if err := VerifyPassword(hash, "wrong-password"); err == nil {
		t.Fatal("wrong password should not verify")
	}
}

func TestHashPasswordProducesUniqueHashes(t *testing.T) {
	password := "same-password"
	hash1, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	hash2, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if hash1 == hash2 {
		t.Fatal("bcrypt must produce unique salted hashes")
	}
	// Both should verify the same password
	if err := VerifyPassword(hash1, password); err != nil {
		t.Fatal("first hash should verify")
	}
	if err := VerifyPassword(hash2, password); err != nil {
		t.Fatal("second hash should verify")
	}
}

func TestVerifyPasswordRejectsEmptyOrInvalidInputs(t *testing.T) {
	hash, _ := HashPassword("test")

	tests := []struct {
		name     string
		hash     string
		password string
	}{
		{"empty hash", "", "password"},
		{"empty password", hash, ""},
		{"invalid hash format", "not-a-bcrypt-hash", "password"},
		{"too short hash", "$2a$10$abc", "password"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := VerifyPassword(tt.hash, tt.password); err == nil {
				t.Fatal("should reject invalid inputs")
			}
		})
	}
}

type mockLocalAuthRepository struct {
	findUserByEmailFn     func(context.Context, string) (*LocalUser, error)
	hasActiveMembershipFn func(context.Context, string) (bool, error)
	createSessionFn       func(context.Context, string, string, string, time.Time) (string, error)
	revokeSessionFn       func(context.Context, string) error
}

func (m *mockLocalAuthRepository) FindUserByEmail(ctx context.Context, email string) (*LocalUser, error) {
	if m.findUserByEmailFn != nil {
		return m.findUserByEmailFn(ctx, email)
	}
	return nil, ErrUnauthenticated
}

func (m *mockLocalAuthRepository) HasActiveMembership(ctx context.Context, userID string) (bool, error) {
	if m.hasActiveMembershipFn != nil {
		return m.hasActiveMembershipFn(ctx, userID)
	}
	return false, nil
}

func (m *mockLocalAuthRepository) CreateSession(ctx context.Context, userID, sessionToken, csrfToken string, expiresAt time.Time) (string, error) {
	if m.createSessionFn != nil {
		return m.createSessionFn(ctx, userID, sessionToken, csrfToken, expiresAt)
	}
	return "session-id", nil
}

func (m *mockLocalAuthRepository) RevokeSession(ctx context.Context, sessionToken string) error {
	if m.revokeSessionFn != nil {
		return m.revokeSessionFn(ctx, sessionToken)
	}
	return nil
}

func (m *mockLocalAuthRepository) EmailExists(ctx context.Context, email string) (bool, error) {
	return false, nil
}

func (m *mockLocalAuthRepository) CreateLocalUser(ctx context.Context, email, passwordHash, displayName string) (string, error) {
	return "", nil
}

func TestLocalAuthenticatorLoginSuccess(t *testing.T) {
	passwordHash, _ := HashPassword("correct-password")

	repo := &mockLocalAuthRepository{
		findUserByEmailFn: func(ctx context.Context, email string) (*LocalUser, error) {
			if email == "user@example.com" {
				return &LocalUser{
					ID:           "user-123",
					Email:        "user@example.com",
					PasswordHash: passwordHash,
					DisplayName:  "Test User",
				}, nil
			}
			return nil, ErrUnauthenticated
		},
		hasActiveMembershipFn: func(ctx context.Context, userID string) (bool, error) {
			return userID == "user-123", nil
		},
		createSessionFn: func(ctx context.Context, userID, sessionToken, csrfToken string, expiresAt time.Time) (string, error) {
			if userID == "user-123" && len(sessionToken) > 0 && len(csrfToken) > 0 {
				return "session-id", nil
			}
			return "", ErrUnauthenticated
		},
	}

	config := LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  "http://localhost:5173",
	}

	authenticator, err := NewLocalAuthenticator(config, repo)
	if err != nil {
		t.Fatal(err)
	}

	reqBody := `{"email":"user@example.com","password":"correct-password"}`
	req := httptest.NewRequest(http.MethodPost, "/auth/local/login", strings.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	authenticator.Login(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	// Verify session cookie was set
	cookies := w.Result().Cookies()
	var sessionCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == SessionCookieName {
			sessionCookie = c
			break
		}
	}
	if sessionCookie == nil {
		t.Fatal("session cookie not set")
	}
	if !sessionCookie.Secure || !sessionCookie.HttpOnly {
		t.Fatal("session cookie must be secure and httponly")
	}
}

func TestLocalAuthenticatorLoginFailsWithWrongPassword(t *testing.T) {
	passwordHash, _ := HashPassword("correct-password")

	repo := &mockLocalAuthRepository{
		findUserByEmailFn: func(ctx context.Context, email string) (*LocalUser, error) {
			return &LocalUser{
				ID:           "user-123",
				Email:        "user@example.com",
				PasswordHash: passwordHash,
				DisplayName:  "Test User",
			}, nil
		},
	}

	config := LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  "http://localhost:5173",
	}

	authenticator, err := NewLocalAuthenticator(config, repo)
	if err != nil {
		t.Fatal(err)
	}

	reqBody := `{"email":"user@example.com","password":"wrong-password"}`
	req := httptest.NewRequest(http.MethodPost, "/auth/local/login", strings.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	authenticator.Login(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d", w.Code)
	}
}

func TestLocalAuthenticatorLoginFailsWithoutActiveMembership(t *testing.T) {
	passwordHash, _ := HashPassword("correct-password")

	repo := &mockLocalAuthRepository{
		findUserByEmailFn: func(ctx context.Context, email string) (*LocalUser, error) {
			return &LocalUser{
				ID:           "user-123",
				Email:        "user@example.com",
				PasswordHash: passwordHash,
				DisplayName:  "Test User",
			}, nil
		},
		hasActiveMembershipFn: func(ctx context.Context, userID string) (bool, error) {
			return false, nil // No active membership
		},
	}

	config := LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  "http://localhost:5173",
	}

	authenticator, err := NewLocalAuthenticator(config, repo)
	if err != nil {
		t.Fatal(err)
	}

	reqBody := `{"email":"user@example.com","password":"correct-password"}`
	req := httptest.NewRequest(http.MethodPost, "/auth/local/login", strings.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	authenticator.Login(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d", w.Code)
	}
}

func TestLocalAuthenticatorLoginRejectsMalformedRequests(t *testing.T) {
	repo := &mockLocalAuthRepository{}
	config := LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  "http://localhost:5173",
	}

	authenticator, err := NewLocalAuthenticator(config, repo)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name        string
		body        string
		contentType string
		wantStatus  int
	}{
		{"invalid json", `{invalid}`, "application/json", http.StatusBadRequest},
		{"missing email", `{"password":"test"}`, "application/json", http.StatusBadRequest},
		{"missing password", `{"email":"test@example.com"}`, "application/json", http.StatusBadRequest},
		{"empty email", `{"email":"","password":"test"}`, "application/json", http.StatusBadRequest},
		{"empty password", `{"email":"test@example.com","password":""}`, "application/json", http.StatusBadRequest},
		{"wrong content type", `{"email":"test@example.com","password":"test"}`, "text/plain", http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/auth/local/login", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", tt.contentType)
			w := httptest.NewRecorder()

			authenticator.Login(w, req)

			if w.Code != tt.wantStatus {
				t.Fatalf("expected status %d, got %d", tt.wantStatus, w.Code)
			}
		})
	}
}
