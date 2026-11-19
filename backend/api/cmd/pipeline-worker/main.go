// The worker has a single execution slot and only runs operator-pinned, network-isolated checks.
package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/postgres"
)

var pinnedImage = regexp.MustCompile(`^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$`)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	store, err := postgres.Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		slog.Error("worker database initialization failed")
		os.Exit(1)
	}
	defer store.Close()
	token := os.Getenv("PIPELINE_RUNNER_TOKEN")
	if len(os.Args) > 1 {
		if err := manageRunner(ctx, store, os.Args[1:], token); err != nil {
			slog.Error("runner administration failed", "error", err)
			os.Exit(1)
		}
		return
	}
	image := os.Getenv("PIPELINE_CHECK_IMAGE")
	if !pinnedImage.MatchString(image) {
		slog.Error("configure PIPELINE_CHECK_IMAGE with a repository and SHA-256 digest")
		os.Exit(1)
	}
	if token == "" {
		slog.Error("configure PIPELINE_RUNNER_TOKEN with a registered credential")
		os.Exit(1)
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for ctx.Err() == nil {
		task, err := store.ClaimTask(ctx, token)
		if errors.Is(err, postgres.ErrRunnerDenied) {
			slog.Error("runner credential invalid or revoked")
			os.Exit(1)
		}
		if err != nil {
			slog.Error("claim failed", "error", err)
		} else if task != nil {
			runTask(ctx, store, *task, image)
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Administration runs on a trusted operator host with database access.
func manageRunner(ctx context.Context, s *postgres.Store, args []string, token string) error {
	if len(args) >= 3 {
		switch args[0] {
		case "register":
			id, err := s.RegisterRunner(ctx, args[1], token, args[2:])
			if err == nil {
				fmt.Println(id)
			}
			return err
		case "revoke":
			if len(args) == 3 {
				return s.RevokeRunner(ctx, args[1], args[2])
			}
		case "quota":
			if len(args) == 3 {
				slots, err := strconv.Atoi(args[2])
				if err != nil || slots < 0 {
					return errors.New("quota requires a nonnegative slot count")
				}
				return s.SetRunnerQuota(ctx, args[1], slots)
			}
		}
	}
	return errors.New("usage: pipeline-worker register ORG CAPABILITY... | revoke ORG RUNNER_ID | quota ORG SLOTS")
}

// Capture a bounded prefix while continuing to drain stdout.
type logPrefix struct{ buf bytes.Buffer }

func (w *logPrefix) Write(p []byte) (int, error) {
	n := min(len(p), 8192-w.buf.Len())
	w.buf.Write(p[:n])
	return len(p), nil
}
func (w *logPrefix) text() string {
	return strings.Map(func(r rune) rune {
		if r < 32 && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, strings.ToValidUTF8(w.buf.String(), "?"))
}

func runTask(ctx context.Context, s *postgres.Store, t execution.Task, image string) {
	outcome := "waiting"
	var output logPrefix
	if t.Capability == pipeline.ContainerCheck {
		outcome = runCheck(ctx, s, t, image, &output)
	} else if t.Capability != pipeline.Approval {
		outcome = "failed"
	}
	if ctx.Err() != nil || outcome == "" {
		return
	}
	if err := s.FinishTask(ctx, t, outcome, output.text()); err != nil && !errors.Is(err, execution.ErrLease) {
		slog.Error("task completion failed", "run", t.RunID, "step", t.StepID, "error", err)
	}
}
func runCheck(ctx context.Context, s *postgres.Store, t execution.Task, image string, output io.Writer) string {
	taskCtx, cancel := context.WithDeadline(ctx, t.Deadline)
	defer cancel()
	sandboxCtx, stop := context.WithTimeout(taskCtx, 2*time.Minute)
	defer stop()
	done := make(chan error, 1)
	go func() { done <- containerCheck(sandboxCtx, t, image, output) }()
	tick := time.NewTicker(3 * time.Second)
	defer tick.Stop()
	for {
		select {
		case err := <-done:
			if err == nil {
				return "succeeded"
			}
			var exit *exec.ExitError
			if errors.Is(sandboxCtx.Err(), context.DeadlineExceeded) || errors.As(err, &exit) && (exit.ExitCode() == 124 || exit.ExitCode() == 137) {
				return "timed_out"
			}
			return "failed"
		case <-tick.C:
			if err := s.Heartbeat(sandboxCtx, t); err != nil {
				stop()
				<-done
				if errors.Is(sandboxCtx.Err(), context.DeadlineExceeded) {
					return "timed_out"
				}
				return ""
			}
		}
	}
}
func containerCheck(ctx context.Context, t execution.Task, image string, output io.Writer) error {
	// The in-container watchdog also bounds runtime if the worker process dies.
	name := "af-" + t.RunID + "-" + t.StepID + "-" + strconv.Itoa(t.Attempt)
	args := []string{"run", "--name", name, "--rm", "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=65532:65532", "--memory=128m", "--memory-swap=128m", "--cpus=0.5", "--pids-limit=32", "--log-driver=none", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m", "--entrypoint", "/usr/bin/timeout"}
	if t.Integration != nil {
		git, err := delivery.LoadIntegrationGit(os.Getenv("GIT_REMOTE_BINDINGS_FILE"), os.Getenv("GIT_REPOSITORY_ROOT"), time.Minute)
		if err != nil {
			return err
		}
		dir, cleanup, err := git.CheckoutCandidate(ctx, t.OrganizationID, t.Integration.Repository, t.Integration.CandidateSHA)
		if err != nil {
			return err
		}
		defer cleanup()
		args = append(args, "--volume", dir+":/workspace:ro", "--workdir", "/workspace", "--env", "AGENTFORGE_REVISION_SHA="+t.Integration.CandidateSHA)
	}
	args = append(args, image, "-s", "KILL", "115", "/usr/local/bin/agentforge-check")
	var input io.Reader
	if len(t.SecretRefs) > 0 {
		var err error
		input, err = secretInput(os.Getenv("PIPELINE_SECRETS_DIR"), t)
		if err != nil {
			return err
		}
		args = append([]string{"run", "--interactive"}, args[1:]...)
		output = io.Discard
	}
	command := exec.CommandContext(ctx, "docker", args...)
	command.Stdin = input
	command.Stdout = output
	err := command.Run()
	if ctx.Err() != nil {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = exec.CommandContext(cleanup, "docker", "rm", "-f", name).Run()
	}
	return err
}
