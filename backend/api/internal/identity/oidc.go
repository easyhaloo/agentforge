package identity

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
	"unicode"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const (
	invitationCookieName = "__Host-agentforge_invitation"
	oidcTransactionTTL   = 10 * time.Minute
	providerTimeout      = 10 * time.Second
	googleIssuer         = "https://accounts.google.com"
)

type OIDCConfig struct {
	ProviderID   string
	IssuerURL    string
	ClientID     string
	ClientSecret string
	RedirectURL  string
	SessionTTL   time.Duration
	AppOrigin    string
}

type OIDCRepository interface {
	CreateOIDCAuthTransaction(context.Context, string, string, time.Time) error
	ConsumeOIDCAuthTransaction(context.Context, string) (string, error)
	UpsertExternalIdentity(context.Context, string, string, string, string) (string, error)
	HasActiveMembership(context.Context, string) (bool, error)
	CreateSession(context.Context, string, string, string, time.Time) (string, error)
	RevokeSession(context.Context, string) error
	AcceptInvitation(context.Context, string, string, string) (string, error)
}

type OIDCAuthenticator struct {
	repository OIDCRepository
	providerID string
	appOrigin  string
	sessionTTL time.Duration
	oauth      oauth2.Config
	verifier   *oidc.IDTokenVerifier
}

func newAuthenticator(configuration OIDCConfig, repository OIDCRepository) (*OIDCAuthenticator, error) {
	if repository == nil || configuration.ClientID == "" || configuration.ClientSecret == "" ||
		configuration.RedirectURL == "" || configuration.AppOrigin == "" ||
		configuration.SessionTTL < 5*time.Minute || configuration.SessionTTL > 7*24*time.Hour {
		return nil, errors.New("incomplete OIDC authenticator configuration")
	}
	return &OIDCAuthenticator{
		repository: repository,
		providerID: configuration.ProviderID,
		appOrigin:  configuration.AppOrigin,
		sessionTTL: configuration.SessionTTL,
		oauth: oauth2.Config{
			ClientID:     configuration.ClientID,
			ClientSecret: configuration.ClientSecret,
			RedirectURL:  configuration.RedirectURL,
		},
	}, nil
}

func NewOIDCAuthenticator(ctx context.Context, configuration OIDCConfig, repository OIDCRepository) (*OIDCAuthenticator, error) {
	if configuration.IssuerURL == "" || (configuration.ProviderID != "" &&
		(configuration.ProviderID != "google" || configuration.IssuerURL != googleIssuer)) {
		return nil, errors.New("invalid OIDC provider configuration")
	}
	a, err := newAuthenticator(configuration, repository)
	if err != nil {
		return nil, err
	}
	provider, err := oidc.NewProvider(a.providerContext(ctx), configuration.IssuerURL)
	if err != nil {
		return nil, fmt.Errorf("discover OIDC provider: %w", err)
	}
	a.oauth.Endpoint = provider.Endpoint()
	a.oauth.Scopes = []string{oidc.ScopeOpenID, "profile", "email"}
	a.verifier = provider.Verifier(&oidc.Config{ClientID: configuration.ClientID})
	return a, nil
}

func (a *OIDCAuthenticator) providerContext(ctx context.Context) context.Context {
	client, _ := ctx.Value(oauth2.HTTPClient).(*http.Client)
	if client == nil {
		client = http.DefaultClient
	}
	bounded := *client
	if bounded.Timeout == 0 || bounded.Timeout > providerTimeout {
		bounded.Timeout = providerTimeout
	}
	if a.providerID != "" {
		bounded.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	}
	return oidc.ClientContext(ctx, &bounded)
}

func (a *OIDCAuthenticator) AcceptInvitation(w http.ResponseWriter, r *http.Request) {
	AcceptInvitationAt(w, r, "/auth/oidc/login")
}

