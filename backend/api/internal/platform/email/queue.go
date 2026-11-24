package email

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrQueueEmpty = errors.New("email queue is empty")
	ErrNotFound   = errors.New("email not found")
)

// QueuedEmail represents an email in the queue.
type QueuedEmail struct {
	ID             string
	OrganizationID string
	ToAddress      string
	Subject        string
	Body           string
	IsHTML         bool
	Status         string
	Attempts       int
	MaxAttempts    int
	ErrorMessage   string
	CreatedAt      time.Time
	SentAt         *time.Time
	NextRetryAt    *time.Time
}

// Queue manages asynchronous email delivery via PostgreSQL.
type Queue interface {
	Enqueue(ctx context.Context, organizationID, to, subject, body string, isHTML bool) (string, error)
	Dequeue(ctx context.Context) (*QueuedEmail, error)
	MarkSent(ctx context.Context, id string) error
	MarkFailed(ctx context.Context, id string, errorMsg string) error
}

// PostgresQueue implements email queue backed by PostgreSQL.
type PostgresQueue struct {
	pool *pgxpool.Pool
}

// NewPostgresQueue creates a new PostgreSQL-backed email queue.
func NewPostgresQueue(pool *pgxpool.Pool) *PostgresQueue {
	return &PostgresQueue{pool: pool}
}

// Enqueue adds an email to the queue for asynchronous delivery.
func (q *PostgresQueue) Enqueue(ctx context.Context, organizationID, to, subject, body string, isHTML bool) (string, error) {
	id, err := generateID()
	if err != nil {
		return "", fmt.Errorf("generate email ID: %w", err)
	}

	_, err = q.pool.Exec(ctx, `
		INSERT INTO email_queue (id, organization_id, to_address, subject, body, is_html, status, next_retry_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
	`, id, organizationID, to, subject, body, isHTML)

	if err != nil {
		return "", fmt.Errorf("enqueue email: %w", err)
	}

	return id, nil
}

// Dequeue retrieves the next pending email from the queue.
// Returns ErrQueueEmpty if no emails are ready for processing.
func (q *PostgresQueue) Dequeue(ctx context.Context) (*QueuedEmail, error) {
	tx, err := q.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin dequeue transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `UPDATE email_queue SET status='failed', body=''
		WHERE status='pending' AND (next_retry_at IS NULL OR next_retry_at <= now())
		AND (attempts >= max_attempts OR (organization_id='' AND created_at <= now() - interval '30 minutes'))`); err != nil {
		return nil, fmt.Errorf("expire email queue entries: %w", err)
	}

	var email QueuedEmail
	err = tx.QueryRow(ctx, `
		SELECT id, organization_id, to_address, subject, body, is_html,
		       status, attempts, max_attempts, COALESCE(error_message, ''),
		       created_at, sent_at, next_retry_at
		FROM email_queue
		WHERE status = 'pending'
		  AND (next_retry_at IS NULL OR next_retry_at <= NOW())
		ORDER BY created_at ASC
		LIMIT 1
		FOR UPDATE SKIP LOCKED
	`).Scan(
		&email.ID, &email.OrganizationID, &email.ToAddress, &email.Subject, &email.Body,
		&email.IsHTML, &email.Status, &email.Attempts, &email.MaxAttempts, &email.ErrorMessage,
		&email.CreatedAt, &email.SentAt, &email.NextRetryAt,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("commit email expiry: %w", err)
		}
		return nil, ErrQueueEmpty
	}
	if err != nil {
		return nil, fmt.Errorf("dequeue email: %w", err)
	}

	// Increment attempts and set next retry time in case of failure
	email.Attempts++
	nextRetry := time.Now().Add(exponentialBackoff(email.Attempts))

	_, err = tx.Exec(ctx, `
		UPDATE email_queue
		SET attempts = $1, next_retry_at = $2
		WHERE id = $3
	`, email.Attempts, nextRetry, email.ID)

	if err != nil {
		return nil, fmt.Errorf("update email attempts: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit dequeue: %w", err)
	}

	return &email, nil
}

// MarkSent marks an email as successfully sent.
func (q *PostgresQueue) MarkSent(ctx context.Context, id string) error {
	now := time.Now()
	tag, err := q.pool.Exec(ctx, `
		UPDATE email_queue
		SET status = 'sent', sent_at = $1, body = '', error_message = NULL
		WHERE id = $2
	`, now, id)

	if err != nil {
		return fmt.Errorf("mark email sent: %w", err)
	}

	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}

	return nil
}

// MarkFailed marks an email as failed with an error message.
// If max attempts have been reached, marks status as 'failed'.
// Otherwise, keeps status as 'pending' for retry.
func (q *PostgresQueue) MarkFailed(ctx context.Context, id string, errorMsg string) error {
	_, err := q.pool.Exec(ctx, `
		UPDATE email_queue
		SET error_message = $1,
		    body = CASE WHEN attempts >= max_attempts THEN '' ELSE body END,
		    status = CASE
		        WHEN attempts >= max_attempts THEN 'failed'
		        ELSE 'pending'
		    END
		WHERE id = $2
	`, errorMsg, id)

	if err != nil {
		return fmt.Errorf("mark email failed: %w", err)
	}

	return nil
}

// exponentialBackoff calculates retry delay using exponential backoff.
// Returns 1 min, 5 min, 15 min for attempts 1, 2, 3+.
func exponentialBackoff(attempt int) time.Duration {
	switch attempt {
	case 1:
		return 1 * time.Minute
	case 2:
		return 5 * time.Minute
	default:
		return 15 * time.Minute
	}
}

// generateID generates a random identifier for queue items.
func generateID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
