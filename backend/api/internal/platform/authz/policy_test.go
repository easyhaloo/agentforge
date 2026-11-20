package authz

import (
	"errors"
	"testing"
)

func TestStandardPolicyReadAccess(t *testing.T) {
	policy := NewStandardPolicy()

	tests := []struct {
		name      string
		principal Principal
		wantErr   bool
	}{
		{
			name:      "active owner can read",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "owner", Status: "active"},
			wantErr:   false,
		},
		{
			name:      "active admin can read",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "admin", Status: "active"},
			wantErr:   false,
		},
		{
			name:      "active member can read",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "member", Status: "active"},
			wantErr:   false,
		},
		{
			name:      "active viewer can read",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "viewer", Status: "active"},
			wantErr:   false,
		},
		{
			name:      "suspended member cannot read",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "member", Status: "suspended"},
			wantErr:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := policy.CanReadOrganization(tt.principal)
			if (err != nil) != tt.wantErr {
				t.Errorf("CanReadOrganization() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err != nil && !errors.Is(err, ErrForbidden) {
				t.Errorf("expected ErrForbidden, got %v", err)
			}
		})
	}
}

func TestStandardPolicyMemberManagement(t *testing.T) {
	policy := NewStandardPolicy()

	tests := []struct {
		name      string
		principal Principal
		wantErr   bool
	}{
		{
			name:      "active owner can manage members",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "owner", Status: "active"},
			wantErr:   false,
		},
		{
			name:      "active admin can manage members",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "admin", Status: "active"},
			wantErr:   false,
		},
		{
			name:      "active member cannot manage members",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "member", Status: "active"},
			wantErr:   true,
		},
		{
			name:      "active viewer cannot manage members",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "viewer", Status: "active"},
			wantErr:   true,
		},
		{
			name:      "suspended admin cannot manage members",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "admin", Status: "suspended"},
			wantErr:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := policy.CanManageMembers(tt.principal)
			if (err != nil) != tt.wantErr {
				t.Errorf("CanManageMembers() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestStandardPolicyRepositoryRegistration(t *testing.T) {
	policy := NewStandardPolicy()

	tests := []struct {
		name      string
		principal Principal
		wantErr   bool
	}{
		{
			name:      "owner can register repository",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "owner", Status: "active"},
			wantErr:   false,
		},
		{
			name:      "admin can register repository",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "admin", Status: "active"},
			wantErr:   false,
		},
		{
			name:      "member cannot register repository",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "member", Status: "active"},
			wantErr:   true,
		},
		{
			name:      "viewer cannot register repository",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "viewer", Status: "active"},
			wantErr:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := policy.CanRegisterRepository(tt.principal)
			if (err != nil) != tt.wantErr {
				t.Errorf("CanRegisterRepository() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestStandardPolicyChangesetWrites(t *testing.T) {
	policy := NewStandardPolicy()

	tests := []struct {
		name      string
		principal Principal
		wantErr   bool
	}{
		{
			name:      "owner can write changesets",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "owner", Status: "active"},
			wantErr:   false,
		},
		{
			name:      "admin can write changesets",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "admin", Status: "active"},
			wantErr:   false,
		},
		{
			name:      "member can write changesets",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "member", Status: "active"},
			wantErr:   false,
		},
		{
			name:      "viewer cannot write changesets",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "viewer", Status: "active"},
			wantErr:   true,
		},
		{
			name:      "suspended member cannot write changesets",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "member", Status: "suspended"},
			wantErr:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := policy.CanWriteChangesets(tt.principal)
			if (err != nil) != tt.wantErr {
				t.Errorf("CanWriteChangesets() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestStandardPolicyPipelineManagement(t *testing.T) {
	policy := NewStandardPolicy()

	tests := []struct {
		name      string
		principal Principal
		wantErr   bool
	}{
		{
			name:      "owner can manage pipelines",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "owner", Status: "active"},
			wantErr:   false,
		},
		{
			name:      "admin can manage pipelines",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "admin", Status: "active"},
			wantErr:   false,
		},
		{
			name:      "member cannot manage pipelines",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "member", Status: "active"},
			wantErr:   true,
		},
		{
			name:      "viewer cannot manage pipelines",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "viewer", Status: "active"},
			wantErr:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := policy.CanManagePipelines(tt.principal)
			if (err != nil) != tt.wantErr {
				t.Errorf("CanManagePipelines() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestStandardPolicyPipelineExecution(t *testing.T) {
	policy := NewStandardPolicy()

	tests := []struct {
		name      string
		principal Principal
		wantErr   bool
	}{
		{
			name:      "owner can start pipeline runs",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "owner", Status: "active"},
			wantErr:   false,
		},
		{
			name:      "admin can start pipeline runs",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "admin", Status: "active"},
			wantErr:   false,
		},
		{
			name:      "member can start pipeline runs",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "member", Status: "active"},
			wantErr:   false,
		},
		{
			name:      "viewer cannot start pipeline runs",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "viewer", Status: "active"},
			wantErr:   true,
		},
		{
			name:      "suspended member cannot start pipeline runs",
			principal: Principal{UserID: "u1", OrganizationID: "org1", Role: "member", Status: "suspended"},
			wantErr:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := policy.CanStartPipelineRuns(tt.principal)
			if (err != nil) != tt.wantErr {
				t.Errorf("CanStartPipelineRuns() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
