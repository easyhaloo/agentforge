package postgres

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
)

func testRunnerToken() string {
	var b [32]byte
	rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
func registerTestRunner(t *testing.T, s *Store, org string, caps ...string) string {
	t.Helper()
	token := testRunnerToken()
	_, err := s.RegisterRunner(t.Context(), org, token, caps)
	lockMust(t, err)
	return token
}

func TestRunnerAdmissionAndRevocation(t *testing.T) {
	ctx := t.Context()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("requires PostgreSQL")
	}
	s, err := Open(ctx, slugScratchDatabase(t, dsn, 1))
	lockMust(t, err)
	t.Cleanup(s.Close)
	slugInsertUser(t, ctx, s, "owner")
	for _, org := range []string{"alpha", "bravo"} {
		slugInsertOrganization(t, ctx, s, org, org, "active")
	}
	publish := func(org, id, cap string) {
		t.Helper()
		d := pipeline.Definition{APIVersion: pipeline.APIVersion, Name: id, Stages: []pipeline.Stage{{ID: "stage", Jobs: []pipeline.Job{{ID: "job", Steps: []pipeline.Step{{ID: "step", Uses: cap}}}}}}}
		for i, action := range []string{"create", "publish"} {
			_, err := s.ChangePipeline(ctx, org, id, "owner", action, i, &d)
			lockMust(t, err)
		}
	}
	enqueue := func(org, id string) {
		t.Helper()
		_, err := s.CreateRun(ctx, org, id, 1, "owner", nil)
		lockMust(t, err)
	}
	publish("bravo", "gate", pipeline.Approval)
	enqueue("bravo", "gate")
	publish("alpha", "check", pipeline.ContainerCheck)
	enqueue("alpha", "check")
	publish("alpha", "gate", pipeline.Approval)
	for range 8 {
		enqueue("alpha", "gate")
	}
	if _, err := s.ClaimTask(ctx, testRunnerToken()); !errors.Is(err, ErrRunnerDenied) {
		t.Fatalf("unregistered claim: %v", err)
	}
	for _, caps := range [][]string{nil, {}, {"unknown"}} {
		if _, err := s.RegisterRunner(ctx, "alpha", testRunnerToken(), caps); err == nil {
			t.Fatal("accepted invalid capabilities")
		}
	}
	type claim struct {
		token string
		task  *execution.Task
		err   error
	}
	race := func(tokens []string) []claim {
		t.Helper()
		start := make(chan struct{})
		results := make(chan claim, len(tokens))
		for _, token := range tokens {
			go func() {
				<-start
				task, err := s.ClaimTask(ctx, token)
				results <- claim{token, task, err}
			}()
		}
		close(start)
		var acquired []claim
		for range tokens {
			r := <-results
			lockMust(t, r.err)
			if r.task != nil {
				if r.task.OrganizationID != "alpha" || r.task.Capability != pipeline.Approval {
					t.Fatalf("wrong claim target %s/%s", r.task.OrganizationID, r.task.Capability)
				}
				acquired = append(acquired, r)
			}
		}
		return acquired
	}
	mustClaim := func(token string) *execution.Task {
		t.Helper()
		task, err := s.ClaimTask(ctx, token)
		lockMust(t, err)
		if task == nil {
			t.Fatal("expected a task")
		}
		return task
	}
	lockMust(t, s.SetRunnerQuota(ctx, "alpha", 2))
	var tokens []string
	for range 8 {
		tokens = append(tokens, registerTestRunner(t, s, "alpha", pipeline.Approval))
	}
	same := race([]string{tokens[0], tokens[0], tokens[0]})
	if len(same) != 1 {
		t.Fatalf("one runner acquired %d slots", len(same))
	}
	more := race(tokens)
	if len(more) != 1 {
		t.Fatalf("remaining quota admitted %d", len(more))
	}
	live := more[0]
	other := mustClaim(registerTestRunner(t, s, "bravo", pipeline.Approval))
	if other.OrganizationID != "bravo" {
		t.Fatal("cross-tenant lease")
	}
	// The event contains a stable public identity. It cannot authorize a task update.
	var id string
	lockMust(t, s.pool.QueryRow(ctx, `SELECT actor FROM pipeline_run_events WHERE run_id=$1 AND kind='claimed'`, live.task.RunID).Scan(&id))
	forged := *live.task
	forged.WorkerID = id
	if !errors.Is(s.Heartbeat(ctx, forged), execution.ErrLease) {
		t.Fatal("public runner ID renewed a lease")
	}
	if err := s.RevokeRunner(ctx, "bravo", id); !errors.Is(err, ErrRunnerDenied) {
		t.Fatal("foreign revocation", err)
	}
	if err := s.FinishTask(ctx, *live.task, "succeeded", ""); !errors.Is(err, execution.ErrLease) {
		t.Fatal("runner bypassed human approval", err)
	}
	lockMust(t, s.Heartbeat(ctx, *live.task))
	lockMust(t, s.RevokeRunner(ctx, "alpha", id))
	if _, err := s.ClaimTask(ctx, live.token); !errors.Is(err, ErrRunnerDenied) {
		t.Fatal("revoked claim", err)
	}
	if !errors.Is(s.Heartbeat(ctx, *live.task), execution.ErrLease) || !errors.Is(s.FinishTask(ctx, *live.task, "waiting", ""), execution.ErrLease) {
		t.Fatal("revoked runner still owns lease")
	}
	if _, err := s.RegisterRunner(ctx, "alpha", live.token, []string{pipeline.Approval}); err == nil {
		t.Fatal("revoked credential re-registered")
	}
	lockMust(t, s.SetRunnerQuota(ctx, "alpha", 0))
	lockMust(t, s.FinishTask(ctx, *same[0].task, "waiting", ""))
	if task, err := s.ClaimTask(ctx, tokens[0]); err != nil || task != nil {
		t.Fatal("zero quota admitted work", err)
	}
	_, err = s.pool.Exec(ctx, `UPDATE pipeline_step_runs SET lease_until=now() WHERE run_id=$1`, live.task.RunID)
	lockMust(t, err)
	lockMust(t, s.SetRunnerQuota(ctx, "alpha", 1))
	replacement := mustClaim(tokens[0])
	if replacement.RunID != live.task.RunID || replacement.Attempt != 2 {
		t.Fatal("expired lease was not reclaimed")
	}
	lockMust(t, s.FinishTask(ctx, *replacement, "waiting", ""))
}

