package postgres

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestIssueMemberMentionsHTTP(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("requires PostgreSQL")
	}
	ctx := t.Context()
	store, err := Open(ctx, slugScratchDatabase(t, dsn, 1))
	lockMust(t, err)
	t.Cleanup(store.Close)
	h := newLockHTTP(t, &lockFixture{ctx: ctx, store: store}, 0)
	other := newLockHTTP(t, &lockFixture{ctx: ctx, store: store}, 0)
	h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{Identity: store, Membership: store, AllowedOrigin: lockHTTPOrigin})
	for _, user := range []string{h.userID, other.userID, "mention-active", "mention-suspended"} {
		if strings.HasPrefix(user, "mention-") {
			_, err := store.pool.Exec(ctx, `INSERT INTO users (id, display_name) VALUES ($1, $2)`, user, "Shared Name")
			lockMust(t, err)
		}
		_, err := store.pool.Exec(ctx, `UPDATE users SET display_name = $2, email = $3 WHERE id = $1`, user, "Shared Name", user+"@example.test")
		lockMust(t, err)
	}
	_, err = store.pool.Exec(ctx, `INSERT INTO organization_memberships (organization_id,user_id,role,status)
		VALUES ($1, 'mention-active', 'member', 'active'), ($1, 'mention-suspended', 'member', 'suspended')`, h.organizationID)
	lockMust(t, err)
	_, err = store.pool.Exec(ctx, `UPDATE organization_memberships SET role = 'member' WHERE organization_id = $1 AND user_id = $2`, h.organizationID, h.userID)
	lockMust(t, err)

	path := "/api/v1/organizations/" + h.organizationID + "/issues/member-mentions?q="
	res := h.do(ctx, http.MethodGet, path+"Shared", "")
	if res.Code != http.StatusOK || res.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("member lookup: %d %s", res.Code, res.Body)
	}
	var data struct{ Items []identity.MemberMention }
	decoder := json.NewDecoder(res.Body)
	decoder.DisallowUnknownFields()
	lockMust(t, decoder.Decode(&data))
	if len(data.Items) != 2 || data.Items[0].Username == data.Items[1].Username {
		t.Fatalf("want two distinct handles for active members with the same display name, got %+v", data.Items)
	}
	if res := h.do(ctx, http.MethodGet, path+url.QueryEscape("@example.test"), ""); res.Code != http.StatusOK || strings.TrimSpace(res.Body.String()) != `{"items":[]}` {
		t.Fatalf("email lookup: %d %s", res.Code, res.Body)
	}
	if res := h.do(ctx, http.MethodGet, path+url.QueryEscape(strings.Repeat("界", 101)), ""); res.Code != http.StatusBadRequest {
		t.Fatalf("long query: %d %s", res.Code, res.Body)
	}
	other.handler = h.handler
	if res := other.do(ctx, http.MethodGet, path+"Shared", ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("another organization: %d %s", res.Code, res.Body)
	}
	unsigned := httptest.NewRecorder()
	h.handler.ServeHTTP(unsigned, httptest.NewRequest(http.MethodGet, path+"Shared", nil))
	if unsigned.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous lookup: %d %s", unsigned.Code, unsigned.Body)
	}
	_, err = store.pool.Exec(ctx, `UPDATE organization_memberships SET role = 'viewer' WHERE organization_id = $1 AND user_id = $2`, h.organizationID, h.userID)
	lockMust(t, err)
	if res := h.do(ctx, http.MethodGet, path+"Shared", ""); res.Code != http.StatusForbidden {
		t.Fatalf("viewer lookup: %d %s", res.Code, res.Body)
	}
}
