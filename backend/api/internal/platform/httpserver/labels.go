package httpserver

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/labels"
)

type createLabelRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Color       string `json:"color"`
}

type updateLabelRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	Color       *string `json:"color,omitempty"`
}

type addLabelsToIssueRequest struct {
	Labels []string `json:"labels"` // Label names
}

// listLabels handles GET /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/labels
func (d DeliveryDependencies) listLabels(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.LabelRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Label system unavailable", "The label repository is not configured")
		return
	}

	owner := r.PathValue("owner")
	repo := r.PathValue("repo")
	if owner == "" || repo == "" {
		writeProblem(w, http.StatusBadRequest, "Repository required", "owner and repo path parameters are required")
		return
	}

	repository := owner + "/" + repo
	filter := labels.ListFilter{
		Repository: repository,
		Query:      r.URL.Query().Get("q"),
	}

	labelsList, err := d.LabelRepo.List(r.Context(), principal.OrganizationID, filter)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to list labels", "The label query failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"items": labelsList})
}

// createLabel handles POST /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/labels
func (d DeliveryDependencies) createLabel(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}

	// Only admins and owners can create labels
	if principal.Role != "admin" && principal.Role != "owner" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization admins and owners can create labels")
		return
	}

	if d.LabelRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Label system unavailable", "The label repository is not configured")
		return
	}

	owner := r.PathValue("owner")
	repo := r.PathValue("repo")
	if owner == "" || repo == "" {
		writeProblem(w, http.StatusBadRequest, "Repository required", "owner and repo path parameters are required")
		return
	}

	var req createLabelRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.Description = strings.TrimSpace(req.Description)
	req.Color = strings.TrimSpace(req.Color)

	if req.Name == "" {
		writeProblem(w, http.StatusBadRequest, "Name required", "label name must not be empty")
		return
	}

	if req.Color == "" {
		writeProblem(w, http.StatusBadRequest, "Color required", "label color must not be empty")
		return
	}

	// Validate color format (6-digit hex without #)
	if len(req.Color) != 6 {
		writeProblem(w, http.StatusBadRequest, "Invalid color", "color must be a 6-digit hex code (e.g., 'd73a4a')")
		return
	}

	id, err := newID()
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to create label", "An identifier could not be generated")
		return
	}

	repository := owner + "/" + repo
	now := time.Now().UTC()
	label := &labels.Label{
		ID:          labels.ID(id),
		Repository:  repository,
		Name:        req.Name,
		Description: req.Description,
		Color:       req.Color,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	created, err := d.LabelRepo.Create(r.Context(), principal.OrganizationID, label)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to create label", "The label could not be persisted")
		return
	}

	writeJSON(w, http.StatusCreated, created)
}

// updateLabel handles PATCH /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/labels/{name}
func (d DeliveryDependencies) updateLabel(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}

	// Only admins and owners can update labels
	if principal.Role != "admin" && principal.Role != "owner" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization admins and owners can update labels")
		return
	}

	if d.LabelRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Label system unavailable", "The label repository is not configured")
		return
	}

	owner := r.PathValue("owner")
	repo := r.PathValue("repo")
	labelName := r.PathValue("name")
	if owner == "" || repo == "" || labelName == "" {
		writeProblem(w, http.StatusBadRequest, "Missing parameters", "owner, repo, and name path parameters are required")
		return
	}

	var req updateLabelRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	repository := owner + "/" + repo

	// Find the label by name
	filter := labels.ListFilter{Repository: repository}
	labelsList, err := d.LabelRepo.List(r.Context(), principal.OrganizationID, filter)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to find label", "The label query failed")
		return
	}

	var label *labels.Label
	for _, l := range labelsList {
		if l.Name == labelName {
			label = l
			break
		}
	}

	if label == nil {
		writeProblem(w, http.StatusNotFound, "Label not found", "No label exists with this name in the repository")
		return
	}

	// Apply updates
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			writeProblem(w, http.StatusBadRequest, "Invalid name", "label name must not be empty")
			return
		}
		label.Name = name
	}
	if req.Description != nil {
		label.Description = strings.TrimSpace(*req.Description)
	}
	if req.Color != nil {
		color := strings.TrimSpace(*req.Color)
		if len(color) != 6 {
			writeProblem(w, http.StatusBadRequest, "Invalid color", "color must be a 6-digit hex code")
			return
		}
		label.Color = color
	}

	label.UpdatedAt = time.Now().UTC()

	updated, err := d.LabelRepo.Update(r.Context(), principal.OrganizationID, label)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to update label", "The label could not be updated")
		return
	}

	writeJSON(w, http.StatusOK, updated)
}

