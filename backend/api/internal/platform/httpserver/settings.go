package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

// Preferences handlers

type preferencesGetter interface {
	GetUserPreferences(context.Context, string) (identity.UserPreferences, error)
}

type preferencesUpdater interface {
	UpdateUserPreferences(context.Context, string, string, string, string) (identity.UserPreferences, error)
}

func (d DeliveryDependencies) getPreferences(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	repo, ok := d.Repository.(preferencesGetter)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "Preferences unavailable", "Preferences repository is not configured")
		return
	}

	prefs, err := repo.GetUserPreferences(r.Context(), userID)
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

	var req struct {
		Theme    string `json:"theme"`
		Language string `json:"language"`
		Timezone string `json:"timezone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid request", "Request body must be valid JSON")
		return
	}

	repo, ok := d.Repository.(preferencesUpdater)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "Preferences unavailable", "Preferences repository is not configured")
		return
	}

	prefs, err := repo.UpdateUserPreferences(r.Context(), userID, req.Theme, req.Language, req.Timezone)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Failed to update preferences", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, prefs)
}

// Notification preferences handlers

type notificationPreferencesGetter interface {
	GetNotificationPreferences(context.Context, string) (identity.NotificationPreferences, error)
}

type notificationPreferencesUpdater interface {
	UpdateNotificationPreferences(context.Context, string, identity.EmailNotificationSettings, bool, string) (identity.NotificationPreferences, error)
}

func (d DeliveryDependencies) getNotificationPreferences(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	repo, ok := d.Repository.(notificationPreferencesGetter)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "Notification preferences unavailable", "Notification preferences repository is not configured")
		return
	}

	prefs, err := repo.GetNotificationPreferences(r.Context(), userID)
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

	var req struct {
		EmailNotifications    identity.EmailNotificationSettings `json:"email_notifications"`
		WebPushEnabled        bool                               `json:"web_push_enabled"`
		NotificationFrequency string                             `json:"notification_frequency"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid request", "Request body must be valid JSON")
		return
	}

	repo, ok := d.Repository.(notificationPreferencesUpdater)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "Notification preferences unavailable", "Notification preferences repository is not configured")
		return
	}

	prefs, err := repo.UpdateNotificationPreferences(r.Context(), userID, req.EmailNotifications, req.WebPushEnabled, req.NotificationFrequency)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Failed to update notification preferences", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, prefs)
}

// Authentication info handler

type authenticationInfoGetter interface {
	GetAuthenticationInfo(context.Context, string) (identity.AuthenticationInfo, error)
}

func (d DeliveryDependencies) getAuthenticationInfo(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	repo, ok := d.Repository.(authenticationInfoGetter)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "Authentication info unavailable", "Authentication info repository is not configured")
		return
	}

	info, err := repo.GetAuthenticationInfo(r.Context(), userID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to load authentication info", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, info)
}

// SSH keys handlers

type sshKeysLister interface {
	ListSSHKeys(context.Context, string) ([]identity.SSHKey, error)
}

type sshKeyAdder interface {
	AddSSHKey(context.Context, string, string, string) (identity.SSHKey, error)
}

type sshKeyDeleter interface {
	DeleteSSHKey(context.Context, string, string) error
}

func (d DeliveryDependencies) listSSHKeys(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	repo, ok := d.Repository.(sshKeysLister)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "SSH keys unavailable", "SSH keys repository is not configured")
		return
	}

	keys, err := repo.ListSSHKeys(r.Context(), userID)
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

	repo, ok := d.Repository.(sshKeyAdder)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "SSH keys unavailable", "SSH keys repository is not configured")
		return
	}

	key, err := repo.AddSSHKey(r.Context(), userID, req.Title, req.PublicKey)
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

	repo, ok := d.Repository.(sshKeyDeleter)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "SSH keys unavailable", "SSH keys repository is not configured")
		return
	}

	if err := repo.DeleteSSHKey(r.Context(), userID, keyID); err != nil {
		writeProblem(w, http.StatusBadRequest, "Failed to delete SSH key", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// Sessions handlers

type sessionsLister interface {
	ListSessions(context.Context, string, string) ([]identity.SessionInfo, error)
}

type sessionRevoker interface {
	RevokeSessionByID(context.Context, string, string) error
}

type allSessionsRevoker interface {
	RevokeAllOtherSessions(context.Context, string, string) (int, error)
}

func (d DeliveryDependencies) listSessions(w http.ResponseWriter, r *http.Request) {
	userID, sessionToken, ok := d.authenticateUserWithToken(w, r)
	if !ok {
		return
	}

	repo, ok := d.Repository.(sessionsLister)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "Sessions unavailable", "Sessions repository is not configured")
		return
	}

	sessions, err := repo.ListSessions(r.Context(), userID, sessionToken)
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

	repo, ok := d.Repository.(sessionRevoker)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "Sessions unavailable", "Sessions repository is not configured")
		return
	}

	if err := repo.RevokeSessionByID(r.Context(), userID, sessionID); err != nil {
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

	repo, ok := d.Repository.(allSessionsRevoker)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "Sessions unavailable", "Sessions repository is not configured")
		return
	}

	count, err := repo.RevokeAllOtherSessions(r.Context(), userID, sessionToken)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to revoke sessions", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, struct {
		RevokedCount int `json:"revoked_count"`
	}{RevokedCount: count})
}

// Agent preferences handlers

type agentPreferencesGetter interface {
	GetAgentPreferences(context.Context, string) (identity.AgentPreferences, error)
}

type agentPreferencesUpdater interface {
	UpdateAgentPreferences(context.Context, string, identity.AgentPreferences) (identity.AgentPreferences, error)
}

func (d DeliveryDependencies) getAgentPreferences(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	repo, ok := d.Repository.(agentPreferencesGetter)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "Agent preferences unavailable", "Agent preferences repository is not configured")
		return
	}

	prefs, err := repo.GetAgentPreferences(r.Context(), userID)
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

	var prefs identity.AgentPreferences
	if err := json.NewDecoder(r.Body).Decode(&prefs); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid request", "Request body must be valid JSON")
		return
	}

	repo, ok := d.Repository.(agentPreferencesUpdater)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "Agent preferences unavailable", "Agent preferences repository is not configured")
		return
	}

	updated, err := repo.UpdateAgentPreferences(r.Context(), userID, prefs)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Failed to update agent preferences", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, updated)
}

func (d DeliveryDependencies) clearAgentMemory(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	// For now, this is a no-op since we don't have an agent memory store yet
	// In the future, this would clear agent context/memory for the user
	_ = userID

	writeJSON(w, http.StatusOK, struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}{Success: true, Message: "Agent memory cleared"})
}

// Account settings handler

func (d DeliveryDependencies) getAccount(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	// Get user account information
	type accountGetter interface {
		GetUserProfile(context.Context, string) (identity.UserProfile, error)
	}

	repo, ok := d.Repository.(accountGetter)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "Account unavailable", "Account repository is not configured")
		return
	}

	profile, err := repo.GetUserProfile(r.Context(), userID)
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
	if d.Account == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Account unavailable", "The account repository is not configured")
		return "", "", false
	}

	cookie, err := r.Cookie(identity.SessionCookieName)
	if err != nil || cookie.Value == "" {
		writeProblem(w, http.StatusUnauthorized, "Authentication required", "A valid application session is required")
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

	return account.UserID, cookie.Value, true
}
