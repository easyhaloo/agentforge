package identity

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

const ssoOrigin = "https://forge.example.test"

func TestGitHubAuthorization(t *testing.T) {
	for _, tc := range []struct {
		name, emails, failure string
		invite, inactive      bool
		inviteError           error
	}{
		{name: "active member", emails: `[{"email":"gh@example.test","primary":true,"verified":true}]`},
		{name: "no membership", emails: `[]`, inactive: true, failure: "access_required"},
		{name: "verified invitation", emails: `[{"email":"gh@example.test","primary":true,"verified":true}]`, invite: true, inactive: true},
		{name: "wrong invitation", emails: `[{"email":"gh@example.test","primary":true,"verified":true}]`, invite: true, inviteError: ErrInvitationNotFound, failure: "invitation_invalid"},
		{name: "unverified primary", emails: `[{"email":"gh@example.test","primary":true,"verified":false},{"email":"secondary@example.test","primary":false,"verified":true}]`, invite: true, failure: "invitation_invalid"},
		{name: "missing primary", emails: `[{"email":"secondary@example.test","verified":true}]`, invite: true, failure: "invitation_invalid"},
		{name: "provider failure", emails: `failure`, invite: true, failure: "failed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &oidcTestRepository{inactive: tc.inactive, inviteError: tc.inviteError}
			a, err := NewGitHubAuthenticator(ssoConfig("github"), repo)
			if err != nil {
				t.Fatal(err)
			}
			start, query := startSSO(t, a, "/projects?tab=active")
			if start.Header().Get("Cache-Control") != "no-store" || start.Header().Get("Referrer-Policy") != "no-referrer" {
				t.Fatal("missing auth response headers")
			}
			if query.Get("scope") != "user:email" || query.Get("nonce") != "" || query.Get("code_challenge_method") != "S256" {
				t.Fatalf("GitHub authorize query = %v", query)
			}
			if repo.stateHash == HashToken(query.Get("state")) || repo.stateHash == "" || time.Until(repo.expiresAt) > oidcTransactionTTL || time.Until(repo.expiresAt) < 9*time.Minute {
				t.Fatal("invalid provider state digest or expiry")
			}
			for _, cookie := range start.Result().Cookies() {
				if !strings.HasPrefix(cookie.Name, "__Host-agentforge_github_") || !cookie.Secure || !cookie.HttpOnly || cookie.Path != "/" || cookie.Domain != "" || cookie.SameSite != http.SameSiteLaxMode {
					t.Fatalf("unsafe GitHub cookie %+v", cookie)
				}
			}
			ctx := mockProvider(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/login/oauth/access_token":
					if r.Method != http.MethodPost || r.FormValue("code") != "accepted" || oidcChallenge(r.FormValue("code_verifier")) != query.Get("code_challenge") {
						t.Error("incorrect GitHub token exchange")
					}
					fmt.Fprint(w, `{"access_token":"provider-secret","token_type":"bearer"}`)
				case "/user", "/user/emails":
					if r.Header.Get("Authorization") != "Bearer provider-secret" || r.Method != http.MethodGet {
						t.Error("missing GitHub user authorization")
					}
					if r.URL.Path == "/user" {
						fmt.Fprint(w, `{"id":9007199254740993,"login":"octocat","email":"public@example.test"}`)
					} else if tc.emails == "failure" {
						http.Error(w, "provider-secret", http.StatusBadGateway)
					} else {
						fmt.Fprint(w, tc.emails)
					}
				default:
					t.Errorf("unexpected GitHub endpoint %s", r.URL.Path)
					http.NotFound(w, r)
				}
			}), "github.com", "api.github.com")

			r := ssoCallback(ctx, "github", start, url.Values{"code": {"accepted"}, "state": {query.Get("state")}})
			r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "old-session"})
			if tc.invite {
				r.AddCookie(&http.Cookie{Name: invitationCookieName, Value: strings.Repeat("A", 43)})
			}
			w := httptest.NewRecorder()
			a.Callback(w, r)
			if tc.emails != "failure" {
				want := externalProfile{issuer: githubIssuer, subject: "9007199254740993", name: "octocat"}
				if strings.Contains(tc.emails, `"primary":true,"verified":true`) {
					want.email = "gh@example.test"
				}
				if repo.profile != want {
					t.Fatalf("external profile = %+v, want %+v", repo.profile, want)
				}
				if (repo.invitations == 1) != (tc.invite && want.email != "") {
					t.Fatalf("invitation attempts = %d", repo.invitations)
				}
			}
			if tc.failure != "" {
				assertSSOFailure(t, w, tc.failure, "/projects?tab=active", tc.emails == "failure")
				if repo.sessions != 0 || len(repo.revoked) != 0 || responseCookie(w, SessionCookieName) != nil {
					t.Fatal("rejected login issued or revoked a session")
				}
			} else {
				if w.Code != http.StatusSeeOther || w.Header().Get("Location") != ssoOrigin+"/projects?tab=active" || repo.sessions != 1 || len(repo.revoked) != 1 || repo.revoked[0] != "old-session" || responseCookie(w, SessionCookieName) == nil || responseCookie(w, CSRFCookieName) == nil {
					t.Fatalf("incorrect session rotation or redirect: status=%d location=%q", w.Code, w.Header().Get("Location"))
				}
				replay := httptest.NewRecorder()
				a.Callback(replay, r)
				assertSSOFailure(t, replay, "failed", "/projects?tab=active", tc.invite)
				if repo.sessions != 1 || len(replay.Result().Cookies()) != 0 {
					t.Fatal("replay changed session or login cookies")
				}
			}
			if tc.invite {
				cookie := responseCookie(w, invitationCookieName)
				if tc.emails == "failure" && cookie != nil || tc.emails != "failure" && (cookie == nil || cookie.MaxAge >= 0) {
					t.Fatalf("unexpected invitation cookie %+v", cookie)
				}
			}
		})
	}
}

