package httpserver

import (
	"context"
	"errors"
	"net/http"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/google/uuid"
)

type projectFieldsRepository interface {
	ListProjectFields(context.Context, string, int) (issues.ProjectFieldDefinitions, error)
	SaveProjectField(context.Context, string, int, string, issues.ProjectFieldInput) (issues.ProjectFieldDefinitions, error)
	DeleteProjectField(context.Context, string, int, string, int64) (issues.ProjectFieldDefinitions, error)
	ListProjectFieldValues(context.Context, string, int, string) (issues.ProjectFieldValues, error)
	PutProjectFieldValue(context.Context, string, int, string, string, issues.ProjectFieldValueInput) (issues.ProjectFieldValues, error)
}

// RegisterProjectFields attaches the sidecar to the same mux as the other
// project routes so it inherits session, CSRF and origin middleware.
func (d DeliveryDependencies) RegisterProjectFields(mux *http.ServeMux) {
	const base = "/api/v1/organizations/{organizationID}/issue-projects/{number}"
	mux.HandleFunc("GET "+base+"/fields", d.projectFieldDefinitions)
	mux.HandleFunc("POST "+base+"/fields", d.projectFieldDefinitions)
	mux.HandleFunc("PATCH "+base+"/fields/{fieldID}", d.projectFieldDefinitions)
	mux.HandleFunc("DELETE "+base+"/fields/{fieldID}", d.projectFieldDefinitions)
	mux.HandleFunc("GET "+base+"/items/{itemID}/field-values", d.projectFieldValues)
	mux.HandleFunc("PUT "+base+"/items/{itemID}/field-values/{fieldID}", d.projectFieldValues)
}

func (d DeliveryDependencies) projectFieldsContext(w http.ResponseWriter, r *http.Request, admin bool) (projectFieldsRepository, string, int, bool) {
	principal, ok := d.projectPrincipal(w, r, admin)
	if !ok {
		return nil, "", 0, false
	}
	repo, ok := d.ProjectRepo.(projectFieldsRepository)
	if !ok {
		writeProblem(w, http.StatusServiceUnavailable, "Custom fields unavailable", "The project fields repository is not configured")
		return nil, "", 0, false
	}
	number, ok := projectNumber(w, r)
	return repo, principal.OrganizationID, number, ok
}

func projectFieldError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, issues.ErrProjectFieldNameInUse):
		writeProblem(w, http.StatusConflict, "Field name already in use", "Choose a different name for this custom field")
	case errors.Is(err, issues.ErrProjectFieldOptionUsed):
		writeProblem(w, http.StatusConflict, "Field option is in use", "Clear item values for this option before removing it")
	case errors.Is(err, issues.ErrProjectItemArchived):
		writeProblem(w, http.StatusConflict, "Project item is archived", "Restore this item before changing custom field values")
	default:
		projectError(w, err)
	}
}

func (d DeliveryDependencies) projectFieldDefinitions(w http.ResponseWriter, r *http.Request) {
	repo, org, number, ok := d.projectFieldsContext(w, r, r.Method != http.MethodGet && r.Method != http.MethodHead)
	if !ok {
		return
	}
	fieldID := r.PathValue("fieldID")
	if fieldID != "" && uuid.Validate(fieldID) != nil {
		projectFieldError(w, issues.ErrProjectNotFound)
		return
	}
	var result issues.ProjectFieldDefinitions
	var err error
	status := http.StatusOK
	switch r.Method {
	case http.MethodPost, http.MethodPatch:
		var input issues.ProjectFieldInput
		if !decodeJSON(w, r, &input) {
			return
		}
		result, err = repo.SaveProjectField(r.Context(), org, number, fieldID, input)
		if r.Method == http.MethodPost {
			status = http.StatusCreated
		}
	case http.MethodDelete:
		version, valid := projectQueryVersion(w, r)
		if !valid {
			return
		}
		result, err = repo.DeleteProjectField(r.Context(), org, number, fieldID, version)
	default:
		result, err = repo.ListProjectFields(r.Context(), org, number)
	}
	if err != nil {
		projectFieldError(w, err)
		return
	}
	writeJSON(w, status, result)
}

func (d DeliveryDependencies) projectFieldValues(w http.ResponseWriter, r *http.Request) {
	repo, org, number, ok := d.projectFieldsContext(w, r, false)
	if !ok {
		return
	}
	itemID, fieldID := r.PathValue("itemID"), r.PathValue("fieldID")
	var result issues.ProjectFieldValues
	var err error
	if r.Method == http.MethodPut {
		if uuid.Validate(fieldID) != nil {
			projectFieldError(w, issues.ErrProjectNotFound)
			return
		}
		var input issues.ProjectFieldValueInput
		if !decodeJSON(w, r, &input) || !projectVersion(w, input.ItemVersion) {
			return
		}
		result, err = repo.PutProjectFieldValue(r.Context(), org, number, itemID, fieldID, input)
	} else {
		result, err = repo.ListProjectFieldValues(r.Context(), org, number, itemID)
	}
	if err != nil {
		projectFieldError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
