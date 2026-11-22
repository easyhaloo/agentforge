package postgres

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

const (
	lockHTTPOrigin = "https://app.example.test"
	// lockBudget is the deadline of every request in a burst: generous for a healthy server, so
	// a request that is still unanswered by then is stuck, not slow.
	lockBudget = 10 * time.Second
)

var (
	lockCommit = strings.Repeat("a", 40)
	lockParent = strings.Repeat("b", 40)
	// lockSequence keeps changeset identifiers unique within a test.
	lockSequence atomic.Int64
)

func lockMust(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// lockFakeGit resolves every ref to fixed commits and "merges" after a pause that stands in for
// the Git work (no database); the lock tests do not run Git.
type lockFakeGit struct{ mergeDelay time.Duration }

func (lockFakeGit) ResolveRevision(_ context.Context, _, _, ref string) (delivery.GitRevision, error) {
	return delivery.GitRevision{Ref: ref, CommitSHA: lockCommit, ParentSHA: lockParent}, nil
}

func (g lockFakeGit) MergeRevision(ctx context.Context, _, _, _, targetRef, _ string) (delivery.GitMerge, error) {
	select {
	case <-time.After(g.mergeDelay):
	case <-ctx.Done():
		return delivery.GitMerge{}, ctx.Err()
	}
	return delivery.GitMerge{CommitSHA: strings.Repeat("c", 40), TargetRef: targetRef}, nil
}

// lockBarrierCatalog makes merges overlap deterministically. A merge asks the catalog for the
// repository list between taking its changeset lock and its repository lock, so once armed the
// catalog holds every caller back until `parties` of them have arrived: all of them then hold their
// first lock before any of them asks for its second.
type lockBarrierCatalog struct {
	delivery.RepositoryCatalog
	mu      sync.Mutex
	parties int
	arrived int
	open    chan struct{}
}

func (c *lockBarrierCatalog) arm(parties int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.parties, c.arrived, c.open = parties, 0, make(chan struct{})
}

func (c *lockBarrierCatalog) ListRepositories(ctx context.Context, organizationID string) ([]delivery.RepositoryMetadata, error) {
	c.mu.Lock()
	armed, open := c.parties > 0, c.open
	if armed {
		c.arrived++
		if c.arrived == c.parties {
			close(c.open)
		}
	}
	c.mu.Unlock()
	if armed {
		select {
		case <-open:
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(5 * time.Second): // somebody never arrived: do not hang the test
		}
	}
	return c.RepositoryCatalog.ListRepositories(ctx, organizationID)
}

// lockHTTP is the real HTTP stack over a real Store: one organization whose owner has a session,
// real identity, CSRF, repository catalog and lock, and only Git faked.
type lockHTTP struct {
	fx             *lockFixture
	organizationID string
	userID         string
	credentials    identity.Credentials
	catalog        *lockBarrierCatalog
	handler        http.Handler
}

// newLockHTTP creates the organization and registers the repositories (default branch main).
func newLockHTTP(t *testing.T, fx *lockFixture, mergeDelay time.Duration, repositories ...string) *lockHTTP {
	t.Helper()
	ctx, store := fx.ctx, fx.store
	suffix := lockSuffix()
	h := &lockHTTP{fx: fx, organizationID: "lock-http-org-" + suffix, userID: "lock-http-user-" + suffix}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		// Organizations first: their cascade removes repositories and changesets before the user.
		_, _ = store.pool.Exec(cleanup, "DELETE FROM organizations WHERE id = $1", h.organizationID)
		_, _ = store.pool.Exec(cleanup, "DELETE FROM users WHERE id = $1", h.userID)
	})
	_, err := store.pool.Exec(ctx, "INSERT INTO organizations (id, name) VALUES ($1, $1)", h.organizationID)
	lockMust(t, err)
	_, err = store.pool.Exec(ctx, "INSERT INTO users (id, display_name) VALUES ($1, $1)", h.userID)
	lockMust(t, err)
	_, err = store.pool.Exec(ctx, "INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')", h.organizationID, h.userID)
	lockMust(t, err)
	for _, repository := range repositories {
		_, err := store.RegisterRepository(ctx, delivery.RepositoryMetadata{OrganizationID: h.organizationID, Slug: repository, DefaultBranch: "main", CreatedBy: h.userID})
		lockMust(t, err)
	}
	h.credentials, err = identity.GenerateCredentials()
	lockMust(t, err)
	_, err = store.CreateSession(ctx, h.userID, h.credentials.SessionToken, h.credentials.CSRFToken, time.Now().Add(time.Hour))
	lockMust(t, err)

	h.catalog = &lockBarrierCatalog{RepositoryCatalog: store}
	h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Repository: store, Identity: store, CSRF: store, Account: store, Catalog: h.catalog,
		Git: lockFakeGit{mergeDelay: mergeDelay}, Locker: store, AllowedOrigin: lockHTTPOrigin,
	})
	return h
}

