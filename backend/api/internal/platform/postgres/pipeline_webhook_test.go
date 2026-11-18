package postgres

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestWebhookEnqueuesOnceAndScopesSecrets(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx := t.Context()
	s, err := Open(ctx, slugScratchDatabase(t, dsn, 1))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	slugInsertOrganization(t, ctx, s, "team", "team", "active")
	slugInsertUser(t, ctx, s, "bot")
	slugInsertMember(t, ctx, s, "team", "bot", "member", "active")
	def := pipeline.Definition{APIVersion: pipeline.APIVersion, Name: "build", Parameters: []pipeline.Parameter{{Name: "token", Type: "secretRef", Default: json.RawMessage(`"secret://release"`)}}, Stages: []pipeline.Stage{{ID: "checks", Jobs: []pipeline.Job{{ID: "build", Steps: []pipeline.Step{{ID: "first", Uses: pipeline.ContainerCheck, SecretParams: []string{"token"}}, {ID: "second", Uses: pipeline.ContainerCheck}}}}}}}
	for i, act := range []string{"create", "publish"} {
		if _, err = s.ChangePipeline(ctx, "team", "flow", "bot", act, i, &def); err != nil {
			t.Fatal(err)
		}
	}
	dir := t.TempDir()
	const key = "synthetic-webhook-fixture-for-tests-only"
	cfg := `{"organizationID":"team","pipelineID":"flow","actorID":"bot","repositoryID":12,"event":"push","branch":"main","version":1,"secret":"` + key + `"}`
	if err = os.WriteFile(filepath.Join(dir, "push.json"), []byte(cfg), 0600); err != nil {
		t.Fatal(err)
	}
	handler := httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{Runs: s, WebhookDirectory: dir})
	sha := strings.Repeat("a", 40)
	body := `{"repository":{"id":12},"ref":"refs/heads/main","after":"` + sha + `"}`
	call := func(body, key, id string) int {
		req := httptest.NewRequest("POST", "/hooks/github/push", strings.NewReader(body))
		mac := hmac.New(sha256.New, []byte(key))
		mac.Write([]byte(body))
		req.Header.Set("X-Hub-Signature-256", "sha256="+hex.EncodeToString(mac.Sum(nil)))
		req.Header.Set("X-GitHub-Delivery", id)
		req.Header.Set("X-GitHub-Event", "push")
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		return res.Code
	}
	if call(body, "bad", "one") != 401 || call(strings.Replace(body, "main", "dev", 1), key, "one") != 422 {
		t.Fatal("signature or branch validation failed")
	}
	status := make(chan int, 2)
	for _, id := range []string{"one", "two"} {
		go func() { status <- call(body, key, id) }()
	}
	for range 2 {
		if got := <-status; got != 202 {
			t.Fatalf("delivery returned %d", got)
		}
	}
	var count int
	if err = s.pool.QueryRow(ctx, `SELECT count(*) FROM pipeline_runs`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("created %d runs: %v", count, err)
	}
	task, err := s.ClaimTask(ctx, "worker")
	if err != nil || task == nil || task.SecretRefs["token"] != "secret://release" || task.OrganizationID != "team" || task.PipelineID != "flow" {
		t.Fatalf("bad task scope: %v", err)
	}
	run, err := s.GetRun(ctx, "team", task.RunID)
	if err != nil || run.Webhook == nil || run.Webhook.SHA != sha {
		t.Fatal("webhook source not pinned")
	}
	if got := call(strings.Replace(body, sha, strings.Repeat("b", 40), 1), key, run.Webhook.Delivery); got != 409 {
		t.Fatalf("delivery collision returned %d", got)
	}
	task.SecretRefs = nil // Database scope remains authoritative even on a bad worker completion.
	if err = s.FinishTask(ctx, *task, "succeeded", "synthetic-output"); err != nil {
		t.Fatal(err)
	}
	second, err := s.ClaimTask(ctx, "worker")
	if err != nil || second == nil || len(second.SecretRefs) != 0 {
		t.Fatal("unexpected secret on sibling step")
	}
	events, err := s.Events(ctx, "team", task.RunID, 0)
	if err != nil {
		t.Fatal(err)
	}
	audited := false
	for _, e := range events {
		if e.Message != nil {
			t.Fatal("sensitive task logged output")
		}
		audited = audited || e.Kind == "secret_refs_requested"
	}
	if !audited {
		t.Fatal("missing secret access audit")
	}
	if _, err = s.Events(ctx, "foreign", task.RunID, 0); err != pipeline.ErrMissing {
		t.Fatal("read foreign events")
	}
	if _, err = s.pool.Exec(ctx, `UPDATE organization_memberships SET role='viewer' WHERE user_id='bot'`); err != nil {
		t.Fatal(err)
	}
	if call(body, key, "retry") != 403 {
		t.Fatal("revoked actor triggered a run")
	}
}
