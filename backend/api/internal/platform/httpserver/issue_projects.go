package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

func (d DeliveryDependencies) registerIssueProjects(mux *http.ServeMux) {
	const base = "/api/v1/organizations/{organizationID}/issue-projects"
	mux.HandleFunc("GET "+base, d.listIssueProjects)
	mux.HandleFunc("POST "+base, d.createIssueProject)
	mux.HandleFunc("GET "+base+"/{number}", d.getIssueProject)
	mux.HandleFunc("PATCH "+base+"/{number}", d.patchIssueProject)
	mux.HandleFunc("DELETE "+base+"/{number}", d.deleteIssueProject)
	mux.HandleFunc("GET "+base+"/{number}/items", d.listProjectItems)
	mux.HandleFunc("POST "+base+"/{number}/items", d.addProjectItem)
	mux.HandleFunc("PATCH "+base+"/{number}/items/{itemID}", d.patchProjectItem)
	mux.HandleFunc("DELETE "+base+"/{number}/items/{itemID}", d.deleteProjectItem)
	mux.HandleFunc("POST "+base+"/{number}/items/{itemID}/convert", d.convertProjectItem)
	mux.HandleFunc("GET "+base+"/{number}/updates", d.listProjectUpdates)
	mux.HandleFunc("POST "+base+"/{number}/updates", d.createProjectUpdate)
	mux.HandleFunc("GET "+base+"/{number}/status-history", d.projectStatusHistory)
	d.RegisterProjectFields(mux)
}

func (d DeliveryDependencies) projectPrincipal(w http.ResponseWriter, r *http.Request, admin bool) (Principal, bool) {
	principal, ok := d.principal(w, r, r.Method != http.MethodGet && r.Method != http.MethodHead)
	if !ok {
		return Principal{}, false
	}
	if admin && principal.Role != "owner" && principal.Role != "admin" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization admins and owners can perform this project operation")
		return Principal{}, false
	}
	if d.ProjectRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Projects unavailable", "The project repository is not configured")
		return Principal{}, false
	}
	w.Header().Set("Cache-Control", "no-store")
	return principal, true
}

func projectNumber(w http.ResponseWriter, r *http.Request) (int, bool) {
	number, err := strconv.ParseInt(r.PathValue("number"), 10, 32)
	if err != nil || number <= 0 {
		writeProblem(w, http.StatusBadRequest, "Invalid project number", "The project number must be a positive integer")
		return 0, false
	}
	return int(number), true
}

func projectVersion(w http.ResponseWriter, version int64) bool {
	if version < 1 {
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid version", "Supply the current version as a positive integer")
		return false
	}
	return true
}

func projectQueryVersion(w http.ResponseWriter, r *http.Request) (int64, bool) {
	version, err := strconv.ParseInt(r.URL.Query().Get("version"), 10, 64)
	if err != nil {
		version = 0
	}
	return version, projectVersion(w, version)
}

func projectError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, issues.ErrProjectNameInUse):
		writeProblem(w, http.StatusConflict, "Project name in use", "Choose another name in this scope")
	case errors.Is(err, issues.ErrProjectClosed):
		writeProblem(w, http.StatusConflict, "Project is closed", "Reopen the project before changing its items or posting updates")
	case errors.Is(err, issues.ErrProjectConflict):
		writeProblem(w, http.StatusConflict, "Project version conflict", "Refresh the project or item and try again")
	case errors.Is(err, issues.ErrProjectNotFound), errors.Is(err, issues.ErrDetailNotFound):
		writeProblem(w, http.StatusNotFound, "Project resource not found", "The project, item or source does not exist in this scope")
	case errors.Is(err, issues.ErrProjectInvalid), errors.Is(err, issues.ErrInvalidMetadata):
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid project operation", "The item, dates or repository are not valid for this project operation")
	default:
		writeProblem(w, http.StatusInternalServerError, "Project operation failed", "The project operation could not be completed")
	}
}

