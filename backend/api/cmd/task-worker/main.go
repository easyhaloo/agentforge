package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/platform/config"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/postgres"
	"github.com/easyhaloo/agentforge/backend/api/internal/tasks"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	configuration, err := config.LoadFromEnv()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	store, err := postgres.Open(ctx, configuration.DatabaseURL)
	if err != nil {
		logger.Error("database initialization failed", "error", err)
		os.Exit(1)
	}
	defer store.Close()

	taskStore := tasks.NewPostgresStore(store.Pool())

	workerID := fmt.Sprintf("worker-%s-%d", os.Getenv("HOSTNAME"), os.Getpid())
	capability := getEnv("WORKER_CAPABILITY", "default")
	concurrency := getEnvInt("WORKER_CONCURRENCY", 2)
	pollInterval := getEnvDuration("WORKER_POLL_INTERVAL", 2*time.Second)
	leaseDuration := getEnvDuration("WORKER_LEASE_DURATION", 5*time.Minute)
	workspaceRoot := getEnv("WORKER_WORKSPACE_ROOT", "/tmp/agentforge-tasks")

	logger.Info("starting task worker",
		"worker_id", workerID,
		"capability", capability,
		"concurrency", concurrency,
		"poll_interval", pollInterval,
		"lease_duration", leaseDuration,
	)

	worker := &Worker{
		store:         taskStore,
		logger:        logger,
		workerID:      workerID,
		capability:    capability,
		concurrency:   concurrency,
		pollInterval:  pollInterval,
		leaseDuration: leaseDuration,
		workspaceRoot: workspaceRoot,
	}

	// Start lease reclaim background job
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				reclaimed, err := taskStore.ReclaimExpiredLeases(ctx)
				if err != nil && ctx.Err() == nil {
					logger.Error("lease reclaim failed", "error", err)
				} else if reclaimed > 0 {
					logger.Info("reclaimed expired leases", "count", reclaimed)
				}
			}
		}
	}()

	if err := worker.Run(ctx); err != nil {
		logger.Error("worker stopped with error", "error", err)
		os.Exit(1)
	}

	logger.Info("worker stopped gracefully")
}

// Worker polls for tasks, claims them, and executes them with bounded concurrency.
type Worker struct {
	store         *tasks.PostgresStore
	logger        *slog.Logger
	workerID      string
	capability    string
	concurrency   int
	pollInterval  time.Duration
	leaseDuration time.Duration
	workspaceRoot string

	wg     sync.WaitGroup
	semaphore chan struct{}
}

// Run starts the worker loop.
func (w *Worker) Run(ctx context.Context) error {
	w.semaphore = make(chan struct{}, w.concurrency)

	ticker := time.NewTicker(w.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			w.logger.Info("shutdown signal received, waiting for in-flight tasks")
			w.wg.Wait()
			return nil

		case <-ticker.C:
			// Try to claim a task if we have capacity
			select {
			case w.semaphore <- struct{}{}:
				lease, err := w.store.ClaimTask(ctx, w.workerID, w.capability, w.leaseDuration)
				if errors.Is(err, tasks.ErrTaskNotFound) {
					<-w.semaphore
					continue
				}
				if err != nil {
					w.logger.Error("task claim failed", "error", err)
					<-w.semaphore
					continue
				}

				w.logger.Info("claimed task",
					"task_id", lease.Task.ID,
					"execution_id", lease.Task.ExecutionID,
					"kind", lease.Task.Kind,
					"attempt", lease.Attempt,
				)

				w.wg.Add(1)
				go func(lease tasks.TaskLease) {
					defer w.wg.Done()
					defer func() { <-w.semaphore }()
					w.executeTask(ctx, lease)
				}(lease)

			default:
				// No capacity, skip this poll
			}
		}
	}
}

