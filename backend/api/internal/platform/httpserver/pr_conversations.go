package httpserver

import (
	"errors"
	"net/http"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
)

func (d DeliveryDependencies) setPRCommentResolution(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	var input struct {
		Resolved *bool `json:"resolved"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.Resolved == nil {
		writeProblem(w, http.StatusBadRequest, "Resolution required", "Supply a boolean resolved value")
		return
	}
	unlock, ok := d.lockChangeset(w, r, principal.OrganizationID)
	if !ok {
		return
	}
	defer unlock()
	stored, ok := d.load(w, r, principal.OrganizationID)
	if !ok {
		return
	}
	changed, err := stored.Changeset.SetPRCommentResolution(delivery.ID(r.PathValue("commentID")), principal.UserID, *input.Resolved, time.Now().UTC())
	if errors.Is(err, delivery.ErrNotFound) {
		writeProblem(w, http.StatusNotFound, "Inline conversation not found", "The pull request does not contain this inline conversation")
		return
	}
	if err != nil {
		writeDeliveryError(w, err)
		return
	}
	if changed {
		stored, err = d.Repository.Update(r.Context(), principal.OrganizationID, stored.Changeset, stored.Version)
		if err != nil {
			writeRepositoryError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, toChangesetResponse(stored))
}

func writeUnresolvedConversations(w http.ResponseWriter) {
	writeProblem(w, http.StatusConflict, "Unresolved pull request conversations", githttp.ErrUnresolvedConversations.Error())
}
