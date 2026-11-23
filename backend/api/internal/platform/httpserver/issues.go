package httpserver

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

type createIssueRequest struct {
	Repository    string      `json:"repository"`
	Title         string      `json:"title"`
	Body          string      `json:"body"`
	Assignees     []string    `json:"assignees,omitempty"`
	LabelIDs      []string    `json:"label_ids,omitempty"`
	MilestoneID   string      `json:"milestone_id,omitempty"`
	Type          issues.Type `json:"issue_type,omitempty"`
	AttachmentIDs []string    `json:"attachment_ids,omitempty"`
	ProjectIDs    []string    `json:"project_ids,omitempty"`
	ParentNumber  int32       `json:"parent_number,omitempty"`
}

type updateIssueRequest struct {
	issues.MetadataUpdate
	Title             *string    `json:"title,omitempty"`
	Body              *string    `json:"body,omitempty"`
	ExpectedUpdatedAt *time.Time `json:"expected_updated_at,omitempty"`
}

type closeIssueRequest struct {
	Reason string `json:"reason"`
}

type lockIssueRequest struct {
	Reason string `json:"reason"`
}

type assigneesRequest struct {
	Assignees []string `json:"assignees"`
}

type issueListResponse struct {
	Items []*issues.Issue `json:"items"`
	issues.ListCounts
	Limit         int                   `json:"limit"`
	Offset        int                   `json:"offset"`
	FilterOptions *issues.FilterOptions `json:"filter_options,omitempty"`
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

	query := r.URL.Query()

	// Parse pagination
	limit, offset := 20, 0
	var err error
	if raw := query.Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 100 {
			writeProblem(w, http.StatusBadRequest, "Invalid limit", "limit must be an integer between 1 and 100")
			return
		}
	}
	if raw := query.Get("offset"); raw != "" {
		offset, err = strconv.Atoi(raw)
		if err != nil || offset < 0 {
			writeProblem(w, http.StatusBadRequest, "Invalid offset", "offset must be a non-negative integer")
			return
		}
	}

	filter := issues.ListFilter{
		LinkedChangeset: query.Get("linked_changeset"),
		Repository:      query.Get("repository"),
		State:           issues.State(query.Get("state")),
		CreatedBy:       query.Get("created_by"),
		Assignee:        query.Get("assignee"),
		Label:           query.Get("labels"),
		Milestone:       query.Get("milestone"),
		Query:           strings.TrimSpace(query.Get("q")),
		Sort:            query.Get("sort"),
		Direction:       query.Get("direction"),
	}
	if filter.LinkedChangeset != "" && (filter.Repository == "" || len(filter.LinkedChangeset) > 128 || !wellFormedText(filter.LinkedChangeset)) {
		writeProblem(w, http.StatusBadRequest, "Invalid linked changeset filter", "Provide a repository and a valid changeset ID")
		return
	}
	if filter.State != "" && filter.State != issues.StateOpen && filter.State != issues.StateClosed {
		writeProblem(w, http.StatusBadRequest, "Invalid state", "state must be 'open' or 'closed'")
		return
	}
	if filter.Sort != "" && filter.Sort != "created" && filter.Sort != "updated" && filter.Sort != "comments" {
		writeProblem(w, http.StatusBadRequest, "Invalid sort", "sort must be 'created', 'updated', or 'comments'")
		return
	}
	if filter.Direction != "" && filter.Direction != "asc" && filter.Direction != "desc" {
		writeProblem(w, http.StatusBadRequest, "Invalid direction", "direction must be 'asc' or 'desc'")
		return
	}
	if raw := query.Get("since"); raw != "" {
		since, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "Invalid since", "since must be an RFC3339 timestamp")
			return
		}
		filter.Since = &since
	}
	includeFilterOptions := false
	switch query.Get("include_filter_options") {
	case "", "false":
	case "true":
		if filter.Repository == "" {
			writeProblem(w, http.StatusBadRequest, "Repository required", "repository is required when including filter options")
			return
		}
		includeFilterOptions = true
	default:
		writeProblem(w, http.StatusBadRequest, "Invalid include_filter_options", "include_filter_options must be 'true' or 'false'")
		return
	}

	items, counts, err := d.IssueRepo.List(r.Context(), principal.OrganizationID, filter, limit, offset)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to list issues", "The issue query failed")
		return
	}
	response := issueListResponse{Items: items, ListCounts: counts, Limit: limit, Offset: offset}
	if includeFilterOptions {
		options, err := d.IssueRepo.FilterOptions(r.Context(), principal.OrganizationID, filter.Repository)
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, "Unable to list issue filters", "The issue filters query failed")
			return
		}
		response.FilterOptions = &options
	}
	writeJSON(w, http.StatusOK, response)
}

