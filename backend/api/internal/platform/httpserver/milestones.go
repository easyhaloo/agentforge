package httpserver

import (
	"net/http"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/milestones"
)

type createMilestoneRequest struct {
	Title       string  `json:"title"`
	Description string  `json:"description"`
	DueOn       *string `json:"due_on,omitempty"` // ISO 8601 date string
}

type updateMilestoneRequest struct {
	Title       *string `json:"title,omitempty"`
	Description *string `json:"description,omitempty"`
	DueOn       *string `json:"due_on,omitempty"`
	State       *string `json:"state,omitempty"`
}

// listMilestones handles GET /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/milestones
func (d DeliveryDependencies) listMilestones(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.MilestoneRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Milestone system unavailable", "The milestone repository is not configured")
		return
	}

	owner := r.PathValue("owner")
	repo := r.PathValue("repo")
	if owner == "" || repo == "" {
		writeProblem(w, http.StatusBadRequest, "Repository required", "owner and repo path parameters are required")
		return
	}

	repository := owner + "/" + repo
	state := milestones.State(r.URL.Query().Get("state"))

	// Default to open milestones if no state specified
	if state == "" {
		state = milestones.StateOpen
	}

	// Validate state
	if state != milestones.StateOpen && state != milestones.StateClosed && state != "all" {
		writeProblem(w, http.StatusBadRequest, "Invalid state", "state must be 'open', 'closed', or 'all'")
		return
	}

	// If "all" is specified, pass empty state to get all milestones
	if state == "all" {
		state = ""
	}

	milestonesList, err := d.MilestoneRepo.List(r.Context(), principal.OrganizationID, repository, state)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to list milestones", "The milestone query failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"items": milestonesList})
}

// createMilestone handles POST /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/milestones
func (d DeliveryDependencies) createMilestone(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}

	// Only admins and owners can create milestones
	if principal.Role != "admin" && principal.Role != "owner" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization admins and owners can create milestones")
		return
	}

	if d.MilestoneRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Milestone system unavailable", "The milestone repository is not configured")
		return
	}

	owner := r.PathValue("owner")
	repo := r.PathValue("repo")
	if owner == "" || repo == "" {
		writeProblem(w, http.StatusBadRequest, "Repository required", "owner and repo path parameters are required")
		return
	}

	var req createMilestoneRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	req.Title = strings.TrimSpace(req.Title)
	req.Description = strings.TrimSpace(req.Description)

	if req.Title == "" {
		writeProblem(w, http.StatusBadRequest, "Title required", "milestone title must not be empty")
		return
	}

	var dueOn *time.Time
	if req.DueOn != nil && *req.DueOn != "" {
		parsed, err := time.Parse(time.RFC3339, *req.DueOn)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "Invalid due date", "due_on must be a valid ISO 8601 date")
			return
		}
		dueOn = &parsed
	}

	id, err := newID()
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to create milestone", "An identifier could not be generated")
		return
	}

	repository := owner + "/" + repo
	now := time.Now().UTC()
	milestone := &milestones.Milestone{
		ID:          milestones.ID(id),
		Repository:  repository,
		Title:       req.Title,
		Description: req.Description,
		DueOn:       dueOn,
		State:       milestones.StateOpen,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	created, err := d.MilestoneRepo.Create(r.Context(), principal.OrganizationID, milestone)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to create milestone", "The milestone could not be persisted")
		return
	}

	writeJSON(w, http.StatusCreated, created)
}

