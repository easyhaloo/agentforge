package httpserver

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

func (d DeliveryDependencies) listIssueProjects(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.ProjectRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Projects unavailable", "The project repository is not configured")
		return
	}
	repository := strings.TrimSpace(r.URL.Query().Get("repository"))
	if repository != "" {
		if _, ok := d.resolveRegisteredRepository(w, r, principal, repository); !ok {
			return
		}
	}
	items, err := d.ProjectRepo.ListIssueProjects(r.Context(), principal.OrganizationID, repository, principal.UserID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to list projects", "The project query failed")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, struct {
		Items []issues.Project `json:"items"`
	}{Items: items})
}

func (d DeliveryDependencies) createIssueProject(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if principal.Role != "owner" && principal.Role != "admin" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization admins and owners can create projects")
		return
	}
	if d.ProjectRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Projects unavailable", "The project repository is not configured")
		return
	}
	var input struct {
		Name       string `json:"name"`
		Repository string `json:"repository,omitempty"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	name, repository := strings.TrimSpace(input.Name), strings.TrimSpace(input.Repository)
	if name == "" || !wellFormedText(name) || strings.ContainsAny(name, "\r\n\t") || utf8.RuneCountInString(name) > 100 {
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid project name", "Enter a project name of 1 to 100 characters")
		return
	}
	if repository != "" {
		if _, ok := d.resolveRegisteredRepository(w, r, principal, repository); !ok {
			return
		}
	}
	id, err := newID()
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to create project", "An identifier could not be generated")
		return
	}
	project := issues.Project{ID: id, Name: name, Repository: repository}
	project.Number, err = d.ProjectRepo.CreateIssueProject(r.Context(), principal.OrganizationID, project)
	if errors.Is(err, issues.ErrProjectNameInUse) {
		writeProblem(w, http.StatusConflict, "Project name in use", "Choose another name in this scope")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to create project", "The project could not be persisted")
		return
	}
	writeJSON(w, http.StatusCreated, project)
}