// issueReferences resolves a bounded set of Issue numbers in the requested repository.
func (d DeliveryDependencies) issueReferences(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.IssueRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Issue tracking unavailable", "The issue repository is not configured")
		return
	}
	query := r.URL.Query()
	repository := query.Get("repository")
	values := query["number"]
	if repository == "" || len(values) < 1 || len(values) > 100 {
		writeProblem(w, http.StatusBadRequest, "Invalid issue reference lookup", "A repository and 1 to 100 issue numbers are required")
		return
	}
	numbers := make([]int32, 0, len(values))
	for _, value := range values {
		number, err := strconv.ParseInt(value, 10, 32)
		if err != nil || number < 1 {
			writeProblem(w, http.StatusBadRequest, "Invalid issue number", "number must be a positive 32-bit integer")
			return
		}
		numbers = append(numbers, int32(number))
	}
	found, err := d.IssueRepo.ExistingNumbers(r.Context(), principal.OrganizationID, repository, numbers)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to resolve issues", "The issue reference query failed")
		return
	}
	writeJSON(w, http.StatusOK, found)
}

func (d DeliveryDependencies) findIssueMemberMentions(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if !wellFormedText(query) || utf8.RuneCountInString(query) > 100 {
		writeProblem(w, http.StatusBadRequest, "Invalid member query", "The member query must contain at most 100 characters")
		return
	}
	if d.Membership == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Member lookup unavailable", "The organization membership repository is not configured")
		return
	}
	items, err := d.Membership.FindMemberMentions(r.Context(), principal.OrganizationID, query)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Member lookup failed", "The organization members could not be queried")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, struct {
		Items []identity.MemberMention `json:"items"`
	}{Items: items})
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
	if strings.TrimSpace(req.Body) == "" {
		req.Body = ""
	}

	if req.Repository == "" {
		writeProblem(w, http.StatusBadRequest, "Repository required", "repository must not be empty")
		return
	}
	if req.Title == "" {
		writeProblem(w, http.StatusBadRequest, "Title required", "title must not be empty")
		return
	}

	if utf8.RuneCountInString(req.Title) > 500 {
		writeProblem(w, http.StatusUnprocessableEntity, "Title too long", "Title must be at most 500 characters")
		return
	}
	if len(req.Assignees) > 0 || len(req.LabelIDs) > 0 || req.MilestoneID != "" || req.Type != "" || len(req.ProjectIDs) > 0 {
		if principal.Role != "owner" && principal.Role != "admin" {
			writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization admins and owners can set metadata when creating an issue")
			return
		}
	}

	if _, ok := d.resolveRegisteredRepository(w, r, principal, req.Repository); !ok {
		return
	}

	if req.ParentNumber < 0 {
		writeProblem(w, http.StatusBadRequest, "Invalid parent number", "The parent number must be a positive integer")
		return
	}

	if !req.Type.Valid() {
		writeProblem(w, http.StatusUnprocessableEntity, "Issue type unavailable", "Choose Task, Bug, or Feature")
		return
	}

	if len(req.ProjectIDs) > 100 {
		writeProblem(w, http.StatusUnprocessableEntity, "Issue projects unavailable", "Choose at most 100 projects")
		return
	}
	for _, id := range req.ProjectIDs {
		if len(id) != 32 || !wellFormedText(id) {
			writeProblem(w, http.StatusUnprocessableEntity, "Issue projects unavailable", "A project identifier is invalid")
			return
		}
	}

	if !validIssueAttachmentIDs(principal.OrganizationID, req.Body, req.AttachmentIDs) {
		writeProblem(w, http.StatusUnprocessableEntity, "Issue attachments unavailable", "The issue must reference at most 20 uploaded files")
		return
	}

	id, err := newID()
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to create issue", "An identifier could not be generated")
		return
	}

	now := time.Now().UTC()
	issue := &issues.Issue{
		ID:              issues.ID(id),
		Repository:      req.Repository,
		Title:           req.Title,
		Body:            req.Body,
		State:           issues.StateOpen,
		CreatedBy:       principal.UserID,
		CreatedAt:       now,
		UpdatedAt:       now,
		MilestoneID:     req.MilestoneID,
		Type:            req.Type,
		AttachmentIDs:   req.AttachmentIDs,
		ProjectIDs:      req.ProjectIDs,
		ParentNumber:    int(req.ParentNumber),
		ParentCanManage: principal.Role == "owner" || principal.Role == "admin",
	}

	for _, userID := range req.Assignees {
		issue.Assignees = append(issue.Assignees, issues.Assignee{UserID: userID})
	}
	for _, labelID := range req.LabelIDs {
		issue.Labels = append(issue.Labels, issues.Label{ID: labelID})
	}

	created, err := d.IssueRepo.Create(r.Context(), principal.OrganizationID, issue)
	if errors.Is(err, issues.ErrDetailNotFound) || errors.Is(err, issues.ErrDetailForbidden) {
		issueDetailError(w, err)
		return
	}
	if errors.Is(err, issues.ErrInvalidAttachments) {
		writeProblem(w, http.StatusUnprocessableEntity, "Issue attachments unavailable", "An uploaded file is expired or unavailable for this issue")
		return
	}
	if errors.Is(err, issues.ErrInvalidMetadata) {
		writeProblem(w, http.StatusUnprocessableEntity, "Issue metadata unavailable", "An assignee, label, milestone, or project is invalid for this repository")
		return
	}
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
	if err != nil && d.IssueDetailRepo != nil {
		issue, err = d.IssueDetailRepo.MovedIssue(r.Context(), principal.OrganizationID, repository, number)
		if err == nil {
			if _, ok := d.resolveRegisteredRepository(w, r, principal, issue.Repository); !ok {
				return
			}
		}
	}
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

	if req.MetadataUpdate.HasChanges() {
		if principal.Role != "owner" && principal.Role != "admin" {
			writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization admins and owners can change issue metadata")
			return
		}
		if (req.Type != nil && !req.Type.Valid()) || len(req.AssigneeIDs) > 100 || len(req.LabelIDs) > 100 || len(req.ProjectIDs) > 100 || len(req.ChangesetIDs) > 100 || len(req.Fields) > 20 {
			writeProblem(w, http.StatusUnprocessableEntity, "Issue metadata unavailable", "Select a valid issue type and at most 100 entries per field")
			return
		}
		for _, values := range [][]string{req.AssigneeIDs, req.LabelIDs, req.ProjectIDs, req.ChangesetIDs} {
			for _, value := range values {
				if value == "" || len(value) > 128 || !wellFormedText(value) {
					writeProblem(w, http.StatusUnprocessableEntity, "Issue metadata unavailable", "Select valid metadata identifiers")
					return
				}
			}
		}
		if req.MilestoneID != nil && (len(*req.MilestoneID) > 128 || !wellFormedText(*req.MilestoneID)) {
			writeProblem(w, http.StatusUnprocessableEntity, "Issue metadata unavailable", "Select a valid milestone")
			return
		}
		for name, value := range req.Fields {
			if name == "" || strings.TrimSpace(name) != name || utf8.RuneCountInString(name) > 64 || utf8.RuneCountInString(value) > 500 || !wellFormedText(name) || !wellFormedText(value) {
				writeProblem(w, http.StatusUnprocessableEntity, "Issue fields unavailable", "Field names must have 1–64 characters and values at most 500")
				return
			}
		}
		issue.MetadataUpdate = req.MetadataUpdate
	}

	if req.ExpectedUpdatedAt != nil && !req.ExpectedUpdatedAt.Equal(issue.UpdatedAt) {
		writeProblem(w, http.StatusConflict, "Issue changed", "Reload the issue before saving your edits")
		return
	}
	previousUpdate := issue.UpdatedAt
	issue.ExpectedUpdatedAt = &previousUpdate
	issue.EditorID = principal.UserID

	// Apply updates
	if req.Title != nil {
		title := strings.TrimSpace(*req.Title)
		if title == "" || utf8.RuneCountInString(title) > 500 {
			writeProblem(w, http.StatusBadRequest, "Invalid title", "title must not be empty")
			return
		}
		issue.Title = title
	}
	if req.Body != nil {
		if utf8.RuneCountInString(*req.Body) > 65536 {
			writeProblem(w, http.StatusBadRequest, "Invalid body", "Issue body must contain at most 65,536 characters")
			return
		}
		issue.Body = *req.Body
		if strings.TrimSpace(issue.Body) == "" {
			issue.Body = ""
		}
	}

	issue.UpdatedAt = time.Now().UTC()

	updated, err := d.IssueRepo.Update(r.Context(), principal.OrganizationID, issue)
	if errors.Is(err, issues.ErrInvalidMetadata) {
		writeProblem(w, http.StatusUnprocessableEntity, "Issue metadata unavailable", "An assignee, label, milestone, or project is invalid for this repository")
		return
	}
	if errors.Is(err, issues.ErrStateConflict) {
		writeProblem(w, http.StatusConflict, "Issue changed", "Reload the issue before saving your edits")
		return
	}
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
	if errors.Is(err, issues.ErrStateConflict) {
		writeProblem(w, http.StatusConflict, "Issue state changed", "Refresh the issue and try again")
		return
	}
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

	reopened, err := d.IssueRepo.Reopen(r.Context(), principal.OrganizationID, issue.ID, principal.UserID, time.Now().UTC())
	if errors.Is(err, issues.ErrStateConflict) {
		writeProblem(w, http.StatusConflict, "Issue state changed", "Refresh the issue and try again")
		return
	}
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

	// Parse lock reason from request body
	var req lockIssueRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	// Validate lock reason
	lockReason := issues.LockReason(req.Reason)
	if lockReason != issues.LockReasonOffTopic && lockReason != issues.LockReasonTooHeated &&
		lockReason != issues.LockReasonResolved && lockReason != issues.LockReasonSpam {
		writeProblem(w, http.StatusBadRequest, "Invalid lock reason", "reason must be 'off-topic', 'too heated', 'resolved', or 'spam'")
		return
	}

	// Get existing issue
	issue, err := d.IssueRepo.Get(r.Context(), principal.OrganizationID, repository, number)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Issue not found", "No issue exists with this number in the repository")
		return
	}

	// Check if already locked
	if issue.Locked {
		writeProblem(w, http.StatusConflict, "Issue already locked", "This issue is already locked")
		return
	}

	// Lock the issue
	locked, err := d.IssueRepo.Lock(r.Context(), principal.OrganizationID, issue.ID, lockReason, principal.UserID, time.Now().UTC())
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to lock issue", "The issue could not be locked")
		return
	}

	writeJSON(w, http.StatusOK, locked)
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

	// Check if already unlocked
	if !issue.Locked {
		writeProblem(w, http.StatusConflict, "Issue already unlocked", "This issue is already unlocked")
		return
	}

	// Unlock the issue
	unlocked, err := d.IssueRepo.Unlock(r.Context(), principal.OrganizationID, issue.ID, principal.UserID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to unlock issue", "The issue could not be unlocked")
		return
	}

	writeJSON(w, http.StatusOK, unlocked)
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

// getIssueTimeline handles GET /api/v1/organizations/{organizationID}/issues/{number}/timeline
func (d DeliveryDependencies) getIssueTimeline(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.IssueRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Issue tracking unavailable", "The issue repository is not configured")
		return
	}
	if d.EventRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Event tracking unavailable", "The event repository is not configured")
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

	// Get timeline events
	events, err := d.EventRepo.List(r.Context(), principal.OrganizationID, string(issue.ID))
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to retrieve timeline", "The timeline could not be retrieved")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"events": events})
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
