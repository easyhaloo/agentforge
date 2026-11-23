package postgres

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestRepositoryWebhookPublicDestinations(t *testing.T) {
	for _, address := range []string{
		"127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.169.254",
		"100.64.0.1", "192.0.0.9", "198.18.0.1", "224.0.0.2", "255.255.255.255",
		"::1", "::ffff:127.0.0.1", "::ffff:100.64.0.1", "::ffff:169.254.169.254", "fe80::a%en1",
		"fd00::1", "64:ff9b::a00:1", "2002:7f00:1::", "2001:db8::1", "3fff::1",
	} {
		if publicRepositoryWebhookAddress(netip.MustParseAddr(address)) {
			t.Errorf("accepted non-public destination %s", address)
		}
	}
	for _, raw := range []string{"http://example.com", "https://user@example.com", "https://example.com/#", "https://example.com:0",
		"https://[::ffff:127.0.0.1]", "https://[fe80::1%25en0]", "https://localhost", "https://example.com:65536"} {
		if _, err := parseRepositoryWebhookURL(raw); err == nil {
			t.Errorf("accepted invalid URL %s", raw)
		}
	}
	for _, raw := range []string{"https://example.com:8443/hook", "https://[2606:4700::1111]/", "https://8.8.8.8"} {
		if _, err := parseRepositoryWebhookURL(raw); err != nil {
			t.Errorf("rejected valid URL %s: %v", raw, err)
		}
	}
	public := netip.MustParseAddr("8.8.8.8")
	private := netip.MustParseAddr("::ffff:10.1.2.3")
	lookup := func(_ context.Context, network, name string) ([]netip.Addr, error) {
		if network != "ip" || name != "hooks.example.com." {
			t.Fatalf("unexpected DNS question: %s %s", network, name)
		}
		return []netip.Addr{public, private}, nil
	}
	if _, err := repositoryWebhookAddresses(t.Context(), "hooks.example.com", lookup); err == nil {
		t.Fatal("accepted DNS response containing a mapped private address")
	}
}

type repositoryWebhookTestTransport func(*http.Request) (*http.Response, error)

func (transport repositoryWebhookTestTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	return transport(r)
}

