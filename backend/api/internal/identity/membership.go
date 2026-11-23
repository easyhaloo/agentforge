package identity

import (
	"errors"
	"time"
)

var (
	ErrMembershipNotFound      = errors.New("organization membership not found")
	ErrMembershipForbidden     = errors.New("membership operation forbidden")
	ErrLastActiveOwner         = errors.New("organization must retain at least one active owner")
	ErrInvalidMembershipChange = errors.New("invalid membership change")
	ErrInvitationNotFound      = errors.New("organization invitation not found")
	ErrInvitationAlreadyMember = errors.New("user is already an organization member")
	ErrInvitationPending       = errors.New("an invitation for this email is already pending")
	ErrInvalidInvitation       = errors.New("invalid organization invitation")
)

type MemberMention struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
}

type OrganizationMember struct {
	UserID      string    `json:"user_id"`
	DisplayName string    `json:"display_name"`
	Email       string    `json:"email,omitempty"`
	Role        string    `json:"role"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type OrganizationInvitation struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	Status    string    `json:"status"`
	InvitedBy string    `json:"invited_by"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

type MembershipAuditEvent struct {
	ID           string    `json:"id"`
	ActorUserID  string    `json:"actor_user_id"`
	TargetUserID string    `json:"target_user_id"`
	Action       string    `json:"action"`
	BeforeRole   string    `json:"before_role"`
	AfterRole    *string   `json:"after_role,omitempty"`
	BeforeStatus string    `json:"before_status"`
	AfterStatus  string    `json:"after_status"`
	CreatedAt    time.Time `json:"created_at"`
}
