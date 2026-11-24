package postgres

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/artifact"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
)

// Exercise the SDK wire format with fault injection, plus the real scheduler,
// database, session middleware and download endpoint.
func TestPipelineObjectLifecycle(t *testing.T) {
	type blob struct{ data, provenance string }
	blobs := map[string]blob{}
	var mu sync.Mutex
	badRead := ""
	denyDelete := true
	denyPut := false
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		key := r.URL.Path
		if !strings.HasPrefix(key, "/test-bucket/pipeline-objects/v1/") || !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 ") {
			http.Error(w, "unsigned or wrong key", 400)
			return
		}
		switch r.Method {
		case "PUT":
			if denyPut {
				http.Error(w, "offline", 403)
				return
			}
			b, e := io.ReadAll(r.Body)
			if e != nil {
				http.Error(w, "bad body", 400)
				return
			}
			sum := sha256.Sum256(b)
			if r.Header.Get("X-Amz-Checksum-Sha256") != base64.StdEncoding.EncodeToString(sum[:]) {
				http.Error(w, "bad checksum", 400)
				return
			}
			blobs[key] = blob{string(b), r.Header.Get("X-Amz-Meta-Provenance")}
			w.Header().Set("X-Amz-Version-Id", "test-version")
		case "GET", "DELETE":
			if r.URL.Query().Get("versionId") != "test-version" {
				http.Error(w, "missing version", 400)
				return
			}
			if r.Method == "DELETE" {
				if denyDelete {
					http.Error(w, "denied", 403)
					return
				}
				delete(blobs, key)
				w.WriteHeader(204)
				return
			}
			b, ok := blobs[key]
			if !ok {
				http.NotFound(w, r)
				return
			}
			switch badRead {
			case "digest":
				b.data = strings.Repeat("X", len(b.data))
			case "oversize":
				b.data += "x"
			case "provenance":
				b.provenance = "wrong"
			}
			w.Header().Set("X-Amz-Meta-Provenance", b.provenance)
			io.WriteString(w, b.data)
		default:
			http.Error(w, "unsupported", 405)
		}
	}))
	defer endpoint.Close()
	t.Setenv("PIPELINE_S3_BUCKET", "test-bucket")
	t.Setenv("PIPELINE_S3_ENDPOINT", endpoint.URL)
	t.Setenv("AWS_ACCESS_KEY_ID", "fixture")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "fixture")
	t.Setenv("AWS_REGION", "us-east-1")
	ctx := t.Context()
	s, h, _, _, dsn := integrationFixture(t)
	t.Setenv("DATABASE_URL", dsn)
	runCommand := func(input string, args ...string) {
		t.Helper()
		cmd := exec.CommandContext(ctx, "go", append([]string{"run"}, args...)...)
		cmd.Dir = "../../.."
		cmd.Stdin = strings.NewReader(input)
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("storage CLI failed: %v %s", err, output)
		}
	}
	org := h.organizationID
	_, err := s.pool.Exec(ctx, `UPDATE delivery_repositories SET actions_retention_days=7 WHERE organization_id=$1 AND slug='team/repo'`, org)
	lockMust(t, err)
	token := registerTestRunner(t, s, org, pipeline.ContainerCheck)
	created := h.do(ctx, "POST", "/api/v1/organizations/"+org+"/pipelines/p/versions/1/integration-runs", `{"repository":"team/repo","target":"main","sources":["topic"]}`)
	if created.Code != 201 {
		t.Fatalf("integration run: %d %s", created.Code, created.Body)
	}
	var run execution.Run
	lockMust(t, json.Unmarshal(created.Body.Bytes(), &run))
	task, err := s.ClaimTask(ctx, token)
	lockMust(t, err)
	if task == nil {
		t.Fatal("missing claim")
	}
	mu.Lock()
	denyPut = true
	mu.Unlock()
	if err = s.FinishTask(ctx, *task, "succeeded", "build output"); err == nil {
		t.Fatal("accepted unavailable storage")
	}
	items, err := s.ListPipelineObjects(ctx, org, run.ID, 0)
	lockMust(t, err)
	if len(items) != 0 {
		t.Fatal("partial publication", items)
	}
	mu.Lock()
	denyPut = false
	mu.Unlock()
	lockMust(t, s.FinishTask(ctx, *task, "succeeded", "build output"))
	path := "/api/v1/organizations/" + org + "/pipeline-runs/" + run.ID + "/objects"
	response := h.do(ctx, "GET", path, "")
	if response.Code != 200 {
		t.Fatalf("listing %d %s", response.Code, response.Body)
	}
	lockMust(t, json.Unmarshal(response.Body.Bytes(), &items))
	if len(items) != 2 {
		t.Fatal("want log and result", items)
	}
	log, report := items[0], items[1]
	for _, item := range items {
		if item.ExpiresAt.Sub(item.CreatedAt) != 7*24*time.Hour {
			t.Fatalf("expected 7 days of retention, got %v", item.ExpiresAt.Sub(item.CreatedAt))
		}
	}
	p := log.Provenance
	if run.Integration == nil || p.SourceSHA == "" || p.SourceSHA != run.Integration.CandidateSHA || p.Organization != org || p.Run != run.ID || p.Step != task.StepID || p.Attempt != task.Attempt || p.Worker == task.WorkerID || p.Worker == "" || p.Version != 1 || len(p.WorkflowSHA256) != 64 || p.Kind != "log" || p.Name != "stdout.txt" || report.Provenance.Name != "result.json" || strings.Contains(response.Body.String(), task.WorkerID) {
		t.Fatal("wrong provenance")
	}
	logPath := path + "/" + strconv.FormatInt(log.ID, 10)
	response = h.do(ctx, "GET", logPath, "")
	if response.Code != 200 || response.Body.String() != "build output" || response.Header().Get("X-Artifact-SHA256") != fmt.Sprintf("%x", sha256.Sum256(response.Body.Bytes())) {
		t.Fatalf("download %d %s", response.Code, response.Body)
	}
	_, b, err := s.ReadPipelineObject(ctx, org, run.ID, report.ID)
	lockMust(t, err)
	if string(b) != `{"outcome":"succeeded"}` {
		t.Fatal("result", string(b))
	}
	if _, _, err = s.ReadPipelineObject(ctx, "foreign", run.ID, log.ID); err != pipeline.ErrMissing {
		t.Fatal("foreign download", err)
	}
	anon := httptest.NewRecorder()
	h.handler.ServeHTTP(anon, httptest.NewRequest("GET", logPath, nil))
	if anon.Code != 401 {
		t.Fatal("anonymous access", anon.Code)
	}
	for _, bad := range []string{"digest", "oversize", "provenance"} {
		mu.Lock()
		badRead = bad
		mu.Unlock()
		if r := h.do(ctx, "GET", logPath, ""); r.Code != 503 || strings.Contains(r.Body.String(), "build output") {
			t.Fatalf("released corrupt %s object", bad)
		}
	}
	mu.Lock()
	badRead = ""
	mu.Unlock()
	if ok, err := s.PurgePipelineObject(ctx); ok || err != nil {
		t.Fatal("early purge", err)
	}
	if _, err = s.pool.Exec(ctx, `DELETE FROM pipeline_objects WHERE id=$1`, log.ID); err == nil {
		t.Fatal("deleted audit")
	}
	if _, err = s.pool.Exec(ctx, `UPDATE pipeline_objects SET sha256=repeat('a',64) WHERE id=$1`, log.ID); err == nil {
		t.Fatal("changed audit")
	}
	// Advance the fixture's retention clock in its isolated scratch database.
	_, err = s.pool.Exec(ctx, `ALTER TABLE pipeline_objects DISABLE TRIGGER immutable_pipeline_object`)
	lockMust(t, err)
	_, err = s.pool.Exec(ctx, `UPDATE pipeline_objects SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1`, log.ID)
	lockMust(t, err)
	_, err = s.pool.Exec(ctx, `ALTER TABLE pipeline_objects ENABLE TRIGGER immutable_pipeline_object`)
	lockMust(t, err)
	if r := h.do(ctx, "GET", logPath, ""); r.Code != 410 {
		t.Fatal("expired download", r.Code)
	}
	if purged, err := s.PurgePipelineObject(ctx); purged || err == nil {
		t.Fatal("lost pending purge")
	}
	mu.Lock()
	denyDelete = false
	mu.Unlock()
	runCommand("", "./cmd/pipeline-storage-gc")
	items, err = s.ListPipelineObjects(ctx, org, run.ID, 0)
	lockMust(t, err)
	if len(items) != 2 || items[0].PurgedAt == nil || items[0].Provenance != p || items[0].SHA256 != log.SHA256 || items[1].PurgedAt != nil {
		t.Fatal("audit after expiry", items)
	}
	mu.Lock()
	count := len(blobs)
	mu.Unlock()
	if count != 1 {
		t.Fatal("wrong live object count", count)
	}
	if ok, err := s.PurgePipelineObject(ctx); ok || err != nil {
		t.Fatal("purge replay", ok, err)
	}
	events, err := s.Events(ctx, org, run.ID, 0)
	lockMust(t, err)
	for _, event := range events {
		if event.Message != nil && strings.Contains(*event.Message, "build output") || event.Actor == task.WorkerID {
			t.Fatal("inline payload or receipt in audit")
		}
	}
	secretRun, err := s.CreateRun(ctx, org, "p", 1, h.userID, nil)
	lockMust(t, err)
	_, err = s.pool.Exec(ctx, `UPDATE pipeline_step_runs SET secret_refs='{"TOKEN":"private"}' WHERE run_id=$1`, secretRun.ID)
	lockMust(t, err)
	task, err = s.ClaimTask(ctx, token)
	lockMust(t, err)
	if task == nil {
		t.Fatal("missing secret claim")
	}
	const payload = "binary\x00\xff"
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(payload)))
	publish := func(task execution.Task, digest, bytes string) error {
		return s.PublishTaskArtifact(ctx, task, digest, strings.NewReader(bytes))
	}
	if err := publish(*task, digest, payload); err == nil {
		t.Fatal("published binary for secret-bearing attempt")
	}
	lockMust(t, s.FinishTask(ctx, *task, "failed", "private output"))
	items, err = s.ListPipelineObjects(ctx, org, secretRun.ID, 0)
	lockMust(t, err)
	if len(items) != 1 || items[0].Provenance.Name != "result.json" {
		t.Fatal("secret output archived", items)
	}

	binaryRun, err := s.CreateRun(ctx, org, "p", 1, h.userID, nil)
	lockMust(t, err)
	task, err = s.ClaimTask(ctx, token)
	lockMust(t, err)
	if task == nil || task.RunID != binaryRun.ID {
		t.Fatal("missing binary claim")
	}
	stale := *task
	stale.WorkerID = "invalid"
	if err := publish(stale, digest, payload); !errors.Is(err, execution.ErrLease) {
		t.Fatal("invalid receipt", err)
	}
	if err := publish(*task, strings.Repeat("0", 64), payload); !errors.Is(err, artifact.ErrIntegrity) {
		t.Fatal("invalid digest", err)
	}
	if err := publish(*task, digest, strings.Repeat("a", artifact.MaxBytes+1)); err == nil {
		t.Fatal("accepted oversized input")
	}
	mu.Lock()
	denyPut = true
	mu.Unlock()
	if err := publish(*task, digest, payload); err == nil {
		t.Fatal("accepted failed PUT")
	}
	items, err = s.ListPipelineObjects(ctx, org, binaryRun.ID, 0)
	lockMust(t, err)
	if len(items) != 0 {
		t.Fatal("failed upload published a manifest")
	}
	mu.Lock()
	denyPut = false
	mu.Unlock()
	t.Setenv("PIPELINE_ATTEMPT_RECEIPT", task.WorkerID)
	runCommand(payload, "./cmd/pipeline-artifact-upload", task.RunID, task.StepID, strconv.Itoa(task.Attempt), digest)
	lockMust(t, publish(*task, digest, payload))
	if err := publish(*task, fmt.Sprintf("%x", sha256.Sum256(nil)), ""); !errors.Is(err, pipeline.ErrConflict) {
		t.Fatal("replacement", err)
	}
	items, err = s.ListPipelineObjects(ctx, org, binaryRun.ID, 0)
	lockMust(t, err)
	if len(items) != 1 || items[0].Provenance.Name != "artifact.bin" || items[0].SHA256 != digest {
		t.Fatal("binary manifest", items)
	}
	_, bytes, err := s.ReadPipelineObject(ctx, org, binaryRun.ID, items[0].ID)
	lockMust(t, err)
	if string(bytes) != payload {
		t.Fatal("binary round trip")
	}
	lockMust(t, s.FinishTask(ctx, *task, "succeeded", ""))
	if err := publish(*task, digest, payload); !errors.Is(err, execution.ErrLease) {
		t.Fatal("finished receipt", err)
	}
}

