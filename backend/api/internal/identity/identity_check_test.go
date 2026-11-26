package identity

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The identity readiness probe (shared with /readyz) against a mock issuer
// (SPEC section 5): discovery timeout, JWKS failure, and the guarantee that
// no secret value ever appears in the payload.

func identityTestIssuer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return server
}

func TestHTTPIdentityProbeDiscoveryTimeout(t *testing.T) {
	server := identityTestIssuer(t, func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(50 * time.Millisecond) // longer than the probe timeout below
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"issuer":"x","jwks_uri":"/jwks"}`))
	})
	// The probe uses the fixed providerProbeTimeout; simulate the timeout by
	// a server that never answers and a context that expires first.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
	defer cancel()
	if _, err := HTTPIdentityProbe(ctx, server.URL); err == nil {
		t.Fatal("probe against a hanging issuer should fail")
	}
}

func TestHTTPIdentityProbeJWKSFailure(t *testing.T) {
	var serverURL string
	server := identityTestIssuer(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/jwks") {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		_, _ = w.Write([]byte(`{"issuer":"` + serverURL + `","jwks_uri":"` + serverURL + `/jwks"}`))
	})
	serverURL = server.URL
	if _, err := HTTPIdentityProbe(context.Background(), server.URL); err == nil {
		t.Fatal("probe with a failing JWKS endpoint should fail")
	} else if !strings.Contains(err.Error(), "status 500") {
		t.Fatalf("JWKS failure should surface the status, got: %v", err)
	}
}

func TestHTTPIdentityProbeSuccess(t *testing.T) {
	var serverURL string
	server := identityTestIssuer(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/jwks") {
			_, _ = w.Write([]byte(`{"keys":[{"kty":"RSA","alg":"RS256","n":"abc","e":"AQAB"}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"issuer":"` + serverURL + `","jwks_uri":"` + serverURL + `/jwks"}`))
	})
	serverURL = server.URL
	if _, err := HTTPIdentityProbe(context.Background(), server.URL); err != nil {
		t.Fatalf("probe against a healthy issuer: %v", err)
	}
}

func TestCheckCallbackURL(t *testing.T) {
	if err := CheckCallbackURL("https://app.example.test/auth/oidc/callback", "https://app.example.test"); err != nil {
		t.Fatalf("same-origin HTTPS callback: %v", err)
	}
	if err := CheckCallbackURL("http://app.example.test/auth/oidc/callback", "https://app.example.test"); err == nil {
		t.Fatal("plain-HTTP callback outside loopback must fail")
	}
	if err := CheckCallbackURL("https://evil.example.test/callback", "https://app.example.test"); err == nil {
		t.Fatal("cross-origin callback must fail")
	}
}

// The admin status payload must never carry a secret field name or value
// (SPEC section 2/5). This check runs against the shape contract, not a live
// server, so it works without a database.
func TestIdentityStatusPayloadCarriesNoSecret(t *testing.T) {
	status := IdentityStatus{
		Ready: false,
		Providers: []IdentityProviderStatus{
			{ID: "oidc", IssuerURL: "https://login.example.test", ClientID: "client-public", SecretConfigured: true, Active: false},
		},
		Checks: []IdentityCheck{
			{Name: "Client secret (oidc)", Status: CheckPassed, Detail: "configured via environment (value not shown)"},
			{Name: "OIDC discovery (oidc)", Status: CheckFailed, Error: "GET https://login.example.test/.well-known/openid-configuration: context deadline exceeded"},
		},
	}
	payload, err := json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	text := string(payload)
	for _, forbidden := range []string{"client_secret", "clientSecret\", \"", "secret_value", "\"secret\":\""} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("payload leaks secret-related field %q: %s", forbidden, text)
		}
	}
	if !strings.Contains(text, "secret_configured") {
		t.Fatalf("payload should carry the configured boolean: %s", text)
	}
	if !strings.Contains(text, "https://login.example.test") {
		t.Fatalf("payload should keep the issuer URL: %s", text)
	}
}
