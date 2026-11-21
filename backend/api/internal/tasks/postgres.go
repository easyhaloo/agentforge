package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresStore implements Store using PostgreSQL.
type PostgresStore struct {
	pool *pgxpool.Pool
}

// NewPostgresStore creates a new PostgreSQL-backed task store.
func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore {
	return &PostgresStore{pool: pool}
}

// CreateExecution creates a new execution record.
func (s *PostgresStore) CreateExecution(ctx context.Context, req CreateExecutionRequest) (Execution, error) {
	id := uuid.New().String()
	now := time.Now()

	exec := Execution{
		ID:             id,
		OrganizationID: req.OrganizationID,
		Kind:           req.Kind,
		Status:         ExecutionQueued,
		Payload:        req.Payload,
		CreatedAt:      now,
		Deadline:       req.Deadline,
		Version:        1,
	}

	query := `
		INSERT INTO executions (id, organization_id, kind, status, payload, created_at, deadline, version)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`
	_, err := s.pool.Exec(ctx, query,
		exec.ID, exec.OrganizationID, exec.Kind, exec.Status,
		exec.Payload, exec.CreatedAt, exec.Deadline, exec.Version,
	)
	if err != nil {
		return Execution{}, fmt.Errorf("create execution: %w", err)
	}

	// Record creation event
	_ = s.AddExecutionEvent(ctx, exec.ID, "execution.created", "system", "")

	return exec, nil
}

// GetExecution retrieves an execution by ID.
func (s *PostgresStore) GetExecution(ctx context.Context, organizationID, executionID string) (Execution, error) {
	query := `
		SELECT id, organization_id, kind, status, payload,
		       COALESCE(result, 'null'::jsonb), COALESCE(error_message, ''),
		       created_at, started_at, completed_at, deadline, version
		FROM executions
		WHERE organization_id = $1 AND id = $2
	`

	var exec Execution
	var startedAt, completedAt *time.Time

	err := s.pool.QueryRow(ctx, query, organizationID, executionID).Scan(
		&exec.ID, &exec.OrganizationID, &exec.Kind, &exec.Status,
		&exec.Payload, &exec.Result, &exec.ErrorMessage,
		&exec.CreatedAt, &startedAt, &completedAt, &exec.Deadline, &exec.Version,
	)
	if err == pgx.ErrNoRows {
		return Execution{}, ErrExecutionNotFound
	}
	if err != nil {
		return Execution{}, fmt.Errorf("get execution: %w", err)
	}

	exec.StartedAt = startedAt
	exec.CompletedAt = completedAt

	return exec, nil
}

// CancelExecution marks an execution and its active tasks as cancelled.
func (s *PostgresStore) CancelExecution(ctx context.Context, organizationID, executionID, actor string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Lock tasks before the execution, as claim and completion do. If the
	// execution cannot be cancelled, the transaction rolls back these updates.
	_, err = tx.Exec(ctx, `
		UPDATE tasks
		SET status = 'cancelled', completed_at = now(), worker_id = NULL, lease_until = NULL
		WHERE organization_id = $1 AND execution_id = $2 AND status IN ('queued', 'leased', 'running')
	`, organizationID, executionID)
	if err != nil {
		return fmt.Errorf("cancel tasks: %w", err)
	}

	tag, err := tx.Exec(ctx, `
		UPDATE executions
		SET status = 'cancelled', completed_at = now(), version = version + 1
		WHERE organization_id = $1 AND id = $2 AND status IN ('queued', 'running')
	`, organizationID, executionID)
	if err != nil {
		return fmt.Errorf("cancel execution: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrExecutionNotFound
	}

	// Record cancellation event
	_, err = tx.Exec(ctx, `
		INSERT INTO execution_events (execution_id, kind, actor, message)
		VALUES ($1, 'execution.cancelled', $2, '')
	`, executionID, actor)
	if err != nil {
		return fmt.Errorf("record event: %w", err)
	}

	return tx.Commit(ctx)
}

// ListExecutions returns executions for an organization.
func (s *PostgresStore) ListExecutions(ctx context.Context, organizationID string, limit, offset int) ([]Execution, int, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	// Get total count
	var total int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM executions WHERE organization_id = $1
	`, organizationID).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count executions: %w", err)
	}

	// Get page
	query := `
		SELECT id, organization_id, kind, status, payload,
		       COALESCE(result, 'null'::jsonb), COALESCE(error_message, ''),
		       created_at, started_at, completed_at, deadline, version
		FROM executions
		WHERE organization_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := s.pool.Query(ctx, query, organizationID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list executions: %w", err)
	}
	defer rows.Close()

	var executions []Execution
	for rows.Next() {
		var exec Execution
		var startedAt, completedAt *time.Time

		err := rows.Scan(
			&exec.ID, &exec.OrganizationID, &exec.Kind, &exec.Status,
			&exec.Payload, &exec.Result, &exec.ErrorMessage,
			&exec.CreatedAt, &startedAt, &completedAt, &exec.Deadline, &exec.Version,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("scan execution: %w", err)
		}

		exec.StartedAt = startedAt
		exec.CompletedAt = completedAt

		executions = append(executions, exec)
	}

	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("rows error: %w", err)
	}

	return executions, total, nil
}