func (d DeliveryDependencies) listIssueProjects(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.projectPrincipal(w, r, false)
	if !ok {
		return
	}
	repository := strings.TrimSpace(r.URL.Query().Get("repository"))
	linkedRepository := strings.TrimSpace(r.URL.Query().Get("linked_repository"))
	for _, slug := range []string{repository, linkedRepository} {
		if slug != "" {
			if _, ok := d.resolveRegisteredRepository(w, r, principal, slug); !ok {
				return
			}
		}
	}
	items, err := d.ProjectRepo.ListIssueProjects(r.Context(), principal.OrganizationID, repository, linkedRepository, principal.UserID)
	if err != nil {
		projectError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Items []issues.Project `json:"items"`
	}{Items: items})
}

func validProjectName(name string) bool {
	return name != "" && projectText(name, 100) && !strings.ContainsAny(name, "\r\n\t")
}

func projectText(value string, maxRunes int) bool {
	return wellFormedText(value) && utf8.RuneCountInString(value) <= maxRunes
}

var projectViewID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func validProjectViews(views []issues.ProjectView) bool {
	if len(views) == 0 || len(views) > 30 {
		return false
	}
	seen := make(map[string]bool, len(views))
	for i := range views {
		view := &views[i]
		view.Name = strings.TrimSpace(view.Name)
		if !projectViewID.MatchString(view.ID) || seen[view.ID] || !view.Layout.Valid() ||
			((view.ID != "default" || view.Name != "") && !validProjectName(view.Name)) ||
			!projectText(view.Filter, 200) || strings.ContainsAny(view.Filter, "\r\n") {
			return false
		}
		switch view.Sort {
		case "manual", "title", "priority", "target_date":
		default:
			return false
		}
		switch view.Group {
		case "status", "priority", "none":
		default:
			return false
		}
		seen[view.ID] = true
	}
	return true
}

func (d DeliveryDependencies) validateProjectRepositories(w http.ResponseWriter, r *http.Request, principal Principal, repositories []string) bool {
	if len(repositories) > 100 {
		writeProblem(w, http.StatusUnprocessableEntity, "Too many linked repositories", "Choose at most 100 repositories")
		return false
	}
	seen := make(map[string]bool, len(repositories))
	for i, slug := range repositories {
		slug = strings.TrimSpace(slug)
		if slug == "" || seen[slug] {
			writeProblem(w, http.StatusUnprocessableEntity, "Invalid linked repositories", "Choose distinct repositories")
			return false
		}
		if _, ok := d.resolveRegisteredRepository(w, r, principal, slug); !ok {
			return false
		}
		repositories[i] = slug
		seen[slug] = true
	}
	return true
}

