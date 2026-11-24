package httpserver

import (
	"net/http"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

func (d DeliveryDependencies) listProjectItems(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.projectPrincipal(w, r, false)
	if !ok {
		return
	}
	number, ok := projectNumber(w, r)
	if !ok {
		return
	}
	archived := r.URL.Query().Get("archived")
	if archived != "" && archived != "true" && archived != "false" {
		writeProblem(w, http.StatusBadRequest, "Invalid archive filter", "Use true or false for archived")
		return
	}
	items, err := d.ProjectRepo.ListProjectItems(r.Context(), principal.OrganizationID, number, archived == "true")
	if err != nil {
		projectError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Items []issues.ProjectItem `json:"items"`
	}{Items: items})
}

func validProjectItemInput(input issues.ProjectItemInput) bool {
	if !validProjectItemPatch(issues.ProjectItemPatch{Status: input.Status, Priority: input.Priority}) {
		return false
	}
	switch input.Kind {
	case "draft":
		return input.Title != "" && projectText(input.Title, 500) && input.Repository == "" && input.Number == 0 && input.SourceID == ""
	case "issue":
		return input.Repository != "" && input.Number > 0 && input.Title == "" && input.SourceID == ""
	case "pull_request":
		return input.Repository != "" && input.Number == 0 && input.Title == "" && input.SourceID != "" && projectText(input.SourceID, 128)
	}
	return false
}

func (d DeliveryDependencies) addProjectItem(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.projectPrincipal(w, r, false)
	if !ok {
		return
	}
	number, ok := projectNumber(w, r)
	if !ok {
		return
	}
	var input issues.ProjectItemInput
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	input.Repository = strings.TrimSpace(input.Repository)
	if !validProjectItemInput(input) {
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid project item", "Supply a draft title, an issue repository and number or a pull request repository and source ID, with an optional valid status and priority")
		return
	}
	if input.Repository != "" {
		if _, ok := d.resolveRegisteredRepository(w, r, principal, input.Repository); !ok {
			return
		}
	}
	item, created, err := d.ProjectRepo.AddProjectItem(r.Context(), principal.OrganizationID, number, input)
	if err != nil {
		projectError(w, err)
		return
	}
	status := http.StatusCreated
	if !created {
		status = http.StatusOK
	}
	writeJSON(w, status, item)
}

func validProjectDate(date *string) bool {
	if date == nil || *date == "" {
		return true
	}
	parsed, err := time.Parse(time.DateOnly, *date)
	return err == nil && parsed.Year() > 0 && parsed.Format(time.DateOnly) == *date
}

func validProjectItemPatch(patch issues.ProjectItemPatch) bool {
	if patch.Status != nil {
		switch *patch.Status {
		case "todo", "in_progress", "done":
		default:
			return false
		}
	}
	if patch.Priority != nil {
		switch *patch.Priority {
		case "", "p0", "p1", "p2":
		default:
			return false
		}
	}
	return (patch.Title == nil || (*patch.Title != "" && projectText(*patch.Title, 500))) &&
		(patch.Iteration == nil || projectText(*patch.Iteration, 100)) && validProjectDate(patch.StartDate) && validProjectDate(patch.TargetDate)
}

func (d DeliveryDependencies) patchProjectItem(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.projectPrincipal(w, r, false)
	if !ok {
		return
	}
	number, ok := projectNumber(w, r)
	if !ok {
		return
	}
	var input issues.ProjectItemPatch
	if !decodeJSON(w, r, &input) || !projectVersion(w, input.Version) {
		return
	}
	if input.Title != nil {
		*input.Title = strings.TrimSpace(*input.Title)
	}
	if !validProjectItemPatch(input) {
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid project item fields", "Check the title, status, priority, iteration or dates")
		return
	}
	item, err := d.ProjectRepo.PatchProjectItem(r.Context(), principal.OrganizationID, number, r.PathValue("itemID"), input)
	if err != nil {
		projectError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (d DeliveryDependencies) deleteProjectItem(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.projectPrincipal(w, r, false)
	if !ok {
		return
	}
	number, ok := projectNumber(w, r)
	if !ok {
		return
	}
	version, ok := projectQueryVersion(w, r)
	if !ok {
		return
	}
	if err := d.ProjectRepo.DeleteProjectItem(r.Context(), principal.OrganizationID, number, r.PathValue("itemID"), version); err != nil {
		projectError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d DeliveryDependencies) convertProjectItem(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.projectPrincipal(w, r, true)
	if !ok {
		return
	}
	number, ok := projectNumber(w, r)
	if !ok {
		return
	}
	var input struct {
		Repository string `json:"repository"`
		Version    int64  `json:"version"`
	}
	if !decodeJSON(w, r, &input) || !projectVersion(w, input.Version) {
		return
	}
	input.Repository = strings.TrimSpace(input.Repository)
	if _, ok := d.resolveRegisteredRepository(w, r, principal, input.Repository); !ok {
		return
	}
	id, err := newID()
	if err != nil {
		projectError(w, err)
		return
	}
	now := time.Now().UTC()
	item, err := d.ProjectRepo.ConvertProjectItem(r.Context(), principal.OrganizationID, number, r.PathValue("itemID"), input.Version, &issues.Issue{
		ID: issues.ID(id), Repository: input.Repository, State: issues.StateOpen, CreatedBy: principal.UserID, CreatedAt: now, UpdatedAt: now,
	})
	if err != nil {
		projectError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}
