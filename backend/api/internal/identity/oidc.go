package identity

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const (
	oidcStateCookieName   = "__Host-agentforge_oidc_state"
	oidcNonceCookieName   = "__Host-agentforge_oidc_nonce"
	oidcPKCECookieName    = "__Host-agentforge_oidc_pkce"
	oidcTransactionTTL    = 10 * time.Minute
)

type OIDCConfig struct {
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
	CreateSession(context.Context, string, string, string, time.Time) (string, error)
	RevokeSession(context.Context, string) error
}

type OIDCAuthenticator struct {
	repository OIDCRepository
	issuer     string
	appOrigin  string
	sessionTTL time.Duration
	oauth      oauth2.Config
	verifier   *oidc.IDTokenVerifier
}

func NewOIDCAuthenticator(ctx context.Context, configuration OIDCConfig, repository OIDCRepository) (*OIDCAuthenticator, error) {
	if repository == nil || configuration.IssuerURL == "" || configuration.ClientID == "" ||
		configuration.ClientSecret == "" || configuration.RedirectURL == "" || configuration.AppOrigin == "" ||
		configuration.SessionTTL < 5*time.Minute || configuration.SessionTTL > 7*24*time.Hour {
		return nil, errors.New("incomplete OIDC authenticator configuration")
	}
	provider, err := oidc.NewProvider(ctx, configuration.IssuerURL)
	if err != nil {
		return nil, fmt.Errorf("discover OIDC provider: %w", err)
	}
	return &OIDCAuthenticator{
		repository: repository,
		issuer: configuration.IssuerURL,
		appOrigin: configuration.AppOrigin,
		sessionTTL: configuration.SessionTTL,
		oauth: oauth2.Config{
			ClientID: configuration.ClientID,
			ClientSecret: configuration.ClientSecret,
			Endpoint: provider.Endpoint(),
			RedirectURL: configuration.RedirectURL,
			Scopes: []string{oidc.ScopeOpenID, "profile", "email"},
		},
		verifier: provider.Verifier(&oidc.Config{ClientID: configuration.ClientID}),
	}, nil
}

func (a *OIDCAuthenticator) Login(w http.ResponseWriter, r *http.Request) {
	state, err := GenerateToken()
	if err != nil {
		writeAuthProblem(w, http.StatusInternalServerError, "Unable to start login", "Secure login state could not be generated")
		return
	}
	nonce, err := GenerateToken()
	if err != nil {
		writeAuthProblem(w, http.StatusInternalServerError, "Unable to start login", "Secure login nonce could not be generated")
		return
	}
	verifier, err := GenerateToken()
	if err != nil {
		writeAuthProblem(w, http.StatusInternalServerError, "Unable to start login", "PKCE verifier could not be generated")
		return
	}
	expiresAt := time.Now().UTC().Add(oidcTransactionTTL)
	if err := a.repository.CreateOIDCAuthTransaction(r.Context(), HashToken(state), HashToken(nonce), expiresAt); err != nil {
		writeAuthProblem(w, http.StatusServiceUnavailable, "Login temporarily unavailable", "The authorization transaction could not be persisted")
		return
	}

	setOIDCCookie(w, oidcStateCookieName, state, expiresAt)
	setOIDCCookie(w, oidcNonceCookieName, nonce, expiresAt)
	setOIDCCookie(w, oidcPKCECookieName, verifier, expiresAt)
	challengeSum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(challengeSum[:])
	location := a.oauth.AuthCodeURL(
		state,
		oauth2.SetAuthURLParam("nonce", nonce),
		oauth2.SetAuthURLParam("code_challenge", challenge),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
	)
	http.Redirect(w, r, location, http.StatusFound)
}

