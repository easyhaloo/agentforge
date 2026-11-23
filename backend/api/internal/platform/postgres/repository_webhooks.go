package postgres

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const (
	repositoryWebhookLimit        = 20
	repositoryWebhookHistoryLimit = 100
	repositoryWebhookBacklogLimit = 1000
	repositoryWebhookPayloadLimit = 1 << 20
	repositoryWebhookHTTPTimeout  = 5 * time.Second
)

const webhookPublicFields = `jsonb_build_object('id', id, 'url', url, 'events', events, 'active', active)`

func (s *Store) ListRepositoryWebhooks(ctx context.Context, organizationID, repository string) (json.RawMessage, error) {
	var items json.RawMessage
	err := s.pool.QueryRow(ctx, `SELECT coalesce(jsonb_agg(`+webhookPublicFields+` ORDER BY id), '[]'::jsonb)
		FROM repository_webhooks WHERE organization_id = $1 AND repository = $2`, organizationID, repository).Scan(&items)
	return items, err
}

// A nil result with no error means the repository has reached its webhook limit.
func (s *Store) CreateRepositoryWebhook(ctx context.Context, organizationID, repository, endpoint, secret string, events []string, active bool) (json.RawMessage, error) {
	if err := validateRepositoryWebhook(&endpoint, &secret, events); err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	// Serialize the count and insert with competing creates on the same repository.
	var slug string
	err = tx.QueryRow(ctx, `SELECT slug FROM delivery_repositories WHERE organization_id = $1 AND slug = $2 FOR NO KEY UPDATE`, organizationID, repository).Scan(&slug)
	if err != nil {
		return nil, err
	}
	var item json.RawMessage
	err = tx.QueryRow(ctx, `INSERT INTO repository_webhooks (organization_id, repository, url, secret, events, active)
		SELECT $1, $2, $3, $4, $5, $6 WHERE (
			SELECT count(*) FROM repository_webhooks WHERE organization_id = $1 AND repository = $2
		) < $7 RETURNING `+webhookPublicFields,
		organizationID, repository, endpoint, []byte(secret), events, active, repositoryWebhookLimit).Scan(&item)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return item, tx.Commit(ctx)
}

func (s *Store) UpdateRepositoryWebhook(ctx context.Context, organizationID, repository, id string, endpoint, secret *string, events []string, active *bool) (json.RawMessage, error) {
	if err := validateRepositoryWebhook(endpoint, secret, events); err != nil {
		return nil, err
	}
	var key []byte
	if secret != nil {
		key = []byte(*secret)
	}
	var item json.RawMessage
	err := s.pool.QueryRow(ctx, `UPDATE repository_webhooks SET url = coalesce($4, url), secret = coalesce($5, secret),
		events = coalesce($6, events), active = coalesce($7, active),
		config_version = config_version + CASE WHEN
			coalesce($4, url) IS DISTINCT FROM url OR coalesce($5, secret) IS DISTINCT FROM secret
			OR coalesce($6, events) IS DISTINCT FROM events OR coalesce($7, active) IS DISTINCT FROM active
			THEN 1 ELSE 0 END
		WHERE organization_id = $1 AND repository = $2 AND id = $3 RETURNING `+webhookPublicFields,
		organizationID, repository, id, endpoint, key, events, active).Scan(&item)
	return item, err
}

func (s *Store) DeleteRepositoryWebhook(ctx context.Context, organizationID, repository, id string) error {
	result, err := s.pool.Exec(ctx, `DELETE FROM repository_webhooks WHERE organization_id = $1 AND repository = $2 AND id = $3`, organizationID, repository, id)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) ListRepositoryWebhookDeliveries(ctx context.Context, organizationID, repository, id string) (json.RawMessage, error) {
	var items json.RawMessage
	err := s.pool.QueryRow(ctx, `SELECT coalesce((
		SELECT jsonb_agg(to_jsonb(recent) ORDER BY created_at DESC, id DESC) FROM (
			SELECT id, event, status, http_status, created_at, delivered_at
			FROM repository_webhook_deliveries WHERE webhook_id = h.id
			ORDER BY created_at DESC, id DESC LIMIT $4
		) recent
	), '[]'::jsonb) FROM repository_webhooks h WHERE organization_id = $1 AND repository = $2 AND id = $3`,
		organizationID, repository, id, repositoryWebhookHistoryLimit).Scan(&items)
	return items, err
}

