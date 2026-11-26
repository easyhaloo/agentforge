package identity

import "time"

// Organization lifecycle statuses reported in AccountContext.
const (
	OrganizationStatusActive          = "active"
	OrganizationStatusSuspended       = "suspended"
	OrganizationStatusPendingDeletion = "pending_deletion"
)

type OrganizationSummary struct {
	ID       string `json:"id"`
	Slug     string `json:"slug"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	Personal bool   `json:"personal,omitempty"`
	// Status is the organization lifecycle state: active, suspended, or
	// pending_deletion. Suspended and pending-deletion organizations still
	// appear here so members can see (and owners can resolve) them.
	Status string `json:"status"`
	// DeletionScheduledAt is set only for pending_deletion organizations.
	DeletionScheduledAt *time.Time `json:"deletion_scheduled_at,omitempty"`
}

type AccountContext struct {
	UserID        string                `json:"user_id"`
	DisplayName   string                `json:"display_name"`
	Email         string                `json:"email,omitempty"`
	Organizations []OrganizationSummary `json:"organizations"`
}

// UserProfile represents a user's profile information for settings pages.
type UserProfile struct {
	UserID      string    `json:"user_id"`
	Username    string    `json:"username"`
	DisplayName string    `json:"display_name"`
	Email       string    `json:"email"`
	AvatarURL   *string   `json:"avatar_url"` // TODO: Not in DB schema yet
	Bio         string    `json:"bio"`
	Location    string    `json:"location"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// UserIdentityRecord represents a user's connected identity (OIDC or platform).
type UserIdentityRecord struct {
	ID          string
	UserID      string
	Issuer      string
	Subject     string
	Email       string
	DisplayName string
	CreatedAt   time.Time
}