func (a *OIDCAuthenticator) Callback(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("error") != "" {
		clearOIDCCookies(w)
		writeAuthProblem(w, http.StatusUnauthorized, "OIDC login rejected", "The identity provider did not complete authentication")
		return
	}
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	stateCookie, stateErr := r.Cookie(oidcStateCookieName)
	nonceCookie, nonceErr := r.Cookie(oidcNonceCookieName)
	pkceCookie, pkceErr := r.Cookie(oidcPKCECookieName)
	if code == "" || state == "" || stateErr != nil || nonceErr != nil || pkceErr != nil ||
		subtle.ConstantTimeCompare([]byte(state), []byte(stateCookie.Value)) != 1 {
		clearOIDCCookies(w)
		writeAuthProblem(w, http.StatusBadRequest, "Invalid OIDC callback", "The authorization response could not be correlated to the login request")
		return
	}

	storedNonceHash, err := a.repository.ConsumeOIDCAuthTransaction(r.Context(), HashToken(state))
	if err != nil || subtle.ConstantTimeCompare([]byte(storedNonceHash), []byte(HashToken(nonceCookie.Value))) != 1 {
		clearOIDCCookies(w)
		writeAuthProblem(w, http.StatusBadRequest, "Invalid OIDC callback", "The authorization transaction is expired, already used, or invalid")
		return
	}

	token, err := a.oauth.Exchange(r.Context(), code, oauth2.SetAuthURLParam("code_verifier", pkceCookie.Value))
	if err != nil {
		clearOIDCCookies(w)
		writeAuthProblem(w, http.StatusUnauthorized, "OIDC token exchange failed", "The identity provider token exchange was rejected")
		return
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		clearOIDCCookies(w)
		writeAuthProblem(w, http.StatusUnauthorized, "OIDC token missing", "The identity provider did not return an ID token")
		return
	}
	idToken, err := a.verifier.Verify(r.Context(), rawIDToken)
	if err != nil || subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(nonceCookie.Value)) != 1 {
		clearOIDCCookies(w)
		writeAuthProblem(w, http.StatusUnauthorized, "OIDC token invalid", "The ID token signature, claims, or nonce could not be verified")
		return
	}

	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
	}
	if err := idToken.Claims(&claims); err != nil || strings.TrimSpace(idToken.Subject) == "" {
		clearOIDCCookies(w)
		writeAuthProblem(w, http.StatusUnauthorized, "OIDC profile invalid", "The verified identity profile is incomplete")
		return
	}
	email := ""
	if claims.EmailVerified {
		email = strings.TrimSpace(claims.Email)
	}
	userID, err := a.repository.UpsertExternalIdentity(r.Context(), idToken.Issuer, idToken.Subject, email, strings.TrimSpace(claims.Name))
	if err != nil {
		clearOIDCCookies(w)
		writeAuthProblem(w, http.StatusServiceUnavailable, "Identity persistence unavailable", "The verified identity could not be saved")
		return
	}

	credentials, err := GenerateCredentials()
	if err != nil {
		clearOIDCCookies(w)
		writeAuthProblem(w, http.StatusInternalServerError, "Session creation failed", "Secure session credentials could not be generated")
		return
	}
	expiresAt := time.Now().UTC().Add(a.sessionTTL)
	if _, err := a.repository.CreateSession(r.Context(), userID, credentials.SessionToken, credentials.CSRFToken, expiresAt); err != nil {
		clearOIDCCookies(w)
		writeAuthProblem(w, http.StatusServiceUnavailable, "Session creation failed", "The authenticated session could not be persisted")
		return
	}
	if oldSession, cookieErr := r.Cookie(SessionCookieName); cookieErr == nil && oldSession.Value != "" {
		if revokeErr := a.repository.RevokeSession(r.Context(), oldSession.Value); revokeErr != nil && !errors.Is(revokeErr, ErrUnauthenticated) {
			_ = a.repository.RevokeSession(r.Context(), credentials.SessionToken)
			clearOIDCCookies(w)
			writeAuthProblem(w, http.StatusServiceUnavailable, "Session rotation failed", "The previous session could not be safely revoked")
			return
		}
	}

	sessionCookie, csrfCookie := SessionCookies(credentials, expiresAt)
	http.SetCookie(w, sessionCookie)
	http.SetCookie(w, csrfCookie)
	clearOIDCCookies(w)
	http.Redirect(w, r, a.appOrigin, http.StatusSeeOther)
}

func (a *OIDCAuthenticator) Logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(SessionCookieName); err == nil && cookie.Value != "" {
		if err := a.repository.RevokeSession(r.Context(), cookie.Value); err != nil && !errors.Is(err, ErrUnauthenticated) {
			writeAuthProblem(w, http.StatusServiceUnavailable, "Logout temporarily unavailable", "The active session could not be revoked")
			return
		}
	}
	sessionCookie, csrfCookie := ClearSessionCookies()
	http.SetCookie(w, sessionCookie)
	http.SetCookie(w, csrfCookie)
	w.WriteHeader(http.StatusNoContent)
}

func setOIDCCookie(w http.ResponseWriter, name, value string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: value, Path: "/", Expires: expiresAt.UTC(),
		MaxAge: int(time.Until(expiresAt).Seconds()), Secure: true, HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func clearOIDCCookies(w http.ResponseWriter) {
	for _, name := range []string{oidcStateCookieName, oidcNonceCookieName, oidcPKCECookieName} {
		http.SetCookie(w, &http.Cookie{
			Name: name, Value: "", Path: "/", MaxAge: -1, Secure: true,
			HttpOnly: true, SameSite: http.SameSiteLaxMode,
		})
	}
}

func writeAuthProblem(w http.ResponseWriter, status int, title, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(struct {
		Type string `json:"type"`
		Title string `json:"title"`
		Status int `json:"status"`
		Detail string `json:"detail"`
	}{Type: "about:blank", Title: title, Status: status, Detail: detail})
}