func TestRepositoryActionsInlineLogRetention(t *testing.T) {
	for _, env := range []string{"PIPELINE_S3_BUCKET", "PIPELINE_S3_ENDPOINT", "PIPELINE_STORAGE_DAYS"} {
		t.Setenv(env, "")
	}
	s, h, _, _, _ := integrationFixture(t)
	ctx, org := t.Context(), h.organizationID
	base := "/api/v1/organizations/" + org
	settings := base + "/repositories/team/repo/settings"
	response := h.do(ctx, "GET", settings, "")
	if response.Code != 200 {
		t.Fatalf("read settings: %d %s", response.Code, response.Body)
	}
	var repository struct {
		UpdatedAt time.Time `json:"updated_at"`
	}
	lockMust(t, json.Unmarshal(response.Body.Bytes(), &repository))
	version := repository.UpdatedAt.Format(time.RFC3339Nano)
	for _, test := range []struct{ days, status int }{{401, 422}, {2, 200}, {1, 409}} {
		response := h.do(ctx, "PATCH", settings, fmt.Sprintf(`{"actions_retention_days":%d,"updated_at":%q}`, test.days, version))
		if response.Code != test.status {
			t.Fatalf("save %d days: %d %s", test.days, response.Code, response.Body)
		}
	}
	token := registerTestRunner(t, s, org, pipeline.ContainerCheck)
	response = h.do(ctx, "POST", base+"/pipelines/p/versions/1/integration-runs", `{"repository":"team/repo","target":"main","sources":["topic"]}`)
	if response.Code != 201 {
		t.Fatalf("create run: %d %s", response.Code, response.Body)
	}
	var run execution.Run
	lockMust(t, json.Unmarshal(response.Body.Bytes(), &run))
	task, err := s.ClaimTask(ctx, token)
	lockMust(t, err)
	if task == nil {
		t.Fatal("missing claim")
	}
	lockMust(t, s.FinishTask(ctx, *task, "succeeded", "retained build output"))
	var hours int
	lockMust(t, s.pool.QueryRow(ctx, `SELECT extract(epoch FROM expires_at-created_at)/3600 FROM pipeline_run_events WHERE run_id=$1 AND kind='log'`, run.ID).Scan(&hours))
	if hours != 48 {
		t.Fatalf("expected 48 hours of retention, got %d", hours)
	}
	_, err = s.pool.Exec(ctx, `UPDATE pipeline_run_events SET expires_at=now()-interval '1 second' WHERE run_id=$1 AND kind='log'`, run.ID)
	lockMust(t, err)
	events, err := s.Events(ctx, org, run.ID, 0)
	lockMust(t, err)
	if len(events) == 0 {
		t.Fatal("run history disappeared")
	}
	for _, event := range events {
		if event.Kind == "log" {
			t.Fatal("expired log was served")
		}
	}
	count, err := s.PurgePipelineLogs(ctx)
	lockMust(t, err)
	if count != 1 {
		t.Fatalf("expected 1 purged log, got %d", count)
	}
}