func (h *lockHTTP) changesetsPath() string {
	return "/api/v1/organizations/" + h.organizationID + "/changesets"
}
func (h *lockHTTP) revisionsPath(changesetID string) string {
	return h.changesetsPath() + "/" + changesetID + "/revisions"
}
func (h *lockHTTP) mergePath(changesetID string) string {
	return h.changesetsPath() + "/" + changesetID + "/merge"
}

// do runs one request through the handler with a session, the CSRF cookie and header, and the origin.
func (h *lockHTTP) do(ctx context.Context, method, path, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body)).WithContext(ctx)
	request.AddCookie(&http.Cookie{Name: identity.SessionCookieName, Value: h.credentials.SessionToken})
	request.AddCookie(&http.Cookie{Name: identity.CSRFCookieName, Value: h.credentials.CSRFToken})
	request.Header.Set(identity.CSRFHeaderName, h.credentials.CSRFToken)
	request.Header.Set("Origin", lockHTTPOrigin)
	response := httptest.NewRecorder()
	h.handler.ServeHTTP(response, request)
	return response
}

type lockCall struct{ method, path, body string }

type lockReply struct {
	status int
	body   string
	took   time.Duration
}

// burst starts every call at the same moment, each with a context that expires after budget, and
// returns the replies in call order once all of them have answered.
func (h *lockHTTP) burst(budget time.Duration, calls []lockCall) []lockReply {
	replies := make([]lockReply, len(calls))
	start := make(chan struct{})
	var wait sync.WaitGroup
	for index, call := range calls {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			ctx, cancel := context.WithTimeout(h.fx.ctx, budget)
			defer cancel()
			began := time.Now()
			response := h.do(ctx, call.method, call.path, call.body)
			replies[index] = lockReply{response.Code, response.Body.String(), time.Since(began)}
		}()
	}
	close(start)
	wait.Wait()
	return replies
}

func lockCount(replies []lockReply, status int) int {
	count := 0
	for _, reply := range replies {
		if reply.status == status {
			count++
		}
	}
	return count
}

// lockStatuses summarises replies as "200 x36" or "200 x20, 503 x16".
func lockStatuses(replies []lockReply) string {
	counts := map[int]int{}
	for _, reply := range replies {
		counts[reply.status]++
	}
	statuses := make([]int, 0, len(counts))
	for status := range counts {
		statuses = append(statuses, status)
	}
	sort.Ints(statuses)
	parts := make([]string, 0, len(statuses))
	for _, status := range statuses {
		parts = append(parts, fmt.Sprintf("%d x%d", status, counts[status]))
	}
	return strings.Join(parts, ", ")
}

func lockSlowest(replies []lockReply) time.Duration {
	slowest := time.Duration(0)
	for _, reply := range replies {
		slowest = max(slowest, reply.took)
	}
	return slowest.Round(10 * time.Millisecond)
}

// newChangeset stores an empty changeset directly and returns its identifier.
func (h *lockHTTP) newChangeset(t *testing.T, repository string) string {
	t.Helper()
	id := fmt.Sprintf("lock-cs-%d", lockSequence.Add(1))
	changeset, err := delivery.NewChangeset(delivery.ID(id), repository, "Lock load", "lock-author", time.Now().UTC())
	lockMust(t, err)
	_, err = h.fx.store.Create(h.fx.ctx, h.organizationID, changeset)
	lockMust(t, err)
	return id
}

