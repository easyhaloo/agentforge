package identity

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const (
	// reservedOrganizationSlug is a client-side alias for the caller's selected
	// organization, so it must never be an organization's handle.
	reservedOrganizationSlug  = "current"
	maxOrganizationSlugLength = 39
)

var ErrInvalidOrganizationSlug = errors.New("invalid organization slug")

var organizationSlugPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,37}[a-z0-9])?$`)

// ValidateOrganizationSlug reports whether slug may be stored as an organization handle.
func ValidateOrganizationSlug(slug string) error {
	if slug == reservedOrganizationSlug {
		return fmt.Errorf("%w: %q is reserved", ErrInvalidOrganizationSlug, slug)
	}
	if !organizationSlugPattern.MatchString(slug) {
		return fmt.Errorf("%w: use 1-%d lowercase letters, digits or hyphens, starting and ending with a letter or digit",
			ErrInvalidOrganizationSlug, maxOrganizationSlugLength)
	}
	return nil
}

// Slugify derives a valid organization slug from a display name. Only ASCII
// letters and digits survive (letters are lowercased); every other run of
// characters becomes one hyphen. The result never starts or ends with a hyphen,
// is at most 39 characters, falls back to "org" when nothing survives, and is
// never the reserved word (it is treated as already taken, like a collision).
// Migration 007 backfills existing organizations with the same rules.
func Slugify(name string) string {
	slug := make([]byte, 0, len(name))
	for _, r := range name {
		if r >= 'A' && r <= 'Z' {
			r += 'a' - 'A'
		}
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			slug = append(slug, byte(r))
		case len(slug) > 0 && slug[len(slug)-1] != '-':
			slug = append(slug, '-')
		}
	}
	value := strings.TrimRight(string(slug), "-")
	if len(value) > maxOrganizationSlugLength {
		value = strings.TrimRight(value[:maxOrganizationSlugLength], "-")
	}
	if value == "" {
		return "org"
	}
	if value == reservedOrganizationSlug {
		return value + "-2"
	}
	return value
}
