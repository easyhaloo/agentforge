package httpserver

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

func (d DeliveryDependencies) registerIssueDetail(mux *http.ServeMux) {
	const path = "/api/v1/organizations/{organizationID}/issues/{number}"
	mux.HandleFunc("GET "+path+"/relationships", d.getIssueRelationships)
	mux.HandleFunc("PUT "+path+"/parent", d.changeIssueParent)
	mux.HandleFunc("DELETE "+path+"/parent", d.changeIssueParent)
	mux.HandleFunc("GET "+path+"/artifacts", d.getIssueArtifacts)
	mux.HandleFunc("PUT "+path+"/artifacts/{attachmentID}", d.changeIssueArtifact)
	mux.HandleFunc("DELETE "+path+"/artifacts/{attachmentID}", d.changeIssueArtifact)
	mux.HandleFunc("POST "+path+"/reports", d.reportIssueContent)
	mux.HandleFunc("POST "+path+"/transfer", d.transferIssue)
	mux.HandleFunc("POST "+path+"/branches", d.createIssueBranch)
	mux.HandleFunc("GET "+path+"/github-source", d.issueGitHubSource)
	mux.HandleFunc("PUT "+path+"/github-source", d.issueGitHubSource)
}

func (d DeliveryDependencies) issueDetailScope(w http.ResponseWriter, r *http.Request, write bool) (issues.DetailScope, bool) {
	principal, ok := d.principal(w, r, write)
	if !ok {
		return issues.DetailScope{}, false
	}
	if d.IssueDetailRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Issue detail unavailable", "The issue detail repository is not configured")
		return issues.DetailScope{}, false
	}
	number, err := strconv.ParseInt(r.PathValue("number"), 10, 32)
	if err != nil || number <= 0 {
		writeProblem(w, http.StatusBadRequest, "Invalid issue number", "The issue number must be a positive integer")
		return issues.DetailScope{}, false
	}
	repository, ok := d.resolveRegisteredRepository(w, r, principal, r.URL.Query().Get("repository"))
	if !ok {
		return issues.DetailScope{}, false
	}
	return issues.DetailScope{
		OrganizationID: principal.OrganizationID, Repository: repository.Slug, Number: int(number),
		UserID: principal.UserID, CanManage: principal.Role == "owner" || principal.Role == "admin",
	}, true
}

func issueDetailError(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, issues.ErrDetailNotFound):
		writeProblem(w, http.StatusNotFound, "Issue detail resource not found", "The requested issue, comment, or attachment is unavailable in this repository")
	case errors.Is(err, issues.ErrDetailForbidden):
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only issue authors and organization admins or owners can edit these links")
	case errors.Is(err, issues.ErrParentCycle):
		writeProblem(w, http.StatusConflict, "Invalid parent", "An issue cannot be its own ancestor")
	case errors.Is(err, issues.ErrParentExists):
		writeProblem(w, http.StatusConflict, "Parent already set", "Remove the current parent before linking a different one")
	case errors.Is(err, issues.ErrArtifactLimit):
		writeProblem(w, http.StatusUnprocessableEntity, "Artifact limit reached", "An issue can have at most 20 linked artifacts")
	case errors.Is(err, issues.ErrDuplicateReport):
		writeProblem(w, http.StatusConflict, "Content already reported", "Your report for this content is already recorded")
	default:
		writeProblem(w, http.StatusInternalServerError, "Issue detail operation failed", "The requested operation could not be completed")
	}
	return true
}

func (d DeliveryDependencies) getIssueRelationships(w http.ResponseWriter, r *http.Request) {
	scope, ok := d.issueDetailScope(w, r, false)
	if !ok {
		return
	}
	result, err := d.IssueDetailRepo.Relationships(r.Context(), scope)
	if !issueDetailError(w, err) {
		writeJSON(w, http.StatusOK, result)
	}
}

func (d DeliveryDependencies) changeIssueParent(w http.ResponseWriter, r *http.Request) {
	scope, ok := d.issueDetailScope(w, r, true)
	if !ok {
		return
	}
	var req struct {
		Number int32 `json:"number"`
	}
	if r.Method == http.MethodPut {
		if !decodeJSON(w, r, &req) {
			return
		}
		if req.Number <= 0 {
			writeProblem(w, http.StatusBadRequest, "Invalid parent number", "The parent number must be a positive integer")
			return
		}
	}
	result, err := d.IssueDetailRepo.SetParent(r.Context(), scope, int(req.Number))
	if !issueDetailError(w, err) {
		writeJSON(w, http.StatusOK, result)
	}
}

func (d DeliveryDependencies) getIssueArtifacts(w http.ResponseWriter, r *http.Request) {
	scope, ok := d.issueDetailScope(w, r, false)
	if !ok {
		return
	}
	files, err := d.IssueDetailRepo.Artifacts(r.Context(), scope)
	if issueDetailError(w, err) {
		return
	}
	for i := range files {
		files[i].URL = issueAttachmentPath(scope.OrganizationID, files[i].ID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"artifacts": files})
}

