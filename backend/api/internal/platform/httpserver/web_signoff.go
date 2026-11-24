package httpserver

import (
	"net/http"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

func (d DeliveryDependencies) webCommitSignoff(w http.ResponseWriter, r *http.Request, principal Principal, required, consent bool) (delivery.WebCommitSignoff, bool) {
	if !consent {
		if required {
			writeProblem(w, http.StatusUnprocessableEntity, "Web commit sign-off required", "Confirm the Developer Certificate of Origin before committing in the WebIDE")
		}
		return delivery.WebCommitSignoff{}, !required
	}
	if principal.UserID == "" || d.Settings == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Contributor identity unavailable", "The contribution cannot be signed off without an authenticated account")
		return delivery.WebCommitSignoff{}, false
	}
	profile, err := d.Settings.GetUserProfile(r.Context(), principal.UserID)
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Contributor identity unavailable", "The authenticated contributor's profile could not be loaded")
		return delivery.WebCommitSignoff{}, false
	}
	return delivery.NewWebCommitSignoff(principal.UserID, profile.Username), true
}
