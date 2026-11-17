package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
	"github.com/jackc/pgx/v5"
)

// These tests use the real Store and a real database: the handler tests elsewhere use fake lockers,
// which is how a lock that always failed went unnoticed.

func lockSuffix() string { return strconv.FormatInt(time.Now().UnixNano(), 10) }

// lockOpenStore opens a Store with an explicit pool size. Every held changeset lock is a
// session-level advisory lock that pins one pooled connection, so the tests must not depend on
// the default pool size (the CPU count).
func lockOpenStore(t *testing.T, maxConns int) (context.Context, *Store) {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("pool_max_conns", strconv.Itoa(maxConns))
	parsed.RawQuery = query.Encode()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)
	store, err := Open(ctx, parsed.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		// Close blocks until every acquired connection is returned, so a leaked lock
		// connection would hang the run: report it instead.
		closed := make(chan struct{})
		go func() { store.Close(); close(closed) }()
		select {
		case <-closed:
		case <-time.After(10 * time.Second):
			t.Errorf("store.Close is blocked: %d connections are still acquired (a lock connection leaked)", store.pool.Stat().AcquiredConns())
		}
	})
	return ctx, store
}

// lockOnce makes an unlock function safe to call from both the test body and a defer.
func lockOnce(release func()) func() {
	var once sync.Once
	return func() { once.Do(release) }
}

