package httpserver

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
)

func (d DeliveryDependencies) executionRoutes(mux *http.ServeMux) {
	const base = "/api/v1/organizations/{organizationID}"
	mux.HandleFunc("POST "+base+"/pipelines/{id}/versions/{number}/runs", d.executionRequest)
	mux.HandleFunc("GET "+base+"/pipeline-runs/{run}", d.executionRequest)
	mux.HandleFunc("POST "+base+"/pipeline-runs/{run}/cancel", d.executionRequest)
	mux.HandleFunc("POST "+base+"/pipeline-runs/{run}/rerun", d.executionRequest)
	mux.HandleFunc("POST "+base+"/pipeline-runs/{run}/steps/{step}/decision", d.executionRequest)
	mux.HandleFunc("GET "+base+"/pipeline-runs/{run}/events", d.executionEvents)
	mux.HandleFunc("GET "+base+"/pipeline-runs/{run}/objects", d.pipelineObjects)
	mux.HandleFunc("GET "+base+"/pipeline-runs/{run}/objects/{object}", d.pipelineObjects)

}
func (d DeliveryDependencies) executionRequest(w http.ResponseWriter, r *http.Request) {
	write := r.Method == http.MethodPost
	user, ok := d.principal(w, r, write)
	if !ok {
		return
	}
	if d.Runs == nil {
		writeProblem(w, 503, "Execution unavailable", "Run storage is unavailable")
		return
	}
	var run execution.Run
	var err error
	status := http.StatusOK
	if write && strings.HasSuffix(r.Pattern, "/rerun") {
		run, err = d.Runs.RerunWorkflow(r.Context(), user.OrganizationID, r.PathValue("run"), user.UserID)
		status = http.StatusCreated
	} else if write && r.PathValue("run") != "" {
		outcome := "cancelled"
		step := r.PathValue("step")
		if step != "" {
			if user.Role != "owner" && user.Role != "admin" {
				writeProblem(w, 403, "Approval denied", "An organization owner or admin must decide approval steps")
				return
			}
			var body struct {
				Approved *bool `json:"approved"`
			}
			if !decodeJSON(w, r, &body) {
				return
			}
			if body.Approved == nil {
				writeProblem(w, 400, "Decision required", "Provide approved as a boolean")
				return
			}
			outcome = "failed"
			if *body.Approved {
				outcome = "succeeded"
			}
		}
		err = d.Runs.DecideRun(r.Context(), user.OrganizationID, r.PathValue("run"), step, user.UserID, outcome)
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
	} else if write {
		number, e := strconv.Atoi(r.PathValue("number"))
		if e != nil || number < 1 {
			writeProblem(w, 400, "Invalid version", "Provide a positive published version number")
			return
		}
		var inputs map[string]json.RawMessage
		if !decodeJSON(w, r, &inputs) {
			return
		}
		if inputs == nil {
			writeProblem(w, 400, "Invalid inputs", "Provide an object of runtime parameter values")
			return
		}
		run, err = d.Runs.CreateRun(r.Context(), user.OrganizationID, r.PathValue("id"), number, user.UserID, inputs)
		status = http.StatusCreated
	} else {
		run, err = d.Runs.GetRun(r.Context(), user.OrganizationID, r.PathValue("run"))
	}
	switch {
	case errors.Is(err, execution.ErrRepositoryActionsDisabled):
		writeProblem(w, 403, "Repository Actions disabled", "Enable Actions in repository settings to start new workflow runs")
	case errors.Is(err, execution.ErrInputs):
		writeProblem(w, 400, "Invalid inputs", err.Error())
	case errors.Is(err, pipeline.ErrMissing):
		writeProblem(w, 404, "Not found", "The requested resource does not exist in this organization")
	case errors.Is(err, pipeline.ErrConflict):
		writeProblem(w, 409, "Lifecycle conflict", "Reload the pipeline or run to check its current state")
	case errors.Is(err, execution.ErrTriggerDenied):
		writeProblem(w, 403, "Rerun denied", "Only the original actor can rerun this workflow")
	case errors.Is(err, execution.ErrQuota):
		writeProblem(w, 429, "Execution quota reached", "Wait for an active run to finish")
	case err != nil:
		writeProblem(w, 500, "Execution operation failed", "Run storage could not complete the request")
	default:
		writeJSON(w, status, run)
	}
}

// Each response replays a bounded page. EventSource reconnects with Last-Event-ID and reauthorizes each read.
func (d DeliveryDependencies) executionEvents(w http.ResponseWriter, r *http.Request) {
	user, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.Runs == nil {
		writeProblem(w, 503, "Execution unavailable", "Run storage is unavailable")
		return
	}
	var cursor int64
	var err error
	if value := r.Header.Get("Last-Event-ID"); value != "" {
		cursor, err = strconv.ParseInt(value, 10, 64)
		if err != nil || cursor < 0 {
			writeProblem(w, 400, "Invalid cursor", "Provide a positive event sequence")
			return
		}
	}
	events, err := d.Runs.Events(r.Context(), user.OrganizationID, r.PathValue("run"), cursor)
	if errors.Is(err, pipeline.ErrMissing) {
		writeProblem(w, 404, "Run not found", "Run does not exist in this organization")
		return
	}
	if err != nil {
		writeProblem(w, 500, "Events unavailable", "Could not load events")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	fmt.Fprint(w, "retry: 1500\n\n")
	for _, event := range events {
		raw, e := json.Marshal(event)
		if e != nil {
			return
		}
		if _, err = fmt.Fprintf(w, "id: %d\ndata: %s\n\n", event.Seq, raw); err != nil {
			return
		}
	}
}
