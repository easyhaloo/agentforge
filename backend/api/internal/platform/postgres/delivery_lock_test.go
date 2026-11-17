package postgres

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// These tests use the real Store and a real database: the handler tests elsewhere use fake lockers,
// which is how a lock that always failed went unnoticed.

func lockSuffix() string { return strconv.FormatInt(time.Now().UnixNano(), 10) }

// lockFixture is a Store under test plus a view of its advisory locks on the server.
type lockFixture struct {
	ctx   context.Context
	store *Store
	// application is the application_name of every connection of both pools, so server-side
	// counts ignore advisory locks held by unrelated sessions (a concurrent migration, for example).
	application string
}

// lockOptions tunes one Store under test. Every held changeset lock pins one connection of the
// lock pool and every waiter pins one too, so tests must not depend on the default pool sizes
// (max(4, NumCPU) for queries, 16 for locks) unless the default is what they are about.
type lockOptions struct {
	queryPool   int               // pool_max_conns of the query pool; 0 keeps the pgxpool default
	lockPool    int32             // lockPoolMaxConns while the store is open; 0 keeps the default
	waitTimeout time.Duration     // lockWaitTimeout while the test runs; 0 keeps the default
	dsn         map[string]string // further DSN parameters, for example pool_min_conns
}

func lockOpenStore(t *testing.T, options lockOptions) *lockFixture {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	application := "af_lock_" + lockSuffix()
	query := parsed.Query()
	query.Set("application_name", application)
	if options.queryPool > 0 {
		query.Set("pool_max_conns", strconv.Itoa(options.queryPool))
	}
	for key, value := range options.dsn {
		query.Set(key, value)
	}
	parsed.RawQuery = query.Encode()

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	t.Cleanup(cancel)

	// lockPoolMaxConns is read when the Store opens and lockWaitTimeout on every LockChangeset
	// call. Both are restored after the store is closed (cleanups run last in, first out).
	previousLockPool, previousWait := lockPoolMaxConns, lockWaitTimeout
	t.Cleanup(func() { lockPoolMaxConns, lockWaitTimeout = previousLockPool, previousWait })
	if options.lockPool > 0 {
		lockPoolMaxConns = options.lockPool
	}
	if options.waitTimeout > 0 {
		lockWaitTimeout = options.waitTimeout
	}

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
			t.Errorf("store.Close is blocked: %d query connections and %d lock connections are still acquired (a connection leaked)",
				store.pool.Stat().AcquiredConns(), store.lockPool.Stat().AcquiredConns())
		}
	})
	if options.queryPool > 0 {
		if got := store.pool.Config().MaxConns; got != int32(options.queryPool) {
			t.Fatalf("pool_max_conns was not applied: MaxConns=%d, want %d", got, options.queryPool)
		}
	}
	return &lockFixture{ctx: ctx, store: store, application: application}
}

