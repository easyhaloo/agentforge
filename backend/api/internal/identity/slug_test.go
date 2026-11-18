package identity

import (
	"errors"
	"math/rand"
	"strings"
	"testing"
)

func TestSlugify(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{"spaces", "Acme Inc", "acme-inc"},
		{"punctuation", "Acme, Inc.!", "acme-inc"},
		{"collapses separator runs", "a  --  b", "a-b"},
		{"uppercase", "AGENT FORGE", "agent-forge"},
		{"digits are kept", "Team 42", "team-42"},
		{"leading and trailing hyphens", "--Hello World--", "hello-world"},
		{"already a slug", "acme-inc", "acme-inc"},
		{"non-ASCII letters are separators", "Ünïcode Café 日本", "n-code-caf"},
		{"only non-ASCII", "日本語", "org"},
		{"empty", "", "org"},
		{"only whitespace", "   ", "org"},
		{"only punctuation", "!!!", "org"},
		{"very long is truncated to 39", strings.Repeat("a", 60), strings.Repeat("a", 39)},
		{"truncation re-trims a trailing hyphen", strings.Repeat("a", 38) + " b", strings.Repeat("a", 38)},
		{"reserved current is never returned", "Current", "current-2"},
		{"reserved current with punctuation", " current! ", "current-2"},
		{"longer than the reserved word is untouched", "currently", "currently"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Slugify(tc.input); got != tc.want {
				t.Fatalf("Slugify(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestSlugifyAlwaysProducesAValidSlug(t *testing.T) {
	random := rand.New(rand.NewSource(1))
	alphabet := []rune("abcXYZ019 -_.,!?/\\'\"\t\n日本éİ")
	for i := 0; i < 2000; i++ {
		input := make([]rune, random.Intn(80))
		for j := range input {
			input[j] = alphabet[random.Intn(len(alphabet))]
		}
		if slug := Slugify(string(input)); ValidateOrganizationSlug(slug) != nil {
			t.Fatalf("Slugify(%q) = %q, which fails validation: %v", string(input), slug, ValidateOrganizationSlug(slug))
		}
	}
}

func TestValidateOrganizationSlug(t *testing.T) {
	valid := []string{"a", "0", "ab", "a1", "a-b", "a--b", "acme-inc-2", strings.Repeat("a", 39)}
	for _, slug := range valid {
		if err := ValidateOrganizationSlug(slug); err != nil {
			t.Errorf("ValidateOrganizationSlug(%q) = %v, want nil", slug, err)
		}
	}
	invalid := []struct {
		name string
		slug string
	}{
		{"empty", ""},
		{"uppercase", "Acme"},
		{"leading hyphen", "-acme"},
		{"trailing hyphen", "acme-"},
		{"underscore", "a_b"},
		{"space", "a b"},
		{"dot", "a.b"},
		{"slash", "a/b"},
		{"non-ASCII", "café"},
		{"40 characters", strings.Repeat("a", 40)},
		{"reserved current", "current"},
	}
	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidateOrganizationSlug(tc.slug); !errors.Is(err, ErrInvalidOrganizationSlug) {
				t.Fatalf("ValidateOrganizationSlug(%q) = %v, want ErrInvalidOrganizationSlug", tc.slug, err)
			}
		})
	}
}
