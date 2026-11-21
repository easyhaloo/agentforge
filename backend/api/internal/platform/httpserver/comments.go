package httpserver

import (
	"net/http"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/comments"
)

type createCommentRequest struct {
	Body string `json:"body"`
}

type updateCommentRequest struct {
	Body string `json:"body"`
}

type minimizeCommentRequest struct {
	Reason string `json:"reason"`
}

// listComments handles GET /api/v1/organizations/{organizationID}/issues/{number}/comments
func (d DeliveryDependencies) listComments(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.CommentRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Comment system unavailable", "The comment repository is not configured")
		return
	}

	// Get issue ID from query or path
	issueID := r.URL.Query().Get("issue_id")
	if issueID == "" {
		writeProblem(w, http.StatusBadRequest, "Issue ID required", "issue_id query parameter is required")
		return
	}

	commentsList, err := d.CommentRepo.List(r.Context(), principal.OrganizationID, comments.ResourceTypeIssue, comments.ID(issueID))
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to list comments", "The comment query failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"items": commentsList})
}

// createComment handles POST /api/v1/organizations/{organizationID}/issues/{number}/comments
func (d DeliveryDependencies) createComment(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.CommentRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Comment system unavailable", "The comment repository is not configured")
		return
	}

	issueID := r.URL.Query().Get("issue_id")
	if issueID == "" {
		writeProblem(w, http.StatusBadRequest, "Issue ID required", "issue_id query parameter is required")
		return
	}

	var req createCommentRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" {
		writeProblem(w, http.StatusBadRequest, "Body required", "comment body must not be empty")
		return
	}

	id, err := newID()
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to create comment", "An identifier could not be generated")
		return
	}

	now := time.Now().UTC()
	comment := &comments.Comment{
		ID:           comments.ID(id),
		ResourceType: comments.ResourceTypeIssue,
		ResourceID:   comments.ID(issueID),
		Body:         req.Body,
		AuthorID:     principal.UserID,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	created, err := d.CommentRepo.Create(r.Context(), principal.OrganizationID, comment)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to create comment", "The comment could not be persisted")
		return
	}

	writeJSON(w, http.StatusCreated, created)
}

// getComment handles GET /api/v1/organizations/{organizationID}/comments/{id}
func (d DeliveryDependencies) getComment(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.CommentRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Comment system unavailable", "The comment repository is not configured")
		return
	}

	commentID := r.PathValue("commentID")
	if commentID == "" {
		writeProblem(w, http.StatusBadRequest, "Comment ID required", "commentID path parameter is required")
		return
	}

	comment, err := d.CommentRepo.Get(r.Context(), principal.OrganizationID, comments.ID(commentID))
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Comment not found", "No comment exists with this ID")
		return
	}

	writeJSON(w, http.StatusOK, comment)
}

// updateComment handles PATCH /api/v1/organizations/{organizationID}/comments/{id}
func (d DeliveryDependencies) updateComment(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.CommentRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Comment system unavailable", "The comment repository is not configured")
		return
	}

	commentID := r.PathValue("commentID")
	if commentID == "" {
		writeProblem(w, http.StatusBadRequest, "Comment ID required", "commentID path parameter is required")
		return
	}

	var req updateCommentRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" {
		writeProblem(w, http.StatusBadRequest, "Body required", "comment body must not be empty")
		return
	}

	// Get existing comment
	comment, err := d.CommentRepo.Get(r.Context(), principal.OrganizationID, comments.ID(commentID))
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Comment not found", "No comment exists with this ID")
		return
	}

	// Check permissions: only the author, admin, or owner can update
	if !d.canModifyComment(principal, comment) {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only the comment author, admins, or owners can update this comment")
		return
	}

	comment.Body = req.Body
	now := time.Now().UTC()
	comment.EditedAt = &now
	comment.UpdatedAt = now

	updated, err := d.CommentRepo.Update(r.Context(), principal.OrganizationID, comment)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to update comment", "The comment could not be updated")
		return
	}

	writeJSON(w, http.StatusOK, updated)
}

// deleteComment handles DELETE /api/v1/organizations/{organizationID}/comments/{id}
func (d DeliveryDependencies) deleteComment(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.CommentRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Comment system unavailable", "The comment repository is not configured")
		return
	}

	commentID := r.PathValue("commentID")
	if commentID == "" {
		writeProblem(w, http.StatusBadRequest, "Comment ID required", "commentID path parameter is required")
		return
	}

	// Get existing comment
	comment, err := d.CommentRepo.Get(r.Context(), principal.OrganizationID, comments.ID(commentID))
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Comment not found", "No comment exists with this ID")
		return
	}

	// Check permissions: only the author, admin, or owner can delete
	if !d.canModifyComment(principal, comment) {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only the comment author, admins, or owners can delete this comment")
		return
	}

	err = d.CommentRepo.Delete(r.Context(), principal.OrganizationID, comments.ID(commentID))
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to delete comment", "The comment could not be deleted")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// minimizeComment handles POST /api/v1/organizations/{organizationID}/comments/{id}/minimize
func (d DeliveryDependencies) minimizeComment(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}

	// Only admins and owners can minimize comments
	if principal.Role != "admin" && principal.Role != "owner" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization admins and owners can minimize comments")
		return
	}

	if d.CommentRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Comment system unavailable", "The comment repository is not configured")
		return
	}

	commentID := r.PathValue("commentID")
	if commentID == "" {
		writeProblem(w, http.StatusBadRequest, "Comment ID required", "commentID path parameter is required")
		return
	}

	var req minimizeCommentRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	// Validate reason
	reason := comments.MinimizedReason(req.Reason)
	if reason != comments.ReasonSpam && reason != comments.ReasonOffTopic &&
		reason != comments.ReasonOutdated && reason != comments.ReasonResolved {
		writeProblem(w, http.StatusBadRequest, "Invalid reason", "reason must be 'spam', 'off-topic', 'outdated', or 'resolved'")
		return
	}

	minimized, err := d.CommentRepo.Minimize(r.Context(), principal.OrganizationID, comments.ID(commentID), reason)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to minimize comment", "The comment could not be minimized")
		return
	}

	writeJSON(w, http.StatusOK, minimized)
}

// unminimizeComment handles DELETE /api/v1/organizations/{organizationID}/comments/{id}/minimize
func (d DeliveryDependencies) unminimizeComment(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}

	// Only admins and owners can unminimize comments
	if principal.Role != "admin" && principal.Role != "owner" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization admins and owners can unminimize comments")
		return
	}

	if d.CommentRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Comment system unavailable", "The comment repository is not configured")
		return
	}

	commentID := r.PathValue("commentID")
	if commentID == "" {
		writeProblem(w, http.StatusBadRequest, "Comment ID required", "commentID path parameter is required")
		return
	}

	unminimized, err := d.CommentRepo.Unminimize(r.Context(), principal.OrganizationID, comments.ID(commentID))
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to unminimize comment", "The comment could not be unminimized")
		return
	}

	writeJSON(w, http.StatusOK, unminimized)
}

// canModifyComment checks if the principal can modify the given comment
func (d DeliveryDependencies) canModifyComment(principal Principal, comment *comments.Comment) bool {
	// Admin and owner have full access
	if principal.Role == "admin" || principal.Role == "owner" {
		return true
	}
	// Author can modify their own comments
	if principal.UserID == comment.AuthorID {
		return true
	}
	return false
}
