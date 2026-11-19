package identity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12

type LocalAuthConfig struct {
	SessionTTL time.Duration
	AppOrigin  string
}

type LocalUser struct {
	ID           string
	Email        string
	PasswordHash string
	DisplayName  string
}

type LocalAuthRepository interface {
	FindUserByEmail(context.Context, string) (*LocalUser, error)
	HasActiveMembership(context.Context, string) (bool, error)
	CreateSession(context.Context, string, string, string, time.Time) (string, error)
	RevokeSession(context.Context, string) error
	EmailExists(context.Context, string) (bool, error)
	CreateLocalUser(context.Context, string, string, string) (string, error)
}

type LocalAuthenticator struct {
	repository LocalAuthRepository
	appOrigin  string
	sessionTTL time.Duration
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginResponse struct {
	UserID      string `json:"user_id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
}

type registerRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
}

type registerResponse struct {
	UserID      string `json:"user_id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
}

// HashPassword hashes a plaintext password using bcrypt with a secure cost factor.
func HashPassword(password string) (string, error) {
	if strings.TrimSpace(password) == "" {
		return "", errors.New("password cannot be empty")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(hash), nil
}

// VerifyPassword compares a bcrypt hash with a plaintext password.
func VerifyPassword(hash, password string) error {
	if strings.TrimSpace(hash) == "" || strings.TrimSpace(password) == "" {
		return errors.New("hash and password are required")
	}
	if len(hash) < 50 {
		return errors.New("invalid hash format")
	}
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	if err != nil {
		if errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
			return ErrUnauthenticated
		}
		return fmt.Errorf("verify password: %w", err)
	}
	return nil
}

func NewLocalAuthenticator(configuration LocalAuthConfig, repository LocalAuthRepository) (*LocalAuthenticator, error) {
	if repository == nil || configuration.AppOrigin == "" ||
		configuration.SessionTTL < 5*time.Minute || configuration.SessionTTL > 7*24*time.Hour {
		return nil, errors.New("incomplete local authenticator configuration")
	}
	return &LocalAuthenticator{
		repository: repository,
		appOrigin:  configuration.AppOrigin,
		sessionTTL: configuration.SessionTTL,
	}, nil
}

func (a *LocalAuthenticator) Login(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Content-Type") != "application/json" {
		writeAuthProblem(w, http.StatusBadRequest, "Invalid content type", "Request must be application/json")
		return
	}

	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAuthProblem(w, http.StatusBadRequest, "Invalid request", "Request body must be valid JSON")
		return
	}

	req.Email = strings.TrimSpace(req.Email)
	req.Password = strings.TrimSpace(req.Password)

	if req.Email == "" || req.Password == "" {
		writeAuthProblem(w, http.StatusBadRequest, "Missing credentials", "Email and password are required")
		return
	}

	// Look up user by email
	user, err := a.repository.FindUserByEmail(r.Context(), req.Email)
	if err != nil {
		writeAuthProblem(w, http.StatusUnauthorized, "Invalid credentials", "Email or password is incorrect")
		return
	}

	// Verify password
	if err := VerifyPassword(user.PasswordHash, req.Password); err != nil {
		writeAuthProblem(w, http.StatusUnauthorized, "Invalid credentials", "Email or password is incorrect")
		return
	}

	// Check active membership
	activeMembership, err := a.repository.HasActiveMembership(r.Context(), user.ID)
	if err != nil {
		writeAuthProblem(w, http.StatusServiceUnavailable, "Membership lookup unavailable", "Organization access could not be verified")
		return
	}
	if !activeMembership {
		writeAuthProblem(w, http.StatusForbidden, "Organization access required", "This account is not an active member of an AgentForge organization")
		return
	}

	// Generate session credentials
	credentials, err := GenerateCredentials()
	if err != nil {
		writeAuthProblem(w, http.StatusInternalServerError, "Session creation failed", "Secure session credentials could not be generated")
		return
	}

	expiresAt := time.Now().UTC().Add(a.sessionTTL)
	if _, err := a.repository.CreateSession(r.Context(), user.ID, credentials.SessionToken, credentials.CSRFToken, expiresAt); err != nil {
		writeAuthProblem(w, http.StatusServiceUnavailable, "Session creation failed", "The authenticated session could not be persisted")
		return
	}

	// Revoke old session if exists
	if oldSession, cookieErr := r.Cookie(SessionCookieName); cookieErr == nil && oldSession.Value != "" {
		if revokeErr := a.repository.RevokeSession(r.Context(), oldSession.Value); revokeErr != nil && !errors.Is(revokeErr, ErrUnauthenticated) {
			_ = a.repository.RevokeSession(r.Context(), credentials.SessionToken)
			writeAuthProblem(w, http.StatusServiceUnavailable, "Session rotation failed", "The previous session could not be safely revoked")
			return
		}
	}

	// Set session cookies
	sessionCookie, csrfCookie := SessionCookies(credentials, expiresAt)
	http.SetCookie(w, sessionCookie)
	http.SetCookie(w, csrfCookie)

	// Return user info
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(loginResponse{
		UserID:      user.ID,
		Email:       user.Email,
		DisplayName: user.DisplayName,
	})
}