func lockEventually(t *testing.T, timeout time.Duration, failure string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatalf("%s (still false after %v)", failure, timeout)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// lockAdvisoryCounts asks the server, over a separate connection, how many advisory locks of the
// current database are granted and how many sessions are waiting for one.
func lockAdvisoryCounts(t *testing.T, ctx context.Context) (granted, waiting int) {
	t.Helper()
	connection, err := pgx.Connect(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close(ctx)
	err = connection.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE granted), count(*) FILTER (WHERE NOT granted)
		FROM pg_locks
		WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
	`).Scan(&granted, &waiting)
	if err != nil {
		t.Fatal(err)
	}
	return granted, waiting
}

type lockOutcome struct {
	unlock func()
	err    error
}

func lockInBackground(ctx context.Context, store *Store, organizationID, changesetID string) <-chan lockOutcome {
	outcome := make(chan lockOutcome, 1)
	go func() {
		unlock, err := store.LockChangeset(ctx, organizationID, changesetID)
		outcome <- lockOutcome{unlock, err}
	}()
	return outcome
}

func TestChangesetLockLocksAndUnlocksOrdinaryIdentifiers(t *testing.T) {
	ctx, store := lockOpenStore(t, 4)
	suffix := lockSuffix()
	unlock, err := store.LockChangeset(ctx, "lock-org-"+suffix, "lock-changeset-"+suffix)
	if err != nil {
		t.Fatalf("LockChangeset with ordinary identifiers: %v", err)
	}
	release := lockOnce(unlock)
	defer release()
	if granted, waiting := lockAdvisoryCounts(t, ctx); granted != 1 || waiting != 0 {
		t.Fatalf("while locked: advisory locks granted=%d waiting=%d, want 1 and 0", granted, waiting)
	}
	if acquired := store.pool.Stat().AcquiredConns(); acquired != 1 {
		t.Fatalf("while locked: AcquiredConns=%d, want 1 (the lock pins one pooled connection)", acquired)
	}

	release()
	lockEventually(t, 2*time.Second, "a pooled connection is still acquired after unlock", func() bool {
		return store.pool.Stat().AcquiredConns() == 0
	})
	if granted, waiting := lockAdvisoryCounts(t, ctx); granted != 0 || waiting != 0 {
		t.Fatalf("after unlock the database still has advisory locks granted=%d waiting=%d, want none", granted, waiting)
	}
}

func TestChangesetLockExcludesTheSameChangesetUntilReleased(t *testing.T) {
	ctx, store := lockOpenStore(t, 4)
	suffix := lockSuffix()
	organizationID, changesetID := "lock-org-"+suffix, "lock-changeset-"+suffix
	first, err := store.LockChangeset(ctx, organizationID, changesetID)
	if err != nil {
		t.Fatalf("first lock: %v", err)
	}
	releaseFirst := lockOnce(first)
	defer releaseFirst()

	waiterCtx, cancelWaiter := context.WithTimeout(ctx, 8*time.Second)
	defer cancelWaiter()
	second := lockInBackground(waiterCtx, store, organizationID, changesetID)

	// Prove the second caller is queued on the server, then that it stays blocked.
	lockEventually(t, 3*time.Second, "the second caller never showed up as a waiting advisory lock", func() bool {
		_, waiting := lockAdvisoryCounts(t, ctx)
		return waiting == 1
	})
	select {
	case got := <-second:
		if got.err == nil {
			got.unlock()
		}
		t.Fatalf("the second LockChangeset returned (err=%v) while the first lock was held", got.err)
	case <-time.After(400 * time.Millisecond):
	}

	releaseFirst()
	select {
	case got := <-second:
		if got.err != nil {
			t.Fatalf("the second lock after the release: %v", got.err)
		}
		got.unlock()
	case <-time.After(3 * time.Second):
		t.Fatal("the second LockChangeset did not acquire within 3s of the first release")
	}
	lockEventually(t, 2*time.Second, "a pooled connection is still acquired after both unlocks", func() bool {
		return store.pool.Stat().AcquiredConns() == 0
	})
	if granted, waiting := lockAdvisoryCounts(t, ctx); granted != 0 || waiting != 0 {
		t.Fatalf("after both unlocks the database still has advisory locks granted=%d waiting=%d", granted, waiting)
	}
}

func TestChangesetLockKeepsDistinctChangesetsIndependent(t *testing.T) {
	ctx, store := lockOpenStore(t, 16)
	prefix := "lock-" + lockSuffix() + "-"
	// Every pair is a different (organization, changeset) and must be lockable at the same
	// time. Several are the classic collisions of a naive key: delimiter shifting, no
	// delimiter at all, and NUL bytes inside the identifiers.
	pairs := []struct{ name, organizationID, changesetID string }{
		{"base", prefix + "org", "cs"},
		{"different changeset", prefix + "org", "cs-other"},
		{"same changeset, different organization", prefix + "org-other", "cs"},
		{`left of ("a", "b:c")`, prefix + "a", "b:c"},
		{`right of ("a:b", "c")`, prefix + "a:b", "c"},
		{`("ab", "c") without a delimiter`, prefix + "ab", "c"},
		{`("a", "bc") without a delimiter`, prefix + "a", "bc"},
		{"NUL inside the changeset", prefix + "n", "x\x00y"},
		{"NUL inside the organization", prefix + "n\x00x", "y"},
	}
	var releases []func()
	defer func() {
		for index := len(releases) - 1; index >= 0; index-- {
			releases[index]()
		}
	}()
	for _, pair := range pairs {
		acquireCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		unlock, err := store.LockChangeset(acquireCtx, pair.organizationID, pair.changesetID)
		cancel()
		if err != nil {
			t.Fatalf("%s (%q, %q) could not be locked while the %d earlier pairs were held: %v", pair.name, pair.organizationID, pair.changesetID, len(releases), err)
		}
		releases = append(releases, lockOnce(unlock))
	}
	if granted, waiting := lockAdvisoryCounts(t, ctx); granted != len(pairs) || waiting != 0 {
		t.Fatalf("with %d independent pairs held, the database reports granted=%d waiting=%d", len(pairs), granted, waiting)
	}
	for index := len(releases) - 1; index >= 0; index-- {
		releases[index]()
	}
	lockEventually(t, 2*time.Second, "pooled connections are still acquired after releasing every pair", func() bool {
		return store.pool.Stat().AcquiredConns() == 0
	})
	if granted, waiting := lockAdvisoryCounts(t, ctx); granted != 0 || waiting != 0 {
		t.Fatalf("after releasing every pair the database still has advisory locks granted=%d waiting=%d", granted, waiting)
	}
}

func TestChangesetLockHandlesUnicodeLongAndHostileIdentifiers(t *testing.T) {
	ctx, store := lockOpenStore(t, 4)
	prefix := "lock-" + lockSuffix() + "-"
	cases := []struct{ name, organizationID, changesetID string }{
		{"Unicode", prefix + "组织-é", "变更集-ß-🙂"},
		{"changeset of at least 512 bytes", prefix + "org", strings.Repeat("c", 600)},
		{"organization of at least 256 bytes", strings.Repeat("o", 300) + prefix, "cs"},
		{"repository merge key", prefix + "org", "repository:team/service"},
		// A client controls the changeset segment of the URL, so these reach the lock.
		{"NUL byte", prefix + "org", "a\x00b"},
		{"invalid UTF-8", prefix + "org", "\xff\xfe"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			unlock, err := store.LockChangeset(ctx, tc.organizationID, tc.changesetID)
			if err != nil {
				t.Fatalf("LockChangeset(%d-byte organization, %d-byte changeset): %v", len(tc.organizationID), len(tc.changesetID), err)
			}
			release := lockOnce(unlock)
			defer release()
			if granted, waiting := lockAdvisoryCounts(t, ctx); granted != 1 || waiting != 0 {
				t.Fatalf("while locked: granted=%d waiting=%d, want 1 and 0", granted, waiting)
			}
			release()
			lockEventually(t, 2*time.Second, "a pooled connection is still acquired after unlock", func() bool {
				return store.pool.Stat().AcquiredConns() == 0
			})
			if granted, waiting := lockAdvisoryCounts(t, ctx); granted != 0 || waiting != 0 {
				t.Fatalf("after unlock: granted=%d waiting=%d, want none", granted, waiting)
			}
		})
	}

	t.Run("long identifiers that differ only in their last byte are independent", func(t *testing.T) {
		common := strings.Repeat("d", 700)
		left, err := store.LockChangeset(ctx, prefix+"org", common+"a")
		if err != nil {
			t.Fatal(err)
		}
		releaseLeft := lockOnce(left)
		defer releaseLeft()
		acquireCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		right, err := store.LockChangeset(acquireCtx, prefix+"org", common+"b")
		if err != nil {
			t.Fatalf("a long changeset id was treated as equal to one that differs only in its last byte: %v", err)
		}
		right()
	})
}

func TestChangesetLockCancelledWaiterFailsCleanlyAndNeverAcquires(t *testing.T) {
	ctx, store := lockOpenStore(t, 4)
	suffix := lockSuffix()
	organizationID, changesetID := "lock-org-"+suffix, "lock-changeset-"+suffix
	holder, err := store.LockChangeset(ctx, organizationID, changesetID)
	if err != nil {
		t.Fatalf("holder lock: %v", err)
	}
	releaseHolder := lockOnce(holder)
	defer releaseHolder()

	waiterCtx, cancelWaiter := context.WithCancel(ctx)
	defer cancelWaiter()
	waiter := lockInBackground(waiterCtx, store, organizationID, changesetID)
	lockEventually(t, 3*time.Second, "the waiter never queued on the advisory lock", func() bool {
		_, waiting := lockAdvisoryCounts(t, ctx)
		return waiting == 1
	})

	cancelWaiter()
	select {
	case got := <-waiter:
		if got.err == nil {
			got.unlock()
			t.Fatal("a cancelled waiter acquired the lock")
		}
		if got.unlock != nil {
			t.Error("a failed LockChangeset must not return an unlock function")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the cancelled waiter did not return")
	}

	// The waiter must be gone from the server as well, not abandoned client-side while still
	// queued (it would take the lock the moment the holder releases it), and its connection
	// must be given up: only the holder's connection stays acquired.
	lockEventually(t, 5*time.Second, "the cancelled waiter is still queued on the server", func() bool {
		granted, waiting := lockAdvisoryCounts(t, ctx)
		return granted == 1 && waiting == 0
	})
	lockEventually(t, 5*time.Second, "the cancelled waiter's connection was not released", func() bool {
		return store.pool.Stat().AcquiredConns() == 1
	})

	releaseHolder()
	next, err := lockWithTimeout(ctx, store, organizationID, changesetID, 2*time.Second)
	if err != nil {
		t.Fatalf("locking after the cancelled waiter and the holder are gone: %v", err)
	}
	if granted, waiting := lockAdvisoryCounts(t, ctx); granted != 1 || waiting != 0 {
		t.Fatalf("with one new holder the database reports granted=%d waiting=%d, want 1 and 0 (a cancelled waiter must not hold the lock)", granted, waiting)
	}
	next()
	lockEventually(t, 2*time.Second, "pooled connections are still acquired after the last unlock", func() bool {
		return store.pool.Stat().AcquiredConns() == 0
	})
	if granted, waiting := lockAdvisoryCounts(t, ctx); granted != 0 || waiting != 0 {
		t.Fatalf("after the last unlock the database still has advisory locks granted=%d waiting=%d", granted, waiting)
	}
	if err := store.Ping(ctx); err != nil {
		t.Fatalf("the pool must stay usable after a cancelled waiter: %v", err)
	}
}

func lockWithTimeout(ctx context.Context, store *Store, organizationID, changesetID string, timeout time.Duration) (func(), error) {
	acquireCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return store.LockChangeset(acquireCtx, organizationID, changesetID)
}

const lockHTTPOrigin = "https://app.example.test"

// lockFakeGit resolves every ref to fixed commits; the lock tests do not run Git.
type lockFakeGit struct{}

func (lockFakeGit) ResolveRevision(_ context.Context, _, _, ref string) (delivery.GitRevision, error) {
	return delivery.GitRevision{Ref: ref, CommitSHA: strings.Repeat("a", 40), ParentSHA: strings.Repeat("b", 40)}, nil
}

func (lockFakeGit) MergeRevision(context.Context, string, string, string, string) (delivery.GitMerge, error) {
	return delivery.GitMerge{}, errors.New("the lock tests do not merge")
}

type lockChangesetBody struct {
	Changeset struct {
		ID        string `json:"id"`
		Revisions []struct {
			Ref       string `json:"ref"`
			CommitSHA string `json:"commit_sha"`
		} `json:"revisions"`
	} `json:"changeset"`
}

func TestChangesetLockWorksThroughTheRealHTTPStack(t *testing.T) {
	ctx, store := lockOpenStore(t, 8)
	suffix := lockSuffix()
	organizationID, userID, repository := "lock-http-org-"+suffix, "lock-http-user-"+suffix, "team/lock-"+suffix
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		// Organizations first: their cascade removes repositories and changesets before the user.
		_, _ = store.pool.Exec(cleanup, "DELETE FROM organizations WHERE id = $1", organizationID)
		_, _ = store.pool.Exec(cleanup, "DELETE FROM users WHERE id = $1", userID)
	})
	if _, err := store.pool.Exec(ctx, "INSERT INTO organizations (id, name) VALUES ($1, $1)", organizationID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.pool.Exec(ctx, "INSERT INTO users (id, display_name) VALUES ($1, $1)", userID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.pool.Exec(ctx, "INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')", organizationID, userID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RegisterRepository(ctx, delivery.RepositoryMetadata{OrganizationID: organizationID, Slug: repository, DefaultBranch: "main", CreatedBy: userID}); err != nil {
		t.Fatal(err)
	}
	credentials, err := identity.GenerateCredentials()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateSession(ctx, userID, credentials.SessionToken, credentials.CSRFToken, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}

	handler := httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Repository: store, Identity: store, CSRF: store, Account: store, Catalog: store,
		Git: lockFakeGit{}, Locker: store, AllowedOrigin: lockHTTPOrigin,
	})
	call := func(method, path, body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		request.AddCookie(&http.Cookie{Name: identity.SessionCookieName, Value: credentials.SessionToken})
		request.AddCookie(&http.Cookie{Name: identity.CSRFCookieName, Value: credentials.CSRFToken})
		request.Header.Set(identity.CSRFHeaderName, credentials.CSRFToken)
		request.Header.Set("Origin", lockHTTPOrigin)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}

	created := call(http.MethodPost, "/api/v1/organizations/"+organizationID+"/changesets", `{"repository":"`+repository+`","title":"Lock regression"}`)
	var changeset lockChangesetBody
	if created.Code != http.StatusCreated || json.Unmarshal(created.Body.Bytes(), &changeset) != nil || changeset.Changeset.ID == "" {
		t.Fatalf("create changeset: status=%d body=%s", created.Code, created.Body.String())
	}
	changesetID := changeset.Changeset.ID
	revisionsPath := "/api/v1/organizations/" + organizationID + "/changesets/" + changesetID + "/revisions"

	// Creating a changeset takes no lock; every later mutation does.
	response := call(http.MethodPost, revisionsPath, `{"ref":"main"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("add revision with the real lock: status=%d body=%s (503 \"Changeset lock unavailable\" is the reported bug)", response.Code, response.Body.String())
	}
	if err := json.Unmarshal(response.Body.Bytes(), &changeset); err != nil || len(changeset.Changeset.Revisions) != 1 || changeset.Changeset.Revisions[0].CommitSHA != strings.Repeat("a", 40) {
		t.Fatalf("revision response = %s (err=%v), want exactly one revision resolved by the Git provider", response.Body.String(), err)
	}
	lockEventually(t, 2*time.Second, "the request left a pooled connection acquired", func() bool {
		return store.pool.Stat().AcquiredConns() == 0
	})
	if granted, waiting := lockAdvisoryCounts(t, ctx); granted != 0 || waiting != 0 {
		t.Fatalf("after the request the database still has advisory locks granted=%d waiting=%d", granted, waiting)
	}

	// The request contends on the same key as a direct caller: while the changeset is locked
	// the request waits, and it completes once the lock is released.
	held, err := store.LockChangeset(ctx, organizationID, changesetID)
	if err != nil {
		t.Fatalf("direct lock of the changeset: %v", err)
	}
	releaseHeld := lockOnce(held)
	defer releaseHeld()
	finished := make(chan *httptest.ResponseRecorder, 1)
	go func() { finished <- call(http.MethodPost, revisionsPath, `{"ref":"main"}`) }()
	select {
	case response := <-finished:
		t.Fatalf("the request completed (status=%d) while the changeset lock was held elsewhere", response.Code)
	case <-time.After(400 * time.Millisecond):
	}
	releaseHeld()
	select {
	case response := <-finished:
		if err := json.Unmarshal(response.Body.Bytes(), &changeset); response.Code != http.StatusOK || err != nil || len(changeset.Changeset.Revisions) != 2 {
			t.Fatalf("request after the lock was released: status=%d body=%s (err=%v), want 200 with two revisions", response.Code, response.Body.String(), err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the request did not complete after the changeset lock was released")
	}
}