// CreateTask creates a new task within an execution.
func (s *PostgresStore) CreateTask(ctx context.Context, req CreateTaskRequest) (Task, error) {
	id := uuid.New().String()
	now := time.Now()

	if req.MaxAttempts <= 0 {
		req.MaxAttempts = 3
	}
	if req.Capability == "" {
		req.Capability = "default"
	}

	task := Task{
		ID:             id,
		ExecutionID:    req.ExecutionID,
		OrganizationID: req.OrganizationID,
		Kind:           req.Kind,
		Capability:     req.Capability,
		Status:         TaskQueued,
		Payload:        req.Payload,
		Attempt:        0,
		MaxAttempts:    req.MaxAttempts,
		CreatedAt:      now,
		Deadline:       req.Deadline,
	}

	query := `
		INSERT INTO tasks (id, execution_id, organization_id, kind, capability, status,
		                   payload, attempt, max_attempts, created_at, deadline)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`
	_, err := s.pool.Exec(ctx, query,
		task.ID, task.ExecutionID, task.OrganizationID, task.Kind, task.Capability,
		task.Status, task.Payload, task.Attempt, task.MaxAttempts,
		task.CreatedAt, task.Deadline,
	)
	if err != nil {
		return Task{}, fmt.Errorf("create task: %w", err)
	}

	return task, nil
}

