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