// newMergeReadyChangeset stores a changeset that passes every merge gate: a revision with a passing
// evaluation against the base the fake Git reports, active evidence, and an approved review.
func (h *lockHTTP) newMergeReadyChangeset(t *testing.T, repository string) string {
	t.Helper()
	now := time.Now().UTC()
	id := fmt.Sprintf("lock-merge-%d", lockSequence.Add(1))
	revision, evaluation, evidence, review := delivery.ID("rev-"+id), delivery.ID("eval-"+id), delivery.ID("evidence-"+id), delivery.ID("review-"+id)
	changeset, err := delivery.NewChangeset(delivery.ID(id), repository, "Merge shape", "lock-author", now)
	lockMust(t, err)
	lockMust(t, changeset.AddGitRevision(revision, "main", lockCommit, lockParent, "lock-author", now))
	lockMust(t, changeset.RecordEvaluationAgainstBase(evaluation, revision, lockCommit, delivery.EvaluationPassed, "passed", "lock-author", now))
	lockMust(t, changeset.AttachEvidence(evidence, revision, evaluation, "report", "evidence://"+id, "lock-author", now))
	lockMust(t, changeset.AssignReview(review, revision, "lock-reviewer", "lock-author", "", now))
	lockMust(t, changeset.DecideReview(review, true, "lock-reviewer", "approved", now))
	lockMust(t, changeset.ValidateMerge())
	_, err = h.fx.store.Create(h.fx.ctx, h.organizationID, changeset)
	lockMust(t, err)
	return id
}

func (h *lockHTTP) stored(t *testing.T, changesetID string) delivery.StoredChangeset {
	t.Helper()
	stored, err := h.fx.store.Get(h.fx.ctx, h.organizationID, delivery.ID(changesetID))
	lockMust(t, err)
	return stored
}

func TestChangesetLockServesMoreConcurrentRequestsThanThePoolHasConnections(t *testing.T) {
	// The default query pool, as in production: max(4, NumCPU) connections.
	fx := lockOpenStore(t, lockOptions{})
	pool := int(fx.store.pool.Config().MaxConns)
	repository := "team/lock-scale-" + lockSuffix()
	h := newLockHTTP(t, fx, 0, repository)

	ids := make([]string, 3*pool)
	calls := make([]lockCall, len(ids))
	for index := range ids {
		ids[index] = h.newChangeset(t, repository)
		calls[index] = lockCall{http.MethodPost, h.revisionsPath(ids[index]), `{"ref":"main"}`}
	}
	replies := h.burst(lockBudget, calls)
	t.Logf("PROBE query pool of %d connections, %d concurrent add-revision requests on %d different changesets: %s (slowest %v)",
		pool, len(calls), len(ids), lockStatuses(replies), lockSlowest(replies))
	if ok := lockCount(replies, http.StatusOK); ok != len(calls) {
		t.Fatalf("%d of %d concurrent requests returned 200 (%s); every request must be served although there are more requests than pool connections", ok, len(calls), lockStatuses(replies))
	}
	for _, id := range ids {
		if revisions := len(h.stored(t, id).Changeset.Revisions); revisions != 1 {
			t.Errorf("changeset %s has %d revisions, want 1", id, revisions)
		}
	}
	fx.wantIdle(t, "after the burst")
}

func TestChangesetLockSerializesConcurrentRevisionsOnOneChangeset(t *testing.T) {
	fx := lockOpenStore(t, lockOptions{queryPool: 8})
	repository := "team/lock-serial-" + lockSuffix()
	h := newLockHTTP(t, fx, 0, repository)

	// perChangeset concurrent requests on each of `changesets` changesets, all at once.
	run := func(t *testing.T, perChangeset, changesets int) {
		ids := make([]string, changesets)
		var calls []lockCall
		for index := range ids {
			ids[index] = h.newChangeset(t, repository)
			for range perChangeset {
				calls = append(calls, lockCall{http.MethodPost, h.revisionsPath(ids[index]), `{"ref":"main"}`})
			}
		}
		replies := h.burst(lockBudget, calls)
		t.Logf("PROBE %d concurrent add-revision requests, %d on each of %d changeset(s): %s (slowest %v)",
			len(calls), perChangeset, changesets, lockStatuses(replies), lockSlowest(replies))
		if ok := lockCount(replies, http.StatusOK); ok != len(calls) {
			t.Fatalf("%d of %d requests returned 200 (%s, %d of them 409 version conflicts)", ok, len(calls), lockStatuses(replies), lockCount(replies, http.StatusConflict))
		}
		for _, id := range ids {
			if revisions := len(h.stored(t, id).Changeset.Revisions); revisions != perChangeset {
				t.Errorf("changeset %s ended with %d revisions, want exactly %d (a lost update means the requests were not serialized)", id, revisions, perChangeset)
			}
		}
		fx.wantIdle(t, "after the burst")
	}
	t.Run("40 concurrent requests on one changeset", func(t *testing.T) { run(t, 40, 1) })
	t.Run("8 concurrent requests while 3 other changesets are mutated too", func(t *testing.T) { run(t, 8, 4) })
}

