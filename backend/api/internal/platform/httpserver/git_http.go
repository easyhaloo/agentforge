package httpserver

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/google/uuid"
)

const gitCredentialLifetime = time.Hour
const gitUsername = "git"
const gitTokenPrefix = "afgit_"

type GitCredentialStore interface {
	CreateGitCredential(ctx context.Context, id, organizationID, repository, actorID, scope string, hash []byte, expiresAt time.Time) error
	RevokeGitCredential(ctx context.Context, id, organizationID, repository, actorID string) error
	AuthorizeGitCredential(ctx context.Context, hash []byte, organization, repository string, write bool) (organizationID, actorID, defaultBranch string, err error)
	LockGitDefaultBranch(ctx context.Context, organization, repository string) (branch string, pushRefLimit int, release func(), err error)
}

func (d DeliveryDependencies) gitHTTPRoutes(mux *http.ServeMux) {
	const gitPath = "/git/{organizationID}/{owner}/{gitRepo}"
	mux.HandleFunc("GET "+gitPath+"/info/refs", d.gitHTTP)
	mux.HandleFunc("POST "+gitPath+"/git-upload-pack", d.gitHTTP)
	mux.HandleFunc("POST "+gitPath+"/git-receive-pack", d.gitHTTP)
	const credentials = "/api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/git-credentials"
	mux.HandleFunc("GET "+credentials, d.listGitCredentials)
	mux.HandleFunc("POST "+credentials, d.createGitCredential)
	mux.HandleFunc("DELETE "+credentials+"/{credentialID}", d.revokeGitCredential)
}

func (d DeliveryDependencies) gitHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	org, owner := r.PathValue("organizationID"), r.PathValue("owner")
	name, ok := strings.CutSuffix(r.PathValue("gitRepo"), ".git")
	if !ok || r.URL.RawPath != "" || !githttp.ValidSegment(org) || !githttp.ValidSegment(owner) || !githttp.ValidSegment(name) {
		http.NotFound(w, r)
		return
	}
	service := githttp.UploadPack
	switch r.Method {
	case http.MethodGet:
		query, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || len(query) != 1 || len(query["service"]) != 1 {
			http.NotFound(w, r)
			return
		}
		service = query.Get("service")
	case http.MethodPost:
		if r.URL.RawQuery != "" {
			http.NotFound(w, r)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/"+githttp.ReceivePack) {
			service = githttp.ReceivePack
		}
	default:
		http.NotFound(w, r)
		return
	}
	if service != githttp.UploadPack && service != githttp.ReceivePack {
		http.NotFound(w, r)
		return
	}
	if d.GitHTTP == nil || d.GitCredentials == nil {
		http.NotFound(w, r)
		return
	}
	unauthorized := func() {
		w.Header().Set("WWW-Authenticate", `Basic realm="AgentForge Git"`)
		http.Error(w, "Git authentication required", http.StatusUnauthorized)
	}
	username, token, ok := r.BasicAuth()
	if !ok || username != gitUsername || len(token) != len(gitTokenPrefix)+43 || !strings.HasPrefix(token, gitTokenPrefix) {
		unauthorized()
		return
	}
	hash := sha256.Sum256([]byte(token))
	repository := owner + "/" + name
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	organization, actor, defaultBranch, err := d.GitCredentials.AuthorizeGitCredential(ctx, hash[:], org, repository, service == githttp.ReceivePack)
	if errors.Is(err, identity.ErrUnauthenticated) {
		unauthorized()
		return
	}
	if err != nil {
		http.Error(w, "Git authentication unavailable", http.StatusServiceUnavailable)
		return
	}
	if service == githttp.UploadPack && r.Method == http.MethodGet && !d.GitHTTP.DefaultBranchMatches(organization, repository, defaultBranch) {
		branch, _, release, err := d.GitCredentials.LockGitDefaultBranch(ctx, organization, repository)
		if err != nil {
			http.Error(w, "Clone policy unavailable", http.StatusServiceUnavailable)
			return
		}
		err = d.GitHTTP.SyncDefaultBranch(ctx, organization, repository, branch)
		release()
		if err != nil {
			http.Error(w, "Clone policy unavailable", http.StatusServiceUnavailable)
			return
		}
	}
	var pushRefLimit int
	if service == githttp.ReceivePack && r.Method == http.MethodPost {
		branch, limit, release, err := d.GitCredentials.LockGitDefaultBranch(ctx, organization, repository)
		if err != nil {
			http.Error(w, "Push policy unavailable", http.StatusServiceUnavailable)
			return
		}
		defer release()
		if err := d.GitHTTP.SyncDefaultBranch(ctx, organization, repository, branch); err != nil {
			http.Error(w, "Push policy unavailable", http.StatusServiceUnavailable)
			return
		}
		defaultBranch, pushRefLimit = branch, limit
	}
	d.GitHTTP.Serve(w, r, service, organization, repository, actor, defaultBranch, pushRefLimit)
}

