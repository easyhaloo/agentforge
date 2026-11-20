package authz

import (
	"errors"
	"fmt"
)

var (
	ErrUnauthorized = errors.New("unauthorized")
	ErrForbidden    = errors.New("forbidden")
)

// Principal represents an authenticated user's identity within an organization context.
type Principal struct {
	UserID           string
	OrganizationID   string
	OrganizationSlug string
	Role             string
	Status           string
}

// Policy centralizes authorization decisions for organization-scoped operations.
type Policy interface {
	// CanReadOrganization checks if the principal can read organization resources.
	CanReadOrganization(p Principal) error

	// CanManageMembers checks if the principal can invite, update, or remove members.
	CanManageMembers(p Principal) error

	// CanRegisterRepository checks if the principal can register repositories.
	CanRegisterRepository(p Principal) error

	// CanWriteChangesets checks if the principal can create or modify changesets.
	CanWriteChangesets(p Principal) error

	// CanManagePipelines checks if the principal can publish or archive pipelines.
	CanManagePipelines(p Principal) error

	// CanReadPipelines checks if the principal can read pipeline definitions.
	CanReadPipelines(p Principal) error

	// CanStartPipelineRuns checks if the principal can start pipeline runs.
	CanStartPipelineRuns(p Principal) error
}

// StandardPolicy implements role-based access control for AgentForge organizations.
type StandardPolicy struct{}

// NewStandardPolicy returns the default RBAC policy.
func NewStandardPolicy() *StandardPolicy {
	return &StandardPolicy{}
}

// CanReadOrganization checks read access to organization resources.
// Active members of any role can read organization resources.
func (p *StandardPolicy) CanReadOrganization(principal Principal) error {
	if principal.Status != "active" {
		return fmt.Errorf("%w: membership is not active", ErrForbidden)
	}
	return nil
}

// CanManageMembers checks member management permissions.
// Only owners and admins can manage organization memberships.
func (p *StandardPolicy) CanManageMembers(principal Principal) error {
	if principal.Status != "active" {
		return fmt.Errorf("%w: membership is not active", ErrForbidden)
	}
	if principal.Role != "owner" && principal.Role != "admin" {
		return fmt.Errorf("%w: only owners and admins can manage members", ErrForbidden)
	}
	return nil
}

// CanRegisterRepository checks repository registration permissions.
// Only owners and admins can register repositories.
func (p *StandardPolicy) CanRegisterRepository(principal Principal) error {
	if principal.Status != "active" {
		return fmt.Errorf("%w: membership is not active", ErrForbidden)
	}
	if principal.Role != "owner" && principal.Role != "admin" {
		return fmt.Errorf("%w: only owners and admins can register repositories", ErrForbidden)
	}
	return nil
}

// CanWriteChangesets checks changeset write permissions.
// Owners, admins, and members can write changesets. Viewers cannot.
func (p *StandardPolicy) CanWriteChangesets(principal Principal) error {
	if principal.Status != "active" {
		return fmt.Errorf("%w: membership is not active", ErrForbidden)
	}
	if principal.Role == "viewer" {
		return fmt.Errorf("%w: viewers cannot modify changesets", ErrForbidden)
	}
	return nil
}

// CanManagePipelines checks pipeline management permissions.
// Only owners and admins can publish or archive pipelines.
func (p *StandardPolicy) CanManagePipelines(principal Principal) error {
	if principal.Status != "active" {
		return fmt.Errorf("%w: membership is not active", ErrForbidden)
	}
	if principal.Role != "owner" && principal.Role != "admin" {
		return fmt.Errorf("%w: only owners and admins can publish or archive pipelines", ErrForbidden)
	}
	return nil
}

// CanReadPipelines checks pipeline read permissions.
// All active members can read pipeline definitions.
func (p *StandardPolicy) CanReadPipelines(principal Principal) error {
	if principal.Status != "active" {
		return fmt.Errorf("%w: membership is not active", ErrForbidden)
	}
	return nil
}

// CanStartPipelineRuns checks pipeline execution permissions.
// Owners, admins, and members can start runs. Viewers cannot.
func (p *StandardPolicy) CanStartPipelineRuns(principal Principal) error {
	if principal.Status != "active" {
		return fmt.Errorf("%w: membership is not active", ErrForbidden)
	}
	if principal.Role == "viewer" {
		return fmt.Errorf("%w: viewers cannot start pipeline runs", ErrForbidden)
	}
	return nil
}
