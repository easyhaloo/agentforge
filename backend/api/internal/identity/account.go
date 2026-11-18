package identity

import "time"

type OrganizationSummary struct {
	ID string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
	Role string `json:"role"`
}

type AccountContext struct {
	UserID string `json:"user_id"`
	DisplayName string `json:"display_name"`
	Email string `json:"email,omitempty"`
	Organizations []OrganizationSummary `json:"organizations"`
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
