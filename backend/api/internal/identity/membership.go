package identity

import "time"

type OrganizationMember struct {
	UserID string `json:"user_id"`
	DisplayName string `json:"display_name"`
	Email string `json:"email,omitempty"`
	Role string `json:"role"`
	Status string `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
