package identity

import (
	"context"
	"encoding/json"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	
)

type oidcTestRepository struct {
	stateHash string
	nonceHash string
}

func (r *oidcTestRepository) CreateOIDCAuthTransaction(_ context.Context, stateHash, nonceHash string, _ time.Time) error {
	r.stateHash, r.nonceHash = stateHash, nonceHash
	return nil
}
func (r *oidcTestRepository) ConsumeOIDCAuthTransaction(context.Context, string) (string, error) {
	return r.nonceHash, nil
}
func (r *oidcTestRepository) UpsertExternalIdentity(context.Context, string, string, string, string) (string, error) {
	return "user-1", nil
}
func (r *oidcTestRepository) CreateSession(context.Context, string, string, string, time.Time) (string, error) {
	return "session-1", nil
}
func (r *oidcTestRepository) RevokeSession(context.Context, string) error { return nil }

func TestOIDCLoginStartsPKCEFlowAndPersistsHashedState(t *testing.T) {
	var issuer string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/.well-known/openid-configuration" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer": issuer,
			"authorization_endpoint": issuer + "/authorize",
			"token_endpoint": issuer + "/token",
			"jwks_uri": issuer + "/keys",
			"response_types_supported": []string{"code"},
			"subject_types_supported": []string{"public"},
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	}))
	defer server.Close()
	issuer = server.URL

	repository := &oidcTestRepository{}
	authenticator, err := NewOIDCAuthenticator(context.Background(), OIDCConfig{
		IssuerURL: issuer, ClientID: "agentforge-test", ClientSecret: "test-secret",
		RedirectURL: "http://localhost:8080/auth/oidc/callback",
		SessionTTL: time.Hour, AppOrigin: "http://localhost:5173",
	}, repository)
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodGet, "/auth/oidc/login", nil)
	response := httptest.NewRecorder()
	authenticator.Login(response, request)
	if response.Code != http.StatusFound {
		t.Fatalf("login status=%d body=%s", response.Code, response.Body.String())
	}
	location, err := url.Parse(response.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	query := location.Query()
	state := query.Get("state")
	nonce := query.Get("nonce")
	challenge := query.Get("code_challenge")
	if state == "" || nonce == "" || challenge == "" || query.Get("code_challenge_method") != "S256" {
		t.Fatalf("missing OIDC security parameters: %v", query)
	}
	if repository.stateHash != HashToken(state) || repository.nonceHash != HashToken(nonce) {
		t.Fatal("only state and nonce hashes should be persisted")
	}

	cookies := response.Result().Cookies()
	if len(cookies) != 3 {
		t.Fatalf("OIDC flow cookies=%d, want 3", len(cookies))
	}
	values := make(map[string]*http.Cookie)
	for _, cookie := range cookies {
		values[cookie.Name] = cookie
		if !cookie.Secure || !cookie.HttpOnly || cookie.Path != "/" || cookie.Domain != "" ||
			cookie.SameSite != http.SameSiteLaxMode {
			t.Fatalf("unsafe OIDC flow cookie: %#v", cookie)
		}
	}
	pkceCookie := values[oidcPKCECookieName]
	if pkceCookie == nil {
		t.Fatal("PKCE verifier cookie missing")
	}
	if got := oidcChallenge(pkceCookie.Value); got != challenge {
		t.Fatalf("PKCE challenge=%q, want %q", challenge, got)
	}
	if values[oidcStateCookieName].Value != state || values[oidcNonceCookieName].Value != nonce {
		t.Fatal("state and nonce cookies must match authorization request")
	}
}

func oidcChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
