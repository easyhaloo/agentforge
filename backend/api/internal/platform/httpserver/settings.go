package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

type SettingsRepository interface {
	GetUserProfile(context.Context, string) (identity.UserProfile, error)
	UpdateUserProfile(context.Context, string, *string, *string, *string) (identity.UserProfile, error)
	GetUserPreferences(context.Context, string) (identity.UserPreferences, error)
	UpdateUserPreferences(context.Context, string, identity.UserPreferencesPatch) (identity.UserPreferences, error)
	GetNotificationPreferences(context.Context, string) (identity.NotificationPreferences, error)
	UpdateNotificationPreferences(context.Context, string, identity.NotificationPreferencesPatch) (identity.NotificationPreferences, error)
	GetAuthenticationInfo(context.Context, string) (identity.AuthenticationInfo, error)
	ListSSHKeys(context.Context, string) ([]identity.SSHKey, error)
	AddSSHKey(context.Context, string, string, string) (identity.SSHKey, error)
	DeleteSSHKey(context.Context, string, string) error
	ListSessions(context.Context, string, string) ([]identity.SessionInfo, error)
	RevokeSessionByID(context.Context, string, string) error
	RevokeAllOtherSessions(context.Context, string, string) (int, error)
	GetAgentPreferences(context.Context, string) (identity.AgentPreferences, error)
	UpdateAgentPreferences(context.Context, string, identity.AgentPreferencesPatch) (identity.AgentPreferences, error)
}

// Preferences handlers

func (d DeliveryDependencies) getPreferences(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	prefs, err := d.Settings.GetUserPreferences(r.Context(), userID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to load preferences", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, prefs)
}

func (d DeliveryDependencies) updatePreferences(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	var req identity.UserPreferencesPatch
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid request", "Request body must be valid JSON")
		return
	}

	prefs, err := d.Settings.UpdateUserPreferences(r.Context(), userID, req)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Failed to update preferences", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, prefs)
}

// Notification preferences handlers

func (d DeliveryDependencies) getNotificationPreferences(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	prefs, err := d.Settings.GetNotificationPreferences(r.Context(), userID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to load notification preferences", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, prefs)
}

func (d DeliveryDependencies) updateNotificationPreferences(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	var req identity.NotificationPreferencesPatch
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid request", "Request body must be valid JSON")
		return
	}

	prefs, err := d.Settings.UpdateNotificationPreferences(r.Context(), userID, req)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Failed to update notification preferences", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, prefs)
}

// Authentication info handler

func (d DeliveryDependencies) getAuthenticationInfo(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	info, err := d.Settings.GetAuthenticationInfo(r.Context(), userID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to load authentication info", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, info)
}

// SSH keys handlers

func (d DeliveryDependencies) listSSHKeys(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	keys, err := d.Settings.ListSSHKeys(r.Context(), userID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to load SSH keys", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, struct {
		Keys []identity.SSHKey `json:"keys"`
	}{Keys: keys})
}

