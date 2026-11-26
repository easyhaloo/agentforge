package postgres

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

func TestPostgresSessionResolutionAndCSRFBinding(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	store, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	organizationID := "identity-org-" + suffix
	userID := "identity-user-" + suffix
	_, err = store.pool.Exec(ctx, "INSERT INTO organizations (id, name) VALUES ($1, $1)", organizationID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.pool.Exec(ctx, "INSERT INTO users (id, display_name) VALUES ($1, $1)", userID)
	if err != nil {
		t.Fatal(err)
	}
	active, err := store.HasActiveMembership(ctx, userID)
	if err != nil || active {
		t.Fatalf("membership before provisioning active=%v err=%v, want false", active, err)
	}
	_, err = store.pool.Exec(ctx, "INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'admin', 'active')", organizationID, userID)
	if err != nil {
		t.Fatal(err)
	}
	active, err = store.HasActiveMembership(ctx, userID)
	if err != nil || !active {
		t.Fatalf("active membership lookup active=%v err=%v, want true", active, err)
	}

	credentials, err := identity.GenerateCredentials()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateSession(ctx, userID, credentials.SessionToken, credentials.CSRFToken, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.AddCookie(&http.Cookie{Name: identity.SessionCookieName, Value: credentials.SessionToken})
	principal, err := store.ResolvePrincipal(request, organizationID)
	if err != nil {
		t.Fatal(err)
	}
	if principal.UserID != userID || principal.OrganizationID != organizationID || principal.Role != "admin" {
		t.Fatalf("resolved principal = %#v", principal)
	}
	if _, err := store.ResolvePrincipal(request, "another-org"); !errors.Is(err, identity.ErrUnauthenticated) {
		t.Fatalf("cross-organization resolution error = %v, want ErrUnauthenticated", err)
	}

	if err := store.ValidateCSRF(ctx, credentials.SessionToken, credentials.CSRFToken); err != nil {
		t.Fatalf("valid CSRF token rejected: %v", err)
	}
	if err := store.ValidateCSRF(ctx, credentials.SessionToken, credentials.SessionToken); !errors.Is(err, identity.ErrUnauthenticated) {
		t.Fatalf("unbound CSRF token error = %v, want ErrUnauthenticated", err)
	}

	if err := store.RevokeSession(ctx, credentials.SessionToken); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ResolvePrincipal(request, organizationID); !errors.Is(err, identity.ErrUnauthenticated) {
		t.Fatalf("revoked session resolution error = %v, want ErrUnauthenticated", err)
	}
	if err := store.ValidateCSRF(ctx, credentials.SessionToken, credentials.CSRFToken); !errors.Is(err, identity.ErrUnauthenticated) {
		t.Fatalf("revoked session CSRF error = %v, want ErrUnauthenticated", err)
	}
}

func TestPostgresResolvePrincipalAcceptsOrganizationSlugOrID(t *testing.T) {
	ctx, store := slugOpenStore(t)
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	userID := "slug-resolve-user-" + suffix
	orgA, orgB, orgLegacy := "slug-res-a-"+suffix, "slug-res-b-"+suffix, "slug-res-legacy-"+suffix
	slugA, slugB := "key-a-"+suffix, "res-b-"+suffix
	slugInsertUser(t, ctx, store, userID)
	slugInsertOrganization(t, ctx, store, orgA, slugA, "active")
	slugInsertOrganization(t, ctx, store, orgB, slugB, "active")
	slugInsertOrganization(t, ctx, store, orgLegacy, "", "active")
	slugInsertMember(t, ctx, store, orgA, userID, "admin", "active")
	slugInsertMember(t, ctx, store, orgB, userID, "viewer", "active")
	slugInsertMember(t, ctx, store, orgLegacy, userID, "member", "active")
	request, _ := slugNewSession(t, ctx, store, userID)

	// The principal carries the canonical id and the organization's handle (its
	// slug, or its id when it has none), whichever handle was used to resolve it.
	cases := []struct{ name, handle, wantOrganization, wantSlug, wantRole string }{
		{"id of the first organization", orgA, orgA, slugA, "admin"},
		{"slug of the first organization", slugA, orgA, slugA, "admin"},
		{"slug match is case-insensitive", strings.ToUpper(slugA), orgA, slugA, "admin"},
		{"slug of the second organization", slugB, orgB, slugB, "viewer"},
		{"upper-case slug of the second organization", strings.ToUpper(slugB), orgB, slugB, "viewer"},
		{"id of the second organization", orgB, orgB, slugB, "viewer"},
		{"organization without a slug resolves by id", orgLegacy, orgLegacy, orgLegacy, "member"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			principal, err := store.ResolvePrincipal(request, tc.handle)
			if err != nil {
				t.Fatalf("ResolvePrincipal(%q) error = %v", tc.handle, err)
			}
			if principal.UserID != userID || principal.OrganizationID != tc.wantOrganization || principal.OrganizationSlug != tc.wantSlug || principal.Role != tc.wantRole {
				t.Fatalf("ResolvePrincipal(%q) = %#v, want user %q organization %q slug %q role %q (the canonical id, never the slug)",
					tc.handle, principal, userID, tc.wantOrganization, tc.wantSlug, tc.wantRole)
			}
		})
	}

	// Only slugs are case-insensitive: an organization id is an exact-match key,
	// also when the id doubles as the handle of an organization without a slug.
	for _, id := range []string{orgA, orgLegacy} {
		if principal, err := store.ResolvePrincipal(request, strings.ToUpper(id)); !errors.Is(err, identity.ErrUnauthenticated) {
			t.Fatalf("upper-cased organization id %q resolved %#v, error = %v; want ErrUnauthenticated", id, principal, err)
		}
	}
	// Slug folding is ASCII-only, so it does not depend on Unicode case rules or
	// the database locale: U+212A (KELVIN SIGN) lowercases to "k" under Unicode rules.
	if principal, err := store.ResolvePrincipal(request, "\u212Aey-a-"+suffix); !errors.Is(err, identity.ErrUnauthenticated) {
		t.Fatalf("non-ASCII handle resolved %#v, error = %v; want ErrUnauthenticated", principal, err)
	}
}

func TestPostgresResolvePrincipalDoesNotRevealOtherOrganizations(t *testing.T) {
	ctx, store := slugOpenStore(t)
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	alice, bob := "slug-oracle-alice-"+suffix, "slug-oracle-bob-"+suffix
	slugInsertUser(t, ctx, store, alice)
	slugInsertUser(t, ctx, store, bob)
	own, ownSlug := "slug-oracle-own-"+suffix, "oracle-own-"+suffix
	slugInsertOrganization(t, ctx, store, own, ownSlug, "active")
	slugInsertMember(t, ctx, store, own, alice, "owner", "active")

	// Every organization below has a valid slug but must be invisible to alice.
	type hiddenOrganization struct{ id, slug string }
	var hidden []hiddenOrganization
	addHidden := func(label, organizationStatus, membershipStatus string, member string) {
		id, slug := "slug-oracle-"+label+"-"+suffix, "or-"+label+"-"+suffix
		slugInsertOrganization(t, ctx, store, id, slug, organizationStatus)
		if member != "" {
			slugInsertMember(t, ctx, store, id, member, "owner", membershipStatus)
		}
		hidden = append(hidden, hiddenOrganization{id, slug})
	}
	addHidden("other", "active", "active", bob)
	addHidden("nobody", "active", "", "")
	addHidden("suspended-member", "active", "suspended", alice)
	addHidden("invited", "active", "invited", alice)
	addHidden("removed", "active", "removed", alice)
	// A suspended organization is intentionally NOT hidden: lifecycle members
	// (SPEC deviation 8) still resolve it read-only; the 423 gate refuses
	// writes instead. Only organizations where alice has no usable membership
	// stay invisible.

	request, token := slugNewSession(t, ctx, store, alice)
	if _, err := store.ResolvePrincipal(request, ownSlug); err != nil {
		t.Fatalf("alice's own organization slug must resolve: %v", err)
	}

	// An unknown handle is the reference: every hidden organization, by slug or
	// by id, must produce exactly the same error value (no enumeration oracle).
	_, unknown := store.ResolvePrincipal(request, "no-such-organization-"+suffix)
	if unknown != identity.ErrUnauthenticated {
		t.Fatalf("unknown organization error = %v, want the ErrUnauthenticated sentinel itself", unknown)
	}
	handles := []string{"current"}
	for _, organization := range hidden {
		handles = append(handles, organization.slug, strings.ToUpper(organization.slug), organization.id)
	}
	for _, handle := range handles {
		if principal, err := store.ResolvePrincipal(request, handle); err != unknown {
			t.Errorf("ResolvePrincipal(%q) = %#v, %v; want the same error as an unknown organization (%v)", handle, principal, err, unknown)
		}
	}

	// A valid slug does not rescue a revoked or expired session.
	if err := store.RevokeSession(ctx, token); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ResolvePrincipal(request, ownSlug); err != unknown {
		t.Errorf("revoked session with a valid slug: error = %v, want %v", err, unknown)
	}
	expiredRequest, expiredToken := slugNewSession(t, ctx, store, alice)
	if _, err := store.pool.Exec(ctx, "UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE token_hash = $1", identity.HashToken(expiredToken)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ResolvePrincipal(expiredRequest, ownSlug); err != unknown {
		t.Errorf("expired session with a valid slug: error = %v, want %v", err, unknown)
	}
}

func TestPostgresResolvePrincipalPrefersOrganizationIDOverSlug(t *testing.T) {
	ctx, store := slugOpenStore(t)
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	both, onlySlugMember := "slug-tie-both-"+suffix, "slug-tie-slug-only-"+suffix
	// The contested handle is the id of one organization and the slug of another.
	// The migration and bootstrap never create this state; it must still resolve deterministically.
	contested := "tie-" + suffix
	idOwner, slugOwner := contested, "slug-tie-holder-"+suffix
	slugInsertUser(t, ctx, store, both)
	slugInsertUser(t, ctx, store, onlySlugMember)
	// The slug holder is created first and joined first, so a missing tie-break would return it.
	slugInsertOrganization(t, ctx, store, slugOwner, contested, "active")
	slugInsertOrganization(t, ctx, store, idOwner, "tie-id-owner-"+suffix, "active")
	slugInsertMember(t, ctx, store, slugOwner, both, "viewer", "active")
	slugInsertMember(t, ctx, store, idOwner, both, "admin", "active")
	slugInsertMember(t, ctx, store, slugOwner, onlySlugMember, "member", "active")

	bothRequest, _ := slugNewSession(t, ctx, store, both)
	principal, err := store.ResolvePrincipal(bothRequest, contested)
	if err != nil || principal.OrganizationID != idOwner || principal.Role != "admin" {
		t.Fatalf("member of both resolved %#v, %v; want the organization whose id is %q with role admin", principal, err, contested)
	}

	// Only the caller's own memberships are considered: without membership in the
	// id match, the slug match is the only candidate.
	slugOnlyRequest, _ := slugNewSession(t, ctx, store, onlySlugMember)
	principal, err = store.ResolvePrincipal(slugOnlyRequest, contested)
	if err != nil || principal.OrganizationID != slugOwner || principal.Role != "member" {
		t.Fatalf("member of the slug holder only resolved %#v, %v; want organization %q with role member", principal, err, slugOwner)
	}
}

// slugMalformedHandles are path handles that can never be an organization id or
// slug. PostgreSQL rejects NUL bytes and invalid UTF-8 with SQLSTATE 22021.
func slugMalformedHandles() map[string]string {
	return map[string]string{
		"NUL only":                 "\x00",
		"NUL inside":               "a\x00b",
		"invalid UTF-8 byte":       "\xff",
		"invalid UTF-8 pair":       "\xff\xfe",
		"truncated UTF-8 sequence": "ab\xc3",
		"empty":                    "",
		"spaces only":              "   ",
		"tab and newline only":     "\t\n",
		"257 bytes":                strings.Repeat("a", 257),
	}
}

func TestPostgresResolvePrincipalRejectsMalformedHandles(t *testing.T) {
	ctx, store := slugOpenStore(t)
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	userID, organizationID, slug := "slug-malformed-user-"+suffix, "slug-malformed-org-"+suffix, "malformed-"+suffix
	slugInsertUser(t, ctx, store, userID)
	slugInsertOrganization(t, ctx, store, organizationID, slug, "active")
	slugInsertMember(t, ctx, store, organizationID, userID, "owner", "active")
	request, _ := slugNewSession(t, ctx, store, userID)

	// With a valid session, a malformed handle is an ordinary unresolvable handle:
	// the same sentinel as an unknown organization, never a database error that
	// the HTTP layer would report as 503.
	for name, handle := range slugMalformedHandles() {
		t.Run(name, func(t *testing.T) {
			if _, err := store.ResolvePrincipal(request, handle); err != identity.ErrUnauthenticated {
				t.Fatalf("ResolvePrincipal(%q) error = %v, want the ErrUnauthenticated sentinel", handle, err)
			}
		})
	}
	if principal, err := store.ResolvePrincipal(request, slug); err != nil || principal.OrganizationID != organizationID {
		t.Fatalf("a well-formed handle must still resolve: %#v, %v", principal, err)
	}
}

func TestPostgresResolvePrincipalValidatesHandleBeforeQuerying(t *testing.T) {
	_, store := slugOpenStore(t)
	store.Close() // every query now fails, so only a handle rejected up front can return the sentinel
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.AddCookie(&http.Cookie{Name: identity.SessionCookieName, Value: "session-token-with-enough-length-to-be-valid"})

	for name, handle := range slugMalformedHandles() {
		t.Run(name, func(t *testing.T) {
			if _, err := store.ResolvePrincipal(request, handle); err != identity.ErrUnauthenticated {
				t.Fatalf("ResolvePrincipal(%q) error = %v, want the ErrUnauthenticated sentinel before any SQL", handle, err)
			}
		})
	}
	// Controls: acceptable handles must reach the database (and fail there), so
	// the checks above cannot pass by rejecting everything. 256 bytes is the limit.
	controls := map[string]string{
		"slug":                        "acme",
		"id with capitals and dots":   "Legacy_Org.1",
		"non-ASCII id":                "café",
		"exactly 256 bytes":           strings.Repeat("a", 256),
		"internal spaces are allowed": "a b",
	}
	for name, handle := range controls {
		t.Run("control/"+name, func(t *testing.T) {
			if _, err := store.ResolvePrincipal(request, handle); err == nil || err == identity.ErrUnauthenticated {
				t.Fatalf("ResolvePrincipal(%q) error = %v, want a database error: the handle must reach SQL", handle, err)
			}
		})
	}
}
