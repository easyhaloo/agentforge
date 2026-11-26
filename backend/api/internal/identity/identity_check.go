package identity

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// IdentityCheckStatus is the outcome of a single readiness check.
type IdentityCheckStatus string

const (
	CheckPassed  IdentityCheckStatus = "ok"
	CheckFailed  IdentityCheckStatus = "fail"
	CheckWarning IdentityCheckStatus = "warn"
)

// IdentityCheck is one result of the provider readiness probe. It never
// carries secret values — only presence booleans and human-readable messages.
type IdentityCheck struct {
	Name     string              `json:"name"`
	Status   IdentityCheckStatus `json:"status"`
	Detail   string              `json:"detail,omitempty"`
	Error    string              `json:"error,omitempty"`
	Duration string              `json:"duration,omitempty"`
}

// IdentityProviderStatus describes one configured SSO provider. Secrets are
// reported as a configured boolean only (SPEC section 2).
type IdentityProviderStatus struct {
	ID               string `json:"id"`
	LoginURL         string `json:"login_url,omitempty"`
	IssuerURL        string `json:"issuer_url,omitempty"`
	ClientID         string `json:"client_id,omitempty"`
	SecretConfigured bool   `json:"secret_configured"`
	RedirectURL      string `json:"redirect_url,omitempty"`
	// Active reports whether the provider was fully initialized and is offered
	// on the login page. Incomplete configurations are hidden from login.
	Active bool `json:"active"`
}

// IdentityStatus is the payload of GET /api/v1/admin/identity.
type IdentityStatus struct {
	Ready     bool                     `json:"ready"`
	Providers []IdentityProviderStatus `json:"providers"`
	Checks    []IdentityCheck          `json:"checks"`
	AppOrigin string                   `json:"app_origin,omitempty"`
}

// IdentityChecker is the shared readiness probe used by /readyz and by the
// admin identity endpoints. Implementations run discovery, JWKS, callback,
// secret-presence and email-provider checks.
type IdentityChecker interface {
	CheckIdentity(ctx context.Context) IdentityStatus
}

// HTTPIdentityProbe fetches discovery and JWKS documents with a bounded
// timeout. It is the runtime counterpart of startup discovery.
func HTTPIdentityProbe(ctx context.Context, issuerURL string) (discoveryBody []byte, err error) {
	start := time.Now()
	_ = start
	probe := &http.Client{Timeout: providerProbeTimeout}
	discoveryURL := strings.TrimSuffix(issuerURL, "/") + "/.well-known/openid-configuration"
	response, err := probe.Get(discoveryURL)
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", discoveryURL, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: status %d", discoveryURL, response.StatusCode)
	}
	var document struct {
		Issuer                  string   `json:"issuer"`
		JWKSURI                 string   `json:"jwks_uri"`
		IDTokenSigningAlgValues []string `json:"id_token_signing_alg_values_supported"`
	}
	if err := json.NewDecoder(response.Body).Decode(&document); err != nil {
		return nil, fmt.Errorf("decode discovery document: %w", err)
	}
	if document.JWKSURI == "" {
		return nil, fmt.Errorf("discovery document has no jwks_uri")
	}
	jwksResponse, err := probe.Get(document.JWKSURI)
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", document.JWKSURI, err)
	}
	defer jwksResponse.Body.Close()
	if jwksResponse.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: status %d", document.JWKSURI, jwksResponse.StatusCode)
	}
	var jwks struct {
		Keys []json.RawMessage `json:"keys"`
	}
	if err := json.NewDecoder(jwksResponse.Body).Decode(&jwks); err != nil {
		return nil, fmt.Errorf("decode JWKS: %w", err)
	}
	if len(jwks.Keys) == 0 {
		return nil, fmt.Errorf("JWKS contains no signing keys")
	}
	return discoveryBody, nil
}

const providerProbeTimeout = 10 * time.Second

// CheckCallbackURL validates that redirectURL is HTTPS and same-origin with
// appOrigin (loopback HTTP allowed for development).
func CheckCallbackURL(redirectURL, appOrigin string) error {
	parsed, err := url.Parse(redirectURL)
	if err != nil || parsed.Host == "" {
		return fmt.Errorf("callback URL %q is not absolute", redirectURL)
	}
	if parsed.Scheme != "https" {
		if parsed.Scheme == "http" && (parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "::1") {
			return nil
		}
		return fmt.Errorf("callback URL must use HTTPS")
	}
	origin, err := url.Parse(appOrigin)
	if err != nil || origin.Host == "" {
		return fmt.Errorf("APP_ORIGIN %q is not absolute", appOrigin)
	}
	if parsed.Host != origin.Host {
		return fmt.Errorf("callback host %q is not same-origin with APP_ORIGIN %q", parsed.Host, origin.Host)
	}
	return nil
}