func TestSSOCallbackCorrelatesBeforeHandlingDenial(t *testing.T) {
	repo := &oidcTestRepository{}
	githubAuth, err := NewGitHubAuthenticator(ssoConfig("github"), repo)
	if err != nil {
		t.Fatal(err)
	}
	start, query := startSSO(t, githubAuth, "/projects")
	for _, tc := range []struct {
		name, provider, state, failure string
		clonedCookies                  bool
	}{
		{"forged denial", "github", "wrong-state", "failed", false},
		{"cross-provider", "google", query.Get("state"), "failed", true},
		{"actual denial", "github", query.Get("state"), "cancelled", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := *githubAuth
			a.providerID = tc.provider
			r := ssoCallback(t.Context(), tc.provider, start, url.Values{"state": {tc.state}, "error": {"access_denied"}, "error_description": {"provider-secret"}})
			r.AddCookie(&http.Cookie{Name: invitationCookieName, Value: strings.Repeat("A", 43)})
			if tc.clonedCookies {
				for _, cookie := range start.Result().Cookies() {
					cookie.Name = strings.Replace(cookie.Name, "_github_", "_google_", 1)
					r.AddCookie(cookie)
				}
			}
			w := httptest.NewRecorder()
			a.Callback(w, r)
			assertSSOFailure(t, w, tc.failure, "/projects", true)
			if responseCookie(w, invitationCookieName) != nil || len(w.Result().Cookies()) != map[string]int{"failed": 0, "cancelled": 4}[tc.failure] || (repo.stateHash == "") != (tc.failure == "cancelled") {
				t.Fatal("incorrect callback transaction or cookie cleanup")
			}
		})
	}
}

