package httpserver

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/notifications"
)

type notificationListResponse struct {
	Items  []*notifications.Notification `json:"items"`
	Total  int                           `json:"total"`
	Limit  int                           `json:"limit"`
	Offset int                           `json:"offset"`
}

// listNotifications handles GET /api/v1/notifications
func (d DeliveryDependencies) listNotifications(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.NotificationRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Notifications unavailable", "The notification repository is not configured")
		return
	}

	// Parse pagination
	limit, offset := 20, 0
	var err error
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 100 {
			writeProblem(w, http.StatusBadRequest, "Invalid limit", "limit must be an integer between 1 and 100")
			return
		}
	}
	if raw := r.URL.Query().Get("offset"); raw != "" {
		offset, err = strconv.Atoi(raw)
		if err != nil || offset < 0 {
			writeProblem(w, http.StatusBadRequest, "Invalid offset", "offset must be a non-negative integer")
			return
		}
	}

	// Parse unread filter
	unreadOnly := false
	if raw := r.URL.Query().Get("unread"); raw != "" {
		unreadOnly = raw == "true"
	}

	items, total, err := d.NotificationRepo.List(r.Context(), principal.OrganizationID, principal.UserID, unreadOnly, limit, offset)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to list notifications", "The notification query failed")
		return
	}

	response := notificationListResponse{
		Items:  items,
		Total:  total,
		Limit:  limit,
		Offset: offset,
	}
	writeJSON(w, http.StatusOK, response)
}

// markNotificationAsRead handles PATCH /api/v1/notifications/{id}/read
func (d DeliveryDependencies) markNotificationAsRead(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.NotificationRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Notifications unavailable", "The notification repository is not configured")
		return
	}

	notificationID := r.PathValue("id")
	if notificationID == "" {
		writeProblem(w, http.StatusBadRequest, "Notification ID required", "notification ID path parameter is required")
		return
	}

	err := d.NotificationRepo.MarkAsRead(r.Context(), principal.OrganizationID, notifications.ID(notificationID), principal.UserID)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeProblem(w, http.StatusNotFound, "Notification not found", "No notification exists with this ID or it's already read")
			return
		}
		writeProblem(w, http.StatusInternalServerError, "Unable to mark notification as read", "The notification could not be updated")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}

// markAllNotificationsAsRead handles POST /api/v1/notifications/read-all
func (d DeliveryDependencies) markAllNotificationsAsRead(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.NotificationRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Notifications unavailable", "The notification repository is not configured")
		return
	}

	err := d.NotificationRepo.MarkAllAsRead(r.Context(), principal.OrganizationID, principal.UserID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to mark notifications as read", "The notifications could not be updated")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}

// subscribeToIssue handles POST /api/v1/organizations/{organizationID}/issues/{number}/subscription
func (d DeliveryDependencies) subscribeToIssue(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.IssueRepo == nil || d.NotificationRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Issue tracking or notifications unavailable", "Required repositories are not configured")
		return
	}

	repository := r.URL.Query().Get("repository")
	if repository == "" {
		writeProblem(w, http.StatusBadRequest, "Repository required", "repository query parameter is required")
		return
	}

	numberStr := r.PathValue("number")
	number, err := strconv.Atoi(numberStr)
	if err != nil || number < 1 {
		writeProblem(w, http.StatusBadRequest, "Invalid issue number", "number must be a positive integer")
		return
	}

	// Verify issue exists
	issue, err := d.IssueRepo.Get(r.Context(), principal.OrganizationID, repository, number)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Issue not found", "No issue exists with this number in the repository")
		return
	}

	// Subscribe user
	err = d.NotificationRepo.Subscribe(r.Context(), principal.OrganizationID, principal.UserID, string(issue.ID))
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to subscribe", "The subscription could not be created")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"subscribed": true})
}

// unsubscribeFromIssue handles DELETE /api/v1/organizations/{organizationID}/issues/{number}/subscription
func (d DeliveryDependencies) unsubscribeFromIssue(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.IssueRepo == nil || d.NotificationRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Issue tracking or notifications unavailable", "Required repositories are not configured")
		return
	}

	repository := r.URL.Query().Get("repository")
	if repository == "" {
		writeProblem(w, http.StatusBadRequest, "Repository required", "repository query parameter is required")
		return
	}

	numberStr := r.PathValue("number")
	number, err := strconv.Atoi(numberStr)
	if err != nil || number < 1 {
		writeProblem(w, http.StatusBadRequest, "Invalid issue number", "number must be a positive integer")
		return
	}

	// Verify issue exists
	issue, err := d.IssueRepo.Get(r.Context(), principal.OrganizationID, repository, number)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Issue not found", "No issue exists with this number in the repository")
		return
	}

	// Unsubscribe user
	err = d.NotificationRepo.Unsubscribe(r.Context(), principal.OrganizationID, principal.UserID, string(issue.ID))
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeProblem(w, http.StatusNotFound, "Subscription not found", "User is not subscribed to this issue")
			return
		}
		writeProblem(w, http.StatusInternalServerError, "Unable to unsubscribe", "The subscription could not be removed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"subscribed": false})
}

// getIssueSubscription handles GET /api/v1/organizations/{organizationID}/issues/{number}/subscription
func (d DeliveryDependencies) getIssueSubscription(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.IssueRepo == nil || d.NotificationRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Issue tracking or notifications unavailable", "Required repositories are not configured")
		return
	}

	repository := r.URL.Query().Get("repository")
	if repository == "" {
		writeProblem(w, http.StatusBadRequest, "Repository required", "repository query parameter is required")
		return
	}

	numberStr := r.PathValue("number")
	number, err := strconv.Atoi(numberStr)
	if err != nil || number < 1 {
		writeProblem(w, http.StatusBadRequest, "Invalid issue number", "number must be a positive integer")
		return
	}

	// Verify issue exists
	issue, err := d.IssueRepo.Get(r.Context(), principal.OrganizationID, repository, number)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Issue not found", "No issue exists with this number in the repository")
		return
	}

	// Check subscription status
	subscribed, err := d.NotificationRepo.IsSubscribed(r.Context(), principal.OrganizationID, principal.UserID, string(issue.ID))
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to check subscription", "The subscription status could not be determined")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"subscribed": subscribed})
}
