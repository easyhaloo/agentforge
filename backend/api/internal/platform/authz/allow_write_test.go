package authz

import (
	"errors"
	"testing"
)

func TestAllowWriteOrganizationLifecycle(t *testing.T) {
	tests := []struct {
		name    string
		status  string
		wantErr bool
	}{
		{name: "active organization allows writes", status: "active"},
		{name: "unknown status allows writes (pre-lifecycle principals)", status: ""},
		{name: "suspended organization refuses writes", status: "suspended", wantErr: true},
		{name: "pending deletion refuses writes", status: "pending_deletion", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := AllowWrite(tt.status)
			if (err != nil) != tt.wantErr {
				t.Fatalf("AllowWrite(%q) error = %v, wantErr %v", tt.status, err, tt.wantErr)
			}
			if tt.wantErr && !errors.Is(err, ErrLocked) {
				t.Errorf("expected ErrLocked, got %v", err)
			}
		})
	}
}