func TestGoogleVerifiesSignedIDToken(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ name, invalid string }{
		{"valid", ""}, {"wrong issuer", "iss"}, {"wrong audience", "aud"}, {"expired", "exp"}, {"wrong nonce", "nonce"}, {"bad signature", "signature"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			idToken := ""
			ctx := mockProvider(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/.well-known/openid-configuration":
					_ = json.NewEncoder(w).Encode(map[string]any{"issuer": googleIssuer, "authorization_endpoint": googleIssuer + "/authorize", "token_endpoint": googleIssuer + "/token", "jwks_uri": googleIssuer + "/keys", "id_token_signing_alg_values_supported": []string{"RS256"}})
				case "/token":
					_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "provider-secret", "id_token": idToken})
				case "/keys":
					n := base64.RawURLEncoding.EncodeToString(key.N.Bytes())
					e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())
					fmt.Fprintf(w, `{"keys":[{"kid":"test","kty":"RSA","alg":"RS256","n":%q,"e":%q}]}`, n, e)
				default:
					http.NotFound(w, r)
				}
			}), "accounts.google.com")
			config := ssoConfig("google")
			config.IssuerURL = googleIssuer
			repo := &oidcTestRepository{}
			a, err := NewOIDCAuthenticator(ctx, config, repo)
			if err != nil {
				t.Fatal(err)
			}
			start, query := startSSO(t, a, "//evil.example")
			nonce := query.Get("nonce")
			if nonce == "" || repo.nonceHash != HashToken(nonce) {
				t.Fatal("missing named Google nonce binding")
			}
			claims := map[string]any{"iss": googleIssuer, "sub": "google-123", "aud": config.ClientID, "iat": time.Now().Unix(), "exp": time.Now().Add(time.Minute).Unix(), "nonce": nonce, "email_verified": true, "email": "google@example.test", "name": "Google User"}
			switch tc.invalid {
			case "exp":
				claims[tc.invalid] = time.Now().Add(-time.Minute).Unix()
			case "iss", "aud", "nonce":
				claims[tc.invalid] = "incorrect"
			}
			idToken = signedSSOIDToken(t, key, claims, tc.invalid == "signature")
			w := httptest.NewRecorder()
			a.Callback(w, ssoCallback(ctx, "google", start, url.Values{"code": {"accepted"}, "state": {query.Get("state")}}))
			if tc.invalid != "" {
				assertSSOFailure(t, w, "failed", "", false)
				if repo.sessions != 0 || repo.profile != (externalProfile{}) {
					t.Fatal("invalid Google token affected identity or session")
				}
				return
			}
			want := externalProfile{issuer: googleIssuer, subject: "google-123", email: "google@example.test", name: "Google User"}
			if w.Code != http.StatusSeeOther || w.Header().Get("Location") != ssoOrigin || repo.profile != want || repo.sessions != 1 {
				t.Fatalf("Google callback status=%d location=%q profile=%+v sessions=%d", w.Code, w.Header().Get("Location"), repo.profile, repo.sessions)
			}
		})
	}
}

func TestSSOSafeReturnAndInvitationHandoff(t *testing.T) {
	for _, invalid := range []string{"https://evil.test", "//evil.test", `\evil.test`, `/\evil.test`, "/%2Fevil.test", "/%5Cevil.test", "/%0Aevil.test", "/foo?q=%0D", "/auth/oidc/callback", "/one/%2e%2e/log%69n", "/register?next=/", "/with#%0A"} {
		if got := safeReturnPath(invalid); got != "" {
			t.Errorf("return path %q was accepted as %q", invalid, got)
		}
	}
	const destination = "/projects?filter=my+repos&next=%2Fissues#results"
	if got := safeReturnPath(destination); got != destination {
		t.Fatalf("return path = %q", got)
	}
	w := httptest.NewRecorder()
	AcceptInvitationAt(w, httptest.NewRequest(http.MethodGet, "/auth/invitations/accept?token="+strings.Repeat("A", 43), nil), "/login?invitation=1")
	cookie := responseCookie(w, invitationCookieName)
	if w.Code != http.StatusSeeOther || w.Header().Get("Location") != "/login?invitation=1" || cookie == nil || !cookie.Secure || !cookie.HttpOnly || cookie.MaxAge != 1800 || w.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatal("invalid invitation handoff")
	}
	a, err := NewGitHubAuthenticator(ssoConfig("github"), &oidcTestRepository{createError: errors.New("storage unavailable")})
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodGet, "/auth/github/login?return="+url.QueryEscape(destination), nil)
	r.AddCookie(cookie)
	w = httptest.NewRecorder()
	a.Login(w, r)
	assertSSOFailure(t, w, "unavailable", destination, true)

	r = httptest.NewRequest(http.MethodGet, "/auth/github/callback?state=forged", nil)
	r.AddCookie(&http.Cookie{Name: a.cookieName("return"), Value: base64.RawURLEncoding.EncodeToString([]byte("//evil.test"))})
	w = httptest.NewRecorder()
	a.Callback(w, r)
	assertSSOFailure(t, w, "failed", "", false)
}

func ssoConfig(provider string) OIDCConfig {
	return OIDCConfig{ProviderID: provider, ClientID: "test-client", ClientSecret: "test-secret", RedirectURL: ssoOrigin + "/auth/" + provider + "/callback", SessionTTL: time.Hour, AppOrigin: ssoOrigin}
}