// counts asks the server, over a separate connection, how many advisory locks held by this
// store's connections are granted and how many are still waiting to be granted.
func (f *lockFixture) counts(t *testing.T) (granted, waiting int) {
	t.Helper()
	connection, err := pgx.Connect(f.ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close(f.ctx)
	err = connection.QueryRow(f.ctx, `
		SELECT count(*) FILTER (WHERE l.granted), count(*) FILTER (WHERE NOT l.granted)
		FROM pg_locks AS l JOIN pg_stat_activity AS a ON a.pid = l.pid
		WHERE l.locktype = 'advisory' AND a.application_name = $1
	`, f.application).Scan(&granted, &waiting)
	if err != nil {
		t.Fatal(err)
	}
	return granted, waiting
}

// wantCounts fails unless the server reports exactly the given granted and waiting advisory locks.
func (f *lockFixture) wantCounts(t *testing.T, when string, wantGranted, wantWaiting int) {
	t.Helper()
	if granted, waiting := f.counts(t); granted != wantGranted || waiting != wantWaiting {
		t.Fatalf("%s: advisory locks granted=%d waiting=%d, want %d and %d", when, granted, waiting, wantGranted, wantWaiting)
	}
}

// wantIdle fails unless every lock connection went back to its pool and the server holds no lock.
func (f *lockFixture) wantIdle(t *testing.T, when string) {
	t.Helper()
	lockEventually(t, 2*time.Second, when+": a lock connection is still acquired", func() bool {
		return f.store.lockPool.Stat().AcquiredConns() == 0
	})
	f.wantCounts(t, when, 0, 0)
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

func lockWithTimeout(ctx context.Context, store *Store, organizationID, changesetID string, timeout time.Duration) (func(), error) {
	acquireCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return store.LockChangeset(acquireCtx, organizationID, changesetID)
}

func TestChangesetLockLocksAndUnlocksOrdinaryIdentifiers(t *testing.T) {
	fx := lockOpenStore(t, lockOptions{queryPool: 4})
	suffix := lockSuffix()
	unlock, err := fx.store.LockChangeset(fx.ctx, "lock-org-"+suffix, "lock-changeset-"+suffix)
	if err != nil {
		t.Fatalf("LockChangeset with ordinary identifiers: %v", err)
	}
	release := lockOnce(unlock)
	defer release()
	fx.wantCounts(t, "while locked", 1, 0)
	if acquired := fx.store.lockPool.Stat().AcquiredConns(); acquired != 1 {
		t.Fatalf("while locked: AcquiredConns=%d, want 1 (the lock pins one pooled connection)", acquired)
	}

	release()
	// An unlock with a key that differs from the lock key would return the connection to the pool
	// with the lock still held, so the server is asked, not only the pool.
	fx.wantIdle(t, "after unlock")
}

func TestChangesetLockExcludesTheSameChangesetUntilReleased(t *testing.T) {
	fx := lockOpenStore(t, lockOptions{queryPool: 4})
	suffix := lockSuffix()
	organizationID, changesetID := "lock-org-"+suffix, "lock-changeset-"+suffix
	first, err := fx.store.LockChangeset(fx.ctx, organizationID, changesetID)
	if err != nil {
		t.Fatalf("first lock: %v", err)
	}
	releaseFirst := lockOnce(first)
	defer releaseFirst()

	waiterCtx, cancelWaiter := context.WithTimeout(fx.ctx, 8*time.Second)
	defer cancelWaiter()
	second := lockInBackground(waiterCtx, fx.store, organizationID, changesetID)

	// Prove the second caller is queued on the server, then that it stays blocked.
	lockEventually(t, 3*time.Second, "the second caller never showed up as a waiting advisory lock", func() bool {
		_, waiting := fx.counts(t)
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
	fx.wantIdle(t, "after both unlocks")
}

func TestChangesetLockKeepsDistinctChangesetsIndependent(t *testing.T) {
	// Ten locks are held at once, so the pool that serves them must have at least ten connections.
	fx := lockOpenStore(t, lockOptions{queryPool: 16})
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
		// The merge handler holds the changeset lock and the repository lock together.
		{"repository key next to the changeset key", prefix + "org", "repository:team/service"},
	}
	var releases []func()
	releaseAll := func() {
		for index := len(releases) - 1; index >= 0; index-- {
			releases[index]()
		}
	}
	defer releaseAll()
	for _, pair := range pairs {
		unlock, err := lockWithTimeout(fx.ctx, fx.store, pair.organizationID, pair.changesetID, 2*time.Second)
		if err != nil {
			t.Fatalf("%s (%q, %q) could not be locked while the %d earlier pairs were held: %v", pair.name, pair.organizationID, pair.changesetID, len(releases), err)
		}
		releases = append(releases, lockOnce(unlock))
	}
	fx.wantCounts(t, "with every pair held", len(pairs), 0)

	releaseAll()
	fx.wantIdle(t, "after releasing every pair")
}

func TestChangesetLockHandlesUnicodeLongAndHostileIdentifiers(t *testing.T) {
	fx := lockOpenStore(t, lockOptions{queryPool: 4})
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
			unlock, err := fx.store.LockChangeset(fx.ctx, tc.organizationID, tc.changesetID)
			if err != nil {
				t.Fatalf("LockChangeset(%d-byte organization, %d-byte changeset): %v", len(tc.organizationID), len(tc.changesetID), err)
			}
			release := lockOnce(unlock)
			defer release()
			fx.wantCounts(t, "while locked", 1, 0)
			release()
			fx.wantIdle(t, "after unlock")
		})
	}

	t.Run("long identifiers that differ only in their last byte are independent", func(t *testing.T) {
		common := strings.Repeat("d", 700)
		left, err := fx.store.LockChangeset(fx.ctx, prefix+"org", common+"a")
		if err != nil {
			t.Fatal(err)
		}
		releaseLeft := lockOnce(left)
		defer releaseLeft()
		right, err := lockWithTimeout(fx.ctx, fx.store, prefix+"org", common+"b", 2*time.Second)
		if err != nil {
			t.Fatalf("a long changeset id was treated as equal to one that differs only in its last byte: %v", err)
		}
		right()
	})
}