// isValidEmail performs basic email validation.
func isValidEmail(email string) bool {
	email = strings.TrimSpace(email)
	if email == "" {
		return false
	}
	// Basic validation: must contain @ with non-empty local and domain parts
	parts := strings.Split(email, "@")
	if len(parts) != 2 {
		return false
	}
	local, domain := parts[0], parts[1]
	return strings.TrimSpace(local) != "" && strings.TrimSpace(domain) != ""
}

func (a *LocalAuthenticator) Register(w http.ResponseWriter, r *http.Request) {
	// Validate Content-Type
	if r.Header.Get("Content-Type") != "application/json" {
		writeAuthProblem(w, http.StatusBadRequest, "Invalid content type", "Request must be application/json")
		return
	}

	// Parse request body
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAuthProblem(w, http.StatusBadRequest, "Invalid request", "Request body must be valid JSON")
		return
	}

	// Trim and validate inputs
	req.Email = strings.TrimSpace(req.Email)
	req.Password = strings.TrimSpace(req.Password)
	req.DisplayName = strings.TrimSpace(req.DisplayName)

	// Validate email format
	if !isValidEmail(req.Email) {
		writeAuthProblem(w, http.StatusBadRequest, "Invalid email", "Email must be a valid email address")
		return
	}

	// Validate password length
	if req.Password == "" {
		writeAuthProblem(w, http.StatusBadRequest, "Missing password", "Password is required")
		return
	}
	if len(req.Password) < 8 {
		writeAuthProblem(w, http.StatusBadRequest, "Password too short", "Password must be at least 8 characters")
		return
	}

	// Validate display name
	if req.DisplayName == "" {
		writeAuthProblem(w, http.StatusBadRequest, "Missing display name", "Display name is required")
		return
	}

	// Check if email already exists
	exists, err := a.repository.EmailExists(r.Context(), req.Email)
	if err != nil {
		writeAuthProblem(w, http.StatusInternalServerError, "Registration failed", "Could not verify email availability")
		return
	}
	if exists {
		writeAuthProblem(w, http.StatusConflict, "Email already registered", "This email is already registered")
		return
	}

	// Hash password
	passwordHash, err := HashPassword(req.Password)
	if err != nil {
		writeAuthProblem(w, http.StatusInternalServerError, "Registration failed", "Could not process password")
		return
	}

	// Create user
	userID, err := a.repository.CreateLocalUser(r.Context(), req.Email, passwordHash, req.DisplayName)
	if err != nil {
		writeAuthProblem(w, http.StatusInternalServerError, "Registration failed", "Could not create user account")
		return
	}

	// Generate session credentials for auto-login
	credentials, err := GenerateCredentials()
	if err != nil {
		writeAuthProblem(w, http.StatusInternalServerError, "Session creation failed", "Secure session credentials could not be generated")
		return
	}

	// Create session
	expiresAt := time.Now().UTC().Add(a.sessionTTL)
	if _, err := a.repository.CreateSession(r.Context(), userID, credentials.SessionToken, credentials.CSRFToken, expiresAt); err != nil {
		writeAuthProblem(w, http.StatusServiceUnavailable, "Session creation failed", "The authenticated session could not be persisted")
		return
	}

	// Set session cookies
	sessionCookie, csrfCookie := SessionCookies(credentials, expiresAt)
	http.SetCookie(w, sessionCookie)
	http.SetCookie(w, csrfCookie)

	// Return user info with 201 Created
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(registerResponse{
		UserID:      userID,
		Email:       req.Email,
		DisplayName: req.DisplayName,
	})
}
