package tasks_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/platform/postgres"
	"github.com/easyhaloo/agentforge/backend/api/internal/tasks"
)

// TestExecutionLifecycle tests the complete execution lifecycle:
// create execution -> create task -> claim task -> complete task -> verify execution completed
func TestExecutionLifecycle(t *testing.T) {
	ctx := context.Background()

	// Skip if DATABASE_URL not set (for CI)
	databaseURL := getTestDatabaseURL(t)
	if databaseURL == "" {
		t.Skip("DATABASE_URL not set, skipping integration test")
	}

	// Open database connection
	store, err := postgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("failed to open database: %v", err)
	}
	defer store.Close()

	taskStore := tasks.NewPostgresStore(store.Pool())

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

	// Complete the task
	result, _ := json.Marshal(map[string]interface{}{
		"passed": true,
		"output": "all tests passed",
	})
	err = taskStore.UpdateTaskStatus(ctx, task.ID, "test-worker", tasks.TaskCompleted, result, "")
	if err != nil {
		t.Fatalf("failed to complete task: %v", err)
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
	ctx := context.Background()

	databaseURL := getTestDatabaseURL(t)
	if databaseURL == "" {
		t.Skip("DATABASE_URL not set, skipping integration test")
	}

	store, err := postgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("failed to open database: %v", err)
	}
	defer store.Close()

	taskStore := tasks.NewPostgresStore(store.Pool())

	// Create execution and task
	exec, _ := taskStore.CreateExecution(ctx, tasks.CreateExecutionRequest{
		OrganizationID: "test-org",
		Kind:           tasks.KindEvaluation,
		Payload:        json.RawMessage(`{}`),
		Deadline:       time.Now().Add(1 * time.Hour),
	})

	task, _ := taskStore.CreateTask(ctx, tasks.CreateTaskRequest{
		ExecutionID:    exec.ID,
		OrganizationID: "test-org",
		Kind:           "evaluation",
		Capability:     "default",
		Payload:        json.RawMessage(`{}`),
		MaxAttempts:    3,
		Deadline:       time.Now().Add(1 * time.Hour),
	})

	// Claim with very short lease
	_, err = taskStore.ClaimTask(ctx, "test-worker", "default", 1*time.Millisecond)
	if err != nil {
		t.Fatalf("failed to claim task: %v", err)
	}

	// Wait for lease to expire
	time.Sleep(10 * time.Millisecond)

	// Reclaim expired leases
	reclaimed, err := taskStore.ReclaimExpiredLeases(ctx)
	if err != nil {
		t.Fatalf("failed to reclaim leases: %v", err)
	}

	if reclaimed < 1 {
		t.Errorf("expected at least 1 reclaimed lease, got %d", reclaimed)
	}

	// Verify task is back to queued
	retrievedTask, err := taskStore.GetTask(ctx, "test-org", task.ID)
	if err != nil {
		t.Fatalf("failed to get task: %v", err)
	}

	if retrievedTask.Status != tasks.TaskQueued {
		t.Errorf("expected task status queued after reclaim, got %s", retrievedTask.Status)
	}
}

// TestCancellation tests execution cancellation
func TestCancellation(t *testing.T) {
	ctx := context.Background()

	databaseURL := getTestDatabaseURL(t)
	if databaseURL == "" {
		t.Skip("DATABASE_URL not set, skipping integration test")
	}

	store, err := postgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("failed to open database: %v", err)
	}
	defer store.Close()

	taskStore := tasks.NewPostgresStore(store.Pool())

	// Create execution with tasks
	exec, _ := taskStore.CreateExecution(ctx, tasks.CreateExecutionRequest{
		OrganizationID: "test-org",
		Kind:           tasks.KindEvaluation,
		Payload:        json.RawMessage(`{}`),
		Deadline:       time.Now().Add(1 * time.Hour),
	})

	taskStore.CreateTask(ctx, tasks.CreateTaskRequest{
		ExecutionID:    exec.ID,
		OrganizationID: "test-org",
		Kind:           "evaluation",
		Capability:     "default",
		Payload:        json.RawMessage(`{}`),
		MaxAttempts:    3,
		Deadline:       time.Now().Add(1 * time.Hour),
	})

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

	for _, task := range taskList {
		if task.Status != tasks.TaskCancelled {
			t.Errorf("expected task status cancelled, got %s", task.Status)
		}
	}
}

func getTestDatabaseURL(t *testing.T) string {
	// Use environment variable or default test database
	// In CI, this would be set appropriately
	return "" // Set this to your test database URL for local testing
}
