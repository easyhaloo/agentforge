package postgres

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

// lockGetPromptly runs a plain query on the query pool, the way a handler loads a changeset, and
// returns how long it took. A changeset that does not exist is a successful query.
func lockGetPromptly(ctx context.Context, store *Store, organizationID string, limit time.Duration) (time.Duration, error) {
	queryCtx, cancel := context.WithTimeout(ctx, limit)
	defer cancel()
	began := time.Now()
	_, err := store.Get(queryCtx, organizationID, "no-such-changeset")
	if errors.Is(err, delivery.ErrNotFound) {
		err = nil
	}
	return time.Since(began), err
}

func TestChangesetLocksNeverStarveTheQueryPool(t *testing.T) {
	// A query pool of four connections and four held locks: as many locks as query connections.
	fx := lockOpenStore(t, lockOptions{queryPool: 4})
	organizationID := "lock-org-" + lockSuffix()
	var releases []func()
	releaseAll := func() {
		for _, release := range releases {
			release()
		}
	}
	defer releaseAll()
	for index := range 4 {
		unlock, err := lockWithTimeout(fx.ctx, fx.store, organizationID, fmt.Sprintf("changeset-%d", index), 2*time.Second)
		if err != nil {
			t.Fatalf("lock %d of 4: %v", index+1, err)
		}
		releases = append(releases, lockOnce(unlock))
	}
	fx.wantCounts(t, "with four locks held", 4, 0)

	// What the lock holders themselves do next: load and save through the query pool.
	took, err := lockGetPromptly(fx.ctx, fx.store, organizationID, 1500*time.Millisecond)
	if err != nil {
		t.Fatalf("a plain Store.Get failed after %v: %v (four locks pinned every query connection)", took, err)
	}
	if took > time.Second {
		t.Errorf("a plain Store.Get took %v with four locks held, want milliseconds", took)
	}
	// All four query connections are usable at once.
	var wait sync.WaitGroup
	failures := make(chan error, 4)
	for range 4 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if _, err := lockGetPromptly(fx.ctx, fx.store, organizationID, 1500*time.Millisecond); err != nil {
				failures <- err
			}
		}()
	}
	wait.Wait()
	close(failures)
	for err := range failures {
		t.Errorf("a concurrent Store.Get failed with four locks held: %v", err)
	}
	if acquired := fx.store.pool.Stat().AcquiredConns(); acquired != 0 {
		t.Errorf("the query pool has %d acquired connections while only locks are held: locks must take their connections from the lock pool", acquired)
	}
	if acquired := fx.store.lockPool.Stat().AcquiredConns(); acquired != 4 {
		t.Errorf("the lock pool has %d acquired connections, want 4 (one per held lock)", acquired)
	}
}

