package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

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
		"GET " + base + "/{id}/versions":                           "versions",
		"POST " + base + "/{id}/versions/{number}/validate-inputs": "inputs",
	} {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) { d.pipelineRequest(w, r, action) })
	}
}
func (d DeliveryDependencies) pipelineRequest(w http.ResponseWriter, r *http.Request, action string) {
	principal, ok := d.principal(w, r, r.Method != "GET" && r.Method != "HEAD")
	if !ok {
		return
	}
	if (action == "publish" || action == "archive") && principal.Role != "admin" && principal.Role != "owner" {
		writeProblem(w, 403, "Insufficient permissions", "Only owners and admins can publish or archive pipelines")
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
			result, err = d.Pipelines.ChangePipeline(ctx, org, id, principal.UserID, action, revision, def)
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
