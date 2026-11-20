// Package tasks provides a general-purpose durable execution subsystem.
// It supports evaluations, Git operations, and agent tasks with lease-based
// worker coordination, automatic retry, and cancellation semantics.
package tasks

import (
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrExecutionNotFound = errors.New("execution not found")
	ErrTaskNotFound      = errors.New("task not found")
	ErrLeaseExpired      = errors.New("task lease expired")
	ErrCancelled         = errors.New("execution cancelled")
	ErrDeadlineExceeded  = errors.New("execution deadline exceeded")
	ErrInvalidStatus     = errors.New("invalid status transition")
)

// ExecutionKind defines the type of execution.
type ExecutionKind string

const (
	KindEvaluation   ExecutionKind = "evaluation"
	KindGitOperation ExecutionKind = "git_operation"
	KindAgentTask    ExecutionKind = "agent_task"
)

// ExecutionStatus represents the lifecycle state of an execution.
type ExecutionStatus string

const (
	ExecutionQueued    ExecutionStatus = "queued"
	ExecutionRunning   ExecutionStatus = "running"
	ExecutionCompleted ExecutionStatus = "completed"
	ExecutionFailed    ExecutionStatus = "failed"
	ExecutionCancelled ExecutionStatus = "cancelled"
	ExecutionTimedOut  ExecutionStatus = "timed_out"
)

// TaskStatus represents the lifecycle state of a task.
type TaskStatus string

const (
	TaskQueued    TaskStatus = "queued"
	TaskLeased    TaskStatus = "leased"
	TaskRunning   TaskStatus = "running"
	TaskCompleted TaskStatus = "completed"
	TaskFailed    TaskStatus = "failed"
	TaskCancelled TaskStatus = "cancelled"
	TaskTimedOut  TaskStatus = "timed_out"
)

// Execution represents a top-level execution request that may contain one or more tasks.
type Execution struct {
	ID             string          `json:"id"`
	OrganizationID string          `json:"organizationId"`
	Kind           ExecutionKind   `json:"kind"`
	Status         ExecutionStatus `json:"status"`
	Payload        json.RawMessage `json:"payload"`
	Result         json.RawMessage `json:"result,omitempty"`
	ErrorMessage   string          `json:"errorMessage,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
	StartedAt      *time.Time      `json:"startedAt,omitempty"`
	CompletedAt    *time.Time      `json:"completedAt,omitempty"`
	Deadline       time.Time       `json:"deadline"`
	Version        int64           `json:"version"`
}

// Task represents an individual unit of work that can be claimed and executed by a worker.
type Task struct {
	ID             string          `json:"id"`
	ExecutionID    string          `json:"executionId"`
	OrganizationID string          `json:"organizationId"`
	Kind           string          `json:"kind"`
	Capability     string          `json:"capability"`
	Status         TaskStatus      `json:"status"`
	Payload        json.RawMessage `json:"payload"`
	Result         json.RawMessage `json:"result,omitempty"`
	ErrorMessage   string          `json:"errorMessage,omitempty"`
	Attempt        int             `json:"attempt"`
	MaxAttempts    int             `json:"maxAttempts"`
	WorkerID       string          `json:"workerId,omitempty"`
	LeaseUntil     *time.Time      `json:"leaseUntil,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
	StartedAt      *time.Time      `json:"startedAt,omitempty"`
	CompletedAt    *time.Time      `json:"completedAt,omitempty"`
	Deadline       time.Time       `json:"deadline"`
}

// TaskLease represents an active worker claim on a task.
type TaskLease struct {
	Task       Task
	WorkerID   string
	LeaseUntil time.Time
	Attempt    int
}

// IsExpired checks if the lease has expired.
func (l TaskLease) IsExpired() bool {
	return time.Now().After(l.LeaseUntil)
}

// ExecutionEvent represents a lifecycle event for an execution.
type ExecutionEvent struct {
	Seq         int64     `json:"seq"`
	ExecutionID string    `json:"executionId"`
	CreatedAt   time.Time `json:"createdAt"`
	Kind        string    `json:"kind"`
	Actor       string    `json:"actor"`
	Message     string    `json:"message,omitempty"`
}

// TaskLog represents a log entry from task execution.
type TaskLog struct {
	ID         int64           `json:"id"`
	TaskID     string          `json:"taskId"`
	CreatedAt  time.Time       `json:"createdAt"`
	Level      string          `json:"level"`
	Message    string          `json:"message"`
	Attributes json.RawMessage `json:"attributes,omitempty"`
}

// CreateExecutionRequest contains the parameters for creating a new execution.
type CreateExecutionRequest struct {
	OrganizationID string
	Kind           ExecutionKind
	Payload        json.RawMessage
	Deadline       time.Time
}

// CreateTaskRequest contains the parameters for creating a new task.
type CreateTaskRequest struct {
	ExecutionID    string
	OrganizationID string
	Kind           string
	Capability     string
	Payload        json.RawMessage
	MaxAttempts    int
	Deadline       time.Time
}
