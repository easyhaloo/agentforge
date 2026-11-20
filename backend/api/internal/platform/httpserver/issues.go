package httpserver

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

type createIssueRequest struct {
	Repository string `json:"repository"`
	Title      string `json:"title"`
	Body       string `json:"body"`
}

type updateIssueRequest struct {
	Title *string `json:"title,omitempty"`
	Body  *string `json:"body,omitempty"`
}

type closeIssueRequest struct {
	Reason string `json:"reason"`
}

type assigneesRequest struct {
	Assignees []string `json:"assignees"`
}

type issueListResponse struct {
	Items  []*issues.Issue `json:"items"`
	Total  int             `json:"total"`
	Limit  int             `json:"limit"`
	Offset int             `json:"offset"`
}

// listIssues handles GET /api/v1/organizations/{organizationID}/issues
func (d DeliveryDependencies) listIssues(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.IssueRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Issue tracking unavailable", "The issue repository is not configured")
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

	// Build filter
	filter := issues.ListFilter{
		Repository: r.URL.Query().Get("repository"),
		State:      issues.State(r.URL.Query().Get("state")),
		CreatedBy:  r.URL.Query().Get("created_by"),
		Query:      r.URL.Query().Get("q"),
	}

	// Validate state if provided
	if filter.State != "" && filter.State != issues.StateOpen && filter.State != issues.StateClosed {
		writeProblem(w, http.StatusBadRequest, "Invalid state", "state must be 'open' or 'closed'")
		return
	}

	items, total, err := d.IssueRepo.List(r.Context(), principal.OrganizationID, filter, limit, offset)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to list issues", "The issue query failed")
		return
	}

	response := issueListResponse{
		Items:  items,
		Total:  total,
		Limit:  limit,
		Offset: offset,
	}
	writeJSON(w, http.StatusOK, response)
}

// createIssue handles POST /api/v1/organizations/{organizationID}/issues
func (d DeliveryDependencies) createIssue(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.IssueRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Issue tracking unavailable", "The issue repository is not configured")
		return
	}

	var req createIssueRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	req.Repository = strings.TrimSpace(req.Repository)
	req.Title = strings.TrimSpace(req.Title)
	req.Body = strings.TrimSpace(req.Body)

	if req.Repository == "" {
		writeProblem(w, http.StatusBadRequest, "Repository required", "repository must not be empty")
		return
	}
	if req.Title == "" {
		writeProblem(w, http.StatusBadRequest, "Title required", "title must not be empty")
		return
	}

	id, err := newID()
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to create issue", "An identifier could not be generated")
		return
	}

	now := time.Now().UTC()
	issue := &issues.Issue{
		ID:         issues.ID(id),
		Repository: req.Repository,
		Title:      req.Title,
		Body:       req.Body,
		State:      issues.StateOpen,
		CreatedBy:  principal.UserID,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	created, err := d.IssueRepo.Create(r.Context(), principal.OrganizationID, issue)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to create issue", "The issue could not be persisted")
		return
	}

	writeJSON(w, http.StatusCreated, created)
}

// getIssue handles GET /api/v1/organizations/{organizationID}/issues/{number}
func (d DeliveryDependencies) getIssue(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.IssueRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Issue tracking unavailable", "The issue repository is not configured")
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

	issue, err := d.IssueRepo.Get(r.Context(), principal.OrganizationID, repository, number)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Issue not found", "No issue exists with this number in the repository")
		return
	}

	writeJSON(w, http.StatusOK, issue)
}

// updateIssue handles PATCH /api/v1/organizations/{organizationID}/issues/{number}
func (d DeliveryDependencies) updateIssue(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.IssueRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Issue tracking unavailable", "The issue repository is not configured")
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

	var req updateIssueRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	// Get existing issue
	issue, err := d.IssueRepo.Get(r.Context(), principal.OrganizationID, repository, number)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Issue not found", "No issue exists with this number in the repository")
		return
	}

	// Check permissions: creator, admin, or owner can update
	if !d.canModifyIssue(principal, issue) {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only the issue creator, admins, or owners can update this issue")
		return
	}

	// Apply updates
	if req.Title != nil {
		title := strings.TrimSpace(*req.Title)
		if title == "" {
			writeProblem(w, http.StatusBadRequest, "Invalid title", "title must not be empty")
			return
		}
		issue.Title = title
	}
	if req.Body != nil {
		issue.Body = strings.TrimSpace(*req.Body)
	}

	issue.UpdatedAt = time.Now().UTC()

	updated, err := d.IssueRepo.Update(r.Context(), principal.OrganizationID, issue)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to update issue", "The issue could not be updated")
		return
	}

	writeJSON(w, http.StatusOK, updated)
}

// closeIssue handles POST /api/v1/organizations/{organizationID}/issues/{number}/close
func (d DeliveryDependencies) closeIssue(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.IssueRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Issue tracking unavailable", "The issue repository is not configured")
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

	var req closeIssueRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	// Validate reason
	reason := issues.StateReason(req.Reason)
	if reason != issues.ReasonCompleted && reason != issues.ReasonNotPlanned && reason != issues.ReasonDuplicate {
		writeProblem(w, http.StatusBadRequest, "Invalid reason", "reason must be 'completed', 'not_planned', or 'duplicate'")
		return
	}

	// Get existing issue
	issue, err := d.IssueRepo.Get(r.Context(), principal.OrganizationID, repository, number)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Issue not found", "No issue exists with this number in the repository")
		return
	}

	// Check if already closed
	if issue.State == issues.StateClosed {
		writeProblem(w, http.StatusConflict, "Issue already closed", "This issue is already closed")
		return
	}

	// Check permissions
	if !d.canModifyIssue(principal, issue) {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only the issue creator, admins, or owners can close this issue")
		return
	}

	closed, err := d.IssueRepo.Close(r.Context(), principal.OrganizationID, issue.ID, reason, principal.UserID, time.Now().UTC())
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to close issue", "The issue could not be closed")
		return
	}

	writeJSON(w, http.StatusOK, closed)
}

