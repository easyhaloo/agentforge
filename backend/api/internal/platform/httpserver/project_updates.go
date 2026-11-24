package httpserver

import (
	"net/http"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

func (d DeliveryDependencies) listProjectUpdates(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.projectPrincipal(w, r, false)
	if !ok {
		return
	}
	number, ok := projectNumber(w, r)
	if !ok {
		return
	}
	items, err := d.ProjectRepo.ListProjectUpdates(r.Context(), principal.OrganizationID, number)
	if err != nil {
		projectError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Items []issues.ProjectUpdate `json:"items"`
	}{Items: items})
}

func (d DeliveryDependencies) createProjectUpdate(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.projectPrincipal(w, r, false)
	if !ok {
		return
	}
	number, ok := projectNumber(w, r)
	if !ok {
		return
	}
	var input issues.ProjectUpdateInput
	if !decodeJSON(w, r, &input) {
		return
	}
	switch input.Status {
	case "on_track", "at_risk", "off_track":
	default:
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid update status", "Use on_track, at_risk or off_track")
		return
	}
	if strings.TrimSpace(input.Body) == "" || !projectText(input.Body, 10000) {
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid update body", "Supply a Markdown body of up to 10,000 characters")
		return
	}
	if !validProjectDate(&input.StartDate) || !validProjectDate(&input.TargetDate) ||
		(input.StartDate != "" && input.TargetDate != "" && input.StartDate > input.TargetDate) {
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid update dates", "Use YYYY-MM-DD and put the start date on or before the target date")
		return
	}
	update, err := d.ProjectRepo.CreateProjectUpdate(r.Context(), principal.OrganizationID, number, principal.UserID, input)
	if err != nil {
		projectError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, update)
}
