package identity

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type mockRegisterRepository struct {
	emailExistsFn       func(context.Context, string) (bool, error)
	createLocalUserFn   func(context.Context, string, string, string) (string, error)
	createSessionFn     func(context.Context, string, string, string, time.Time) (string, error)
	hasActiveMembershipFn func(context.Context, string) (bool, error)
}

func (m *mockRegisterRepository) EmailExists(ctx context.Context, email string) (bool, error) {
	if m.emailExistsFn != nil {
		return m.emailExistsFn(ctx, email)
	}
	return false, nil
}

func (m *mockRegisterRepository) CreateLocalUser(ctx context.Context, email, passwordHash, displayName string) (string, error) {
	if m.createLocalUserFn != nil {
		return m.createLocalUserFn(ctx, email, passwordHash, displayName)
	}
	return "user-123", nil
}

func (m *mockRegisterRepository) CreateSession(ctx context.Context, userID, sessionToken, csrfToken string, expiresAt time.Time) (string, error) {
	if m.createSessionFn != nil {
		return m.createSessionFn(ctx, userID, sessionToken, csrfToken, expiresAt)
	}
	return "session-123", nil
}

func (m *mockRegisterRepository) HasActiveMembership(ctx context.Context, userID string) (bool, error) {
	if m.hasActiveMembershipFn != nil {
		return m.hasActiveMembershipFn(ctx, userID)
	}
	return true, nil
}

func (m *mockRegisterRepository) FindUserByEmail(ctx context.Context, email string) (*LocalUser, error) {
	return nil, ErrUnauthenticated
}

func (m *mockRegisterRepository) RevokeSession(ctx context.Context, sessionToken string) error {
	return nil
}

func TestRegisterSuccess(t *testing.T) {
	repo := &mockRegisterRepository{}
	auth, _ := NewLocalAuthenticator(LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  "http://localhost:3000",
	}, repo)

	reqBody := map[string]string{
		"email":        "newuser@example.com",
		"password":     "securepassword123",
		"display_name": "New User",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/auth/local/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	auth.Register(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected status 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp registerResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Email != "newuser@example.com" {
		t.Errorf("expected email %q, got %q", "newuser@example.com", resp.Email)
	}
	if resp.DisplayName != "New User" {
		t.Errorf("expected display name %q, got %q", "New User", resp.DisplayName)
	}
	if resp.UserID == "" {
		t.Error("expected non-empty user ID")
	}
}

func TestRegisterDuplicateEmail(t *testing.T) {
	repo := &mockRegisterRepository{
		emailExistsFn: func(_ context.Context, email string) (bool, error) {
			return email == "existing@example.com", nil
		},
	}
	auth, _ := NewLocalAuthenticator(LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  "http://localhost:3000",
	}, repo)

	reqBody := map[string]string{
		"email":        "existing@example.com",
		"password":     "password123",
		"display_name": "User",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/auth/local/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	auth.Register(w, req)

	if w.Code != http.StatusConflict {
		t.Errorf("expected status 409, got %d: %s", w.Code, w.Body.String())
	}

	var problem map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&problem); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if problem["status"] != float64(409) {
		t.Errorf("expected status 409 in problem details, got %v", problem["status"])
	}
}

