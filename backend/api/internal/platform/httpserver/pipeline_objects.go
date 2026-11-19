package httpserver

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/easyhaloo/agentforge/backend/api/internal/artifact"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
)

type pipelineObjectReader interface {
	ListPipelineObjects(context.Context, string, string, int64) ([]artifact.Record, error)
	ReadPipelineObject(context.Context, string, string, int64) (artifact.Record, []byte, error)
}

func (d DeliveryDependencies) pipelineObjects(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	store, ok := d.Runs.(pipelineObjectReader)
	if !ok {
		writeProblem(w, 503, "Storage unavailable", "Pipeline object storage is unavailable")
		return
	}
	run := r.PathValue("run")
	var err error
	if raw := r.PathValue("object"); raw != "" {
		id, e := strconv.ParseInt(raw, 10, 64)
		if e != nil || id < 1 {
			writeProblem(w, 400, "Invalid object ID", "Provide a positive object ID")
			return
		}
		var b []byte
		var rec artifact.Record
		rec, b, err = store.ReadPipelineObject(r.Context(), principal.OrganizationID, run, id)
		if err == nil {
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Disposition", "attachment")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Artifact-SHA256", rec.SHA256)
			_, _ = w.Write(b)
			return
		}
	} else {
		var after int64
		if raw := r.URL.Query().Get("after"); raw != "" {
			after, err = strconv.ParseInt(raw, 10, 64)
			if err != nil || after < 0 {
				writeProblem(w, 400, "Invalid cursor", "Provide a nonnegative object ID")
				return
			}
		}
		var items []artifact.Record
		items, err = store.ListPipelineObjects(r.Context(), principal.OrganizationID, run, after)
		if err == nil {
			writeJSON(w, 200, items)
			return
		}
	}
	switch {
	case errors.Is(err, pipeline.ErrMissing):
		writeProblem(w, 404, "Not found", "The requested resource does not exist in this organization")
	case errors.Is(err, artifact.ErrExpired):
		writeProblem(w, 410, "Payload expired", "Audit metadata remains available")
	default:
		writeProblem(w, 503, "Object unavailable", "Verified pipeline output could not be retrieved")
	}
}