func TestRepositoryWebhookAPIAndDelivery(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("requires PostgreSQL")
	}
	ctx := t.Context()
	store, err := Open(ctx, slugScratchDatabase(t, dsn, 41))
	lockMust(t, err)
	t.Cleanup(store.Close)
	const repo = "team/repo"
	const key = "e²FjK5Nz%a6x^gS3c"
	const newKey = "rT7Y9x4Wkv%apjH$L"
	h := newLockHTTP(t, &lockFixture{ctx: ctx, store: store}, 0, repo, "team/other")
	h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Identity: store, CSRF: store, Catalog: store, RepositoryWebhooks: store, AllowedOrigin: lockHTTPOrigin,
	})
	prefix := "/api/v1/organizations/" + h.organizationID + "/repositories/"
	base := prefix + repo + "/webhooks"
	request := func(method, path, body string, code int) string {
		t.Helper()
		res := h.do(ctx, method, path, body)
		if res.Code != code {
			t.Fatalf("%s %s: status %d, want %d\n%s", method, path, res.Code, code, res.Body.String())
		}
		if strings.Contains(res.Body.String(), key) || strings.Contains(res.Body.String(), newKey) || strings.Contains(res.Body.String(), `"secret"`) {
			t.Fatal("webhook returned its signing secret")
		}
		return strings.TrimSpace(res.Body.String())
	}
	if got := request(http.MethodGet, base, "", http.StatusOK); got != `{"webhooks":[]}` {
		t.Fatalf("unexpected empty response: %s", got)
	}
	body := fmt.Sprintf(`{"url":"https://hooks.example.com/webhook","secret":%q,"events":["issues","issue_comment"]}`, key)
	noCSRF := httptest.NewRequest(http.MethodPost, base, strings.NewReader(body))
	noCSRF.Header.Set("Origin", lockHTTPOrigin)
	noCSRF.AddCookie(&http.Cookie{Name: identity.SessionCookieName, Value: h.credentials.SessionToken})
	res := httptest.NewRecorder()
	h.handler.ServeHTTP(res, noCSRF)
	if res.Code != http.StatusForbidden {
		t.Fatalf("creation without CSRF: got %d", res.Code)
	}
	request(http.MethodPost, base, strings.Replace(body, key, "abcdefghabcdefgh", 1), http.StatusBadRequest)
	request(http.MethodPost, base, strings.Replace(body, "hooks.example.com", "127.0.0.1", 1), http.StatusBadRequest)
	request(http.MethodPost, base, strings.Replace(body, "issue_comment", "push", 1), http.StatusBadRequest)
	var webhook struct {
		ID     string
		URL    string
		Events []string
		Active bool
	}
	lockMust(t, json.Unmarshal([]byte(request(http.MethodPost, base, body, http.StatusCreated)), &webhook))
	if webhook.ID == "" || !webhook.Active || len(webhook.Events) != 2 || webhook.URL != "https://hooks.example.com/webhook" {
		t.Fatalf("invalid created webhook: %+v", webhook)
	}
	item := base + "/" + webhook.ID
	deliveries := item + "/deliveries"
	request(http.MethodGet, prefix+"team/other/webhooks/"+webhook.ID+"/deliveries", "", http.StatusNotFound)
	request(http.MethodDelete, prefix+"team/other/webhooks/"+webhook.ID, "", http.StatusNotFound)
	_, err = store.pool.Exec(ctx, `UPDATE organization_memberships SET role='member' WHERE organization_id=$1 AND user_id=$2`, h.organizationID, h.userID)
	lockMust(t, err)
	request(http.MethodGet, deliveries, "", http.StatusForbidden)
	request(http.MethodPatch, item, `{"active":false}`, http.StatusForbidden)
	_, err = store.pool.Exec(ctx, `UPDATE organization_memberships SET role='admin' WHERE organization_id=$1 AND user_id=$2`, h.organizationID, h.userID)
	lockMust(t, err)

	// Exercise the same enqueue contract as the issue activity helper, inside the producer transaction.
	insertIssue := func(id string, number int, commit bool) {
		t.Helper()
		tx, err := store.pool.Begin(ctx)
		lockMust(t, err)
		defer tx.Rollback(ctx)
		_, err = tx.Exec(ctx, `INSERT INTO issues (organization_id, id, repository, number, title, created_by) VALUES ($1,$2,$3,$4,'Test issue',$5)`, h.organizationID, id, repo, number, h.userID)
		lockMust(t, err)
		lockMust(t, EnqueueRepositoryWebhooks(ctx, tx, h.organizationID, id, ""))
		lockMust(t, EnqueueRepositoryWebhooks(ctx, tx, h.organizationID, id, ""))
		if commit {
			lockMust(t, tx.Commit(ctx))
		}
	}
	insertComment := func(id string) {
		t.Helper()
		tx, err := store.pool.Begin(ctx)
		lockMust(t, err)
		defer tx.Rollback(ctx)
		_, err = tx.Exec(ctx, `INSERT INTO comments (organization_id, id, resource_type, resource_id, body, author_id) VALUES ($1,$2,'issue','first','Test comment',$3)`, h.organizationID, id, h.userID)
		lockMust(t, err)
		lockMust(t, EnqueueRepositoryWebhooks(ctx, tx, h.organizationID, "first", id))
		lockMust(t, tx.Commit(ctx))
	}
	insertIssue("rolled-back", 2, false)
	if got := request(http.MethodGet, deliveries, "", http.StatusOK); got != `{"deliveries":[]}` {
		t.Fatalf("uncommitted delivery escaped: %s", got)
	}

	type outbound struct{ id, event, sig, body string }
	received := make(chan outbound, 4)
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		read, err := io.ReadAll(r.Body)
		if err != nil || r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("unexpected webhook request: %s, %v", r.Method, err)
		}
		event := r.Header.Get("X-GitHub-Event")
		received <- outbound{r.Header.Get("X-GitHub-Delivery"), event, r.Header.Get("X-Hub-Signature-256"), string(read)}
		if event == "issue_comment" {
			http.Redirect(w, r, "/should-not-follow", http.StatusTemporaryRedirect)
			return
		}
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte("private receiver response"))
	}))
	defer receiver.Close()
	local, err := url.Parse(receiver.URL)
	lockMust(t, err)
	client := repositoryWebhookClient(repositoryWebhookTestTransport(func(r *http.Request) (*http.Response, error) {
		clone := r.Clone(r.Context())
		clone.URL.Host = local.Host
		return receiver.Client().Transport.RoundTrip(clone)
	}))
	process := func(want bool) {
		t.Helper()
		worked, err := store.deliverNextRepositoryWebhook(ctx, client)
		lockMust(t, err)
		if worked != want {
			t.Fatalf("processed delivery = %v, want %v", worked, want)
		}
	}
	verify := func(event, action, secret string) outbound {
		t.Helper()
		select {
		case sent := <-received:
			mac := hmac.New(sha256.New, []byte(secret))
			mac.Write([]byte(sent.body))
			var payload struct {
				Action string
				Issue  struct{ ID string }
			}
			lockMust(t, json.Unmarshal([]byte(sent.body), &payload))
			if sent.id == "" || sent.event != event || payload.Action != action || payload.Issue.ID != "first" ||
				sent.sig != "sha256="+hex.EncodeToString(mac.Sum(nil)) {
				t.Fatalf("invalid signed delivery: %+v", sent)
			}
			return sent
		default:
			t.Fatal("receiver got no delivery")
			return outbound{}
		}
	}

	insertIssue("first", 1, true)
	// Two workers may contend for the same row, but exactly one can deliver it.
	var wg sync.WaitGroup
	worked := make(chan bool, 2)
	for range 2 {
		wg.Go(func() {
			ok, err := store.deliverNextRepositoryWebhook(ctx, client)
			if err != nil {
				t.Error(err)
			}
			worked <- ok
		})
	}
	wg.Wait()
	if <-worked == <-worked {
		t.Fatal("expected exactly one delivery claim")
	}
	issue := verify("issues", "opened", key)
	insertComment("stale")
	request(http.MethodPatch, item, fmt.Sprintf(`{"secret":%q}`, newKey), http.StatusOK)
	process(true) // rotation invalidates already queued deliveries
	insertComment("redirected")
	process(true)
	comment := verify("issue_comment", "created", newKey)
	if !strings.Contains(comment.body, `"body": "Test comment"`) {
		t.Fatal("missing comment snapshot")
	}
	insertComment("abandoned")
	_, err = store.pool.Exec(ctx, `UPDATE repository_webhook_deliveries SET status='delivering', lease_until=now()-interval '1 second' WHERE resource_id='abandoned'`)
	lockMust(t, err)
	process(true)
	process(false)
	if len(received) != 0 {
		t.Fatal("unexpected webhook request after rotation, redirect, or lease expiration")
	}
	var history struct {
		Deliveries []struct {
			ID          string
			Status      string
			HTTPStatus  *int    `json:"http_status"`
			DeliveredAt *string `json:"delivered_at"`
		}
	}
	historyBody := request(http.MethodGet, deliveries, "", http.StatusOK)
	lockMust(t, json.Unmarshal([]byte(historyBody), &history))
	if strings.Contains(historyBody, "private receiver response") || strings.Contains(historyBody, "payload") || len(history.Deliveries) != 4 {
		t.Fatalf("invalid delivery history: %s", historyBody)
	}
	for _, d := range history.Deliveries {
		switch d.ID {
		case issue.id:
			if d.Status != "succeeded" || d.HTTPStatus == nil || *d.HTTPStatus != http.StatusAccepted || d.DeliveredAt == nil {
				t.Fatalf("issue delivery was not recorded as successful: %+v", d)
			}
		case comment.id:
			if d.Status != "failed" || d.HTTPStatus == nil || *d.HTTPStatus != http.StatusTemporaryRedirect || d.DeliveredAt == nil {
				t.Fatalf("redirected delivery was not recorded as failed: %+v", d)
			}
		default:
			if d.Status != "failed" || d.HTTPStatus != nil || d.DeliveredAt != nil {
				t.Fatalf("unattempted delivery was not recorded as failed: %+v", d)
			}
		}
	}
	// A new arrival removes old terminal rows, while history remains a fixed-size view.
	_, err = store.pool.Exec(ctx, `INSERT INTO repository_webhook_deliveries
		(webhook_id, config_version, event, resource_id, status, created_at)
		SELECT $1, 1, 'issues', 'old-' || n, 'failed', now() - interval '1 day'
		FROM generate_series(1, $2::int) n`, webhook.ID, repositoryWebhookHistoryLimit+10)
	lockMust(t, err)
	insertComment("triggers-prune")
	var terminal int
	lockMust(t, store.pool.QueryRow(ctx, `SELECT count(*) FROM repository_webhook_deliveries
		WHERE webhook_id = $1 AND status IN ('failed', 'succeeded')`, webhook.ID).Scan(&terminal))
	if terminal != repositoryWebhookHistoryLimit {
		t.Fatalf("retained %d terminal deliveries, want %d", terminal, repositoryWebhookHistoryLimit)
	}
	lockMust(t, json.Unmarshal([]byte(request(http.MethodGet, deliveries, "", http.StatusOK)), &history))
	if len(history.Deliveries) != repositoryWebhookHistoryLimit || history.Deliveries[0].Status != "pending" {
		t.Fatal("history should return the most recent deliveries including pending ones")
	}
	request(http.MethodPatch, item, `{"active":false}`, http.StatusOK)
	process(true) // disabling cancels the already queued delivery
	insertComment("disabled")
	process(false)
	request(http.MethodDelete, item, "", http.StatusNoContent)
	request(http.MethodGet, deliveries, "", http.StatusNotFound)
}