// lockMerges stores one merge-ready changeset in each of four repositories and starts the four merges at
// the same moment. The catalog barrier makes every merge hold its changeset lock before any of them
// asks for its repository lock.
func lockMerges(t *testing.T, fx *lockFixture, budget time.Duration) (h *lockHTTP, ids []string, replies []lockReply, elapsed time.Duration) {
	t.Helper()
	suffix := lockSuffix()
	repositories := make([]string, 4)
	for index := range repositories {
		repositories[index] = fmt.Sprintf("team/lock-merge-%s-%d", suffix, index)
	}
	h = newLockHTTP(t, fx, 50*time.Millisecond, repositories...)
	calls := make([]lockCall, len(repositories))
	for index, repository := range repositories {
		ids = append(ids, h.newMergeReadyChangeset(t, repository))
		calls[index] = lockCall{http.MethodPost, h.mergePath(ids[index]), `{"target_ref":"main"}`}
	}
	h.catalog.arm(len(calls))
	began := time.Now()
	replies = h.burst(budget, calls)
	return h, ids, replies, time.Since(began)
}

func TestChangesetLockMergesOnDifferentRepositoriesSucceedWithASmallLockPool(t *testing.T) {
	// Four merges need up to eight lock connections (changeset lock plus repository lock each)
	// and their queries run on a query pool of the same size, which locks must not touch.
	fx := lockOpenStore(t, lockOptions{queryPool: 8, lockPool: 8, waitTimeout: 3 * time.Second})
	h, ids, replies, elapsed := lockMerges(t, fx, lockBudget)
	t.Logf("PROBE 4 concurrent merges on 4 repositories, lock pool of 8, query pool of 8: %s in %v", lockStatuses(replies), elapsed.Round(10*time.Millisecond))
	if ok := lockCount(replies, http.StatusOK); ok != len(replies) {
		t.Fatalf("%d of %d merges returned 200 (%s)", ok, len(replies), lockStatuses(replies))
	}
	for _, id := range ids {
		if h.stored(t, id).Changeset.Merge == nil {
			t.Errorf("changeset %s answered 200 but has no recorded merge", id)
		}
	}
	fx.wantIdle(t, "after the merges")
}

// This documents the known residual rather than hiding it: a merge needs two lock connections,
// so as many simultaneous merges as the lock pool has connections can each hold one and wait for a
// second. They must not hang: every request is answered within the wait limit plus a margin.
func TestChangesetLockMergesStallBoundedWhenTheLockPoolIsTooSmall(t *testing.T) {
	const limit = time.Second
	fx := lockOpenStore(t, lockOptions{queryPool: 8, lockPool: 4, waitTimeout: limit})
	h, ids, replies, elapsed := lockMerges(t, fx, lockBudget)
	t.Logf("PROBE 4 simultaneous merges, lock pool of 4 (one connection each, none left for the second lock): %s in %v", lockStatuses(replies), elapsed.Round(10*time.Millisecond))
	if bound := limit + 3*time.Second; elapsed > bound {
		t.Fatalf("the merges needed %v, want an answer within lockWaitTimeout plus a margin (%v): a stall must end, not hang (%s)", elapsed.Round(10*time.Millisecond), bound, lockStatuses(replies))
	}
	for index, reply := range replies {
		if reply.status != http.StatusOK && reply.status != http.StatusServiceUnavailable {
			t.Errorf("merge %d returned %d %s, want 200 or 503", index, reply.status, reply.body)
		}
		// An answered 503 must not have merged anything, and a 200 must have.
		if merged := h.stored(t, ids[index]).Changeset.Merge != nil; merged != (reply.status == http.StatusOK) {
			t.Errorf("merge %d returned %d but the changeset's merge record is %v", index, reply.status, merged)
		}
	}
	fx.wantIdle(t, "after the stalled merges ended")
}