func TestChangesetLockWaitIsBounded(t *testing.T) {
	const limit = 300 * time.Millisecond
	fx := lockOpenStore(t, lockOptions{queryPool: 4, waitTimeout: limit})
	suffix := lockSuffix()
	organizationID, changesetID := "lock-org-"+suffix, "lock-changeset-"+suffix
	holder, err := fx.store.LockChangeset(fx.ctx, organizationID, changesetID)
	if err != nil {
		t.Fatalf("holder lock: %v", err)
	}
	releaseHolder := lockOnce(holder)
	defer releaseHolder()

	// Cancellable so that, if the wait were unbounded, the test can still end cleanly.
	waiterCtx, cancelWaiter := context.WithCancel(fx.ctx)
	defer cancelWaiter()
	began := time.Now()
	waiter := lockInBackground(waiterCtx, fx.store, organizationID, changesetID)
	var got lockOutcome
	select {
	case got = <-waiter:
	case <-time.After(5 * time.Second):
		t.Fatalf("the waiter is still blocked after %v although lockWaitTimeout is %v: the wait is not bounded", time.Since(began).Round(10*time.Millisecond), limit)
	}
	took := time.Since(began)
	if got.err == nil {
		got.unlock()
		t.Fatal("the waiter acquired a lock that is held elsewhere")
	}
	if got.unlock != nil {
		t.Error("a failed LockChangeset must not return an unlock function")
	}
	if !errors.Is(got.err, context.DeadlineExceeded) {
		t.Errorf("the timeout error = %v, want one that wraps context.DeadlineExceeded", got.err)
	}
	if took < 250*time.Millisecond || took > 2*time.Second {
		t.Errorf("the waiter failed after %v, want roughly lockWaitTimeout (%v)", took.Round(10*time.Millisecond), limit)
	}

	// The holder still holds; the waiter left the server's queue and gave its connection back.
	lockEventually(t, 3*time.Second, "the timed-out waiter is still queued on the server or still holds a lock connection", func() bool {
		granted, waiting := fx.counts(t)
		return granted == 1 && waiting == 0 && fx.store.lockPool.Stat().AcquiredConns() == 1
	})
	// It never acquires later: not while the holder holds, and not when the holder lets go.
	time.Sleep(2 * limit)
	fx.wantCounts(t, "after the timed-out waiter had time to take the lock", 1, 0)
	releaseHolder()
	fx.wantIdle(t, "after the holder released (a leftover waiter would hold the lock now)")
	time.Sleep(limit)
	fx.wantCounts(t, "a moment after the release", 0, 0)

	next, err := lockWithTimeout(fx.ctx, fx.store, organizationID, changesetID, 2*time.Second)
	if err != nil {
		t.Fatalf("a new lock after the release: %v", err)
	}
	next()
	fx.wantIdle(t, "after the new lock")
}

// The wait limit is for getting the lock; it must never limit how long the lock is held.
func TestChangesetLockHeldLongerThanTheWaitLimitStaysHeld(t *testing.T) {
	const limit = 200 * time.Millisecond
	fx := lockOpenStore(t, lockOptions{queryPool: 4, waitTimeout: limit})
	suffix := lockSuffix()
	organizationID, changesetID := "lock-org-"+suffix, "lock-changeset-"+suffix
	unlock, err := fx.store.LockChangeset(fx.ctx, organizationID, changesetID)
	if err != nil {
		t.Fatal(err)
	}
	release := lockOnce(unlock)
	defer release()

	time.Sleep(4 * limit)
	fx.wantCounts(t, "after holding the lock for four times lockWaitTimeout", 1, 0)
	if acquired := fx.store.lockPool.Stat().AcquiredConns(); acquired != 1 {
		t.Fatalf("after holding the lock for four times lockWaitTimeout the lock pool has %d acquired connections, want 1", acquired)
	}

	release()
	fx.wantIdle(t, "after unlocking a long-held lock")
	// The connection went back to the pool instead of being destroyed: the next lock reuses it.
	before := fx.store.lockPool.Stat().NewConnsCount()
	again, err := fx.store.LockChangeset(fx.ctx, organizationID, changesetID)
	if err != nil {
		t.Fatal(err)
	}
	again()
	if after := fx.store.lockPool.Stat().NewConnsCount(); after != before {
		t.Fatalf("unlocking after a long hold destroyed the connection: new connections went from %d to %d", before, after)
	}
}

