package postgres

import (
	"testing"
)

// Unit tests for the /me organization list and slug-change validation rules
// that do not need a database (SPEC deviation 3 and 8).

func TestValidOrganizationSlugChangeBoundaries(t *testing.T) {
	long39 := "a" + string(repeat('b', 37)) + "c" // 39 chars, valid interior
	tests := []struct {
		slug string
		want bool
	}{
		{"abc", true},       // 3 chars: minimum
		{long39, true},      // 39 chars: maximum
		{"a", false},        // 1 char: legacy only, cannot be re-assigned
		{"ab", false},       // 2 chars: legacy only
		{"abcd", true},      // 4 chars
		{"-abc", false},     // leading hyphen
		{"abc-", false},     // trailing hyphen
		{"-ab-", false},     // both ends
		{"a--b", true},      // interior double hyphen is allowed
		{"Abc", false},      // uppercase
		{"a_c", false},      // underscore
		{"current", true},   // the 3–39 pattern alone accepts it; CreateOrganization keeps the reservation
		{"current-x", true}, // not reserved
	}
	for _, tt := range tests {
		if got := ValidOrganizationSlugChange(tt.slug); got != tt.want {
			t.Errorf("ValidOrganizationSlugChange(%q) = %v, want %v", tt.slug, got, tt.want)
		}
	}
	if len(long39) != 39 {
		t.Fatalf("boundary slug length = %d, want 39", len(long39))
	}
}

func repeat(r rune, n int) []rune {
	out := make([]rune, n)
	for i := range out {
		out[i] = r
	}
	return out
}

// 'current' must stay reserved for new slugs even though the 3–39 pattern
// alone would accept it.
func TestOrganizationCreateStillReservesCurrent(t *testing.T) {
	if ValidOrganizationSlug("current") {
		t.Fatal("ValidOrganizationSlug must keep 'current' reserved")
	}
}