// EnqueueRepositoryWebhooks records an issue creation or, when commentID is set, an issue comment
// creation. Call after inserting the issue or comment and before committing its transaction.
func EnqueueRepositoryWebhooks(ctx context.Context, tx pgx.Tx, organizationID, issueID, commentID string) error {
	// Acquire matching configuration locks in a stable order. An independent statement below
	// takes a fresh snapshot for the backlog count after a concurrent enqueuer commits.
	event, action, resourceID := "issues", "opened", issueID
	if commentID != "" {
		event, action, resourceID = "issue_comment", "created", commentID
	}
	rows, err := tx.Query(ctx, `SELECT h.id::text FROM repository_webhooks h JOIN issues i
		ON (h.organization_id, h.repository) = (i.organization_id, i.repository)
		WHERE i.organization_id = $1 AND i.id = $2 AND h.active AND $3 = ANY(h.events)
		ORDER BY h.id FOR NO KEY UPDATE OF h`, organizationID, issueID, event)
	if err != nil {
		return fmt.Errorf("lock repository webhooks: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("read repository webhooks: %w", err)
	}
	if len(ids) == 0 {
		return nil
	}
	_, err = tx.Exec(ctx, `WITH activity AS (
		SELECT jsonb_build_object(
			'action', $6::text,
			'issue', jsonb_build_object('id', i.id, 'number', i.number, 'title', i.title, 'body', i.body, 'state', i.state),
			'repository', jsonb_build_object('full_name', i.repository),
			'sender', jsonb_build_object('id', u.id, 'login', u.username)
		) || CASE WHEN c.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('comment',
			jsonb_build_object('id', c.id, 'body', c.body, 'created_at', c.created_at)) END AS payload
		FROM issues i LEFT JOIN comments c ON c.organization_id = i.organization_id
			AND c.resource_type = 'issue' AND c.resource_id = i.id AND c.id = $3
		JOIN users u ON u.id = coalesce(c.author_id, i.created_by)
		WHERE i.organization_id = $1 AND i.id = $2 AND ($3 = '' OR c.id IS NOT NULL)
	), targets AS (
		SELECT h.id, h.config_version, EXISTS (
			SELECT 1 FROM repository_webhook_deliveries d WHERE d.webhook_id = h.id
			AND d.status IN ('pending', 'delivering') OFFSET $8 LIMIT 1
		) AS full FROM repository_webhooks h WHERE h.id = ANY($4::text[]::uuid[])
	)
	INSERT INTO repository_webhook_deliveries (webhook_id, config_version, event, resource_id, payload, status)
	SELECT t.id, t.config_version, $5, $7, CASE WHEN queue.accepted THEN a.payload END,
		CASE WHEN queue.accepted THEN 'pending' ELSE 'failed' END
	FROM activity a CROSS JOIN targets t
	CROSS JOIN LATERAL (SELECT NOT t.full AND octet_length(a.payload::text) <= $9 AS accepted) queue
	ON CONFLICT (webhook_id, event, resource_id) DO NOTHING`, organizationID, issueID, commentID, ids,
		event, action, resourceID, repositoryWebhookBacklogLimit-1, repositoryWebhookPayloadLimit)
	if err != nil {
		return fmt.Errorf("enqueue repository webhook deliveries: %w", err)
	}
	if err := pruneRepositoryWebhookHistory(ctx, tx, ids); err != nil {
		return fmt.Errorf("prune repository webhook deliveries: %w", err)
	}
	return nil
}

func pruneRepositoryWebhookHistory(ctx context.Context, tx pgx.Tx, ids []string) error {
	_, err := tx.Exec(ctx, `DELETE FROM repository_webhook_deliveries WHERE id IN (
		SELECT old.id FROM unnest($1::text[]::uuid[]) AS hook(id) CROSS JOIN LATERAL (
			SELECT id FROM repository_webhook_deliveries WHERE webhook_id = hook.id
			AND status IN ('failed', 'succeeded') ORDER BY created_at DESC, id DESC OFFSET $2
		) AS old
	)`, ids, repositoryWebhookHistoryLimit)
	return err
}

// RunRepositoryWebhookWorker processes a bounded batch before waiting for the next poll.
// The caller owns the goroutine and cancels ctx at shutdown.
func (s *Store) RunRepositoryWebhookWorker(ctx context.Context, logger *slog.Logger) {
	transport := &http.Transport{
		DialContext: dialRepositoryWebhook, DisableKeepAlives: true,
		TLSHandshakeTimeout: repositoryWebhookHTTPTimeout, MaxResponseHeaderBytes: 32 << 10,
	}
	defer transport.CloseIdleConnections()
	client := repositoryWebhookClient(transport)
	for ctx.Err() == nil {
		for i := 0; i < 8 && ctx.Err() == nil; i++ {
			worked, err := s.deliverNextRepositoryWebhook(ctx, client)
			if err != nil && ctx.Err() == nil {
				logger.Error("process repository webhook queue", "error", err)
			}
			if err != nil || !worked {
				break
			}
		}
		timer := time.NewTimer(2 * time.Second)
		select {
		case <-ctx.Done():
		case <-timer.C:
		}
		timer.Stop()
	}
}

func repositoryWebhookClient(transport http.RoundTripper) *http.Client {
	return &http.Client{
		Transport: transport, Timeout: repositoryWebhookHTTPTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func (s *Store) deliverNextRepositoryWebhook(ctx context.Context, client *http.Client) (bool, error) {
	var id, hookID, event, endpoint string
	var secret, payload []byte
	var send bool
	var leaseUntil time.Time
	claimCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	err := s.pool.QueryRow(claimCtx, `WITH next AS (
		SELECT d.id, d.status = 'pending' AND h.active AND d.config_version = h.config_version AS send,
			h.url, h.secret FROM repository_webhook_deliveries d JOIN repository_webhooks h ON h.id = d.webhook_id
		WHERE d.status = 'pending' OR (d.status = 'delivering' AND d.lease_until <= now())
		ORDER BY d.created_at, d.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED
	)
	UPDATE repository_webhook_deliveries d SET status = 'delivering', lease_until = clock_timestamp() + interval '30 seconds'
	FROM next WHERE d.id = next.id RETURNING d.id, d.webhook_id, d.event, next.url, next.secret, d.payload, next.send, d.lease_until`,
	).Scan(&id, &hookID, &event, &endpoint, &secret, &payload, &send, &leaseUntil)
	cancel()
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim repository webhook delivery: %w", err)
	}
	// An expired lease may have already reached the receiver. Mark it failed instead of replaying it.
	var code *int
	var deliveredAt *time.Time
	status := "failed"
	if send {
		code = sendRepositoryWebhook(ctx, client, id, event, endpoint, secret, payload)
		attemptedAt := time.Now().UTC()
		deliveredAt = &attemptedAt
		if code != nil && *code >= 200 && *code < 300 {
			status = "succeeded"
		}
	}
	// Allow finalization after shutdown cancels the HTTP request. Both phases have deadlines.
	finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := s.finishRepositoryWebhook(finishCtx, hookID, id, status, code, deliveredAt, leaseUntil); err != nil {
		return true, fmt.Errorf("finish repository webhook delivery: %w", err)
	}
	return true, nil
}

func (s *Store) finishRepositoryWebhook(ctx context.Context, hookID, id, status string, code *int, deliveredAt *time.Time, leaseUntil time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Keep pruning and the backlog count serialized with enqueuers for this webhook.
	var locked string
	err = tx.QueryRow(ctx, `SELECT id FROM repository_webhooks WHERE id = $1 FOR NO KEY UPDATE`, hookID).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // Deleting the webhook cascades to its deliveries.
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE repository_webhook_deliveries SET status = $3, http_status = $4, delivered_at = $5,
		payload = NULL, lease_until = NULL WHERE id = $1 AND webhook_id = $2 AND status = 'delivering' AND lease_until = $6`,
		id, hookID, status, code, deliveredAt, leaseUntil)
	if err != nil {
		return err
	}
	if err := pruneRepositoryWebhookHistory(ctx, tx, []string{hookID}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func sendRepositoryWebhook(ctx context.Context, client *http.Client, id, event, endpoint string, secret, payload []byte) *int {
	if _, err := parseRepositoryWebhookURL(endpoint); err != nil {
		return nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil
	}
	signature := hmac.New(sha256.New, secret)
	signature.Write(payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "AgentForge-Webhook/1")
	req.Header.Set("X-GitHub-Event", event)
	req.Header.Set("X-GitHub-Delivery", id)
	req.Header.Set("X-Hub-Signature-256", "sha256="+hex.EncodeToString(signature.Sum(nil)))
	response, err := client.Do(req)
	if err != nil {
		return nil
	}
	response.Body.Close()
	return &response.StatusCode
}

func validateRepositoryWebhook(endpoint, secret *string, events []string) error {
	if endpoint != nil {
		if _, err := parseRepositoryWebhookURL(*endpoint); err != nil {
			return err
		}
	}
	if secret != nil && !validRepositoryWebhookSecret(*secret) {
		return fmt.Errorf("use a randomly generated UTF-8 secret of 16 to 256 bytes: %w", fs.ErrInvalid)
	}
	if events != nil {
		seen := make(map[string]bool, 2)
		if len(events) == 0 || len(events) > 2 {
			return fmt.Errorf("select one or two supported events: %w", fs.ErrInvalid)
		}
		for _, event := range events {
			if (event != "issues" && event != "issue_comment") || seen[event] {
				return fmt.Errorf("events must be a unique list of issues and issue_comment: %w", fs.ErrInvalid)
			}
			seen[event] = true
		}
	}
	return nil
}

// The caller must generate a random secret. Reject short and obviously repetitive inputs.
func validRepositoryWebhookSecret(secret string) bool {
	if len(secret) < 16 || len(secret) > 256 || !utf8.ValidString(secret) || strings.ContainsAny(secret, "\x00\uFFFD") {
		return false
	}
	characters := []rune(secret)
	seen := make(map[rune]bool, len(characters))
	for _, c := range characters {
		seen[c] = true
	}
	if len(seen) < 8 {
		return false
	}
	for period := 1; period <= len(characters)/2; period++ {
		i := period
		for i < len(characters) && characters[i] == characters[i%period] {
			i++
		}
		if i == len(characters) {
			return false
		}
	}
	return true
}

func parseRepositoryWebhookURL(raw string) (*url.URL, error) {
	invalid := fmt.Errorf("specify a public HTTPS URL without credentials or fragments: %w", fs.ErrInvalid)
	if len(raw) == 0 || len(raw) > 2048 || strings.ContainsAny(raw, "\x00#") {
		return nil, invalid
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Opaque != "" {
		return nil, invalid
	}
	if p := u.Port(); p != "" {
		if port, err := strconv.ParseUint(p, 10, 16); err != nil || port == 0 {
			return nil, invalid
		}
	} else if strings.HasSuffix(u.Host, ":") {
		return nil, invalid
	}
	host := u.Hostname()
	if addr, err := netip.ParseAddr(host); err == nil {
		if !publicRepositoryWebhookAddress(addr) {
			return nil, invalid
		}
	} else if strings.HasPrefix(u.Host, "[") || !repositoryWebhookDNSName(host) {
		return nil, invalid
	}
	return u, nil
}

func repositoryWebhookDNSName(host string) bool {
	host = strings.TrimSuffix(host, ".")
	if len(host) > 253 || !strings.Contains(host, ".") {
		return false
	}
	for _, label := range strings.Split(host, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, c := range strings.ToLower(label) {
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
				return false
			}
		}
	}
	return true
}

var repositoryWebhookGlobalIPv6 = netip.MustParsePrefix("2000::/3")

var repositoryWebhookReserved = []netip.Prefix{
	// IPv4 special-purpose space outside netip's private, loopback and link-local checks.
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.31.196.0/24"), netip.MustParsePrefix("192.52.193.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"), netip.MustParsePrefix("192.175.48.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("240.0.0.0/4"),
	// IPv6 special-purpose allocations inside 2000::/3, including transition prefixes.
	netip.MustParsePrefix("2001::/23"), netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"), netip.MustParsePrefix("2620:4f:8000::/48"),
	netip.MustParsePrefix("3fff::/20"),
}

func publicRepositoryWebhookAddress(addr netip.Addr) bool {
	if addr.Zone() != "" {
		return false
	}
	addr = addr.Unmap()
	if !addr.IsGlobalUnicast() || addr.IsPrivate() || (addr.Is6() && !repositoryWebhookGlobalIPv6.Contains(addr)) {
		return false
	}
	for _, prefix := range repositoryWebhookReserved {
		if prefix.Contains(addr) {
			return false
		}
	}
	return true
}

func dialRepositoryWebhook(ctx context.Context, network, target string) (net.Conn, error) {
	ctx, cancel := context.WithTimeout(ctx, repositoryWebhookHTTPTimeout)
	defer cancel()
	host, port, err := net.SplitHostPort(target)
	if err != nil {
		return nil, err
	}
	addresses, err := repositoryWebhookAddresses(ctx, host, net.DefaultResolver.LookupNetIP)
	if err != nil {
		return nil, err
	}
	// Dial the checked address directly. The transport still verifies TLS for the original hostname.
	dialer := net.Dialer{Timeout: repositoryWebhookHTTPTimeout}
	for _, address := range addresses {
		var connection net.Conn
		connection, err = dialer.DialContext(ctx, network, net.JoinHostPort(address.Unmap().String(), port))
		if err == nil {
			return connection, nil
		}
		if ctx.Err() != nil {
			break
		}
	}
	return nil, err
}

func repositoryWebhookAddresses(ctx context.Context, host string, lookup func(context.Context, string, string) ([]netip.Addr, error)) ([]netip.Addr, error) {
	var addresses []netip.Addr
	if address, err := netip.ParseAddr(host); err == nil {
		addresses = []netip.Addr{address}
	} else {
		if !repositoryWebhookDNSName(host) {
			return nil, errors.New("invalid webhook DNS name")
		}
		// Use a fully qualified name to prevent resolver search-domain expansion.
		resolved, err := lookup(ctx, "ip", strings.TrimSuffix(host, ".")+".")
		if err != nil {
			return nil, err
		}
		addresses = resolved
	}
	if len(addresses) == 0 || len(addresses) > 32 {
		return nil, errors.New("unexpected webhook address count")
	}
	for _, address := range addresses {
		if !publicRepositoryWebhookAddress(address) {
			return nil, errors.New("webhook address is not public")
		}
	}
	return addresses, nil
}
