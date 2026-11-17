package identity

import (
	"context"
	"time"
)

type Member struct {
	UserID      string    `json:"user_id"`
	DisplayName string    `json:"display_name"`
	Email       string    `json:"email,omitempty"`
	Role        string    `json:"role"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type Invitation struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	ExpiresAt time.Time `json:"expires_at"`
	Token     string    `json:"token,omitempty"`
}

type MembershipRepository interface {
	ListMembers(context.Context, string) ([]Member, error)
	CreateInvitation(context.Context, string, string, string, string, string, string, time.Time) (Invitation, error)
	UpdateMembership(context.Context, string, string, string, string, string, string) (Member, error)
	RemoveMembership(context.Context, string, string, string, string) error
	AcceptInvitation(context.Context, string, string) (string, error)
}

func CanManageMembers(role string) bool {
	return role == "owner" || role == "admin"
}

func CanInviteRole(actorRole, inviteRole string) bool {
	switch inviteRole {
	case "member", "viewer":
		return CanManageMembers(actorRole)
	case "admin":
		return actorRole == "owner"
	default:
		return false
	}
}

func CanChangeMember(actorRole, targetRole, nextRole string) bool {
	if targetRole == "owner" || nextRole == "owner" {
		return false
	}
	switch actorRole {
	case "owner":
		return targetRole == "admin" || targetRole == "member" || targetRole == "viewer"
	case "admin":
		return (targetRole == "member" || targetRole == "viewer") &&
			(nextRole == "member" || nextRole == "viewer")
	default:
		return false
	}
}

func CanRemoveMember(actorRole, targetRole string) bool {
	if targetRole == "owner" {
		return false
	}
	switch actorRole {
	case "owner":
		return targetRole == "admin" || targetRole == "member" || targetRole == "viewer"
	case "admin":
		return targetRole == "member" || targetRole == "viewer"
	default:
		return false
	}
}

func CanWriteChangesets(role string) bool {
	return role == "owner" || role == "admin" || role == "member"
}