func (d DeliveryDependencies) changeIssueArtifact(w http.ResponseWriter, r *http.Request) {
	scope, ok := d.issueDetailScope(w, r, true)
	if !ok {
		return
	}
	id := r.PathValue("attachmentID")
	if !issueAttachmentID.MatchString(id) {
		writeProblem(w, http.StatusBadRequest, "Invalid attachment identifier", "Provide a valid uploaded file identifier")
		return
	}
	err := d.IssueDetailRepo.SetArtifact(r.Context(), scope, id, r.Method == http.MethodPut)
	if !issueDetailError(w, err) {
		w.WriteHeader(http.StatusNoContent)
	}
}

func (d DeliveryDependencies) reportIssueContent(w http.ResponseWriter, r *http.Request) {
	scope, ok := d.issueDetailScope(w, r, true)
	if !ok {
		return
	}
	var req struct {
		Reason    string `json:"reason"`
		Details   string `json:"details"`
		CommentID string `json:"commentId"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	switch req.Reason {
	case "spam", "abuse", "harassment", "inappropriate", "other":
	default:
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid report reason", "Choose a supported report reason")
		return
	}
	req.Details = strings.TrimSpace(req.Details)
	if !wellFormedText(req.CommentID) || utf8.RuneCountInString(req.CommentID) > 128 || !wellFormedText(req.Details) || utf8.RuneCountInString(req.Details) > 2000 {
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid report", "The comment identifier or report details are invalid")
		return
	}
	id, err := newID()
	if issueDetailError(w, err) {
		return
	}
	receipt, err := d.IssueDetailRepo.Report(r.Context(), scope, id, req.CommentID, req.Reason, req.Details)
	if !issueDetailError(w, err) {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusCreated, receipt)
	}
}

func (d DeliveryDependencies) transferIssue(w http.ResponseWriter, r *http.Request) {
	scope, ok := d.issueDetailScope(w, r, true)
	if !ok {
		return
	}
	if !scope.CanManage {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization owners and administrators can transfer issues")
		return
	}
	var req struct {
		Repository string    `json:"repository"`
		Expected   time.Time `json:"expected_updated_at"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Expected.IsZero() || req.Repository == scope.Repository {
		writeProblem(w, http.StatusBadRequest, "Invalid transfer", "Choose another repository and provide the issue's last update timestamp")
		return
	}
	principal := Principal{OrganizationID: scope.OrganizationID, UserID: scope.UserID}
	target, ok := d.resolveRegisteredRepository(w, r, principal, req.Repository)
	if !ok {
		return
	}
	if target.Visibility == "public" {
		source, ok := d.resolveRegisteredRepository(w, r, principal, scope.Repository)
		if !ok {
			return
		}
		if source.Visibility != "public" {
			writeProblem(w, http.StatusUnprocessableEntity, "Invalid transfer visibility", "Private issues cannot be transferred to a public repository")
			return
		}
	}
	issue, err := d.IssueDetailRepo.Transfer(r.Context(), scope, target.Slug, req.Expected)
	switch {
	case errors.Is(err, issues.ErrTransferConflict):
		writeProblem(w, http.StatusConflict, "Issue changed", "Reload the issue before transferring it")
	case errors.Is(err, issues.ErrTransferRelated):
		writeProblem(w, http.StatusConflict, "Issue has related issues", "Remove the parent and sub-issue links before transferring this issue")
	case !issueDetailError(w, err):
		writeJSON(w, http.StatusOK, issue)
	}
}

func (d DeliveryDependencies) createIssueBranch(w http.ResponseWriter, r *http.Request) {
	scope, ok := d.issueDetailScope(w, r, true)
	if !ok {
		return
	}
	if !scope.CanManage {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization owners and administrators can create issue branches")
		return
	}
	writer, supported := d.Git.(interface {
		CreateIssueBranch(context.Context, string, string, string, string, string, string) (delivery.RepositoryRef, error)
	})
	if !supported {
		writeProblem(w, http.StatusServiceUnavailable, "Branch creation unavailable", "A registered repository with a writable Git provider is required")
		return
	}
	var input struct {
		Name string `json:"name"`
		Base string `json:"base_branch"`
		SHA  string `json:"base_sha"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if !validPullBranch(input.Base) {
		writeProblem(w, http.StatusBadRequest, "Invalid base branch", "Select the name of an existing branch")
		return
	}
	ref, err := d.IssueDetailRepo.CreateBranch(r.Context(), scope, func(id issues.ID) (delivery.RepositoryRef, error) {
		return writer.CreateIssueBranch(r.Context(), scope.OrganizationID, scope.Repository, string(id), input.Name, "refs/heads/"+input.Base, input.SHA)
	})
	switch {
	case err == nil:
		writeJSON(w, http.StatusCreated, ref)
	case errors.Is(err, issues.ErrDetailNotFound), errors.Is(err, issues.ErrDetailForbidden):
		issueDetailError(w, err)
	case errors.Is(err, delivery.ErrWriteInvalid):
		writeProblem(w, http.StatusBadRequest, "Invalid branch", "Use an alphanumeric branch suffix with optional hyphens and an existing base commit")
	case errors.Is(err, delivery.ErrWriteConflict):
		writeProblem(w, http.StatusConflict, "Branch conflict", "The base branch moved or the issue branch name already exists")
	default:
		writeProblem(w, http.StatusServiceUnavailable, "Branch creation unavailable", "The Git repository could not be written")
	}
}
