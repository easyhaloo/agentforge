package postgres

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

const slugBootstrapIssuer = "https://bootstrap-slug-issuer.example.test"

// slugOrganizationRow returns an organization's name and slug (nil when NULL).
func slugOrganizationRow(t *testing.T, ctx context.Context, store *Store, id string) (name string, slug *string, exists bool) {
	t.Helper()
	err := store.pool.QueryRow(ctx, "SELECT name, slug FROM organizations WHERE id = $1", id).Scan(&name, &slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, false
	}
	if err != nil {
		t.Fatal(err)
	}
	return name, slug, true
}

func TestBootstrapFirstOwnerSetsOrganizationSlug(t *testing.T) {
	ctx, store := slugOpenStore(t)
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	derivedName := "Derived Org " + suffix
	cases := []struct{ label, name, slug, want string }{
		{"explicit", "Explicit Org", "explicit-" + suffix, "explicit-" + suffix},
		// The operator CLI derives the slug from the name when none is configured.
		{"derived", derivedName, identity.Slugify(derivedName), "derived-org-" + suffix},
	}
	for _, tc := range cases {
		t.Run(tc.label, func(t *testing.T) {
			organizationID := "bootstrap-" + tc.label + "-" + suffix
			userID, err := store.BootstrapFirstOwner(ctx, slugBootstrapIssuer, "owner-"+tc.label+"-"+suffix, organizationID, tc.name, tc.slug)
			if err != nil {
				t.Fatal(err)
			}
			if _, slug, exists := slugOrganizationRow(t, ctx, store, organizationID); !exists || slug == nil || *slug != tc.want {
				t.Fatalf("stored slug = %v (exists=%v), want %q", slug, exists, tc.want)
			}
			// The handle works end to end and resolves to the canonical id.
			request, _ := slugNewSession(t, ctx, store, userID)
			principal, err := store.ResolvePrincipal(request, tc.want)
			if err != nil || principal.OrganizationID != organizationID || principal.Role != "owner" {
				t.Fatalf("ResolvePrincipal(%q) = %#v, %v; want organization %q with role owner", tc.want, principal, err, organizationID)
			}
		})
	}
}

func TestBootstrapFirstOwnerRejectsInvalidReservedOrConflictingSlug(t *testing.T) {
	ctx, store := slugOpenStore(t)
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	takenSlug, otherOrganizationID := "taken-"+suffix, "idholder-"+suffix
	slugInsertOrganization(t, ctx, store, "bootstrap-slug-holder-"+suffix, takenSlug, "active")
	slugInsertOrganization(t, ctx, store, otherOrganizationID, "", "active")

	assertRejected := func(label, organizationID, slug string, want error) {
		t.Helper()
		subject := "reject-" + label + "-" + suffix
		if _, err := store.BootstrapFirstOwner(ctx, slugBootstrapIssuer, subject, organizationID, "Rejected Org", slug); !errors.Is(err, want) {
			t.Errorf("%s: organization %q slug %q: error = %v, want %v", label, organizationID, slug, err, want)
		}
		// Nothing is committed: no organization and no user for the subject.
		if _, _, exists := slugOrganizationRow(t, ctx, store, organizationID); exists {
			t.Errorf("%s: organization %q was created despite the error", label, organizationID)
		}
		var identities int
		if err := store.pool.QueryRow(ctx, "SELECT count(*) FROM external_identities WHERE issuer = $1 AND subject = $2", slugBootstrapIssuer, subject).Scan(&identities); err != nil {
			t.Fatal(err)
		}
		if identities != 0 {
			t.Errorf("%s: %d external identities were created despite the error", label, identities)
		}
	}

	invalid := map[string]string{
		"reserved":        "current",
		"uppercase":       "Upper-" + suffix,
		"leading-hyphen":  "-lead",
		"trailing-hyphen": "trail-",
		"underscore":      "a_b",
		"too-long":        strings.Repeat("a", 40),
		"empty":           "",
		"blank":           "   ",
	}
	for label, slug := range invalid {
		assertRejected("invalid-"+label, "bootstrap-invalid-"+label+"-"+suffix, slug, identity.ErrInvalidOrganizationSlug)
	}
	assertRejected("slug-in-use", "bootstrap-new-slug-"+suffix, takenSlug, ErrOrganizationSlugConflict)
	assertRejected("slug-is-another-id", "bootstrap-new-id-"+suffix, otherOrganizationID, ErrOrganizationSlugConflict)
	assertRejected("id-is-another-slug", takenSlug, "fresh-"+suffix, ErrOrganizationSlugConflict)

	// An organization may use its own id as its slug.
	sameID := "same-" + suffix
	if _, err := store.BootstrapFirstOwner(ctx, slugBootstrapIssuer, "owner-same-"+suffix, sameID, "Same", sameID); err != nil {
		t.Fatalf("slug equal to the organization's own id: %v", err)
	}
}

func TestBootstrapFirstOwnerNeverOverwritesAnExistingOrganization(t *testing.T) {
	ctx, store := slugOpenStore(t)
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	cases := []struct {
		label, organizationSlug, passedSlug string // organizationSlug "" stores NULL
	}{
		{"has-slug", "old-" + suffix, "new-" + suffix},
		// Re-running with the slug the organization already has must not conflict with itself.
		{"own-slug", "own-" + suffix, "own-" + suffix},
		{"null-slug", "", "fill-" + suffix},
	}
	for _, tc := range cases {
		t.Run(tc.label, func(t *testing.T) {
			organizationID := "bootstrap-existing-" + tc.label + "-" + suffix
			slugInsertOrganization(t, ctx, store, organizationID, tc.organizationSlug, "active")
			if _, err := store.BootstrapFirstOwner(ctx, slugBootstrapIssuer, "owner-"+tc.label+"-"+suffix, organizationID, "Renamed", tc.passedSlug); err != nil {
				t.Fatal(err)
			}
			name, slug, _ := slugOrganizationRow(t, ctx, store, organizationID)
			if name != organizationID {
				t.Errorf("organization name = %q, want it unchanged (%q)", name, organizationID)
			}
			switch {
			case tc.organizationSlug == "" && slug != nil:
				t.Errorf("slug = %q, want it to stay NULL", *slug)
			case tc.organizationSlug != "" && (slug == nil || *slug != tc.organizationSlug):
				t.Errorf("slug = %v, want it unchanged (%q)", slug, tc.organizationSlug)
			}
		})
	}
}