// reopenIssue handles POST /api/v1/organizations/{organizationID}/issues/{number}/reopen
func (d DeliveryDependencies) reopenIssue(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.IssueRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Issue tracking unavailable", "The issue repository is not configured")
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

	// Get existing issue
	issue, err := d.IssueRepo.Get(r.Context(), principal.OrganizationID, repository, number)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Issue not found", "No issue exists with this number in the repository")
		return
	}

	// Check if already open
	if issue.State == issues.StateOpen {
		writeProblem(w, http.StatusConflict, "Issue already open", "This issue is already open")
		return
	}

	// Check permissions
	if !d.canModifyIssue(principal, issue) {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only the issue creator, admins, or owners can reopen this issue")
		return
	}

	// Reopen by updating state
	issue.State = issues.StateOpen
	issue.StateReason = ""
	issue.ClosedAt = nil
	issue.ClosedBy = ""
	issue.UpdatedAt = time.Now().UTC()

	reopened, err := d.IssueRepo.Update(r.Context(), principal.OrganizationID, issue)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to reopen issue", "The issue could not be reopened")
		return
	}

	writeJSON(w, http.StatusOK, reopened)
}

// lockIssue handles POST /api/v1/organizations/{organizationID}/issues/{number}/lock
func (d DeliveryDependencies) lockIssue(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}

	// Only admins and owners can lock issues
	if principal.Role != "admin" && principal.Role != "owner" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization admins and owners can lock issues")
		return
	}

	// Lock/unlock functionality requires additional fields in the Issue model
	// For now, return not implemented
	writeProblem(w, http.StatusNotImplemented, "Not implemented", "Issue locking is not yet implemented")
}

// unlockIssue handles DELETE /api/v1/organizations/{organizationID}/issues/{number}/lock
func (d DeliveryDependencies) unlockIssue(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}

	// Only admins and owners can unlock issues
	if principal.Role != "admin" && principal.Role != "owner" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization admins and owners can unlock issues")
		return
	}

	// Lock/unlock functionality requires additional fields in the Issue model
	// For now, return not implemented
	writeProblem(w, http.StatusNotImplemented, "Not implemented", "Issue unlocking is not yet implemented")
}

// addAssignees handles POST /api/v1/organizations/{organizationID}/issues/{number}/assignees
func (d DeliveryDependencies) addAssignees(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.IssueRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Issue tracking unavailable", "The issue repository is not configured")
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

	var req assigneesRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	if len(req.Assignees) == 0 {
		writeProblem(w, http.StatusBadRequest, "Assignees required", "assignees array must not be empty")
		return
	}

	// Get existing issue
	issue, err := d.IssueRepo.Get(r.Context(), principal.OrganizationID, repository, number)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Issue not found", "No issue exists with this number in the repository")
		return
	}

	// Add each assignee
	for _, userID := range req.Assignees {
		userID = strings.TrimSpace(userID)
		if userID == "" {
			continue
		}
		err := d.IssueRepo.AddAssignee(r.Context(), principal.OrganizationID, string(issue.ID), userID)
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, "Unable to add assignee", "The assignee could not be added")
			return
		}
	}

	// Get updated assignees list
	assignees, err := d.IssueRepo.GetAssignees(r.Context(), principal.OrganizationID, string(issue.ID))
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to get assignees", "The assignees list could not be retrieved")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"assignees": assignees})
}

// removeAssignees handles DELETE /api/v1/organizations/{organizationID}/issues/{number}/assignees
func (d DeliveryDependencies) removeAssignees(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.IssueRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Issue tracking unavailable", "The issue repository is not configured")
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

	var req assigneesRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	if len(req.Assignees) == 0 {
		writeProblem(w, http.StatusBadRequest, "Assignees required", "assignees array must not be empty")
		return
	}

	// Get existing issue
	issue, err := d.IssueRepo.Get(r.Context(), principal.OrganizationID, repository, number)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Issue not found", "No issue exists with this number in the repository")
		return
	}

	// Remove each assignee
	for _, userID := range req.Assignees {
		userID = strings.TrimSpace(userID)
		if userID == "" {
			continue
		}
		err := d.IssueRepo.RemoveAssignee(r.Context(), principal.OrganizationID, string(issue.ID), userID)
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, "Unable to remove assignee", "The assignee could not be removed")
			return
		}
	}

	// Get updated assignees list
	assignees, err := d.IssueRepo.GetAssignees(r.Context(), principal.OrganizationID, string(issue.ID))
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to get assignees", "The assignees list could not be retrieved")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"assignees": assignees})
}

// canModifyIssue checks if the principal can modify the given issue
func (d DeliveryDependencies) canModifyIssue(principal Principal, issue *issues.Issue) bool {
	// Admin and owner have full access
	if principal.Role == "admin" || principal.Role == "owner" {
		return true
	}
	// Creator can modify their own issues
	if principal.UserID == issue.CreatedBy {
		return true
	}
	return false
}