// executeTask runs a claimed task with lease renewal and timeout handling.
func (w *Worker) executeTask(ctx context.Context, lease tasks.TaskLease) {
	taskCtx, cancel := context.WithDeadline(ctx, lease.Task.Deadline)
	defer cancel()

	// Start lease renewal goroutine
	renewCtx, stopRenewal := context.WithCancel(taskCtx)
	defer stopRenewal()

	go w.renewLease(renewCtx, lease.Task.ID)

	// Update task to running status
	err := w.store.UpdateTaskStatus(taskCtx, lease.Task.ID, w.workerID, tasks.TaskRunning, nil, "")
	if err != nil {
		w.logger.Error("failed to update task to running", "task_id", lease.Task.ID, "error", err)
		return
	}

	w.logger.Info("executing task", "task_id", lease.Task.ID, "kind", lease.Task.Kind)

	// Execute the task based on its kind
	result, err := w.execute(taskCtx, lease.Task)

	// Update final status
	var status tasks.TaskStatus
	var errorMsg string
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			status = tasks.TaskTimedOut
			errorMsg = "task deadline exceeded"
		} else if errors.Is(err, context.Canceled) {
			status = tasks.TaskCancelled
			errorMsg = "task cancelled"
		} else {
			status = tasks.TaskFailed
			errorMsg = err.Error()
		}
		w.logger.Error("task execution failed",
			"task_id", lease.Task.ID,
			"status", status,
			"error", err,
		)
	} else {
		status = tasks.TaskCompleted
		w.logger.Info("task completed successfully", "task_id", lease.Task.ID)
	}

	if err := w.store.UpdateTaskStatus(context.Background(), lease.Task.ID, w.workerID, status, result, errorMsg); err != nil {
		w.logger.Error("failed to update task final status", "task_id", lease.Task.ID, "error", err)
	}

	// Clean up workspace
	workspace := filepath.Join(w.workspaceRoot, lease.Task.ID)
	if err := os.RemoveAll(workspace); err != nil {
		w.logger.Warn("workspace cleanup failed", "task_id", lease.Task.ID, "error", err)
	}
}

// renewLease periodically renews the task lease while execution is in progress.
func (w *Worker) renewLease(ctx context.Context, taskID string) {
	ticker := time.NewTicker(w.leaseDuration / 2)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := w.store.RenewLease(ctx, taskID, w.workerID, w.leaseDuration); err != nil {
				w.logger.Error("lease renewal failed", "task_id", taskID, "error", err)
				return
			}
		}
	}
}

// execute dispatches task execution based on kind.
func (w *Worker) execute(ctx context.Context, task tasks.Task) (json.RawMessage, error) {
	switch task.Kind {
	case "evaluation":
		return w.executeEvaluation(ctx, task)
	case "git_operation":
		return w.executeGitOperation(ctx, task)
	default:
		return nil, fmt.Errorf("unsupported task kind: %s", task.Kind)
	}
}

// executeEvaluation runs an evaluation task (Git diff check or Docker evaluator).
func (w *Worker) executeEvaluation(ctx context.Context, task tasks.Task) (json.RawMessage, error) {
	var payload struct {
		Repository     string `json:"repository"`
		BaseSHA        string `json:"baseSHA"`
		RevisionSHA    string `json:"revisionSHA"`
		DockerImage    string `json:"dockerImage,omitempty"`
		Command        string `json:"command,omitempty"`
		RepositoryPath string `json:"repositoryPath"`
	}

	if err := json.Unmarshal(task.Payload, &payload); err != nil {
		return nil, fmt.Errorf("invalid evaluation payload: %w", err)
	}

	w.logTask(ctx, task.ID, "info", "starting evaluation", nil)

	// Create isolated workspace
	workspace := filepath.Join(w.workspaceRoot, task.ID)
	if err := os.MkdirAll(workspace, 0755); err != nil {
		return nil, fmt.Errorf("create workspace: %w", err)
	}

	// If Docker image is specified, run in container
	if payload.DockerImage != "" && payload.Command != "" {
		return w.executeDockerEvaluation(ctx, task, workspace, payload)
	}

	// Otherwise, run Git diff check
	return w.executeGitDiffCheck(ctx, task, payload)
}