func AcceptInvitationAt(w http.ResponseWriter, r *http.Request, loginURL string) {
	setAuthHeaders(w)
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if len(token) < 40 || len(token) > 128 || strings.ContainsFunc(token, func(ch rune) bool {
		return !(ch >= 'A' && ch <= 'Z' || ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' || ch == '-' || ch == '_')
	}) {
		writeAuthProblem(w, http.StatusBadRequest, "Invalid invitation link", "The invitation token is missing or malformed")
		return
	}
	expiresAt := time.Now().UTC().Add(30 * time.Minute)
	http.SetCookie(w, &http.Cookie{Name: invitationCookieName, Value: token, Path: "/", Expires: expiresAt,
		MaxAge: 1800, Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	http.Redirect(w, r, loginURL, http.StatusSeeOther)
}

func (a *OIDCAuthenticator) Login(w http.ResponseWriter, r *http.Request) {
	setAuthHeaders(w)
	flow := a.loginFlow(r)
	if a.providerID != "" {
		flow.returnPath = safeReturnPath(r.URL.Query().Get("return"))
	}
	state, err := GenerateToken()
	if err != nil {
		flow.fail(w, "unavailable", http.StatusInternalServerError, "Unable to start login", "Secure login state could not be generated")
		return
	}
	nonce, err := GenerateToken()
	if err != nil {
		flow.fail(w, "unavailable", http.StatusInternalServerError, "Unable to start login", "Secure login nonce could not be generated")
		return
	}
	verifier, err := GenerateToken()
	if err != nil {
		flow.fail(w, "unavailable", http.StatusInternalServerError, "Unable to start login", "PKCE verifier could not be generated")
		return
	}
	expiresAt := time.Now().UTC().Add(oidcTransactionTTL)
	if err := a.repository.CreateOIDCAuthTransaction(r.Context(), a.stateHash(state), HashToken(nonce), expiresAt); err != nil {
		flow.fail(w, "unavailable", http.StatusServiceUnavailable, "Login temporarily unavailable", "The authorization transaction could not be persisted")
		return
	}

	setOIDCCookie(w, a.cookieName("state"), state, expiresAt)
	setOIDCCookie(w, a.cookieName("nonce"), nonce, expiresAt)
	setOIDCCookie(w, a.cookieName("pkce"), verifier, expiresAt)
	if a.providerID != "" {
		setOIDCCookie(w, a.cookieName("return"), base64.RawURLEncoding.EncodeToString([]byte(flow.returnPath)), expiresAt)
	}
	opts := []oauth2.AuthCodeOption{oauth2.S256ChallengeOption(verifier)}
	if a.verifier != nil {
		opts = append(opts, oauth2.SetAuthURLParam("nonce", nonce))
	}
	http.Redirect(w, r, a.oauth.AuthCodeURL(state, opts...), http.StatusFound)
}

func (a *OIDCAuthenticator) Callback(w http.ResponseWriter, r *http.Request) {
	setAuthHeaders(w)
	flow := a.loginFlow(r)
	if a.providerID != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(cookieValue(r, a.cookieName("return")))
		if err == nil {
			flow.returnPath = safeReturnPath(string(decoded))
		}
	}
	query := r.URL.Query()
	state := query.Get("state")
	nonce := cookieValue(r, a.cookieName("nonce"))
	pkce := cookieValue(r, a.cookieName("pkce"))
	if state == "" || nonce == "" || pkce == "" || !equalSecret(state, cookieValue(r, a.cookieName("state"))) {
		flow.fail(w, "failed", http.StatusBadRequest, "Invalid OIDC callback", "The authorization response could not be correlated to the login request")
		return
	}
	code, providerError := query.Get("code"), query.Get("error")
	if code == "" && providerError == "" {
		flow.fail(w, "failed", http.StatusBadRequest, "Invalid OIDC callback", "The authorization response could not be correlated to the login request")
		return
	}
	storedNonceHash, err := a.repository.ConsumeOIDCAuthTransaction(r.Context(), a.stateHash(state))
	if err != nil || !equalSecret(storedNonceHash, HashToken(nonce)) {
		failure := "failed"
		if err != nil && !errors.Is(err, ErrUnauthenticated) {
			failure = "unavailable"
		}
		flow.fail(w, failure, http.StatusBadRequest, "Invalid OIDC callback", "The authorization transaction is expired, already used, or invalid")
		return
	}

	for _, suffix := range []string{"state", "nonce", "pkce"} {
		clearAuthCookie(w, a.cookieName(suffix))
	}
	if a.providerID != "" {
		clearAuthCookie(w, a.cookieName("return"))
	} else {
		clearAuthCookie(w, invitationCookieName)
	}
	if providerError != "" {
		failure := "failed"
		if providerError == "access_denied" {
			failure = "cancelled"
		}
		flow.fail(w, failure, http.StatusUnauthorized, "OIDC login rejected", "The identity provider did not complete authentication")
		return
	}

	ctx, cancel := context.WithTimeout(a.providerContext(r.Context()), providerTimeout)
	defer cancel()
	token, err := a.oauth.Exchange(ctx, code, oauth2.VerifierOption(pkce))
	if err != nil {
		flow.fail(w, "failed", http.StatusUnauthorized, "OIDC token exchange failed", "The identity provider token exchange was rejected")
		return
	}
	if a.providerID == "github" {
		profile, err := githubProfile(ctx, token)
		if err != nil {
			flow.fail(w, "failed", http.StatusUnauthorized, "GitHub profile invalid", "The verified identity profile could not be retrieved")
			return
		}
		flow.finish(w, profile)
		return
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		flow.fail(w, "failed", http.StatusUnauthorized, "OIDC token missing", "The identity provider did not return an ID token")
		return
	}
	idToken, err := a.verifier.Verify(ctx, rawIDToken)
	if err != nil || !equalSecret(idToken.Nonce, nonce) {
		flow.fail(w, "failed", http.StatusUnauthorized, "OIDC token invalid", "The ID token signature, claims, or nonce could not be verified")
		return
	}

	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
	}
	if err := idToken.Claims(&claims); err != nil || strings.TrimSpace(idToken.Subject) == "" {
		flow.fail(w, "failed", http.StatusUnauthorized, "OIDC profile invalid", "The verified identity profile is incomplete")
		return
	}
	profile := externalProfile{issuer: idToken.Issuer, subject: idToken.Subject, name: strings.TrimSpace(claims.Name)}
	if a.providerID == "google" {
		profile.issuer = googleIssuer
	}
	if claims.EmailVerified {
		profile.email = strings.TrimSpace(claims.Email)
	}
	flow.finish(w, profile)
}

type externalProfile struct {
	issuer, subject, email, name string
}

type loginFlow struct {
	*OIDCAuthenticator
	request    *http.Request
	returnPath string
	invitation string
}

func (a *OIDCAuthenticator) loginFlow(r *http.Request) loginFlow {
	return loginFlow{OIDCAuthenticator: a, request: r, invitation: cookieValue(r, invitationCookieName)}
}

func (f loginFlow) finish(w http.ResponseWriter, profile externalProfile) {
	ctx := f.request.Context()
	userID, err := f.repository.UpsertExternalIdentity(ctx, profile.issuer, profile.subject, profile.email, profile.name)
	if err != nil {
		f.fail(w, "unavailable", http.StatusServiceUnavailable, "Identity persistence unavailable", "The verified identity could not be saved")
		return
	}
	if f.invitation != "" {
		if profile.email == "" {
			f.fail(w, "invitation_invalid", http.StatusForbidden, "Verified email required", "The identity provider must verify the invited email address")
			return
		}
		if _, err := f.repository.AcceptInvitation(ctx, HashToken(f.invitation), profile.email, userID); err != nil {
			if f.providerID != "" && !errors.Is(err, ErrInvitationNotFound) && !errors.Is(err, ErrInvitationAlreadyMember) {
				f.fail(w, "unavailable", http.StatusServiceUnavailable, "Invitation unavailable", "The invitation could not be processed")
				return
			}
			f.fail(w, "invitation_invalid", http.StatusForbidden, "Invitation unavailable", "The invitation is invalid, expired, revoked, already used, or addressed to a different verified email")
			return
		}
		if f.providerID != "" {
			clearAuthCookie(w, invitationCookieName)
		}
		f.invitation = ""
	} else {
		// A verified external identity alone grants no organization access.
		activeMembership, err := f.repository.HasActiveMembership(ctx, userID)
		if err != nil {
			f.fail(w, "unavailable", http.StatusServiceUnavailable, "Membership lookup unavailable", "Organization access could not be verified")
			return
		}
		if !activeMembership {
			f.fail(w, "access_required", http.StatusForbidden, "Organization access required", "This identity is not an active member of an AgentForge organization. Ask an organization owner to provision access.")
			return
		}
	}

	credentials, err := GenerateCredentials()
	if err != nil {
		f.fail(w, "unavailable", http.StatusInternalServerError, "Session creation failed", "Secure session credentials could not be generated")
		return
	}
	expiresAt := time.Now().UTC().Add(f.sessionTTL)
	if _, err := f.repository.CreateSession(ctx, userID, credentials.SessionToken, credentials.CSRFToken, expiresAt); err != nil {
		f.fail(w, "unavailable", http.StatusServiceUnavailable, "Session creation failed", "The authenticated session could not be persisted")
		return
	}
	if oldSession := cookieValue(f.request, SessionCookieName); oldSession != "" {
		if revokeErr := f.repository.RevokeSession(ctx, oldSession); revokeErr != nil && !errors.Is(revokeErr, ErrUnauthenticated) {
			_ = f.repository.RevokeSession(ctx, credentials.SessionToken)
			f.fail(w, "unavailable", http.StatusServiceUnavailable, "Session rotation failed", "The previous session could not be safely revoked")
			return
		}
	}

	sessionCookie, csrfCookie := SessionCookies(credentials, expiresAt)
	http.SetCookie(w, sessionCookie)
	http.SetCookie(w, csrfCookie)
	http.Redirect(w, f.request, f.appOrigin+f.returnPath, http.StatusSeeOther)
}

func (f loginFlow) fail(w http.ResponseWriter, code string, status int, title, detail string) {
	if f.providerID == "" {
		writeAuthProblem(w, status, title, detail)
		return
	}
	query := url.Values{"sso_error": {code}}
	if f.returnPath != "" {
		query.Set("return", f.returnPath)
	}
	if f.invitation != "" {
		if code == "invitation_invalid" {
			clearAuthCookie(w, invitationCookieName)
		} else {
			query.Set("invitation", "1")
		}
	}
	http.Redirect(w, f.request, f.appOrigin+"/login?"+query.Encode(), http.StatusSeeOther)
}

func (a *OIDCAuthenticator) cookieName(suffix string) string {
	provider := a.providerID
	if provider == "" {
		provider = "oidc"
	}
	return "__Host-agentforge_" + provider + "_" + suffix
}

func (a *OIDCAuthenticator) stateHash(state string) string {
	if a.providerID == "" {
		return HashToken(state)
	}
	return HashToken(a.providerID + ":" + state)
}

func safeReturnPath(raw string) string {
	unsafe := func(s string) bool {
		return strings.ContainsRune(s, '\\') || strings.ContainsFunc(s, unicode.IsControl)
	}
	if len(raw) > 2048 || !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") || unsafe(raw) {
		return ""
	}
	target, err := url.Parse(raw)
	if err != nil || target.Host != "" || strings.HasPrefix(target.Path, "//") || unsafe(target.Path) || unsafe(target.Fragment) {
		return ""
	}
	query, err := url.QueryUnescape(target.RawQuery)
	if err != nil || unsafe(query) {
		return ""
	}
	clean := path.Clean(target.Path)
	if clean == "/login" || clean == "/register" || clean == "/auth" || strings.HasPrefix(clean, "/auth/") {
		return ""
	}
	return target.String()
}

func equalSecret(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func cookieValue(r *http.Request, name string) string {
	cookie, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return cookie.Value
}

func setAuthHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
}

func setOIDCCookie(w http.ResponseWriter, name, value string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: value, Path: "/", Expires: expiresAt.UTC(),
		MaxAge: int(time.Until(expiresAt).Seconds()), Secure: true, HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func clearAuthCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Path: "/", MaxAge: -1, Secure: true,
		HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
}

func writeAuthProblem(w http.ResponseWriter, status int, title, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(struct {
		Type   string `json:"type"`
		Title  string `json:"title"`
		Status int    `json:"status"`
		Detail string `json:"detail"`
	}{Type: "about:blank", Title: title, Status: status, Detail: detail})
}
