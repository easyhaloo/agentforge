package identity

import "time"

type OrganizationSummary struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
	Role string `json:"role"`
}

type AccountContext struct {
	UserID        string                `json:"user_id"`
	DisplayName   string                `json:"display_name"`
	Email         string                `json:"email,omitempty"`
	Organizations []OrganizationSummary `json:"organizations"`
}

// UserProfile represents a user's profile information for settings pages.
// Fields not yet in database schema (bio, location, avatar_url, username) return empty values.
type UserProfile struct {
	UserID      string    `json:"user_id"`
	Username    string    `json:"username"` // TODO: Not in DB schema yet
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
