package main

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
)

// The API CI job already pulls postgres:17. Reuse its userspace to exercise the actual runtime limits.
func TestContainerCheck(t *testing.T) {
	if os.Getenv("TEST_PIPELINE_DOCKER") != "1" {
		t.Skip("set TEST_PIPELINE_DOCKER=1 with a local Docker daemon")
	}
	dir := t.TempDir()
	script := `#!/bin/sh
set -eu
test "$(id -u)" = 65532
test ! -w /
test ! -S /var/run/docker.sock
test -w /tmp
test "$(wc -l </proc/net/route)" -eq 1
test "$(cat /sys/fs/cgroup/pids.max)" = 32
if test -f /slow; then sleep 60; else
  test -n "$AGENTFORGE_REVISION_SHA"
  test "$(cat /workspace/build-input)" = pinned
  test ! -d /workspace/.git
  test ! -w /workspace/build-input
  test "$(cat)" = '{"token":"fixture"}'
  echo fixture
fi
`
	if err := os.WriteFile(filepath.Join(dir, "check"), []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	for _, slow := range []bool{false, true} {
		dockerfile := "FROM postgres:17\nCOPY --chmod=0755 check /usr/local/bin/agentforge-check\n"
		if slow {
			dockerfile += "COPY check /slow\n"
		}
		if err := os.WriteFile(filepath.Join(dir, "Dockerfile"), []byte(dockerfile), 0600); err != nil {
			t.Fatal(err)
		}
		image := "agentforge-worker-test-" + strconv.FormatInt(time.Now().UnixNano(), 10)
		if output, err := exec.Command("docker", "build", "--pull=false", "-t", image, dir).CombinedOutput(); err != nil {
			t.Fatalf("build fixture: %v %s", err, output)
		}
		t.Cleanup(func() { _ = exec.Command("docker", "image", "rm", image).Run() })
		task := execution.Task{RunID: image, StepID: "check", Attempt: 1}
		var capture logPrefix
		if !slow {
			task.OrganizationID, task.PipelineID = "org", "workflow"
			gitRoot := t.TempDir()
			t.Setenv("GIT_REPOSITORY_ROOT", gitRoot)
			repo := filepath.Join(gitRoot, "org", "team", "repo")
			if err := os.MkdirAll(repo, 0700); err != nil {
				t.Fatal(err)
			}
			git := func(args ...string) {
				t.Helper()
				out, err := exec.Command("git", append([]string{"-C", repo, "-c", "user.name=fixture", "-c", "user.email=test@example.invalid"}, args...)...).CombinedOutput()
				if err != nil {
					t.Fatalf("git fixture: %v %s", err, out)
				}
			}
			git("init", "-b", "main")
			git("commit", "--allow-empty", "-m", "base")
			git("checkout", "-b", "topic")
			if err := os.WriteFile(filepath.Join(repo, "build-input"), []byte("pinned"), 0644); err != nil {
				t.Fatal(err)
			}
			git("add", ".")
			git("commit", "-m", "input")
			provider, err := delivery.NewLocalGitProvider(gitRoot, time.Minute)
			if err != nil {
				t.Fatal(err)
			}
			candidate, err := provider.PrepareCandidate(t.Context(), "org", "team/repo", delivery.MergeRequest{Target: "main", Sources: []string{"topic"}})
			if err != nil {
				t.Fatal(err)
			}
			git("checkout", "main")
			task.Integration = &execution.Integration{Repository: "team/repo", MergePreview: candidate}

			task.SecretRefs = map[string]string{"token": "secret://key"}
			root := t.TempDir()
			t.Setenv("PIPELINE_SECRETS_DIR", root)
			scope := filepath.Join(root, "org", "workflow", task.StepID)
			if err := os.MkdirAll(scope, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(scope, "key"), []byte("fixture"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
		defer cancel()
		done := make(chan error, 1)
		go func() { done <- containerCheck(ctx, task, image, &capture) }()
		if slow {
			running := false
			for i := 0; i < 50; i++ {
				out, _ := exec.Command("docker", "inspect", "--format", "{{.State.Running}}", "af-"+image+"-check-1").Output()
				if strings.TrimSpace(string(out)) == "true" {
					running = true
					break
				}
				time.Sleep(100 * time.Millisecond)
			}
			cancel()
			if !running {
				t.Fatal("long-running check did not start")
			}
		}
		err := <-done
		if slow {
			if err == nil || !errors.Is(ctx.Err(), context.Canceled) {
				t.Fatal("container did not stop on cancellation")
			}
			if exec.Command("docker", "inspect", "af-"+image+"-check-1").Run() == nil {
				t.Fatal("cancelled container still exists")
			}
		} else {
			if err != nil || capture.text() != "" {
				t.Fatalf("isolation or log suppression failed: %v", err)
			}
			candidate := task.Integration
			task.Integration = nil
			task.Trigger = &execution.TriggerSource{Kind: "changeset_revision", Repository: candidate.Repository, SHA: candidate.Sources[0].SHA, BaseSHA: candidate.Target.SHA}
			if err := containerCheck(ctx, task, image, &capture); err != nil || capture.text() != "" {
				t.Fatalf("revision checkout isolation or log suppression failed: %v", err)
			}
		}
	}
}

func TestLogPrefixDrainsAndBoundsOutput(t *testing.T) {
	var output logPrefix
	data := []byte("\x00\xff" + strings.Repeat("x", 20000))
	n, err := output.Write(data)
	if err != nil || n != len(data) || len(output.text()) != 8191 || strings.ContainsRune(output.text(), 0) {
		t.Fatalf("captured %d bytes from %d, %v", len(output.text()), n, err)
	}
}

func TestSecretInputIsStepScoped(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "org", "workflow", "check")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "key"), []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	task := execution.Task{OrganizationID: "org", PipelineID: "workflow", StepID: "check", SecretRefs: map[string]string{"token": "secret://key"}}
	input, err := secretInput(base, task)
	if err != nil {
		t.Fatal(err)
	}
	b, err := io.ReadAll(input)
	if err != nil || string(b) != `{"token":"fixture"}` {
		t.Fatal("bad injected value")
	}
	for _, task := range []execution.Task{{OrganizationID: "other", PipelineID: "workflow", StepID: "check", SecretRefs: task.SecretRefs}, {OrganizationID: "org", PipelineID: "workflow", StepID: "other", SecretRefs: task.SecretRefs}, {OrganizationID: "org", PipelineID: "workflow", StepID: "check", SecretRefs: map[string]string{"token": "secret://../key"}}} {
		if _, err := secretInput(base, task); err != secretUnavailable {
			t.Fatal("resolved outside step scope")
		}
	}
}