// getMilestone handles GET /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/milestones/{id}
func (d DeliveryDependencies) getMilestone(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.MilestoneRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Milestone system unavailable", "The milestone repository is not configured")
		return
	}

	milestoneID := r.PathValue("milestoneID")
	if milestoneID == "" {
		writeProblem(w, http.StatusBadRequest, "Milestone ID required", "milestoneID path parameter is required")
		return
	}

	milestone, err := d.MilestoneRepo.Get(r.Context(), principal.OrganizationID, milestones.ID(milestoneID))
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Milestone not found", "No milestone exists with this ID")
		return
	}

	// Get progress statistics
	progress, err := d.MilestoneRepo.GetProgress(r.Context(), principal.OrganizationID, milestones.ID(milestoneID))
	if err != nil {
		// Don't fail the request if progress query fails, just return the milestone
		writeJSON(w, http.StatusOK, milestone)
		return
	}

	// Return milestone with progress
	response := map[string]interface{}{
		"milestone": milestone,
		"progress":  progress,
	}
	writeJSON(w, http.StatusOK, response)
}

// updateMilestone handles PATCH /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/milestones/{id}
func (d DeliveryDependencies) updateMilestone(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}

	// Only admins and owners can update milestones
	if principal.Role != "admin" && principal.Role != "owner" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization admins and owners can update milestones")
		return
	}

	if d.MilestoneRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Milestone system unavailable", "The milestone repository is not configured")
		return
	}

	milestoneID := r.PathValue("milestoneID")
	if milestoneID == "" {
		writeProblem(w, http.StatusBadRequest, "Milestone ID required", "milestoneID path parameter is required")
		return
	}

	var req updateMilestoneRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	// Get existing milestone
	milestone, err := d.MilestoneRepo.Get(r.Context(), principal.OrganizationID, milestones.ID(milestoneID))
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Milestone not found", "No milestone exists with this ID")
		return
	}

	// Apply updates
	if req.Title != nil {
		title := strings.TrimSpace(*req.Title)
		if title == "" {
			writeProblem(w, http.StatusBadRequest, "Invalid title", "milestone title must not be empty")
			return
		}
		milestone.Title = title
	}
	if req.Description != nil {
		milestone.Description = strings.TrimSpace(*req.Description)
	}
	if req.DueOn != nil {
		if *req.DueOn == "" {
			milestone.DueOn = nil
		} else {
			parsed, err := time.Parse(time.RFC3339, *req.DueOn)
			if err != nil {
				writeProblem(w, http.StatusBadRequest, "Invalid due date", "due_on must be a valid ISO 8601 date")
				return
			}
			milestone.DueOn = &parsed
		}
	}
	if req.State != nil {
		state := milestones.State(*req.State)
		if state != milestones.StateOpen && state != milestones.StateClosed {
			writeProblem(w, http.StatusBadRequest, "Invalid state", "state must be 'open' or 'closed'")
			return
		}

		// If closing the milestone, set ClosedAt
		if state == milestones.StateClosed && milestone.State == milestones.StateOpen {
			now := time.Now().UTC()
			milestone.ClosedAt = &now
		}
		// If reopening, clear ClosedAt
		if state == milestones.StateOpen && milestone.State == milestones.StateClosed {
			milestone.ClosedAt = nil
		}

		milestone.State = state
	}

	milestone.UpdatedAt = time.Now().UTC()

	updated, err := d.MilestoneRepo.Update(r.Context(), principal.OrganizationID, milestone)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to update milestone", "The milestone could not be updated")
		return
	}

	writeJSON(w, http.StatusOK, updated)
}

// deleteMilestone handles DELETE /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/milestones/{id}
func (d DeliveryDependencies) deleteMilestone(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}

	// Only admins and owners can delete milestones
	if principal.Role != "admin" && principal.Role != "owner" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization admins and owners can delete milestones")
		return
	}

	if d.MilestoneRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Milestone system unavailable", "The milestone repository is not configured")
		return
	}

	milestoneID := r.PathValue("milestoneID")
	if milestoneID == "" {
		writeProblem(w, http.StatusBadRequest, "Milestone ID required", "milestoneID path parameter is required")
		return
	}

	err := d.MilestoneRepo.Delete(r.Context(), principal.OrganizationID, milestones.ID(milestoneID))
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to delete milestone", "The milestone could not be deleted")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