// executeGitDiffCheck runs git diff --check.
func (w *Worker) executeGitDiffCheck(ctx context.Context, task tasks.Task, payload struct {
	Repository     string `json:"repository"`
	BaseSHA        string `json:"baseSHA"`
	RevisionSHA    string `json:"revisionSHA"`
	DockerImage    string `json:"dockerImage,omitempty"`
	Command        string `json:"command,omitempty"`
	RepositoryPath string `json:"repositoryPath"`
}) (json.RawMessage, error) {
	w.logTask(ctx, task.ID, "info", "running git diff check", nil)

	cmd := exec.CommandContext(ctx, "git", "diff", "--check", payload.BaseSHA, payload.RevisionSHA)
	cmd.Dir = payload.RepositoryPath

	output, err := cmd.CombinedOutput()
	passed := err == nil

	result := map[string]interface{}{
		"kind":        "git_diff_check",
		"passed":      passed,
		"output":      string(output),
		"baseSHA":     payload.BaseSHA,
		"revisionSHA": payload.RevisionSHA,
	}

	resultJSON, _ := json.Marshal(result)

	if !passed {
		return resultJSON, fmt.Errorf("git diff check failed: %s", string(output))
	}

	return resultJSON, nil
}

// executeDockerEvaluation runs evaluation in a Docker container.
func (w *Worker) executeDockerEvaluation(ctx context.Context, task tasks.Task, workspace string, payload struct {
	Repository     string `json:"repository"`
	BaseSHA        string `json:"baseSHA"`
	RevisionSHA    string `json:"revisionSHA"`
	DockerImage    string `json:"dockerImage,omitempty"`
	Command        string `json:"command,omitempty"`
	RepositoryPath string `json:"repositoryPath"`
}) (json.RawMessage, error) {
	w.logTask(ctx, task.ID, "info", "running docker evaluation", map[string]string{
		"image":   payload.DockerImage,
		"command": payload.Command,
	})

	args := []string{
		"run", "--rm", "--pull=never", "--network=none", "--read-only",
		"--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=256",
		"--memory=2g", "--cpus=2", "--user=65532:65532",
		"--tmpfs", "/tmp:rw,nosuid,nodev,size=512m",
		"--mount", "type=bind,src=" + payload.RepositoryPath + ",dst=/workspace,readonly",
		"--workdir", "/workspace",
		"--env", "HOME=/tmp",
		"--env", "AGENTFORGE_BASE_SHA=" + payload.BaseSHA,
		"--env", "AGENTFORGE_REVISION_SHA=" + payload.RevisionSHA,
		payload.DockerImage,
		"/bin/sh", "-c", payload.Command,
	}

	cmd := exec.CommandContext(ctx, "docker", args...)
	output, err := cmd.CombinedOutput()
	passed := err == nil

	result := map[string]interface{}{
		"kind":        "docker_evaluation",
		"passed":      passed,
		"image":       payload.DockerImage,
		"command":     payload.Command,
		"output":      string(output),
		"baseSHA":     payload.BaseSHA,
		"revisionSHA": payload.RevisionSHA,
	}

	resultJSON, _ := json.Marshal(result)

	if !passed {
		return resultJSON, fmt.Errorf("docker evaluation failed: %s", string(output))
	}

	return resultJSON, nil
}

// executeGitOperation runs a Git operation task.
func (w *Worker) executeGitOperation(ctx context.Context, task tasks.Task) (json.RawMessage, error) {
	w.logTask(ctx, task.ID, "info", "git operation not yet implemented", nil)
	return nil, fmt.Errorf("git operations not yet implemented")
}

// logTask adds a log entry for the task.
func (w *Worker) logTask(ctx context.Context, taskID, level, message string, attrs map[string]string) {
	var attrsJSON json.RawMessage
	if attrs != nil {
		attrsJSON, _ = json.Marshal(attrs)
	}
	_ = w.store.AddTaskLog(ctx, taskID, level, message, attrsJSON)
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		var result int
		if _, err := fmt.Sscanf(val, "%d", &result); err == nil {
			return result
		}
	}
	return defaultVal
}

func getEnvDuration(key string, defaultVal time.Duration) time.Duration {
	if val := os.Getenv(key); val != "" {
		if d, err := time.ParseDuration(val); err == nil {
			return d
		}
	}
	return defaultVal
}
