package httpserver

import (
	"net/http"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/reactions"
)

type addReactionRequest struct {
	Content string `json:"content"`
}

// listReactions handles GET /api/v1/organizations/{organizationID}/comments/{id}/reactions
// Also supports reactions on issues via issue_id query parameter
func (d DeliveryDependencies) listReactions(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.ReactionRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Reaction system unavailable", "The reaction repository is not configured")
		return
	}

	// Determine reactable type and ID
	var reactableType reactions.ReactableType
	var reactableID reactions.ID

	commentID := r.PathValue("commentID")
	issueID := r.URL.Query().Get("issue_id")

	if commentID != "" {
		reactableType = reactions.ReactableTypeComment
		reactableID = reactions.ID(commentID)
	} else if issueID != "" {
		reactableType = reactions.ReactableTypeIssue
		reactableID = reactions.ID(issueID)
	} else {
		writeProblem(w, http.StatusBadRequest, "Resource ID required", "Either commentID path parameter or issue_id query parameter is required")
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
// Also supports reactions on issues via issue_id query parameter
func (d DeliveryDependencies) addReaction(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.ReactionRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Reaction system unavailable", "The reaction repository is not configured")
		return
	}

	// Determine reactable type and ID
	var reactableType reactions.ReactableType
	var reactableID reactions.ID

	commentID := r.PathValue("commentID")
	issueID := r.URL.Query().Get("issue_id")

	if commentID != "" {
		reactableType = reactions.ReactableTypeComment
		reactableID = reactions.ID(commentID)
	} else if issueID != "" {
		reactableType = reactions.ReactableTypeIssue
		reactableID = reactions.ID(issueID)
	} else {
		writeProblem(w, http.StatusBadRequest, "Resource ID required", "Either commentID path parameter or issue_id query parameter is required")
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
		if err.Error() == "duplicate reaction" {
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

	// Note: In a production system, you'd want to verify that the user owns this reaction
	// or has admin/owner privileges before allowing deletion. For now, we'll allow deletion
	// but the repository layer should handle authorization.

	err := d.ReactionRepo.Remove(r.Context(), principal.OrganizationID, reactions.ID(reactionID))
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
