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
if test -f /slow; then sleep 60; fi
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
		ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
		defer cancel()
		done := make(chan error, 1)
		go func() { done <- containerCheck(ctx, task, image, io.Discard) }()
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
		} else if err != nil {
			t.Fatalf("isolation check failed: %v", err)
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
