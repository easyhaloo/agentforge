package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

// IdentityManagementRepository defines methods for managing user identities.
type IdentityManagementRepository interface {
	ListUserIdentities(ctx context.Context, userID string) ([]identity.UserIdentityRecord, error)
	GetUserIdentityCount(ctx context.Context, userID string) (int, error)
	DeleteUserIdentity(ctx context.Context, userID, identityID string) error
	ChangeUserPassword(ctx context.Context, userID, currentPassword, newPassword string) error
	HasPlatformCredentials(ctx context.Context, userID string) (bool, error)
}

// UserIdentity represents a connected identity for API responses.
type UserIdentity struct {
	ID              string `json:"id"`
	Issuer          string `json:"issuer"`
	ProviderDisplay string `json:"provider_display"`
	Email           string `json:"email,omitempty"`
	CreatedAt       string `json:"created_at"`
}

type listIdentitiesResponse struct {
	Identities []UserIdentity `json:"identities"`
}

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

type deleteIdentityRequest struct {
	Confirm bool `json:"confirm"`
}

// SessionResolver extracts user ID from session token.
type SessionResolver interface {
	GetUserIDFromSession(ctx context.Context, sessionToken string) (string, error)
}

// listIdentities handles GET /api/v1/me/identities
func (d DeliveryDependencies) listIdentities(w http.ResponseWriter, r *http.Request) {
	repo, ok := d.Repository.(IdentityManagementRepository)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "Identity management unavailable", "The identity management repository is not configured")
		return
	}

	userID, ok := d.getUserIDFromSession(w, r)
	if !ok {
		return
	}

	identities, err := repo.ListUserIdentities(r.Context(), userID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to load identities", "The connected identities could not be retrieved")
		return
	}

	// Convert to API response format
	apiIdentities := make([]UserIdentity, len(identities))
	for i, id := range identities {
		apiIdentities[i] = UserIdentity{
			ID:              id.ID,
			Issuer:          id.Issuer,
			ProviderDisplay: formatProviderDisplay(id.Issuer),
			Email:           id.Email,
			CreatedAt:       id.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
	}

	writeJSON(w, http.StatusOK, listIdentitiesResponse{Identities: apiIdentities})
}

// changePassword handles POST /api/v1/me/password
func (d DeliveryDependencies) changePassword(w http.ResponseWriter, r *http.Request) {
	repo, ok := d.Repository.(IdentityManagementRepository)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "Identity management unavailable", "The identity management repository is not configured")
		return
	}

	userID, ok := d.getUserIDFromSession(w, r)
	if !ok {
		return
	}

	if r.Header.Get("Content-Type") != "application/json" {
		writeProblem(w, http.StatusBadRequest, "Invalid content type", "Request must be application/json")
		return
	}

	var req changePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid request", "Request body must be valid JSON")
		return
	}

	req.CurrentPassword = strings.TrimSpace(req.CurrentPassword)
	req.NewPassword = strings.TrimSpace(req.NewPassword)

	if req.CurrentPassword == "" || req.NewPassword == "" {
		writeProblem(w, http.StatusBadRequest, "Missing passwords", "Current password and new password are required")
		return
	}

	if len(req.NewPassword) < 8 {
		writeProblem(w, http.StatusBadRequest, "Password too short", "New password must be at least 8 characters")
		return
	}

	// Check if user has platform credentials
	hasCreds, err := repo.HasPlatformCredentials(r.Context(), userID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to check credentials", "Platform credentials status could not be verified")
		return
	}
	if !hasCreds {
		writeProblem(w, http.StatusBadRequest, "No platform credentials", "This account does not have platform password credentials")
		return
	}

	err = repo.ChangeUserPassword(r.Context(), userID, req.CurrentPassword, req.NewPassword)
	if errors.Is(err, identity.ErrUnauthenticated) {
		writeProblem(w, http.StatusUnauthorized, "Invalid current password", "The current password is incorrect")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to change password", "The password could not be updated")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// deleteIdentity handles DELETE /api/v1/me/identities/{identityID}
func (d DeliveryDependencies) deleteIdentity(w http.ResponseWriter, r *http.Request) {
	repo, ok := d.Repository.(IdentityManagementRepository)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "Identity management unavailable", "The identity management repository is not configured")
		return
	}

	userID, ok := d.getUserIDFromSession(w, r)
	if !ok {
		return
	}

	identityID := strings.TrimSpace(r.PathValue("identityID"))
	if identityID == "" {
		writeProblem(w, http.StatusBadRequest, "Identity ID required", "An identity identifier is required")
		return
	}

	// Check identity count - must have at least 2 to delete one
	count, err := repo.GetUserIdentityCount(r.Context(), userID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to verify identities", "The number of connected identities could not be verified")
		return
	}

	if count <= 1 {
		writeProblem(w, http.StatusBadRequest, "Cannot delete last identity", "You must have at least one login method. Add another identity before removing this one.")
		return
	}

	err = repo.DeleteUserIdentity(r.Context(), userID, identityID)
	if errors.Is(err, identity.ErrUnauthenticated) {
		writeProblem(w, http.StatusNotFound, "Identity not found", "The identity does not exist or does not belong to your account")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to delete identity", "The identity could not be removed")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// getUserIDFromSession extracts the user ID from the session cookie.
// Returns the user ID and true if successful, writes an error response and returns false otherwise.
func (d DeliveryDependencies) getUserIDFromSession(w http.ResponseWriter, r *http.Request) (string, bool) {
	// Try using Account repository if available
	if d.Account != nil {
		cookie, err := r.Cookie(identity.SessionCookieName)
		if err != nil || cookie.Value == "" {
			writeProblem(w, http.StatusUnauthorized, "Authentication required", "A valid application session is required")
			return "", false
		}
		account, err := d.Account.CurrentAccount(r.Context(), cookie.Value)
		if errors.Is(err, identity.ErrUnauthenticated) {
			writeProblem(w, http.StatusUnauthorized, "Authentication required", "A valid application session is required")
			return "", false
		}
		if err != nil {
			writeProblem(w, http.StatusServiceUnavailable, "Session unavailable", "The session could not be validated")
			return "", false
		}
		return account.UserID, true
	}

	// Fallback: try direct session resolution via repository
	resolver, ok := d.Repository.(SessionResolver)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "Session resolver unavailable", "The session resolver is not configured")
		return "", false
	}

	cookie, err := r.Cookie(identity.SessionCookieName)
	if err != nil || cookie.Value == "" {
		writeProblem(w, http.StatusUnauthorized, "Authentication required", "A valid application session is required")
		return "", false
	}

	userID, err := resolver.GetUserIDFromSession(r.Context(), cookie.Value)
	if errors.Is(err, identity.ErrUnauthenticated) {
		writeProblem(w, http.StatusUnauthorized, "Authentication required", "A valid application session is required")
		return "", false
	}
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Session unavailable", "The session could not be validated")
		return "", false
	}

	return userID, true
}

// formatProviderDisplay converts an issuer to a human-readable provider name.
func formatProviderDisplay(issuer string) string {
	switch {
	case issuer == "platform:internal":
		return "Platform Password"
	case strings.Contains(issuer, "google"):
		return "Google"
	case strings.Contains(issuer, "github"):
		return "GitHub"
	case strings.Contains(issuer, "gitlab"):
		return "GitLab"
	case strings.Contains(issuer, "microsoft"):
		return "Microsoft"
	default:
		return "External Provider"
	}
}