func TestChangesetLockPoolExhaustionFailsAfterTheLimitWhileReadsKeepWorking(t *testing.T) {
	const limit = 300 * time.Millisecond
	fx := lockOpenStore(t, lockOptions{queryPool: 4, lockPool: 3, waitTimeout: limit})
	organizationID := "lock-org-" + lockSuffix()
	var releases []func()
	releaseAll := func() {
		for _, release := range releases {
			release()
		}
	}
	defer releaseAll()
	for index := range 3 {
		unlock, err := lockWithTimeout(fx.ctx, fx.store, organizationID, fmt.Sprintf("changeset-%d", index), 2*time.Second)
		if err != nil {
			t.Fatalf("holder %d of 3: %v", index+1, err)
		}
		releases = append(releases, lockOnce(unlock))
	}

	// Three holders use every lock connection; a fourth request, on another key, has to wait for one.
	fourthCtx, cancelFourth := context.WithCancel(fx.ctx)
	defer cancelFourth()
	began := time.Now()
	fourth := lockInBackground(fourthCtx, fx.store, organizationID, "changeset-4")

	// While it waits, reads on the query pool answer in milliseconds.
	if took, err := lockGetPromptly(fx.ctx, fx.store, organizationID, time.Second); err != nil || took > 500*time.Millisecond {
		t.Errorf("a plain Store.Get while the lock pool is exhausted took %v (err=%v), want milliseconds", took.Round(time.Millisecond), err)
	}

	var got lockOutcome
	select {
	case got = <-fourth:
	case <-time.After(5 * time.Second):
		t.Fatalf("the fourth request is still blocked after %v although lockWaitTimeout is %v: the wait is not bounded", time.Since(began).Round(10*time.Millisecond), limit)
	}
	took := time.Since(began)
	if got.err == nil {
		got.unlock()
		t.Fatal("the fourth request was granted a lock although the lock pool has three connections and three locks are held")
	}
	if !errors.Is(got.err, context.DeadlineExceeded) {
		t.Errorf("the timeout error = %v, want one that wraps context.DeadlineExceeded", got.err)
	}
	if took < 250*time.Millisecond || took > 2*time.Second {
		t.Errorf("the fourth request failed after %v, want roughly lockWaitTimeout (%v)", took.Round(10*time.Millisecond), limit)
	}
	fx.wantCounts(t, "with three holders after the fourth request failed", 3, 0)

	// A holder lets go: the pool is usable again.
	releases[0]()
	next, err := lockWithTimeout(fx.ctx, fx.store, organizationID, "changeset-4", 2*time.Second)
	if err != nil {
		t.Fatalf("a lock after a holder released its connection: %v", err)
	}
	releases = append(releases, lockOnce(next))
}

func TestChangesetLockPoolIsSeparateBoundedAndLazy(t *testing.T) {
	// pool_min_conns makes the query pool open connections eagerly; the lock pool must not inherit that.
	fx := lockOpenStore(t, lockOptions{queryPool: 4, lockPool: 5, dsn: map[string]string{"pool_min_conns": "2"}})
	store := fx.store
	if store.lockPool == store.pool {
		t.Fatal("the lock pool is the query pool: locks and queries compete for the same connections")
	}
	if got := store.lockPool.Config().MaxConns; got != 5 {
		t.Errorf("the lock pool has MaxConns=%d, want lockPoolMaxConns (5)", got)
	}
	if got := store.pool.Config().MaxConns; got != 4 {
		t.Errorf("the query pool has MaxConns=%d, want 4 (the DSN value)", got)
	}
	if got := store.lockPool.Config().MinConns; got != 0 {
		t.Errorf("the lock pool has MinConns=%d, want 0: no lock connection until one is needed", got)
	}
	lockEventually(t, 3*time.Second, "the query pool never opened its pool_min_conns connections", func() bool {
		return store.pool.Stat().TotalConns() >= 2
	})
	time.Sleep(300 * time.Millisecond)
	if total := store.lockPool.Stat().TotalConns(); total != 0 {
		t.Errorf("the lock pool opened %d connections before any lock was requested", total)
	}
}

func TestStoreCloseClosesBothPools(t *testing.T) {
	fx := lockOpenStore(t, lockOptions{queryPool: 4, lockPool: 3})
	store := fx.store
	unlock, err := store.LockChangeset(fx.ctx, "lock-org-"+lockSuffix(), "changeset")
	if err != nil {
		t.Fatal(err)
	}
	unlock()
	if total := store.lockPool.Stat().TotalConns(); total == 0 {
		t.Fatal("the lock pool has no connection after a lock: nothing to close")
	}

	store.Close()
	if total := store.lockPool.Stat().TotalConns(); total != 0 {
		t.Errorf("the lock pool still has %d connections after Close", total)
	}
	if total := store.pool.Stat().TotalConns(); total != 0 {
		t.Errorf("the query pool still has %d connections after Close", total)
	}
	if unlock, err := store.LockChangeset(fx.ctx, "lock-org", "changeset"); err == nil {
		unlock()
		t.Error("a closed store granted a lock")
	}
	store.Close() // a second Close must not panic; the fixture closes the store once more
}
