package identity

import (
	"errors"
	"time"
)

var (
	ErrMembershipNotFound = errors.New("organization membership not found")
	ErrMembershipForbidden = errors.New("membership operation forbidden")
	ErrLastActiveOwner = errors.New("organization must retain at least one active owner")
	ErrInvalidMembershipChange = errors.New("invalid membership change")
)

type OrganizationMember struct {
	UserID string `json:"user_id"`
	DisplayName string `json:"display_name"`
	Email string `json:"email,omitempty"`
	Role string `json:"role"`
	Status string `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
