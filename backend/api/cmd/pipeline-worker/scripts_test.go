package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/postgres"
	"github.com/jackc/pgx/v5"
)

// Exercise publication, run inputs, leases and the actual Docker worker with one isolated tenant.
func TestScriptVariableFlow(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" || os.Getenv("TEST_PIPELINE_DOCKER") != "1" {
		t.Skip("requires PostgreSQL and the Docker test image postgres:17")
	}
	ctx := t.Context()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	store, err := postgres.Open(ctx, dsn)
	must(err)
	defer store.Close()
	db, err := pgx.Connect(ctx, dsn)
	must(err)
	defer db.Close(ctx)
	org := "shell-" + time.Now().Format("150405000000000") + rand.Text()[:8]
	_, err = db.Exec(ctx, `INSERT INTO organizations(id,name) VALUES($1,$1)`, org)
	must(err)
	_, err = db.Exec(ctx, `INSERT INTO users(id,display_name) VALUES($1,$1)`, org)
	must(err)
	stage := func(id string, deps []string, steps ...pipeline.Step) pipeline.Stage {
		return pipeline.Stage{ID: id, DependsOn: deps, Jobs: []pipeline.Job{{ID: "job-" + id, Steps: steps}}}
	}
	shell := func(id, script string, outputs ...string) pipeline.Step {
		return pipeline.Step{ID: id, Uses: pipeline.ShellScript, Script: script, Outputs: outputs}
	}
	def := pipeline.Definition{APIVersion: pipeline.APIVersion, Name: "script-demo", Parameters: []pipeline.Parameter{{Name: "VERSION", Type: "string", Override: true}, {Name: "token", Type: "secretRef", Default: json.RawMessage(`"secret://fixture"`)}}, Stages: []pipeline.Stage{
		stage("build", nil, shell("emit", `printf 'TAG=%s\n' "$AF_PARAM_VERSION" >> "$FLOW_ENV"`, "TAG"), shell("verify", `test "$AF_VAR_TAG" = "$AF_PARAM_VERSION"`)),
		stage("independent", []string{}, shell("isolated", `test -z "${AF_VAR_TAG+x}"`)),
		stage("release", []string{"build"}, shell("handoff", `printf 'FINAL=%s\n' "$AF_VAR_TAG" >> "$AF_ENV_FILE"`, "FINAL")),
		stage("deploy", []string{"release"}, shell("consume", `test "$AF_VAR_FINAL" = 'v1 $(false)=ok'; test "$AF_VAR_TAG" = "$AF_VAR_FINAL"; test -z "${AF_PARAM_token+x}"; case "$AF_PARAMS_JSON" in *fixture*) exit 1;; esac`))}}
	must(def.Validate())
	_, err = store.ChangePipeline(ctx, org, "flow", org, "create", 0, &def)
	must(err)
	_, err = store.ChangePipeline(ctx, org, "flow", org, "publish", 1, nil)
	must(err)
	var bytes [32]byte
	_, err = rand.Read(bytes[:])
	must(err)
	token := hex.EncodeToString(bytes[:])
	_, err = store.RegisterRunner(ctx, org, token, []string{pipeline.ShellScript})
	must(err)
	run, err := store.CreateRun(ctx, org, "flow", 1, org, map[string]json.RawMessage{"VERSION": json.RawMessage(`"v1 $(false)=ok"`)})
	must(err)
	for range 5 {
		task, err := store.ClaimTask(ctx, token)
		must(err)
		if task == nil {
			t.Fatal("expected runnable script")
		}
		runTask(ctx, store, *task, "postgres:17")
		r, err := store.GetRun(ctx, org, run.ID)
		must(err)
		if r.StepStatuses[task.StepID] != "succeeded" {
			t.Fatalf("step %s: %v", task.StepID, r.StepStatuses)
		}
	}
	result, err := store.GetRun(ctx, org, run.ID)
	must(err)
	if result.Status != "succeeded" {
		t.Fatalf("run: %s", result.Status)
	}
	// A malformed file after a valid entry fails the attempt without committing that entry.
	def.Stages = []pipeline.Stage{stage("build", nil, shell("emit", `printf 'TAG=partial\nUNKNOWN=value\n' >> "$FLOW_ENV"`, "TAG"))}
	_, err = store.ChangePipeline(ctx, org, "invalid", org, "create", 0, &def)
	must(err)
	_, err = store.ChangePipeline(ctx, org, "invalid", org, "publish", 1, nil)
	must(err)
	invalid, err := store.CreateRun(ctx, org, "invalid", 1, org, nil)
	must(err)
	task, err := store.ClaimTask(ctx, token)
	must(err)
	if task == nil || task.RunID != invalid.ID {
		t.Fatal("expected malformed-output task")
	}
	runTask(ctx, store, *task, "postgres:17")
	var rejected bool
	must(db.QueryRow(ctx, `SELECT status='failed' AND exports='{}'::jsonb FROM pipeline_step_runs WHERE run_id=$1 AND id='emit'`, invalid.ID).Scan(&rejected))
	if !rejected {
		t.Fatal("malformed output was not rejected atomically")
	}
}

func TestRejectInvalidExports(t *testing.T) {
	for _, raw := range []string{"", "TAG", "OTHER=x", "TAG=x\nTAG=y", "TAG=x\r", "TAG=" + strings.Repeat("x", 1025), strings.Repeat("\n", 8193)} {
		var output logPrefix
		output.Write([]byte(raw))
		if readExports(output, []string{"TAG"}, map[string]string{}) == nil {
			t.Errorf("accepted invalid output of length %d", len(raw))
		}
	}
}
