package httpserver

import (
	"errors"
	"net/http"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/comments"
	"github.com/easyhaloo/agentforge/backend/api/internal/reactions"
)

type addReactionRequest struct {
	Content string `json:"content"`
}

// listReactions handles GET /api/v1/organizations/{organizationID}/comments/{id}/reactions
// Also serves issue reactions by repository and number.
func (d DeliveryDependencies) listReactions(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.ReactionRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Reaction system unavailable", "The reaction repository is not configured")
		return
	}

	reactableType, reactableID, ok := d.reactionTarget(w, r, principal)
	if !ok {
		return
	}

	reactionsList, err := d.ReactionRepo.List(r.Context(), principal.OrganizationID, reactableType, reactableID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to list reactions", "The reaction query failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"items": reactionsList})
}

// addReaction handles POST /api/v1/organizations/{organizationID}/comments/{id}/reactions
// Also serves issue reactions by repository and number.
func (d DeliveryDependencies) addReaction(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.ReactionRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Reaction system unavailable", "The reaction repository is not configured")
		return
	}

	reactableType, reactableID, ok := d.reactionTarget(w, r, principal)
	if !ok {
		return
	}

	var req addReactionRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	// Validate content
	content := reactions.Content(req.Content)
	if !isValidReactionContent(content) {
		writeProblem(w, http.StatusBadRequest, "Invalid reaction", "content must be one of: +1, -1, laugh, confused, heart, hooray, rocket, eyes")
		return
	}

	id, err := newID()
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to add reaction", "An identifier could not be generated")
		return
	}

	reaction := &reactions.Reaction{
		ID:            reactions.ID(id),
		ReactableType: reactableType,
		ReactableID:   reactableID,
		UserID:        principal.UserID,
		Content:       content,
		CreatedAt:     time.Now().UTC(),
	}

	created, err := d.ReactionRepo.Add(r.Context(), principal.OrganizationID, reaction)
	if err != nil {
		// Check if it's a duplicate (user already reacted with this emoji)
		if errors.Is(err, reactions.ErrDuplicate) {
			writeProblem(w, http.StatusConflict, "Duplicate reaction", "You have already reacted with this emoji")
			return
		}
		writeProblem(w, http.StatusInternalServerError, "Unable to add reaction", "The reaction could not be persisted")
		return
	}

	writeJSON(w, http.StatusCreated, created)
}

// removeReaction handles DELETE /api/v1/organizations/{organizationID}/comments/{commentID}/reactions/{reactionID}
func (d DeliveryDependencies) removeReaction(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.ReactionRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Reaction system unavailable", "The reaction repository is not configured")
		return
	}

	reactionID := r.PathValue("reactionID")
	if reactionID == "" {
		writeProblem(w, http.StatusBadRequest, "Reaction ID required", "reactionID path parameter is required")
		return
	}

	reactableType, reactableID, ok := d.reactionTarget(w, r, principal)
	if !ok {
		return
	}
	err := d.ReactionRepo.RemoveOwn(r.Context(), principal.OrganizationID, reactableType, reactableID, reactions.ID(reactionID), principal.UserID)
	if errors.Is(err, reactions.ErrNotFound) {
		writeProblem(w, http.StatusNotFound, "Reaction not found", "No reaction owned by you matches this target")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to remove reaction", "The reaction could not be removed")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// isValidReactionContent checks if the reaction content is one of the supported emojis
func isValidReactionContent(content reactions.Content) bool {
	switch content {
	case reactions.ContentThumbsUp, reactions.ContentThumbsDown,
		reactions.ContentLaugh, reactions.ContentConfused,
		reactions.ContentHeart, reactions.ContentHooray,
		reactions.ContentRocket, reactions.ContentEyes:
		return true
	default:
		return false
	}
}

func (d DeliveryDependencies) reactionTarget(w http.ResponseWriter, r *http.Request, principal Principal) (reactions.ReactableType, reactions.ID, bool) {
	if commentID := r.PathValue("commentID"); commentID != "" {
		if d.CommentRepo == nil {
			writeProblem(w, http.StatusServiceUnavailable, "Comment system unavailable", "The comment repository is not configured")
			return "", "", false
		}
		if _, err := d.CommentRepo.Get(r.Context(), principal.OrganizationID, comments.ID(commentID)); err != nil {
			writeProblem(w, http.StatusNotFound, "Comment not found", "No comment exists with this ID")
			return "", "", false
		}
		return reactions.ReactableTypeComment, reactions.ID(commentID), true
	}
	issue, ok := d.conversationIssue(w, r, principal)
	if !ok {
		return "", "", false
	}
	return reactions.ReactableTypeIssue, reactions.ID(issue.ID), true
}
