package postgres

import (
	"context"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

// ProviderProbeConfig carries one provider's effective settings into the
// readiness probe. Secrets are consumed here but never returned.
type ProviderProbeConfig struct {
	IssuerURL        string
	ClientID         string
	SecretConfigured bool
	RedirectURL      string
}

// IdentityProvidersConfig carries the effective SSO configuration into the
// readiness probe.
type IdentityProvidersConfig struct {
	AppOrigin string
	// Providers keyed by the login-page id (oidc, google, github). Absent
	// entries mean the provider has no configuration at all and is skipped.
	Providers map[string]ProviderProbeConfig
}

// RunIdentityCheck executes the shared provider readiness checks and returns
// the full status payload. The same checks gate /readyz (via ReadyOverview).
func (s *Store) RunIdentityCheck(ctx context.Context, configuration IdentityProvidersConfig) identity.IdentityStatus {
	status := identity.IdentityStatus{Providers: []identity.IdentityProviderStatus{}, Checks: []identity.IdentityCheck{}, AppOrigin: configuration.AppOrigin}
	for _, id := range []string{"oidc", "google", "github"} {
		probe, configured := configuration.Providers[id]
		if !configured {
			continue
		}
		status.Providers = append(status.Providers, identity.IdentityProviderStatus{
			ID: id, LoginURL: "/auth/" + id + "/login", IssuerURL: probe.IssuerURL,
			ClientID: probe.ClientID, SecretConfigured: probe.SecretConfigured,
			RedirectURL: probe.RedirectURL, Active: probe.SecretConfigured,
		})
	}

	oidcReady := false
	for _, id := range []string{"oidc", "google", "github"} {
		probe, configured := configuration.Providers[id]
		if !configured || probe.IssuerURL == "" {
			continue
		}
		start := time.Now()
		if _, err := identity.HTTPIdentityProbe(ctx, probe.IssuerURL); err != nil {
			status.Checks = append(status.Checks, identity.IdentityCheck{
				Name: "OIDC discovery (" + id + ")", Status: identity.CheckFailed,
				Error: err.Error(), Duration: time.Since(start).Round(time.Millisecond).String(),
			})
			status.Checks = append(status.Checks, identity.IdentityCheck{
				Name: "JWKS public keys (" + id + ")", Status: identity.CheckFailed,
				Detail: "skipped because discovery failed",
			})
		} else {
			oidcReady = true
			status.Checks = append(status.Checks, identity.IdentityCheck{
				Name: "OIDC discovery (" + id + ")", Status: identity.CheckPassed,
				Detail: probe.IssuerURL, Duration: time.Since(start).Round(time.Millisecond).String(),
			})
			status.Checks = append(status.Checks, identity.IdentityCheck{
				Name: "JWKS public keys (" + id + ")", Status: identity.CheckPassed,
				Detail: "signing keys retrieved",
			})
		}
		break
	}

	for _, id := range []string{"oidc", "google", "github"} {
		probe, configured := configuration.Providers[id]
		if !configured {
			continue
		}
		check := identity.IdentityCheck{Name: "Callback URL (" + id + ")"}
		if err := identity.CheckCallbackURL(probe.RedirectURL, configuration.AppOrigin); err != nil {
			check.Status, check.Error = identity.CheckFailed, err.Error()
		} else {
			check.Status, check.Detail = identity.CheckPassed, probe.RedirectURL
		}
		status.Checks = append(status.Checks, check)
		check = identity.IdentityCheck{Name: "Client secret (" + id + ")"}
		if probe.SecretConfigured {
			check.Status, check.Detail = identity.CheckPassed, "configured via environment (value not shown)"
		} else {
			check.Status, check.Error = identity.CheckFailed, "client secret not configured"
		}
		status.Checks = append(status.Checks, check)
	}
	if len(status.Providers) == 0 {
		status.Checks = append(status.Checks, identity.IdentityCheck{
			Name: "SSO providers", Status: identity.CheckWarning,
			Detail: "no SSO provider is configured; only local password sign-in works",
		})
	}

	if s.notificationMailConfigured() {
		status.Checks = append(status.Checks, identity.IdentityCheck{
			Name: "Email sending", Status: identity.CheckPassed, Detail: "notification email provider configured",
		})
	} else {
		status.Checks = append(status.Checks, identity.IdentityCheck{
			Name: "Email sending", Status: identity.CheckWarning,
			Detail: "NOTIFICATION_EMAIL_PROVIDER not configured: invitation links must be delivered manually",
		})
	}

	status.Ready = oidcReady
	return status
}

// ReadyOverview is the shared readiness shape consumed by /readyz.
func (s *Store) ReadyOverview(ctx context.Context, configuration IdentityProvidersConfig) (bool, identity.IdentityStatus) {
	status := s.RunIdentityCheck(ctx, configuration)
	return status.Ready, status
}

func (s *Store) notificationMailConfigured() bool {
	return s.notificationMailOrigin != ""
}
