package tasks_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/platform/postgres"
	"github.com/easyhaloo/agentforge/backend/api/internal/tasks"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// TestExecutionLifecycle tests the complete execution lifecycle:
// create execution -> create task -> claim task -> complete task -> verify execution completed
func TestExecutionLifecycle(t *testing.T) {
	ctx, taskStore := openTaskStore(t)

	// Create an execution
	payload, _ := json.Marshal(map[string]string{
		"repository":     "/test/repo",
		"baseSHA":        "abc123",
		"revisionSHA":    "def456",
		"repositoryPath": "/tmp/test-repo",
	})

	exec, err := taskStore.CreateExecution(ctx, tasks.CreateExecutionRequest{
		OrganizationID: "test-org",
		Kind:           tasks.KindEvaluation,
		Payload:        payload,
		Deadline:       time.Now().Add(1 * time.Hour),
	})
	if err != nil {
		t.Fatalf("failed to create execution: %v", err)
	}

	if exec.Status != tasks.ExecutionQueued {
		t.Errorf("expected status queued, got %s", exec.Status)
	}

	// Create a task
	task, err := taskStore.CreateTask(ctx, tasks.CreateTaskRequest{
		ExecutionID:    exec.ID,
		OrganizationID: "test-org",
		Kind:           "evaluation",
		Capability:     "default",
		Payload:        payload,
		MaxAttempts:    3,
		Deadline:       time.Now().Add(1 * time.Hour),
	})
	if err != nil {
		t.Fatalf("failed to create task: %v", err)
	}

	if task.Status != tasks.TaskQueued {
		t.Errorf("expected task status queued, got %s", task.Status)
	}

	// Claim the task
	lease, err := taskStore.ClaimTask(ctx, "test-worker", "default", 5*time.Minute)
	if err != nil {
		t.Fatalf("failed to claim task: %v", err)
	}

	if lease.Task.ID != task.ID {
		t.Errorf("expected task ID %s, got %s", task.ID, lease.Task.ID)
	}

	if lease.Task.Status != tasks.TaskLeased {
		t.Errorf("expected task status leased, got %s", lease.Task.Status)
	}

	// Verify execution is now running
	exec, err = taskStore.GetExecution(ctx, "test-org", exec.ID)
	if err != nil {
		t.Fatalf("failed to get execution: %v", err)
	}
	if exec.Status != tasks.ExecutionRunning {
		t.Errorf("expected execution status running, got %s", exec.Status)
	}

	// Update task to running
	err = taskStore.UpdateTaskStatus(ctx, task.ID, "test-worker", tasks.TaskRunning, nil, "")
	if err != nil {
		t.Fatalf("failed to update task to running: %v", err)
	}

	if err := taskStore.RenewLease(ctx, task.ID, "test-worker", 5*time.Minute); err != nil {
		t.Fatalf("renew running task lease: %v", err)
	}
	if err := taskStore.UpdateTaskStatus(ctx, task.ID, "other-worker", tasks.TaskCancelled, nil, ""); !errors.Is(err, tasks.ErrLeaseExpired) {
		t.Fatalf("expected lease error for another worker, got %v", err)
	}

	// Complete the task
	result, _ := json.Marshal(map[string]interface{}{
		"passed": true,
		"output": "all tests passed",
	})
	err = taskStore.UpdateTaskStatus(ctx, task.ID, "test-worker", tasks.TaskCompleted, result, "")
	if err != nil {
		t.Fatalf("failed to complete task: %v", err)
	}

	completedTask, err := taskStore.GetTask(ctx, "test-org", task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if completedTask.Status != tasks.TaskCompleted || completedTask.WorkerID != "" || completedTask.LeaseUntil != nil {
		t.Fatalf("expected completed task without a lease, got %+v", completedTask)
	}

	// Verify execution is now completed
	exec, err = taskStore.GetExecution(ctx, "test-org", exec.ID)
	if err != nil {
		t.Fatalf("failed to get execution: %v", err)
	}
	if exec.Status != tasks.ExecutionCompleted {
		t.Errorf("expected execution status completed, got %s", exec.Status)
	}
}

// TestTaskLeaseReclaim tests that expired leases are properly reclaimed
func TestTaskLeaseReclaim(t *testing.T) {
	ctx, taskStore := openTaskStore(t)

	// Create execution and task
	exec, err := taskStore.CreateExecution(ctx, tasks.CreateExecutionRequest{
		OrganizationID: "test-org",
		Kind:           tasks.KindEvaluation,
		Payload:        json.RawMessage(`{}`),
		Deadline:       time.Now().Add(1 * time.Hour),
	})

	if err != nil {
		t.Fatal(err)
	}

	task, err := taskStore.CreateTask(ctx, tasks.CreateTaskRequest{
		ExecutionID:    exec.ID,
		OrganizationID: "test-org",
		Kind:           "evaluation",
		Capability:     "default",
		Payload:        json.RawMessage(`{}`),
		MaxAttempts:    3,
		Deadline:       time.Now().Add(1 * time.Hour),
	})

	if err != nil {
		t.Fatal(err)
	}

	// Set the lease to expire in the past so reclaim does not depend on a sleep.
	_, err = taskStore.ClaimTask(ctx, "test-worker", "default", -time.Minute)
	if err != nil {
		t.Fatalf("failed to claim task: %v", err)
	}

	// Reclaim expired leases
	reclaimed, err := taskStore.ReclaimExpiredLeases(ctx)
	if err != nil {
		t.Fatalf("failed to reclaim leases: %v", err)
	}

	if reclaimed != 1 {
		t.Errorf("expected 1 reclaimed lease, got %d", reclaimed)
	}

	// Verify task is back to queued
	retrievedTask, err := taskStore.GetTask(ctx, "test-org", task.ID)
	if err != nil {
		t.Fatalf("failed to get task: %v", err)
	}

	if retrievedTask.Status != tasks.TaskQueued {
		t.Errorf("expected task status queued after reclaim, got %s", retrievedTask.Status)
	}

	lease, err := taskStore.ClaimTask(ctx, "next-worker", "default", time.Minute)
	if err != nil || lease.Task.ID != task.ID || lease.Attempt != 2 {
		t.Fatalf("expected task to be claimable again, got %+v (%v)", lease, err)
	}
	if err := taskStore.UpdateTaskStatus(ctx, task.ID, "next-worker", tasks.TaskRunning, nil, ""); err != nil {
		t.Fatal(err)
	}
	if err := taskStore.RenewLease(ctx, task.ID, "next-worker", -time.Minute); err != nil {
		t.Fatal(err)
	}
	if err := taskStore.UpdateTaskStatus(ctx, task.ID, "next-worker", tasks.TaskCompleted, nil, ""); !errors.Is(err, tasks.ErrLeaseExpired) {
		t.Fatalf("expected expired worker lease to reject completion, got %v", err)
	}
	if reclaimed, err := taskStore.ReclaimExpiredLeases(ctx); err != nil || reclaimed != 1 {
		t.Fatalf("expected to reclaim the running task, got %d (%v)", reclaimed, err)
	}
}

// TestCancellation tests execution cancellation
func TestCancellation(t *testing.T) {
	ctx, taskStore := openTaskStore(t)

	// Create execution with tasks
	exec, err := taskStore.CreateExecution(ctx, tasks.CreateExecutionRequest{
		OrganizationID: "test-org",
		Kind:           tasks.KindEvaluation,
		Payload:        json.RawMessage(`{}`),
		Deadline:       time.Now().Add(1 * time.Hour),
	})

	if err != nil {
		t.Fatal(err)
	}

	// Cancel both a running task and a leased task that has not started.
	for _, status := range []tasks.TaskStatus{tasks.TaskRunning, tasks.TaskLeased} {
		task, err := taskStore.CreateTask(ctx, tasks.CreateTaskRequest{
			ExecutionID:    exec.ID,
			OrganizationID: "test-org",
			Kind:           "evaluation",
			Capability:     "default",
			Payload:        json.RawMessage(`{}`),
			MaxAttempts:    3,
			Deadline:       time.Now().Add(time.Hour),
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := taskStore.ClaimTask(ctx, "test-worker", "default", 5*time.Minute); err != nil {
			t.Fatal(err)
		}
		if status == tasks.TaskRunning {
			if err := taskStore.UpdateTaskStatus(ctx, task.ID, "test-worker", status, nil, ""); err != nil {
				t.Fatal(err)
			}
		}
	}
	// Cancel the execution
	err = taskStore.CancelExecution(ctx, "test-org", exec.ID, "test-user")
	if err != nil {
		t.Fatalf("failed to cancel execution: %v", err)
	}

	// Verify execution is cancelled
	exec, err = taskStore.GetExecution(ctx, "test-org", exec.ID)
	if err != nil {
		t.Fatalf("failed to get execution: %v", err)
	}

	if exec.Status != tasks.ExecutionCancelled {
		t.Errorf("expected execution status cancelled, got %s", exec.Status)
	}

	// Verify tasks are cancelled
	taskList, err := taskStore.ListTasks(ctx, "test-org", exec.ID)
	if err != nil {
		t.Fatalf("failed to list tasks: %v", err)
	}

	if len(taskList) != 2 {
		t.Fatalf("expected two cancelled tasks, got %d", len(taskList))
	}
	for _, task := range taskList {
		if task.Status != tasks.TaskCancelled || task.LeaseUntil != nil || task.WorkerID != "" {
			t.Fatalf("expected cancelled task without a lease, got %+v", task)
		}
	}
}

func openTaskStore(t *testing.T) (context.Context, *tasks.PostgresStore) {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		if os.Getenv("CI") == "true" {
			t.Fatal("DATABASE_URL is required in CI")
		}
		t.Skip("DATABASE_URL is not configured")
	}

	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	t.Cleanup(cancel)
	scratch, err := url.Parse(dsn)
	if err != nil {
		t.Fatal("invalid DATABASE_URL")
	}
	// Claims and reclaim are database-wide. Each test needs an empty queue.
	name := "agentforge_tasks_" + uuid.NewString()
	identifier := pgx.Identifier{name}.Sanitize()
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.Close(context.Background()) })
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+identifier); err != nil {
		t.Fatalf("create scratch database: %v", err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := admin.Exec(cleanup, "DROP DATABASE "+identifier); err != nil {
			t.Errorf("drop scratch database: %v", err)
		}
	})
	scratch.Path = "/" + name
	scratch.RawPath = ""
	store, err := postgres.Open(ctx, scratch.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Close)
	if _, err := store.Pool().Exec(ctx, "INSERT INTO organizations (id, name) VALUES ($1, $2)", "test-org", "Test organization"); err != nil {
		t.Fatal(err)
	}
	return ctx, tasks.NewPostgresStore(store.Pool())
}
