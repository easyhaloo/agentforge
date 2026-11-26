package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
)

func (d DeliveryDependencies) pipelineRoutes(mux *http.ServeMux) {
	const base = "/api/v1/organizations/{organizationID}/pipelines"
	for pattern, action := range map[string]string{
		"GET " + base: "list", "POST " + base: "create",
		"GET " + base + "/{id}":                                    "get",
		"PUT " + base + "/{id}/draft":                              "save",
		"POST " + base + "/{id}/publish":                           "publish",
		"POST " + base + "/{id}/archive":                           "archive",
		"POST " + base + "/{id}/disable":                           "disable",
		"POST " + base + "/{id}/enable":                            "enable",
		"GET " + base + "/{id}/versions":                           "versions",
		"POST " + base + "/{id}/versions/{number}/validate-inputs": "inputs",
	} {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) { d.pipelineRequest(w, r, action) })
	}
	mux.HandleFunc("GET "+base+"/{id}/triggers", d.workflowTriggers)
	mux.HandleFunc("POST "+base+"/{id}/triggers", d.workflowTriggers)
	mux.HandleFunc("DELETE "+base+"/{id}/triggers/{binding}", d.workflowTriggers)
}
func (d DeliveryDependencies) pipelineRequest(w http.ResponseWriter, r *http.Request, action string) {
	principal, ok := d.principal(w, r, r.Method != "GET" && r.Method != "HEAD")
	if !ok {
		return
	}
	if (action == "publish" || action == "archive" || action == "disable" || action == "enable") && principal.Role != "admin" && principal.Role != "owner" {
		writeProblem(w, 403, "Insufficient permissions", "Only owners and admins can publish, archive, disable, or enable workflows")
		return
	}
	if d.Pipelines == nil {
		writeProblem(w, 503, "Pipelines unavailable", "Pipeline storage is unavailable")
		return
	}
	ctx, org, id := r.Context(), principal.OrganizationID, r.PathValue("id")
	var result any
	var err error
	status := 200
	switch action {
	case "list":
		var items []pipeline.Summary
		items, err = d.Pipelines.ListPipelines(ctx, org)
		result = map[string]any{"items": items}
	case "get":
		result, err = d.Pipelines.GetPipeline(ctx, org, id)
	case "inputs":
		number, parseErr := strconv.Atoi(r.PathValue("number"))
		if parseErr != nil || number < 1 {
			writeProblem(w, 400, "Invalid version", "Provide a positive published version number")
			return
		}
		var values map[string]json.RawMessage
		if !decodeJSON(w, r, &values) {
			return
		}
		if values == nil {
			writeProblem(w, 400, "Invalid inputs", "Provide an object of runtime parameter values")
			return
		}
		var v pipeline.Version
		v, err = d.Pipelines.PipelineVersion(ctx, org, id, number)
		if err == nil {
			if validation := v.Definition.ValidateInputs(values); validation != nil {
				writeProblem(w, 400, "Invalid inputs", validation.Error())
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
	case "versions":
		var versions []pipeline.Version
		versions, err = d.Pipelines.PipelineVersions(ctx, org, id)
		result = map[string]any{"items": versions}
	default:
		var revision int
		var raw json.RawMessage
		var def *pipeline.Definition
		switch action {
		case "create":
			if !decodeJSON(w, r, &raw) {
				return
			}
			id, err = newID()
			status = 201
		case "save":
			var body struct {
				Revision   int             `json:"revision"`
				Definition json.RawMessage `json:"definition"`
			}
			if !decodeJSON(w, r, &body) {
				return
			}
			revision, raw = body.Revision, body.Definition
			if raw == nil {
				writeProblem(w, 400, "Invalid draft", "Provide a workflow definition")
				return
			}
		default:
			var body struct {
				Revision int `json:"revision"`
			}
			if !decodeJSON(w, r, &body) {
				return
			}
			revision = body.Revision
		}
		if action != "create" && revision < 1 {
			writeProblem(w, 400, "Invalid revision", "Provide the revision being modified")
			return
		}
		if raw != nil && err == nil {
			def, err = pipeline.Decode(raw)
			if err != nil {
				writeProblem(w, 400, "Invalid definition", err.Error())
				return
			}
		}
		if err == nil {
			if slug := r.URL.Query().Get("repository"); action == "create" && slug != "" {
				repository, registered := d.resolveRegisteredRepository(w, r, principal, slug)
				if !registered {
					return
				}
				result, err = d.Pipelines.CreateRepositoryPipeline(ctx, org, id, principal.UserID, repository.Slug, def)
			} else {
				result, err = d.Pipelines.ChangePipeline(ctx, org, id, principal.UserID, action, revision, def)
			}
		}
	}
	switch {
	case errors.Is(err, pipeline.ErrMissing):
		writeProblem(w, 404, "Pipeline not found", "The pipeline does not exist in this organization")
	case errors.Is(err, pipeline.ErrConflict):
		writeProblem(w, 409, "Pipeline changed", "Reload the pipeline and check its revision and status")
	case err != nil:
		writeProblem(w, 500, "Pipeline operation failed", "Pipeline storage could not complete the request")
	default:
		writeJSON(w, status, result)
	}
}

func (d DeliveryDependencies) workflowTriggers(w http.ResponseWriter, r *http.Request) {
	write := r.Method != http.MethodGet
	user, ok := d.principal(w, r, write)
	if !ok {
		return
	}
	if write && user.Role != "owner" && user.Role != "admin" {
		writeProblem(w, 403, "Insufficient permissions", "Only owners and admins can manage workflow triggers")
		return
	}
	store, ok := d.Pipelines.(pipeline.TriggerStore)
	if !ok {
		writeProblem(w, 503, "Triggers unavailable", "Workflow trigger storage is unavailable")
		return
	}
	ctx, org, id := r.Context(), user.OrganizationID, r.PathValue("id")
	var err error
	switch r.Method {
	case http.MethodGet:
		var items []pipeline.TriggerBinding
		items, err = store.WorkflowTriggers(ctx, org, id)
		if err == nil {
			writeJSON(w, http.StatusOK, map[string]any{"items": items})
			return
		}
	case http.MethodPost:
		var body struct {
			Kind         string `json:"kind"`
			Version      int    `json:"version"`
			EverySeconds int    `json:"everySeconds"`
			TagPattern   string `json:"tagPattern"`
		}
		if !decodeJSON(w, r, &body) {
			return
		}
		if body.Version < 1 || !((body.Kind == "schedule" && body.EverySeconds >= 60 && body.EverySeconds <= 86400*365) ||
			(body.Kind == "changeset_revision" && body.EverySeconds == 0) ||
			(body.Kind == "tag" && body.EverySeconds == 0 && pipeline.ValidateTagPattern(body.TagPattern))) {
			writeProblem(w, 400, "Invalid trigger", "Provide a published version and a supported trigger configuration")
			return
		}
		var binding pipeline.TriggerBinding
		binding, err = store.EnableWorkflowTrigger(ctx, org, id, user.UserID, body.Kind, body.TagPattern, body.Version, body.EverySeconds)
		if err == nil {
			writeJSON(w, http.StatusCreated, binding)
			return
		}
	case http.MethodDelete:
		err = store.DisableWorkflowTrigger(ctx, org, id, r.PathValue("binding"))
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}
	switch {
	case errors.Is(err, pipeline.ErrMissing):
		writeProblem(w, 404, "Not found", "The repository workflow, version, or binding does not exist")
	case errors.Is(err, pipeline.ErrConflict):
		writeProblem(w, 409, "Trigger conflict", "Check the workflow and disable existing bindings of this type")
	case errors.Is(err, execution.ErrInputs):
		writeProblem(w, 422, "Defaults required", "Automatic triggers require defaults for all required workflow inputs")
	default:
		writeProblem(w, 500, "Trigger operation failed", "Workflow trigger storage could not complete the request")
	}
}
