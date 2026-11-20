package tasks

import (
	"context"
	"encoding/json"
	"time"
)

// Store defines the persistence interface for executions and tasks.
type Store interface {
	// CreateExecution creates a new execution record.
	CreateExecution(ctx context.Context, req CreateExecutionRequest) (Execution, error)

	// GetExecution retrieves an execution by ID.
	GetExecution(ctx context.Context, organizationID, executionID string) (Execution, error)

	// CancelExecution marks an execution and its pending tasks as cancelled.
	CancelExecution(ctx context.Context, organizationID, executionID, actor string) error

	// ListExecutions returns executions for an organization, ordered by created_at DESC.
	ListExecutions(ctx context.Context, organizationID string, limit, offset int) ([]Execution, int, error)

	// CreateTask creates a new task within an execution.
	CreateTask(ctx context.Context, req CreateTaskRequest) (Task, error)

	// ClaimTask atomically claims an available task for a worker.
	// It uses PostgreSQL advisory locks to prevent concurrent claims.
	// Returns ErrTaskNotFound if no claimable task is available.
	ClaimTask(ctx context.Context, workerID, capability string, leaseDuration time.Duration) (TaskLease, error)

	// RenewLease extends the lease for a task the worker still holds.
	// Returns ErrLeaseExpired if the lease has already expired or the worker doesn't match.
	RenewLease(ctx context.Context, taskID, workerID string, extension time.Duration) error

	// UpdateTaskStatus updates a task's status. The worker ID must match for leased tasks.
	UpdateTaskStatus(ctx context.Context, taskID, workerID string, status TaskStatus, result json.RawMessage, errorMsg string) error

	// GetTask retrieves a task by ID.
	GetTask(ctx context.Context, organizationID, taskID string) (Task, error)

	// ListTasks returns all tasks for an execution.
	ListTasks(ctx context.Context, organizationID, executionID string) ([]Task, error)

	// ReclaimExpiredLeases finds tasks with expired leases and returns them to queued status.
	// This is called periodically by workers to recover from crashes.
	ReclaimExpiredLeases(ctx context.Context) (int, error)

	// AddTaskLog appends a log entry for a task.
	AddTaskLog(ctx context.Context, taskID, level, message string, attributes json.RawMessage) error

	// GetTaskLogs retrieves logs for a task.
	GetTaskLogs(ctx context.Context, taskID string, limit int) ([]TaskLog, error)

	// AddExecutionEvent records a lifecycle event for an execution.
	AddExecutionEvent(ctx context.Context, executionID, kind, actor, message string) error

	// GetExecutionEvents retrieves events for an execution.
	GetExecutionEvents(ctx context.Context, executionID string, afterSeq int64) ([]ExecutionEvent, error)
}
