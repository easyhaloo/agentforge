package identity

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

type oidcTestRepository struct {
	stateHash   string
	nonceHash   string
	expiresAt   time.Time
	profile     externalProfile
	inactive    bool
	sessions    int
	revoked     []string
	invitations int
	inviteError error
	createError error
}

func (r *oidcTestRepository) CreateOIDCAuthTransaction(_ context.Context, stateHash, nonceHash string, expiresAt time.Time) error {
	r.stateHash, r.nonceHash, r.expiresAt = stateHash, nonceHash, expiresAt
	return r.createError
}
func (r *oidcTestRepository) ConsumeOIDCAuthTransaction(_ context.Context, stateHash string) (string, error) {
	if stateHash != r.stateHash || !r.expiresAt.After(time.Now()) {
		return "", ErrUnauthenticated
	}
	r.stateHash = ""
	return r.nonceHash, nil
}
func (r *oidcTestRepository) UpsertExternalIdentity(_ context.Context, issuer, subject, email, name string) (string, error) {
	r.profile = externalProfile{issuer: issuer, subject: subject, email: email, name: name}
	return "user-1", nil
}
func (r *oidcTestRepository) HasActiveMembership(context.Context, string) (bool, error) {
	return !r.inactive, nil
}
func (r *oidcTestRepository) CreateSession(context.Context, string, string, string, time.Time) (string, error) {
	r.sessions++
	return "session-1", nil
}
func (r *oidcTestRepository) RevokeSession(_ context.Context, token string) error {
	r.revoked = append(r.revoked, token)
	return nil
}
func (r *oidcTestRepository) AcceptInvitation(context.Context, string, string, string) (string, error) {
	r.invitations++
	return "org-1", r.inviteError
}

func TestOIDCLoginStartsPKCEFlowAndPersistsHashedState(t *testing.T) {
	var issuer string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/.well-known/openid-configuration" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer":                                issuer,
			"authorization_endpoint":                issuer + "/authorize",
			"token_endpoint":                        issuer + "/token",
			"jwks_uri":                              issuer + "/keys",
			"response_types_supported":              []string{"code"},
			"subject_types_supported":               []string{"public"},
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	}))
	defer server.Close()
	issuer = server.URL

	repository := &oidcTestRepository{}
	authenticator, err := NewOIDCAuthenticator(context.Background(), OIDCConfig{
		IssuerURL: issuer, ClientID: "agentforge-test", ClientSecret: "test-secret",
		RedirectURL: "http://localhost:8080/auth/oidc/callback",
		SessionTTL:  time.Hour, AppOrigin: "http://localhost:5173",
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
	pkceCookie := values["__Host-agentforge_oidc_pkce"]
	if pkceCookie == nil {
		t.Fatal("PKCE verifier cookie missing")
	}
	if got := oidcChallenge(pkceCookie.Value); got != challenge {
		t.Fatalf("PKCE challenge=%q, want %q", challenge, got)
	}
	if values["__Host-agentforge_oidc_state"].Value != state || values["__Host-agentforge_oidc_nonce"].Value != nonce {
		t.Fatal("state and nonce cookies must match authorization request")
	}
}

func oidcChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
