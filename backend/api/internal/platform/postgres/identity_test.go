package postgres

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
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
