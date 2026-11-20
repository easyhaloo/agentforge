package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/tasks"
)

// taskExecutionRoutes registers routes for the general-purpose task execution subsystem.
// This is distinct from pipeline execution routes (which use /pipeline-runs).
func (d DeliveryDependencies) taskExecutionRoutes(mux *http.ServeMux) {
	const base = "/api/v1/organizations/{organizationID}"
	mux.HandleFunc("POST "+base+"/executions", d.createExecution)
	mux.HandleFunc("GET "+base+"/executions", d.listExecutions)
	mux.HandleFunc("GET "+base+"/executions/{executionID}", d.getExecution)
	mux.HandleFunc("POST "+base+"/executions/{executionID}/cancel", d.cancelExecution)
	mux.HandleFunc("GET "+base+"/executions/{executionID}/tasks", d.listTasks)
	mux.HandleFunc("GET "+base+"/executions/{executionID}/events", d.getExecutionEvents)
}

func (d DeliveryDependencies) createExecution(w http.ResponseWriter, r *http.Request) {
	user, ok := d.principal(w, r, true)
	if !ok {
		return
	}

	if d.Tasks == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Execution unavailable", "Task execution subsystem is not configured")
		return
	}

	var body struct {
		Kind     string          `json:"kind"`
		Payload  json.RawMessage `json:"payload"`
		Deadline *time.Time      `json:"deadline,omitempty"`
	}

	if !decodeJSON(w, r, &body) {
		return
	}

	if body.Kind == "" {
		writeProblem(w, http.StatusBadRequest, "Invalid kind", "Execution kind is required")
		return
	}

	kind := tasks.ExecutionKind(body.Kind)
	if kind != tasks.KindEvaluation && kind != tasks.KindGitOperation && kind != tasks.KindAgentTask {
		writeProblem(w, http.StatusBadRequest, "Invalid kind", "Kind must be one of: evaluation, git_operation, agent_task")
		return
	}

	if body.Payload == nil {
		writeProblem(w, http.StatusBadRequest, "Invalid payload", "Execution payload is required")
		return
	}

	deadline := time.Now().Add(30 * time.Minute)
	if body.Deadline != nil {
		deadline = *body.Deadline
	}

	req := tasks.CreateExecutionRequest{
		OrganizationID: user.OrganizationID,
		Kind:           kind,
		Payload:        body.Payload,
		Deadline:       deadline,
	}

	execution, err := d.Tasks.CreateExecution(r.Context(), req)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Execution creation failed", err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, execution)
}

func (d DeliveryDependencies) getExecution(w http.ResponseWriter, r *http.Request) {
	user, ok := d.principal(w, r, false)
	if !ok {
		return
	}

	if d.Tasks == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Execution unavailable", "Task execution subsystem is not configured")
		return
	}

	executionID := r.PathValue("executionID")
	if executionID == "" {
		writeProblem(w, http.StatusBadRequest, "Missing execution ID", "Execution ID is required")
		return
	}

	execution, err := d.Tasks.GetExecution(r.Context(), user.OrganizationID, executionID)
	if errors.Is(err, tasks.ErrExecutionNotFound) {
		writeProblem(w, http.StatusNotFound, "Execution not found", "The requested execution does not exist")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to retrieve execution", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, execution)
}

func (d DeliveryDependencies) listExecutions(w http.ResponseWriter, r *http.Request) {
	user, ok := d.principal(w, r, false)
	if !ok {
		return
	}

	if d.Tasks == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Execution unavailable", "Task execution subsystem is not configured")
		return
	}

	limit := 20
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	offset := 0
	if offsetStr := r.URL.Query().Get("offset"); offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	executions, total, err := d.Tasks.ListExecutions(r.Context(), user.OrganizationID, limit, offset)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to list executions", err.Error())
		return
	}

	response := struct {
		Items  []tasks.Execution `json:"items"`
		Total  int               `json:"total"`
		Limit  int               `json:"limit"`
		Offset int               `json:"offset"`
	}{
		Items:  executions,
		Total:  total,
		Limit:  limit,
		Offset: offset,
	}

	writeJSON(w, http.StatusOK, response)
}

func (d DeliveryDependencies) cancelExecution(w http.ResponseWriter, r *http.Request) {
	user, ok := d.principal(w, r, true)
	if !ok {
		return
	}

	if d.Tasks == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Execution unavailable", "Task execution subsystem is not configured")
		return
	}

	executionID := r.PathValue("executionID")
	if executionID == "" {
		writeProblem(w, http.StatusBadRequest, "Missing execution ID", "Execution ID is required")
		return
	}

	err := d.Tasks.CancelExecution(r.Context(), user.OrganizationID, executionID, user.UserID)
	if errors.Is(err, tasks.ErrExecutionNotFound) {
		writeProblem(w, http.StatusNotFound, "Execution not found", "The requested execution does not exist or is already completed")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to cancel execution", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (d DeliveryDependencies) listTasks(w http.ResponseWriter, r *http.Request) {
	user, ok := d.principal(w, r, false)
	if !ok {
		return
	}

	if d.Tasks == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Execution unavailable", "Task execution subsystem is not configured")
		return
	}

	executionID := r.PathValue("executionID")
	if executionID == "" {
		writeProblem(w, http.StatusBadRequest, "Missing execution ID", "Execution ID is required")
		return
	}

	taskList, err := d.Tasks.ListTasks(r.Context(), user.OrganizationID, executionID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to list tasks", err.Error())
		return
	}

	response := struct {
		Items []tasks.Task `json:"items"`
	}{
		Items: taskList,
	}

	writeJSON(w, http.StatusOK, response)
}

func (d DeliveryDependencies) getExecutionEvents(w http.ResponseWriter, r *http.Request) {
	user, ok := d.principal(w, r, false)
	if !ok {
		return
	}

	if d.Tasks == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Execution unavailable", "Task execution subsystem is not configured")
		return
	}

	executionID := r.PathValue("executionID")
	if executionID == "" {
		writeProblem(w, http.StatusBadRequest, "Missing execution ID", "Execution ID is required")
		return
	}

	// Verify execution exists and user has access
	_, err := d.Tasks.GetExecution(r.Context(), user.OrganizationID, executionID)
	if errors.Is(err, tasks.ErrExecutionNotFound) {
		writeProblem(w, http.StatusNotFound, "Execution not found", "The requested execution does not exist")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to retrieve execution", err.Error())
		return
	}

	afterSeq := int64(0)
	if seqStr := r.Header.Get("Last-Event-ID"); seqStr != "" {
		if seq, err := strconv.ParseInt(seqStr, 10, 64); err == nil && seq >= 0 {
			afterSeq = seq
		}
	}

	events, err := d.Tasks.GetExecutionEvents(r.Context(), executionID, afterSeq)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Failed to retrieve events", err.Error())
		return
	}

	// Return as SSE stream
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Write([]byte("retry: 1500\n\n"))

	for _, event := range events {
		data, _ := json.Marshal(event)
		w.Write([]byte("id: " + strconv.FormatInt(event.Seq, 10) + "\n"))
		w.Write([]byte("data: " + string(data) + "\n\n"))
	}
}