func (d DeliveryDependencies) addSSHKey(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	var req struct {
		Title     string `json:"title"`
		PublicKey string `json:"public_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid request", "Request body must be valid JSON")
		return
	}

	if strings.TrimSpace(req.Title) == "" {
		writeProblem(w, http.StatusBadRequest, "Invalid request", "Title is required")
		return
	}
	if strings.TrimSpace(req.PublicKey) == "" {
		writeProblem(w, http.StatusBadRequest, "Invalid request", "Public key is required")
		return
	}

	key, err := d.Settings.AddSSHKey(r.Context(), userID, req.Title, req.PublicKey)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Failed to add SSH key", err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, key)
}

func (d DeliveryDependencies) deleteSSHKey(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	keyID := strings.TrimSpace(r.PathValue("keyId"))
	if keyID == "" {
		writeProblem(w, http.StatusBadRequest, "Invalid request", "Key ID is required")
		return
	}

	if err := d.Settings.DeleteSSHKey(r.Context(), userID, keyID); err != nil {
		writeProblem(w, http.StatusBadRequest, "Failed to delete SSH key", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// Sessions handlers

func (d DeliveryDependencies) listSessions(w http.ResponseWriter, r *http.Request) {
	userID, sessionToken, ok := d.authenticateUserWithToken(w, r)
	if !ok {
		return
	}

	sessions, err := d.Settings.ListSessions(r.Context(), userID, sessionToken)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to load sessions", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, struct {
		Sessions []identity.SessionInfo `json:"sessions"`
	}{Sessions: sessions})
}

func (d DeliveryDependencies) revokeSession(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := d.authenticateUserWithToken(w, r)
	if !ok {
		return
	}

	sessionID := strings.TrimSpace(r.PathValue("sessionId"))
	if sessionID == "" {
		writeProblem(w, http.StatusBadRequest, "Invalid request", "Session ID is required")
		return
	}

	if err := d.Settings.RevokeSessionByID(r.Context(), userID, sessionID); err != nil {
		writeProblem(w, http.StatusBadRequest, "Failed to revoke session", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (d DeliveryDependencies) revokeAllOtherSessions(w http.ResponseWriter, r *http.Request) {
	userID, sessionToken, ok := d.authenticateUserWithToken(w, r)
	if !ok {
		return
	}

	count, err := d.Settings.RevokeAllOtherSessions(r.Context(), userID, sessionToken)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to revoke sessions", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, struct {
		RevokedCount int `json:"revoked_count"`
	}{RevokedCount: count})
}

// Agent preferences handlers

func (d DeliveryDependencies) getAgentPreferences(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	prefs, err := d.Settings.GetAgentPreferences(r.Context(), userID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to load agent preferences", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, prefs)
}

func (d DeliveryDependencies) updateAgentPreferences(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	var prefs identity.AgentPreferencesPatch
	if err := json.NewDecoder(r.Body).Decode(&prefs); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid request", "Request body must be valid JSON")
		return
	}

	updated, err := d.Settings.UpdateAgentPreferences(r.Context(), userID, prefs)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Failed to update agent preferences", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, updated)
}

func (d DeliveryDependencies) clearAgentMemory(w http.ResponseWriter, r *http.Request) {
	if _, ok := d.authenticateUser(w, r); !ok {
		return
	}
	writeProblem(w, http.StatusNotImplemented, "Agent memory unavailable", "Agent memory storage is not implemented")
}

// Account settings handler

func (d DeliveryDependencies) getAccount(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	profile, err := d.Settings.GetUserProfile(r.Context(), userID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to load account", err.Error())
		return
	}

	// Check if user has platform credentials (can delete account if only platform auth)
	type credentialsChecker interface {
		HasPlatformCredentials(context.Context, string) (bool, error)
		GetUserIdentityCount(context.Context, string) (int, error)
	}

	canDelete := false
	if checker, ok := d.Repository.(credentialsChecker); ok {
		count, err := checker.GetUserIdentityCount(r.Context(), userID)
		if err == nil && count == 1 {
			// Can only delete if user has exactly one identity (platform:internal)
			hasPlatform, err := checker.HasPlatformCredentials(r.Context(), userID)
			if err == nil && hasPlatform {
				canDelete = true
			}
		}
	}

	writeJSON(w, http.StatusOK, struct {
		Email            string `json:"email"`
		EmailVerified    bool   `json:"email_verified"`
		AccountCreatedAt string `json:"account_created_at"`
		CanDeleteAccount bool   `json:"can_delete_account"`
	}{
		Email:            profile.Email,
		EmailVerified:    false, // TODO: Get from users.email_verified column
		AccountCreatedAt: profile.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		CanDeleteAccount: canDelete,
	})
}

// Helper functions

func (d DeliveryDependencies) authenticateUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	userID, _, ok := d.authenticateUserWithToken(w, r)
	return userID, ok
}

func (d DeliveryDependencies) authenticateUserWithToken(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	cookie, err := r.Cookie(identity.SessionCookieName)
	if err != nil || cookie.Value == "" {
		writeProblem(w, http.StatusUnauthorized, "Authentication required", "A valid application session is required")
		return "", "", false
	}

	if d.Account == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Account unavailable", "The account repository is not configured")
		return "", "", false
	}

	account, err := d.Account.CurrentAccount(r.Context(), cookie.Value)
	if errors.Is(err, identity.ErrUnauthenticated) {
		writeProblem(w, http.StatusUnauthorized, "Authentication required", "A valid application session is required")
		return "", "", false
	}
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Account unavailable", "Could not load account context")
		return "", "", false
	}

	if account.UserID == "" || d.Settings == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Settings unavailable", "The account or settings repository is unavailable")
		return "", "", false
	}
	return account.UserID, cookie.Value, true
}
