package pipeline

import (
	"strings"
	"testing"
)

func TestValidateTagPattern(t *testing.T) {
	cases := []struct {
		pattern string
		want    bool
	}{
		{"v*", true},
		{"release-*", true},
		{"v1.0.0", true},
		{"[a-c]*", true},
		{"", false},
		{"refs/tags/v*", false}, // no path separators: patterns cannot escape the namespace
		{"a/b", false},
		{"a\\b", false},
		{"has space", false},
		{"a\x00b", false},
		{"a\nb", false},
		{"[a-", false}, // malformed glob
		{strings.Repeat("a", MaxTagPatternLength+1), false},
	}
	for _, c := range cases {
		if got := ValidateTagPattern(c.pattern); got != c.want {
			t.Errorf("ValidateTagPattern(%q) = %v, want %v", c.pattern, got, c.want)
		}
	}
	if !ValidateTagPattern(strings.Repeat("a", MaxTagPatternLength)) {
		t.Error("a full-length pattern should validate")
	}
}

func TestMatchTagPattern(t *testing.T) {
	cases := []struct {
		pattern, tag string
		want         bool
	}{
		{"v*", "v1.0.0", true},
		{"v*", "v2", true},
		{"v*", "release-1", false},
		{"release-*", "release-2026", true},
		{"v1.?.0", "v1.2.0", true},
		{"v1.?.0", "v1.22.0", false},
		{"v*", "", false},
		{"[a-", "anything", false}, // malformed pattern never matches
		{"v*", "a/b", false},
	}
	for _, c := range cases {
		if got := MatchTagPattern(c.pattern, c.tag); got != c.want {
			t.Errorf("MatchTagPattern(%q, %q) = %v, want %v", c.pattern, c.tag, got, c.want)
		}
	}
}
