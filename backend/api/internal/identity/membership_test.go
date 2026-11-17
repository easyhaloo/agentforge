package identity

import "testing"

func TestMembershipAuthorizationPolicy(t *testing.T) {
	tests := []struct {
		name string
		got bool
		want bool
	}{
		{name: "owner invites admin", got: CanInviteRole("owner", "admin"), want: true},
		{name: "admin cannot invite admin", got: CanInviteRole("admin", "admin"), want: false},
		{name: "admin invites member", got: CanInviteRole("admin", "member"), want: true},
		{name: "member cannot invite", got: CanInviteRole("member", "viewer"), want: false},
		{name: "owner cannot invite owner", got: CanInviteRole("owner", "owner"), want: false},
		{name: "owner changes admin", got: CanChangeMember("owner", "admin", "viewer"), want: true},
		{name: "admin cannot change admin", got: CanChangeMember("admin", "admin", "member"), want: false},
		{name: "admin changes viewer", got: CanChangeMember("admin", "viewer", "member"), want: true},
		{name: "nobody changes owner", got: CanChangeMember("owner", "owner", "member"), want: false},
		{name: "owner cannot assign owner", got: CanChangeMember("owner", "member", "owner"), want: false},
		{name: "admin removes member", got: CanRemoveMember("admin", "member"), want: true},
		{name: "admin cannot remove admin", got: CanRemoveMember("admin", "admin"), want: false},
		{name: "owner cannot remove owner", got: CanRemoveMember("owner", "owner"), want: false},
		{name: "member can create changeset", got: CanWriteChangesets("member"), want: true},
		{name: "viewer cannot create changeset", got: CanWriteChangesets("viewer"), want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if test.got != test.want {
				t.Fatalf("got=%v want=%v", test.got, test.want)
			}
		})
	}
}