// ClaimTask atomically claims an available task for a worker using advisory locks.
func (s *PostgresStore) ClaimTask(ctx context.Context, workerID, capability string, leaseDuration time.Duration) (TaskLease, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TaskLease{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Find a claimable task and lock it with FOR UPDATE SKIP LOCKED
	query := `
		SELECT id, execution_id, organization_id, kind, capability, status, payload,
		       COALESCE(result, 'null'::jsonb), COALESCE(error_message, ''),
		       attempt, max_attempts, worker_id, lease_until,
		       created_at, started_at, completed_at, deadline
		FROM tasks
		WHERE capability = $1
		  AND status = 'queued'
		  AND attempt < max_attempts
		  AND deadline > now()
		ORDER BY created_at
		LIMIT 1
		FOR UPDATE SKIP LOCKED
	`

	var task Task
	var result, errorMsg *string
	var currentWorkerID *string
	var leaseUntil, startedAt, completedAt *time.Time

	err = tx.QueryRow(ctx, query, capability).Scan(
		&task.ID, &task.ExecutionID, &task.OrganizationID, &task.Kind,
		&task.Capability, &task.Status, &task.Payload,
		&result, &errorMsg, &task.Attempt, &task.MaxAttempts,
		&currentWorkerID, &leaseUntil,
		&task.CreatedAt, &startedAt, &completedAt, &task.Deadline,
	)
	if err == pgx.ErrNoRows {
		return TaskLease{}, ErrTaskNotFound
	}
	if err != nil {
		return TaskLease{}, fmt.Errorf("find claimable task: %w", err)
	}

	if result != nil {
		task.Result = json.RawMessage(*result)
	}
	if errorMsg != nil {
		task.ErrorMessage = *errorMsg
	}
	if currentWorkerID != nil {
		task.WorkerID = *currentWorkerID
	}
	task.LeaseUntil = leaseUntil
	task.StartedAt = startedAt
	task.CompletedAt = completedAt

	// Claim the task by updating it to leased status
	newLeaseUntil := time.Now().Add(leaseDuration)
	_, err = tx.Exec(ctx, `
		UPDATE tasks
		SET status = 'leased',
		    worker_id = $1,
		    lease_until = $2,
		    attempt = attempt + 1
		WHERE id = $3
	`, workerID, newLeaseUntil, task.ID)
	if err != nil {
		return TaskLease{}, fmt.Errorf("claim task: %w", err)
	}

	// Update execution status to running if it's still queued
	_, err = tx.Exec(ctx, `
		UPDATE executions
		SET status = 'running', started_at = now()
		WHERE id = $1 AND status = 'queued'
	`, task.ExecutionID)
	if err != nil {
		return TaskLease{}, fmt.Errorf("update execution status: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return TaskLease{}, fmt.Errorf("commit transaction: %w", err)
	}

	task.Status = TaskLeased
	task.WorkerID = workerID
	task.LeaseUntil = &newLeaseUntil
	task.Attempt++

	return TaskLease{
		Task:       task,
		WorkerID:   workerID,
		LeaseUntil: newLeaseUntil,
		Attempt:    task.Attempt,
	}, nil
}

// RenewLease extends the lease for a task the worker still holds.
func (s *PostgresStore) RenewLease(ctx context.Context, taskID, workerID string, extension time.Duration) error {
	newLeaseUntil := time.Now().Add(extension)

	tag, err := s.pool.Exec(ctx, `
		UPDATE tasks
		SET lease_until = $1
		WHERE id = $2
		  AND worker_id = $3
		  AND status IN ('leased', 'running')
		  AND lease_until > now()
	`, newLeaseUntil, taskID, workerID)
	if err != nil {
		return fmt.Errorf("renew lease: %w", err)
	}

	if tag.RowsAffected() == 0 {
		return ErrLeaseExpired
	}

	return nil
}

// UpdateTaskStatus updates a task's status.
func (s *PostgresStore) UpdateTaskStatus(ctx context.Context, taskID, workerID string, status TaskStatus, result json.RawMessage, errorMsg string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Update task status
	query := `
		UPDATE tasks
		SET status = $1,
		    result = COALESCE($2, result),
		    error_message = COALESCE($3, error_message),
		    completed_at = CASE WHEN $1 IN ('completed', 'failed', 'cancelled', 'timed_out')
		                        THEN now() ELSE completed_at END,
		    started_at = CASE WHEN $1 = 'running' AND started_at IS NULL
		                      THEN now() ELSE started_at END,
		    worker_id = CASE WHEN $1 IN ('leased', 'running') THEN worker_id END,
		    lease_until = CASE WHEN $1 IN ('leased', 'running') THEN lease_until END
		WHERE id = $4 AND worker_id = $5 AND lease_until > now()
		  AND status IN ('leased', 'running')
	`

	var resultVal, errorVal interface{}
	if result != nil {
		resultVal = result
	}
	if errorMsg != "" {
		errorVal = errorMsg
	}

	tag, err := tx.Exec(ctx, query, status, resultVal, errorVal, taskID, workerID)
	if err != nil {
		return fmt.Errorf("update task status: %w", err)
	}

	if tag.RowsAffected() == 0 {
		return ErrLeaseExpired
	}

	// If task completed or failed, check if execution should be updated
	if status == TaskCompleted || status == TaskFailed || status == TaskTimedOut {
		var executionID string
		err = tx.QueryRow(ctx, `SELECT execution_id FROM tasks WHERE id = $1`, taskID).Scan(&executionID)
		if err != nil {
			return fmt.Errorf("get execution id: %w", err)
		}

		// Count remaining tasks
		var pendingCount, failedCount, totalCount int
		err = tx.QueryRow(ctx, `
			SELECT
				COUNT(*) FILTER (WHERE status IN ('queued', 'leased', 'running')) as pending,
				COUNT(*) FILTER (WHERE status IN ('failed', 'timed_out')) as failed,
				COUNT(*) as total
			FROM tasks
			WHERE execution_id = $1
		`, executionID).Scan(&pendingCount, &failedCount, &totalCount)
		if err != nil {
			return fmt.Errorf("count tasks: %w", err)
		}

		// Update execution status if all tasks are done
		if pendingCount == 0 {
			var execStatus string
			if failedCount > 0 {
				execStatus = string(ExecutionFailed)
			} else {
				execStatus = string(ExecutionCompleted)
			}

			tag, err := tx.Exec(ctx, `
				UPDATE executions
				SET status = $1, completed_at = now(), version = version + 1
				WHERE id = $2 AND status = 'running'
			`, execStatus, executionID)
			if err != nil {
				return fmt.Errorf("update execution status: %w", err)
			}

			if tag.RowsAffected() == 0 {
				return tx.Commit(ctx)
			}

			// Record completion event
			_, err = tx.Exec(ctx, `
				INSERT INTO execution_events (execution_id, kind, actor, message)
				VALUES ($1, $2, 'system', '')
			`, executionID, "execution."+execStatus)
			if err != nil {
				return fmt.Errorf("record event: %w", err)
			}
		}
	}

	return tx.Commit(ctx)
}

// GetTask retrieves a task by ID.
func (s *PostgresStore) GetTask(ctx context.Context, organizationID, taskID string) (Task, error) {
	query := `
		SELECT id, execution_id, organization_id, kind, capability, status, payload,
		       COALESCE(result, 'null'::jsonb), COALESCE(error_message, ''),
		       attempt, max_attempts, worker_id, lease_until,
		       created_at, started_at, completed_at, deadline
		FROM tasks
		WHERE organization_id = $1 AND id = $2
	`

	var task Task
	var result, errorMsg *string
	var workerID *string
	var leaseUntil, startedAt, completedAt *time.Time

	err := s.pool.QueryRow(ctx, query, organizationID, taskID).Scan(
		&task.ID, &task.ExecutionID, &task.OrganizationID, &task.Kind,
		&task.Capability, &task.Status, &task.Payload,
		&result, &errorMsg, &task.Attempt, &task.MaxAttempts,
		&workerID, &leaseUntil,
		&task.CreatedAt, &startedAt, &completedAt, &task.Deadline,
	)
	if err == pgx.ErrNoRows {
		return Task{}, ErrTaskNotFound
	}
	if err != nil {
		return Task{}, fmt.Errorf("get task: %w", err)
	}

	if result != nil {
		task.Result = json.RawMessage(*result)
	}
	if errorMsg != nil {
		task.ErrorMessage = *errorMsg
	}
	if workerID != nil {
		task.WorkerID = *workerID
	}
	task.LeaseUntil = leaseUntil
	task.StartedAt = startedAt
	task.CompletedAt = completedAt

	return task, nil
}

// ListTasks returns all tasks for an execution.
func (s *PostgresStore) ListTasks(ctx context.Context, organizationID, executionID string) ([]Task, error) {
	query := `
		SELECT id, execution_id, organization_id, kind, capability, status, payload,
		       COALESCE(result, 'null'::jsonb), COALESCE(error_message, ''),
		       attempt, max_attempts, worker_id, lease_until,
		       created_at, started_at, completed_at, deadline
		FROM tasks
		WHERE organization_id = $1 AND execution_id = $2
		ORDER BY created_at
	`

	rows, err := s.pool.Query(ctx, query, organizationID, executionID)
	if err != nil {
		return nil, fmt.Errorf("list tasks: %w", err)
	}
	defer rows.Close()

	var tasks []Task
	for rows.Next() {
		var task Task
		var result, errorMsg *string
		var workerID *string
		var leaseUntil, startedAt, completedAt *time.Time

		err := rows.Scan(
			&task.ID, &task.ExecutionID, &task.OrganizationID, &task.Kind,
			&task.Capability, &task.Status, &task.Payload,
			&result, &errorMsg, &task.Attempt, &task.MaxAttempts,
			&workerID, &leaseUntil,
			&task.CreatedAt, &startedAt, &completedAt, &task.Deadline,
		)
		if err != nil {
			return nil, fmt.Errorf("scan task: %w", err)
		}

		if result != nil {
			task.Result = json.RawMessage(*result)
		}
		if errorMsg != nil {
			task.ErrorMessage = *errorMsg
		}
		if workerID != nil {
			task.WorkerID = *workerID
		}
		task.LeaseUntil = leaseUntil
		task.StartedAt = startedAt
		task.CompletedAt = completedAt

		tasks = append(tasks, task)
	}

	return tasks, rows.Err()
}

// ReclaimExpiredLeases finds tasks with expired leases and returns them to queued status.
func (s *PostgresStore) ReclaimExpiredLeases(ctx context.Context) (int, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE tasks
		SET status = 'queued',
		    worker_id = NULL,
		    lease_until = NULL
		WHERE status IN ('leased', 'running')
		  AND lease_until <= now()
		  AND attempt < max_attempts
	`)
	if err != nil {
		return 0, fmt.Errorf("reclaim expired leases: %w", err)
	}

	return int(tag.RowsAffected()), nil
}

// AddTaskLog appends a log entry for a task.
func (s *PostgresStore) AddTaskLog(ctx context.Context, taskID, level, message string, attributes json.RawMessage) error {
	query := `
		INSERT INTO task_logs (task_id, level, message, attributes)
		VALUES ($1, $2, $3, $4)
	`
	_, err := s.pool.Exec(ctx, query, taskID, level, message, attributes)
	if err != nil {
		return fmt.Errorf("add task log: %w", err)
	}
	return nil
}

// GetTaskLogs retrieves logs for a task.
func (s *PostgresStore) GetTaskLogs(ctx context.Context, taskID string, limit int) ([]TaskLog, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}

	query := `
		SELECT id, task_id, created_at, level, message, COALESCE(attributes, 'null'::jsonb)
		FROM task_logs
		WHERE task_id = $1
		ORDER BY created_at DESC, id DESC
		LIMIT $2
	`

	rows, err := s.pool.Query(ctx, query, taskID, limit)
	if err != nil {
		return nil, fmt.Errorf("get task logs: %w", err)
	}
	defer rows.Close()

	var logs []TaskLog
	for rows.Next() {
		var log TaskLog
		err := rows.Scan(&log.ID, &log.TaskID, &log.CreatedAt, &log.Level, &log.Message, &log.Attributes)
		if err != nil {
			return nil, fmt.Errorf("scan log: %w", err)
		}
		logs = append(logs, log)
	}

	return logs, rows.Err()
}

// AddExecutionEvent records a lifecycle event for an execution.
func (s *PostgresStore) AddExecutionEvent(ctx context.Context, executionID, kind, actor, message string) error {
	query := `
		INSERT INTO execution_events (execution_id, kind, actor, message)
		VALUES ($1, $2, $3, NULLIF($4, ''))
	`
	_, err := s.pool.Exec(ctx, query, executionID, kind, actor, message)
	if err != nil {
		return fmt.Errorf("add execution event: %w", err)
	}
	return nil
}

// GetExecutionEvents retrieves events for an execution.
func (s *PostgresStore) GetExecutionEvents(ctx context.Context, executionID string, afterSeq int64) ([]ExecutionEvent, error) {
	query := `
		SELECT seq, execution_id, created_at, kind, actor, COALESCE(message, '')
		FROM execution_events
		WHERE execution_id = $1 AND seq > $2
		ORDER BY seq
	`

	rows, err := s.pool.Query(ctx, query, executionID, afterSeq)
	if err != nil {
		return nil, fmt.Errorf("get execution events: %w", err)
	}
	defer rows.Close()

	var events []ExecutionEvent
	for rows.Next() {
		var event ExecutionEvent
		err := rows.Scan(&event.Seq, &event.ExecutionID, &event.CreatedAt, &event.Kind, &event.Actor, &event.Message)
		if err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}
		events = append(events, event)
	}

	return events, rows.Err()
}