// deleteLabel handles DELETE /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/labels/{name}
func (d DeliveryDependencies) deleteLabel(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}

	// Only admins and owners can delete labels
	if principal.Role != "admin" && principal.Role != "owner" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization admins and owners can delete labels")
		return
	}

	if d.LabelRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Label system unavailable", "The label repository is not configured")
		return
	}

	owner := r.PathValue("owner")
	repo := r.PathValue("repo")
	labelName := r.PathValue("name")
	if owner == "" || repo == "" || labelName == "" {
		writeProblem(w, http.StatusBadRequest, "Missing parameters", "owner, repo, and name path parameters are required")
		return
	}

	repository := owner + "/" + repo

	// Find the label by name
	filter := labels.ListFilter{Repository: repository}
	labelsList, err := d.LabelRepo.List(r.Context(), principal.OrganizationID, filter)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to find label", "The label query failed")
		return
	}

	var labelID labels.ID
	for _, l := range labelsList {
		if l.Name == labelName {
			labelID = l.ID
			break
		}
	}

	if labelID == "" {
		writeProblem(w, http.StatusNotFound, "Label not found", "No label exists with this name in the repository")
		return
	}

	err = d.LabelRepo.Delete(r.Context(), principal.OrganizationID, labelID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to delete label", "The label could not be deleted")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// addLabelsToIssue handles POST /api/v1/organizations/{organizationID}/issues/{number}/labels
func (d DeliveryDependencies) addLabelsToIssue(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.LabelRepo == nil || d.IssueRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Label system unavailable", "The label or issue repository is not configured")
		return
	}

	repository := r.URL.Query().Get("repository")
	if repository == "" {
		writeProblem(w, http.StatusBadRequest, "Repository required", "repository query parameter is required")
		return
	}

	numberStr := r.PathValue("number")
	number, err := strconv.Atoi(numberStr)
	if err != nil || number < 1 {
		writeProblem(w, http.StatusBadRequest, "Invalid issue number", "number must be a positive integer")
		return
	}

	var req addLabelsToIssueRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	if len(req.Labels) == 0 {
		writeProblem(w, http.StatusBadRequest, "Labels required", "labels array must not be empty")
		return
	}

	// Get the issue to verify it exists
	issue, err := d.IssueRepo.Get(r.Context(), principal.OrganizationID, repository, number)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Issue not found", "No issue exists with this number in the repository")
		return
	}

	// Get all labels for the repository
	filter := labels.ListFilter{Repository: repository}
	labelsList, err := d.LabelRepo.List(r.Context(), principal.OrganizationID, filter)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to list labels", "The label query failed")
		return
	}

	// Map label names to IDs
	labelMap := make(map[string]labels.ID)
	for _, l := range labelsList {
		labelMap[l.Name] = l.ID
	}

	// Add each label
	for _, labelName := range req.Labels {
		labelName = strings.TrimSpace(labelName)
		if labelName == "" {
			continue
		}

		labelID, exists := labelMap[labelName]
		if !exists {
			writeProblem(w, http.StatusNotFound, "Label not found", "Label '"+labelName+"' does not exist in the repository")
			return
		}

		err := d.LabelRepo.AddLabelToIssue(r.Context(), principal.OrganizationID, string(issue.ID), labelID)
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, "Unable to add label", "The label could not be added to the issue")
			return
		}
	}

	// Get updated labels for the issue
	issueLabels, err := d.LabelRepo.GetLabelsForIssue(r.Context(), principal.OrganizationID, string(issue.ID))
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to get labels", "The labels list could not be retrieved")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"labels": issueLabels})
}

// removeLabelFromIssue handles DELETE /api/v1/organizations/{organizationID}/issues/{number}/labels/{name}
func (d DeliveryDependencies) removeLabelFromIssue(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.LabelRepo == nil || d.IssueRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Label system unavailable", "The label or issue repository is not configured")
		return
	}

	repository := r.URL.Query().Get("repository")
	if repository == "" {
		writeProblem(w, http.StatusBadRequest, "Repository required", "repository query parameter is required")
		return
	}

	numberStr := r.PathValue("number")
	number, err := strconv.Atoi(numberStr)
	if err != nil || number < 1 {
		writeProblem(w, http.StatusBadRequest, "Invalid issue number", "number must be a positive integer")
		return
	}

	labelName := r.PathValue("labelName")
	if labelName == "" {
		writeProblem(w, http.StatusBadRequest, "Label name required", "labelName path parameter is required")
		return
	}

	// Get the issue to verify it exists
	issue, err := d.IssueRepo.Get(r.Context(), principal.OrganizationID, repository, number)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Issue not found", "No issue exists with this number in the repository")
		return
	}

	// Find the label by name
	filter := labels.ListFilter{Repository: repository}
	labelsList, err := d.LabelRepo.List(r.Context(), principal.OrganizationID, filter)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to find label", "The label query failed")
		return
	}

	var labelID labels.ID
	for _, l := range labelsList {
		if l.Name == labelName {
			labelID = l.ID
			break
		}
	}

	if labelID == "" {
		writeProblem(w, http.StatusNotFound, "Label not found", "No label exists with this name in the repository")
		return
	}

	err = d.LabelRepo.RemoveLabelFromIssue(r.Context(), principal.OrganizationID, string(issue.ID), labelID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to remove label", "The label could not be removed from the issue")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