func (d DeliveryDependencies) listGitCredentials(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	repository, ok := d.registeredRepository(w, r, principal)
	if !ok {
		return
	}
	store, ok := d.GitCredentials.(interface {
		ListGitCredentials(context.Context, string, string, string) ([]githttp.CredentialSummary, error)
	})
	if !ok || d.GitHTTP == nil || !d.GitHTTP.Available(principal.OrganizationID, repository.Slug) {
		writeProblem(w, http.StatusServiceUnavailable, "Git credentials unavailable", "Managed Git credential storage is unavailable")
		return
	}
	items, err := store.ListGitCredentials(r.Context(), principal.OrganizationID, repository.Slug, principal.UserID)
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Git credentials unavailable", "Credentials could not be listed")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (d DeliveryDependencies) createGitCredential(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.GitHTTP == nil || d.GitCredentials == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Git transport unavailable", "Git Smart HTTP is not enabled")
		return
	}
	var input struct {
		Scope string `json:"scope"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.Scope != "read" && input.Scope != "write" {
		writeProblem(w, http.StatusBadRequest, "Invalid Git credential scope", "Scope must be read or write")
		return
	}
	if input.Scope == "write" && principal.Role == "viewer" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "The viewer role cannot push to repositories")
		return
	}
	repository, ok := d.registeredRepository(w, r, principal)
	if !ok {
		return
	}
	if !d.GitHTTP.Available(principal.OrganizationID, repository.Slug) {
		writeProblem(w, http.StatusConflict, "Git transport unavailable", "A managed bare repository is required")
		return
	}
	id := uuid.NewString()
	var secret [32]byte
	rand.Read(secret[:])
	token := gitTokenPrefix + base64.RawURLEncoding.EncodeToString(secret[:])
	hash := sha256.Sum256([]byte(token))
	expiresAt := time.Now().UTC().Add(gitCredentialLifetime)
	err := d.GitCredentials.CreateGitCredential(r.Context(), id, principal.OrganizationID, repository.Slug, principal.UserID, input.Scope, hash[:], expiresAt)
	if errors.Is(err, identity.ErrUnauthenticated) {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "The organization role no longer permits this operation")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Git credential unavailable", "The credential could not be issued")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusCreated, struct {
		ID        string    `json:"id"`
		Username  string    `json:"username"`
		Token     string    `json:"token"`
		ExpiresAt time.Time `json:"expires_at"`
	}{id, gitUsername, token, expiresAt})
}

func (d DeliveryDependencies) revokeGitCredential(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.GitCredentials == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Git credentials unavailable", "Credential storage is unavailable")
		return
	}
	repository, ok := d.registeredRepository(w, r, principal)
	if !ok {
		return
	}
	id, err := uuid.Parse(r.PathValue("credentialID"))
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid Git credential ID", "Provide a valid credential ID")
		return
	}
	if err := d.GitCredentials.RevokeGitCredential(r.Context(), id.String(), principal.OrganizationID, repository.Slug, principal.UserID); err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Git credential unavailable", "The credential could not be revoked")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
