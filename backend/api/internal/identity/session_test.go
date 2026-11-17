package identity

import (
	"testing"
	"net/http"
	"time"
)

func TestGenerateCredentialsProducesIndependentOpaqueTokens(t *testing.T) {
	first, err := GenerateCredentials()
	if err != nil {
		t.Fatal(err)
	}
	second, err := GenerateCredentials()
	if err != nil {
		t.Fatal(err)
	}
	if len(first.SessionToken) < 40 || len(first.CSRFToken) < 40 {
		t.Fatal("generated credentials must contain at least 256 bits of entropy")
	}
	if first.SessionToken == first.CSRFToken || first.SessionToken == second.SessionToken ||
		first.CSRFToken == second.CSRFToken {
		t.Fatal("generated credentials must be independent")
	}
	if HashToken(first.SessionToken) == first.SessionToken {
		t.Fatal("stored token hash must not equal the raw session token")
	}
	if HashToken(first.SessionToken) != HashToken(first.SessionToken) {
		t.Fatal("token hashing must be deterministic")
	}
}

func TestSessionCookiesUseHostOnlySecureAttributes(t *testing.T) {
	credentials, err := GenerateCredentials()
	if err != nil {
		t.Fatal(err)
	}
	expiresAt := time.Now().Add(time.Hour)
	session, csrf := SessionCookies(credentials, expiresAt)
	if session.Name != SessionCookieName || !session.Secure || !session.HttpOnly || session.Path != "/" ||
		session.Domain != "" || session.SameSite != http.SameSiteLaxMode {
		t.Fatalf("unsafe session cookie attributes: %#v", session)
	}
	if csrf.Name != CSRFCookieName || !csrf.Secure || csrf.HttpOnly || csrf.Path != "/" ||
		csrf.Domain != "" || csrf.SameSite != http.SameSiteLaxMode {
		t.Fatalf("unsafe CSRF cookie attributes: %#v", csrf)
	}
	clearedSession, clearedCSRF := ClearSessionCookies()
	if clearedSession.MaxAge != -1 || clearedCSRF.MaxAge != -1 {
		t.Fatal("logout cookies must expire both credentials")
	}
}