func TestChangesetLockCancelledWaiterFailsCleanlyAndNeverAcquires(t *testing.T) {
	fx := lockOpenStore(t, lockOptions{queryPool: 4})
	suffix := lockSuffix()
	organizationID, changesetID := "lock-org-"+suffix, "lock-changeset-"+suffix

	// A context that is already cancelled never reaches the database and leaks nothing.
	dead, stop := context.WithCancel(fx.ctx)
	stop()
	if unlock, err := fx.store.LockChangeset(dead, organizationID, changesetID); err == nil || unlock != nil {
		t.Fatalf("LockChangeset with a cancelled context returned unlock!=nil=%v err=%v, want an error and no unlock function", unlock != nil, err)
	}
	fx.wantIdle(t, "after a lock attempt with an already cancelled context")

	holder, err := fx.store.LockChangeset(fx.ctx, organizationID, changesetID)
	if err != nil {
		t.Fatalf("holder lock: %v", err)
	}
	releaseHolder := lockOnce(holder)
	defer releaseHolder()

	waiterCtx, cancelWaiter := context.WithCancel(fx.ctx)
	defer cancelWaiter()
	waiter := lockInBackground(waiterCtx, fx.store, organizationID, changesetID)
	lockEventually(t, 3*time.Second, "the waiter never queued on the advisory lock", func() bool {
		_, waiting := fx.counts(t)
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
		granted, waiting := fx.counts(t)
		return granted == 1 && waiting == 0
	})
	lockEventually(t, 5*time.Second, "the cancelled waiter's connection was not released", func() bool {
		return fx.store.lockPool.Stat().AcquiredConns() == 1
	})

	releaseHolder()
	next, err := lockWithTimeout(fx.ctx, fx.store, organizationID, changesetID, 2*time.Second)
	if err != nil {
		t.Fatalf("locking after the cancelled waiter and the holder are gone: %v", err)
	}
	fx.wantCounts(t, "with one new holder (a cancelled waiter must not hold the lock)", 1, 0)
	next()
	fx.wantIdle(t, "after the last unlock")
	if err := fx.store.Ping(fx.ctx); err != nil {
		t.Fatalf("the pool must stay usable after a cancelled waiter: %v", err)
	}
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
	fx := lockOpenStore(t, lockOptions{queryPool: 8})
	ctx, store := fx.ctx, fx.store
	repository := "team/lock-" + lockSuffix()
	h := newLockHTTP(t, fx, 0, repository)

	created := h.do(ctx, http.MethodPost, h.changesetsPath(), `{"repository":"`+repository+`","title":"Lock regression"}`)
	var changeset lockChangesetBody
	if created.Code != http.StatusCreated || json.Unmarshal(created.Body.Bytes(), &changeset) != nil || changeset.Changeset.ID == "" {
		t.Fatalf("create changeset: status=%d body=%s", created.Code, created.Body.String())
	}
	changesetID := changeset.Changeset.ID
	revisionsPath := h.revisionsPath(changesetID)

	// Creating a changeset takes no lock; every later mutation does.
	response := h.do(ctx, http.MethodPost, revisionsPath, `{"ref":"main"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("add revision with the real lock: status=%d body=%s (503 \"Changeset lock unavailable\" is the reported bug)", response.Code, response.Body.String())
	}
	if err := json.Unmarshal(response.Body.Bytes(), &changeset); err != nil || len(changeset.Changeset.Revisions) != 1 || changeset.Changeset.Revisions[0].CommitSHA != lockCommit {
		t.Fatalf("revision response = %s (err=%v), want exactly one revision resolved by the Git provider", response.Body.String(), err)
	}
	fx.wantIdle(t, "after the request")

	// The request contends on the same key as a direct caller: while the changeset is locked
	// the request waits, and it completes once the lock is released.
	held, err := store.LockChangeset(ctx, h.organizationID, changesetID)
	if err != nil {
		t.Fatalf("direct lock of the changeset: %v", err)
	}
	releaseHeld := lockOnce(held)
	defer releaseHeld()
	finished := make(chan *httptest.ResponseRecorder, 1)
	go func() { finished <- h.do(ctx, http.MethodPost, revisionsPath, `{"ref":"main"}`) }()
	lockEventually(t, 3*time.Second, "the request never queued on the changeset lock", func() bool {
		_, waiting := fx.counts(t)
		return waiting == 1
	})
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
	fx.wantIdle(t, "after the contended request")
}