func startSSO(t *testing.T, a *OIDCAuthenticator, returnPath string) (*httptest.ResponseRecorder, url.Values) {
	t.Helper()
	provider := a.providerID
	if provider == "" {
		provider = "oidc"
	}
	w := httptest.NewRecorder()
	a.Login(w, httptest.NewRequest(http.MethodGet, "/auth/"+provider+"/login?return="+url.QueryEscape(returnPath), nil))
	target, err := url.Parse(w.Header().Get("Location"))
	if w.Code != http.StatusFound || err != nil || target.Query().Get("state") == "" {
		t.Fatalf("invalid login response: status=%d location=%q", w.Code, w.Header().Get("Location"))
	}
	return w, target.Query()
}

func ssoCallback(ctx context.Context, provider string, start *httptest.ResponseRecorder, query url.Values) *http.Request {
	r := httptest.NewRequestWithContext(ctx, http.MethodGet, "/auth/"+provider+"/callback?"+query.Encode(), nil)
	for _, cookie := range start.Result().Cookies() {
		r.AddCookie(cookie)
	}
	return r
}

func responseCookie(w *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == name {
			return cookie
		}
	}
	return nil
}

func assertSSOFailure(t *testing.T, w *httptest.ResponseRecorder, reason, returnPath string, invitation bool) {
	t.Helper()
	location := w.Header().Get("Location")
	redirect, err := url.Parse(location)
	if err != nil || !strings.HasPrefix(location, ssoOrigin+"/login?") || w.Code != http.StatusSeeOther || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("invalid failure response: status=%d location=%q", w.Code, location)
	}
	want := url.Values{"sso_error": {reason}}
	if returnPath != "" {
		want.Set("return", returnPath)
	}
	if invitation {
		want.Set("invitation", "1")
	}
	if redirect.Query().Encode() != want.Encode() || strings.Contains(w.Body.String(), "provider-secret") {
		t.Fatalf("unexpected login failure redirect %q", location)
	}
}

type ssoTestTransport func(*http.Request) (*http.Response, error)

func (f ssoTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func mockProvider(t *testing.T, handler http.Handler, hosts ...string) context.Context {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	local, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	return context.WithValue(t.Context(), oauth2.HTTPClient, &http.Client{Transport: ssoTestTransport(func(r *http.Request) (*http.Response, error) {
		for _, host := range hosts {
			if r.URL.Scheme == "https" && r.URL.Host == host {
				request := r.Clone(r.Context())
				request.URL.Scheme, request.URL.Host = local.Scheme, local.Host
				return http.DefaultTransport.RoundTrip(request)
			}
		}
		return nil, fmt.Errorf("unexpected upstream host %s", r.URL.Host)
	})})
}

func signedSSOIDToken(t *testing.T, key *rsa.PrivateKey, claims map[string]any, invalidSignature bool) string {
	t.Helper()
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	encode := base64.RawURLEncoding.EncodeToString
	token := encode([]byte(`{"alg":"RS256","kid":"test"}`)) + "." + encode(payload)
	digest := sha256.Sum256([]byte(token))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	if invalidSignature {
		signature[0] ^= 1
	}
	return token + "." + encode(signature)
}

func TestLegacyOIDCDenialKeepsProblemResponse(t *testing.T) {
	repo := &oidcTestRepository{}
	config := ssoConfig("oidc")
	config.ProviderID = ""
	a, err := newAuthenticator(config, repo)
	if err != nil {
		t.Fatal(err)
	}
	a.oauth.Endpoint.AuthURL = "https://oidc.example.test/authorize"
	start, query := startSSO(t, a, "/ignored")
	w := httptest.NewRecorder()
	a.Callback(w, ssoCallback(t.Context(), "oidc", start, url.Values{"state": {query.Get("state")}, "error": {"access_denied"}}))
	if w.Code != http.StatusUnauthorized || w.Header().Get("Content-Type") != "application/problem+json" || w.Header().Get("Location") != "" || !strings.Contains(w.Body.String(), "OIDC login rejected") || len(w.Result().Cookies()) != 4 {
		t.Fatalf("legacy OIDC denial returned status=%d location=%q and body %s", w.Code, w.Header().Get("Location"), w.Body.String())
	}
}