func TestRegisterInvalidEmail(t *testing.T) {
	repo := &mockRegisterRepository{}
	auth, _ := NewLocalAuthenticator(LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  "http://localhost:3000",
	}, repo)

	testCases := []struct {
		name  string
		email string
	}{
		{"no at sign", "notanemail"},
		{"missing domain", "user@"},
		{"missing local", "@domain.com"},
		{"empty", ""},
		{"spaces only", "   "},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			reqBody := map[string]string{
				"email":        tc.email,
				"password":     "password123",
				"display_name": "User",
			}
			body, _ := json.Marshal(reqBody)

			req := httptest.NewRequest(http.MethodPost, "/auth/local/register", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			auth.Register(w, req)

			if w.Code != http.StatusBadRequest {
				t.Errorf("expected status 400, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestRegisterEmptyPassword(t *testing.T) {
	repo := &mockRegisterRepository{}
	auth, _ := NewLocalAuthenticator(LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  "http://localhost:3000",
	}, repo)

	reqBody := map[string]string{
		"email":        "user@example.com",
		"password":     "",
		"display_name": "User",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/auth/local/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	auth.Register(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRegisterShortPassword(t *testing.T) {
	repo := &mockRegisterRepository{}
	auth, _ := NewLocalAuthenticator(LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  "http://localhost:3000",
	}, repo)

	reqBody := map[string]string{
		"email":        "user@example.com",
		"password":     "short",
		"display_name": "User",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/auth/local/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	auth.Register(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRegisterEmptyDisplayName(t *testing.T) {
	repo := &mockRegisterRepository{}
	auth, _ := NewLocalAuthenticator(LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  "http://localhost:3000",
	}, repo)

	reqBody := map[string]string{
		"email":        "user@example.com",
		"password":     "password123",
		"display_name": "",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/auth/local/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	auth.Register(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRegisterInvalidContentType(t *testing.T) {
	repo := &mockRegisterRepository{}
	auth, _ := NewLocalAuthenticator(LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  "http://localhost:3000",
	}, repo)

	req := httptest.NewRequest(http.MethodPost, "/auth/local/register", bytes.NewReader([]byte("plain text")))
	req.Header.Set("Content-Type", "text/plain")
	w := httptest.NewRecorder()

	auth.Register(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRegisterMalformedJSON(t *testing.T) {
	repo := &mockRegisterRepository{}
	auth, _ := NewLocalAuthenticator(LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  "http://localhost:3000",
	}, repo)

	req := httptest.NewRequest(http.MethodPost, "/auth/local/register", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	auth.Register(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRegisterRepositoryError(t *testing.T) {
	repo := &mockRegisterRepository{
		emailExistsFn: func(_ context.Context, _ string) (bool, error) {
			return false, errors.New("database unavailable")
		},
	}
	auth, _ := NewLocalAuthenticator(LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  "http://localhost:3000",
	}, repo)

	reqBody := map[string]string{
		"email":        "user@example.com",
		"password":     "password123",
		"display_name": "User",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/auth/local/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	auth.Register(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRegisterMissingFields(t *testing.T) {
	repo := &mockRegisterRepository{}
	auth, _ := NewLocalAuthenticator(LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  "http://localhost:3000",
	}, repo)

	testCases := []struct {
		name string
		body string
	}{
		{"missing email", `{"password":"password123","display_name":"User"}`},
		{"missing password", `{"email":"user@example.com","display_name":"User"}`},
		{"missing display_name", `{"email":"user@example.com","password":"password123"}`},
		{"empty object", `{}`},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/auth/local/register", bytes.NewReader([]byte(tc.body)))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			auth.Register(w, req)

			if w.Code != http.StatusBadRequest {
				t.Errorf("expected status 400, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestRegisterPasswordIsHashed(t *testing.T) {
	var capturedPasswordHash string
	repo := &mockRegisterRepository{
		createLocalUserFn: func(_ context.Context, email, passwordHash, displayName string) (string, error) {
			capturedPasswordHash = passwordHash
			return "user-123", nil
		},
	}
	auth, _ := NewLocalAuthenticator(LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  "http://localhost:3000",
	}, repo)

	plainPassword := "MySecurePassword123!"
	reqBody := map[string]string{
		"email":        "user@example.com",
		"password":     plainPassword,
		"display_name": "User",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/auth/local/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	auth.Register(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d: %s", w.Code, w.Body.String())
	}

	// Verify password was hashed
	if capturedPasswordHash == "" {
		t.Fatal("password hash was not captured")
	}
	if capturedPasswordHash == plainPassword {
		t.Error("password should be hashed, not stored as plaintext")
	}
	if len(capturedPasswordHash) < 50 {
		t.Error("password hash should be at least 50 characters (bcrypt format)")
	}

	// Verify it's a valid bcrypt hash
	if err := VerifyPassword(capturedPasswordHash, plainPassword); err != nil {
		t.Errorf("hashed password should verify against original: %v", err)
	}
	if err := VerifyPassword(capturedPasswordHash, "WrongPassword"); err == nil {
		t.Error("wrong password should not verify")
	}
}

func TestRegisterPasswordNotInResponse(t *testing.T) {
	repo := &mockRegisterRepository{}
	auth, _ := NewLocalAuthenticator(LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  "http://localhost:3000",
	}, repo)

	reqBody := map[string]string{
		"email":        "user@example.com",
		"password":     "SecretPassword123",
		"display_name": "User",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/auth/local/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	auth.Register(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", w.Code)
	}

	// Verify response doesn't contain password
	var resp map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if _, hasPassword := resp["password"]; hasPassword {
		t.Error("response should not contain 'password' field")
	}
	if _, hasPasswordHash := resp["password_hash"]; hasPasswordHash {
		t.Error("response should not contain 'password_hash' field")
	}
}

func TestRegisterCreatesSession(t *testing.T) {
	var sessionCreated bool
	var capturedUserID, capturedSessionToken, capturedCSRFToken string
	repo := &mockRegisterRepository{
		createSessionFn: func(_ context.Context, userID, sessionToken, csrfToken string, expiresAt time.Time) (string, error) {
			sessionCreated = true
			capturedUserID = userID
			capturedSessionToken = sessionToken
			capturedCSRFToken = csrfToken
			return "session-789", nil
		},
	}
	auth, _ := NewLocalAuthenticator(LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  "http://localhost:3000",
	}, repo)

	reqBody := map[string]string{
		"email":        "user@example.com",
		"password":     "password123",
		"display_name": "User",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/auth/local/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	auth.Register(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", w.Code)
	}

	// Verify session was created
	if !sessionCreated {
		t.Fatal("CreateSession should have been called")
	}
	if capturedUserID == "" {
		t.Error("user ID should not be empty")
	}
	if len(capturedSessionToken) == 0 {
		t.Error("session token should not be empty")
	}
	if len(capturedCSRFToken) == 0 {
		t.Error("CSRF token should not be empty")
	}
	if capturedSessionToken == capturedCSRFToken {
		t.Error("session token and CSRF token should be different")
	}

	// Verify cookies are set
	cookies := w.Result().Cookies()
	var sessionCookie, csrfCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == SessionCookieName {
			sessionCookie = c
		}
		if c.Name == CSRFCookieName {
			csrfCookie = c
		}
	}

	if sessionCookie == nil {
		t.Fatal("session cookie not set")
	}
	if csrfCookie == nil {
		t.Fatal("CSRF cookie not set")
	}
	if !sessionCookie.Secure || !sessionCookie.HttpOnly {
		t.Error("session cookie must be Secure and HttpOnly")
	}
	if !csrfCookie.Secure || csrfCookie.HttpOnly {
		t.Error("CSRF cookie must be Secure but NOT HttpOnly")
	}
}

func TestRegisterUnicodeDisplayName(t *testing.T) {
	repo := &mockRegisterRepository{}
	auth, _ := NewLocalAuthenticator(LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  "http://localhost:3000",
	}, repo)

	unicodeNames := []string{
		"张三",
		"田中太郎",
		"José García",
		"Müller",
	}

	for _, name := range unicodeNames {
		t.Run(name, func(t *testing.T) {
			reqBody := map[string]string{
				"email":        "user@example.com",
				"password":     "password123",
				"display_name": name,
			}
			body, _ := json.Marshal(reqBody)

			req := httptest.NewRequest(http.MethodPost, "/auth/local/register", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			auth.Register(w, req)

			if w.Code == http.StatusCreated {
				var resp map[string]interface{}
				if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}
				if resp["display_name"] != name {
					t.Errorf("expected display_name '%s', got %v", name, resp["display_name"])
				}
			}
		})
	}
}
