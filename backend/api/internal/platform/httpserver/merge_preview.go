package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"net/http"
	"slices"
	"strconv"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

func (d DeliveryDependencies) mergePreviewRoutes(mux *http.ServeMux) {
	const base = "/api/v1/organizations/{organizationID}/merge-preview"
	provider, supported := d.Git.(delivery.MergePreviewProvider)
	slots := make(chan struct{}, 1) // One preview per API process bounds temporary repositories and Git subprocesses.
	mux.HandleFunc("GET "+base+"/capabilities", func(w http.ResponseWriter, r *http.Request) {
		if _, ok := d.principal(w, r, false); !ok {
			return
		}
		writeJSON(w, 200, map[string]bool{"orderedMergePreview": supported && provider.SupportsMergePreview(r.Context())})
	})
	handler := func(w http.ResponseWriter, r *http.Request) {
		user, ok := d.principal(w, r, true)
		if !ok {
			return
		}
		if !supported || d.Catalog == nil {
			writeProblem(w, 503, "Merge preview unavailable", "A registered repository and preview-capable provider are required")
			return
		}
		var inputs map[string]json.RawMessage
		var input struct {
			Repository string `json:"repository"`
			delivery.MergeRequest
		}
		version := 0
		if n := r.PathValue("number"); n != "" {
			var err error
			version, err = strconv.Atoi(n)
			if err != nil || version < 1 {
				writeProblem(w, 400, "Invalid version", "Select a published version")
				return
			}
			body := struct {
				Repository string `json:"repository"`
				delivery.MergeRequest
				Inputs map[string]json.RawMessage `json:"inputs"`
			}{}
			if !decodeJSON(w, r, &body) {
				return
			}
			input.Repository, input.MergeRequest, inputs = body.Repository, body.MergeRequest, body.Inputs
		} else if !decodeJSON(w, r, &input) {
			return
		}
		repos, err := d.Catalog.ListRepositories(r.Context(), user.OrganizationID)
		if err != nil {
			writeProblem(w, 503, "Catalog unavailable", "Could not read registered repositories")
			return
		}
		if !slices.ContainsFunc(repos, func(item delivery.RepositoryMetadata) bool { return item.Slug == input.Repository }) {
			writeProblem(w, 404, "Unknown repository", "Select a repository registered in this organization")
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			writeProblem(w, 429, "Preview in progress", "Retry after the current preview completes")
			return
		}
		simulate := provider.PreviewMerge
		if version != 0 {
			candidates, ok := d.Git.(interface {
				PrepareCandidate(context.Context, string, string, delivery.MergeRequest) (delivery.MergePreview, error)
			})
			if !ok || d.Runs == nil {
				writeProblem(w, 503, "Integration unavailable", "Candidate storage and execution are required")
				return
			}
			simulate = candidates.PrepareCandidate
		}
		if input.Strategy == "" {
			input.Strategy = "merge-commit"
		}
		result, err := simulate(r.Context(), user.OrganizationID, input.Repository, input.MergeRequest)
		switch {
		case err == nil && version != 0 && result.Status == "clean":
			run, runErr := d.Runs.CreateIntegrationRun(r.Context(), user.OrganizationID, r.PathValue("id"), version, user.UserID, inputs, execution.Integration{Repository: input.Repository, Strategy: input.Strategy, MergePreview: result})
			switch {
			case runErr == nil:
				writeJSON(w, 201, run)
			case errors.Is(runErr, execution.ErrInputs):
				writeProblem(w, 422, "Invalid integration workflow", runErr.Error())
			case errors.Is(runErr, pipeline.ErrMissing):
				writeProblem(w, 404, "Unknown workflow version", "Select a published workflow version")
			case errors.Is(runErr, execution.ErrQuota):
				writeProblem(w, 429, "Execution quota reached", "Wait for an active run to finish")
			case errors.Is(runErr, pipeline.ErrConflict):
				writeProblem(w, 409, "Workflow unavailable", "Select an active workflow")
			default:
				writeProblem(w, 503, "Execution unavailable", "Could not start the candidate build")
			}
		case err == nil && version != 0:
			writeJSON(w, 409, result)
		case err == nil:
			writeJSON(w, 200, result)
		case errors.Is(err, delivery.ErrRepositoryInvalid):
			writeProblem(w, 422, "Invalid merge inputs", "Provide a target and one to 32 distinct source revisions")
		default:
			writeProblem(w, 503, "Git preview unavailable", "Check the repository, Git version and execution limits")
		}
	}
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/pipeline-runs/{run}/promote", d.promoteIntegration)
	mux.HandleFunc("POST "+base, handler)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/pipelines/{id}/versions/{number}/integration-runs", handler)
}

func (d DeliveryDependencies) promoteIntegration(w http.ResponseWriter, r *http.Request) {
	user, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if user.Role != "owner" && user.Role != "admin" {
		writeProblem(w, 403, "Promotion denied", "An owner or admin must approve the candidate")
		return
	}
	git, ok := d.Git.(execution.PromotionProvider)
	if !ok || d.Runs == nil {
		writeProblem(w, 503, "Promotion unavailable", "A provider with atomic promotion is required")
		return
	}
	var input struct {
		CandidateSHA string `json:"candidateSHA"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.CandidateSHA == "" {
		writeProblem(w, 400, "Candidate required", "Supply the candidate SHA you reviewed")
		return
	}
	err := d.Runs.PromoteIntegration(r.Context(), user.OrganizationID, r.PathValue("run"), user.UserID, input.CandidateSHA, git)
	switch {
	case err == nil:
		writeJSON(w, 200, map[string]string{"promotedSHA": input.CandidateSHA})
	case errors.Is(err, execution.ErrTriggerDenied):
		writeProblem(w, 403, "Promotion denied", "Check organization membership and the registered default branch")
	case errors.Is(err, pipeline.ErrMissing):
		writeProblem(w, 404, "Run unavailable", "Select a run in this organization")
	case errors.Is(err, pipeline.ErrConflict):
		writeProblem(w, 409, "Merge gate closed", "Check the exact candidate, build, evidence and current revision approvals")
	case errors.Is(err, delivery.ErrCandidateStale):
		writeProblem(w, 409, "Target changed", "Start a new integration build against the current target")
	default:
		writeProblem(w, 503, "Promotion unavailable", "Could not complete the promotion")
	}
}