// Exercise the operator CLI and the worker process. A blocking Docker stand-in
// makes cancellation observable without depending on image pulls or job timing.
func TestRunnerRevocationStopsWorker(t *testing.T) {
	s, h, _, _, dsn := integrationFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	dir := t.TempDir()
	binary := filepath.Join(dir, "pipeline-worker")
	build := exec.CommandContext(ctx, "go", "build", "-o", binary, "./cmd/pipeline-worker")
	build.Dir = "../../.."
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build worker: %v: %s", err, out)
	}
	lockMust(t, os.WriteFile(filepath.Join(dir, "docker"), []byte(`#!/bin/sh
case "$1" in
run) touch "$RUNNER_TEST_DIR/started"; exec sleep 60;;
rm) touch "$RUNNER_TEST_DIR/stopped";;
*) exit 1;;
esac
`), 0700))
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("RUNNER_TEST_DIR", dir)
	t.Setenv("DATABASE_URL", dsn)
	t.Setenv("PIPELINE_RUNNER_TOKEN", testRunnerToken())
	t.Setenv("PIPELINE_CHECK_IMAGE", "test@sha256:"+strings.Repeat("0", 64))
	admin := func(args ...string) string {
		t.Helper()
		out, err := exec.CommandContext(ctx, binary, args...).Output()
		lockMust(t, err)
		return strings.TrimSpace(string(out))
	}
	id := admin("register", h.organizationID, pipeline.ContainerCheck)
	admin("quota", h.organizationID, "1")
	run, err := s.CreateRun(ctx, h.organizationID, "p", 1, h.userID, nil)
	lockMust(t, err)
	worker := exec.CommandContext(ctx, binary)
	lockMust(t, worker.Start())
	defer func() {
		if worker.ProcessState == nil {
			_ = worker.Process.Kill()
			_ = worker.Wait()
		}
	}()
	for {
		if _, err := os.Stat(filepath.Join(dir, "started")); err == nil {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("worker never started the check")
		case <-time.After(20 * time.Millisecond):
		}
	}
	admin("revoke", h.organizationID, id)
	var exit *exec.ExitError
	if err := worker.Wait(); !errors.As(err, &exit) || exit.ExitCode() != 1 || ctx.Err() != nil {
		t.Fatalf("revoked worker exit: %v", err)
	}
	_, err = os.Stat(filepath.Join(dir, "stopped"))
	lockMust(t, err)
	var status string
	lockMust(t, s.pool.QueryRow(ctx, `SELECT status FROM pipeline_step_runs WHERE run_id=$1`, run.ID).Scan(&status))
	if status != "leased" {
		t.Fatalf("revoked worker published a result: %s", status)
	}
}
