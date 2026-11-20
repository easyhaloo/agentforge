package identity

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"time"
)

const (
	SessionCookieName = "__Host-agentforge_session"
	CSRFCookieName    = "__Host-agentforge_csrf"
	CSRFHeaderName    = "X-CSRF-Token"
)

var ErrUnauthenticated = errors.New("unauthenticated")

type Principal struct {
	UserID           string
	OrganizationID   string
	OrganizationSlug string
	Role             string
}

// PrincipalResolver maps a request and the organization handle from its path
// (an organization id or slug) to the caller's Principal. Principal.OrganizationID
// is always the canonical organization id.
type PrincipalResolver interface {
	ResolvePrincipal(*http.Request, string) (Principal, error)
}

type OIDCHandler interface {
	Login(http.ResponseWriter, *http.Request)
	Callback(http.ResponseWriter, *http.Request)
	AcceptInvitation(http.ResponseWriter, *http.Request)
}

type CSRFValidator interface {
	ValidateCSRF(ctx context.Context, sessionToken, csrfToken string) error
}

type Credentials struct {
	SessionToken string
	CSRFToken    string
}

// SessionCookies returns host-only Secure cookies. The session credential is
// HttpOnly; the CSRF value is intentionally readable by same-origin browser code.
func SessionCookies(credentials Credentials, expiresAt time.Time) (*http.Cookie, *http.Cookie) {
	return &http.Cookie{
			Name: SessionCookieName, Value: credentials.SessionToken, Path: "/",
			Expires: expiresAt.UTC(), Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode,
		}, &http.Cookie{
			Name: CSRFCookieName, Value: credentials.CSRFToken, Path: "/",
			Expires: expiresAt.UTC(), Secure: true, HttpOnly: false, SameSite: http.SameSiteLaxMode,
		}
}

func ClearSessionCookies() (*http.Cookie, *http.Cookie) {
	return &http.Cookie{
			Name: SessionCookieName, Value: "", Path: "/", MaxAge: -1,
			Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode,
		}, &http.Cookie{
			Name: CSRFCookieName, Value: "", Path: "/", MaxAge: -1,
			Secure: true, HttpOnly: false, SameSite: http.SameSiteLaxMode,
		}
}

func GenerateCredentials() (Credentials, error) {
	sessionToken, err := randomToken()
	if err != nil {
		return Credentials{}, fmt.Errorf("generate session token: %w", err)
	}
	csrfToken, err := randomToken()
	if err != nil {
		return Credentials{}, fmt.Errorf("generate CSRF token: %w", err)
	}
	return Credentials{SessionToken: sessionToken, CSRFToken: csrfToken}, nil
}

func GenerateToken() (string, error) { return randomToken() }

func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func randomToken() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}