func (d DeliveryDependencies) createIssueProject(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.projectPrincipal(w, r, true)
	if !ok {
		return
	}
	var input struct {
		Name              string               `json:"name"`
		Repository        string               `json:"repository"`
		Layout            issues.ProjectLayout `json:"layout"`
		DefaultRepository string               `json:"default_repository"`
		Template          string               `json:"template"`
		Description       string               `json:"description"`
		Readme            string               `json:"readme"`
		Repositories      []string             `json:"repositories"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	name, repository := strings.TrimSpace(input.Name), strings.TrimSpace(input.Repository)
	if !validProjectName(name) {
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid project name", "Enter a project name of 1 to 100 characters")
		return
	}
	if !projectText(input.Description, 500) || !projectText(input.Readme, 65536) {
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid project text", "Description or README exceeds the allowed length or contains invalid text")
		return
	}
	if repository != "" {
		if _, ok := d.resolveRegisteredRepository(w, r, principal, repository); !ok {
			return
		}
	}
	var initial issues.ProjectLayout
	switch input.Template {
	case "":
		initial = issues.ProjectTable
	case "team_backlog":
		initial = issues.ProjectBoard
	case "release_plan":
		initial = issues.ProjectRoadmap
	default:
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid project template", "Choose team_backlog or release_plan")
		return
	}
	if input.Layout == "" {
		input.Layout = initial
	}
	if !input.Layout.Valid() {
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid project layout", "Choose table, board or roadmap")
		return
	}
	defaultRepository := strings.TrimSpace(input.DefaultRepository)
	if repository != "" && defaultRepository != "" && defaultRepository != repository {
		projectError(w, issues.ErrProjectInvalid)
		return
	}
	if defaultRepository != "" && defaultRepository != repository {
		if _, ok := d.resolveRegisteredRepository(w, r, principal, defaultRepository); !ok {
			return
		}
	}
	if !d.validateProjectRepositories(w, r, principal, input.Repositories) {
		return
	}
	if repository != "" {
		found := false
		for _, slug := range input.Repositories {
			found = found || slug == repository
		}
		if !found {
			input.Repositories = append(input.Repositories, repository)
		}
	}
	id, err := newID()
	if err != nil {
		projectError(w, err)
		return
	}
	group := "none"
	if input.Layout == issues.ProjectBoard {
		group = "status"
	}
	project, err := d.ProjectRepo.CreateIssueProject(r.Context(), principal.OrganizationID, issues.Project{
		ID: id, Name: name, Repository: repository, Layout: input.Layout, DefaultRepository: defaultRepository,
		Description: input.Description, Readme: input.Readme, Repositories: input.Repositories,
		Views: []issues.ProjectView{{ID: "default", Layout: input.Layout, Sort: "manual", Group: group}},
	})
	if err != nil {
		projectError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, project)
}

func (d DeliveryDependencies) getIssueProject(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.projectPrincipal(w, r, false)
	if !ok {
		return
	}
	number, ok := projectNumber(w, r)
	if !ok {
		return
	}
	project, err := d.ProjectRepo.GetIssueProject(r.Context(), principal.OrganizationID, number, principal.UserID)
	if err != nil {
		projectError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, project)
}

func (d DeliveryDependencies) patchIssueProject(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.projectPrincipal(w, r, true)
	if !ok {
		return
	}
	number, ok := projectNumber(w, r)
	if !ok {
		return
	}
	var input issues.ProjectPatch
	var body struct {
		*issues.ProjectPatch
		Views json.RawMessage `json:"views"`
	}
	body.ProjectPatch = &input
	if !decodeJSON(w, r, &body) || !projectVersion(w, input.Version) {
		return
	}
	if input.Name != nil {
		*input.Name = strings.TrimSpace(*input.Name)
		if !validProjectName(*input.Name) {
			writeProblem(w, http.StatusUnprocessableEntity, "Invalid project name", "Enter a project name of 1 to 100 characters")
			return
		}
	}
	if (input.Description != nil && !projectText(*input.Description, 500)) || (input.Readme != nil && !projectText(*input.Readme, 65536)) {
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid project text", "Description or README exceeds the allowed length or contains invalid text")
		return
	}
	if input.Workflows != nil && !input.Workflows.Valid() {
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid project workflows", "Supply valid project status targets for the built-in workflows")
		return
	}
	if body.Views != nil {
		var views []issues.ProjectView
		decoder := json.NewDecoder(strings.NewReader(string(body.Views)))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&views); err != nil || !validProjectViews(views) {
			writeProblem(w, http.StatusUnprocessableEntity, "Invalid project views", "Supply 1 to 30 views with distinct IDs and valid names, layouts, filters, sorts and groups")
			return
		}
		input.Views = &views
	}
	if input.DefaultRepository != nil {
		*input.DefaultRepository = strings.TrimSpace(*input.DefaultRepository)
		if *input.DefaultRepository != "" {
			if _, ok := d.resolveRegisteredRepository(w, r, principal, *input.DefaultRepository); !ok {
				return
			}
		}
	}
	if input.Repositories != nil && !d.validateProjectRepositories(w, r, principal, *input.Repositories) {
		return
	}
	project, err := d.ProjectRepo.PatchIssueProject(r.Context(), principal.OrganizationID, number, principal.UserID, input)
	if err != nil {
		projectError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, project)
}

func (d DeliveryDependencies) deleteIssueProject(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.projectPrincipal(w, r, true)
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
	if err := d.ProjectRepo.DeleteIssueProject(r.Context(), principal.OrganizationID, number, version); err != nil {
		projectError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d DeliveryDependencies) projectStatusHistory(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.projectPrincipal(w, r, false)
	if !ok {
		return
	}
	number, ok := projectNumber(w, r)
	if !ok {
		return
	}
	items, err := d.ProjectRepo.ProjectStatusHistory(r.Context(), principal.OrganizationID, number)
	if err != nil {
		projectError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Items []issues.ProjectStatusDay `json:"items"`
	}{Items: items})
}
