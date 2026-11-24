package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/easyhaloo/agentforge/backend/api/internal/comments"
	"github.com/jackc/pgx/v5"
)

type CommentRepository struct {
	store *Store
}

func NewCommentRepository(store *Store) *CommentRepository {
	return &CommentRepository{store: store}
}

// Create persists a new comment and increments the parent resource's comments_count
func (r *CommentRepository) Create(ctx context.Context, organizationID string, comment *comments.Comment) (*comments.Comment, error) {
	// Begin transaction
	tx, err := r.store.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Insert comment
	_, err = tx.Exec(ctx, `
		INSERT INTO comments (
			organization_id, id, resource_type, resource_id, body, author_id,
			created_at, updated_at, version
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
	`, organizationID, comment.ID, comment.ResourceType, comment.ResourceID, comment.Body,
		comment.AuthorID, comment.CreatedAt, comment.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("insert comment: %w", err)
	}

	// Increment parent resource's comments_count
	if err := r.incrementCommentsCount(ctx, tx, organizationID, comment.ResourceType, comment.ResourceID, comment.AllowLocked); err != nil {
		return nil, fmt.Errorf("increment comments count: %w", err)
	}

	if comment.ResourceType == comments.ResourceTypeIssue {
		if err := notifyIssueActivity(ctx, tx, organizationID, string(comment.ResourceID), string(comment.ID), comment.AuthorID, comment.Body, comment.CreatedAt, r.store.notificationMailOrigin); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit transaction: %w", err)
	}

	comment.Version = 1
	return comment, nil
}

// List retrieves all comments for a specific resource, ordered by created_at ASC
func (r *CommentRepository) List(ctx context.Context, organizationID string, resourceType comments.ResourceType, resourceID comments.ID) ([]*comments.Comment, error) {
	rows, err := r.store.pool.Query(ctx, `
		SELECT id, resource_type, resource_id, body, author_id,
		       created_at, updated_at, edited_at, minimized, minimized_reason, version
		FROM comments
		WHERE organization_id = $1 AND resource_type = $2 AND resource_id = $3
		ORDER BY created_at ASC
	`, organizationID, resourceType, resourceID)

	if err != nil {
		return nil, fmt.Errorf("query comments: %w", err)
	}
	defer rows.Close()

	var commentsList []*comments.Comment
	for rows.Next() {
		var c comments.Comment
		var editedAt sql.NullTime
		var minimizedReason sql.NullString

		err := rows.Scan(
			&c.ID, &c.ResourceType, &c.ResourceID, &c.Body, &c.AuthorID,
			&c.CreatedAt, &c.UpdatedAt, &editedAt, &c.Minimized, &minimizedReason, &c.Version,
		)
		if err != nil {
			return nil, fmt.Errorf("scan comment: %w", err)
		}

		if editedAt.Valid {
			t := editedAt.Time
			c.EditedAt = &t
		}
		if minimizedReason.Valid {
			c.MinimizedReason = comments.MinimizedReason(minimizedReason.String)
		}

		commentsList = append(commentsList, &c)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate comments: %w", err)
	}

	return commentsList, nil
}

const visibleComment = `(resource_type <> 'issue' OR EXISTS (
	SELECT 1 FROM enabled_repository_issues i
	WHERE i.organization_id = comments.organization_id AND i.id = comments.resource_id
))`

// Get retrieves a single comment by ID
func (r *CommentRepository) Get(ctx context.Context, organizationID string, commentID comments.ID) (*comments.Comment, error) {
	var c comments.Comment
	var editedAt sql.NullTime
	var minimizedReason sql.NullString

	err := r.store.pool.QueryRow(ctx, `
		SELECT id, resource_type, resource_id, body, author_id,
		       created_at, updated_at, edited_at, minimized, minimized_reason, version
		FROM comments
		WHERE organization_id = $1 AND id = $2 AND `+visibleComment, organizationID, commentID).Scan(
		&c.ID, &c.ResourceType, &c.ResourceID, &c.Body, &c.AuthorID,
		&c.CreatedAt, &c.UpdatedAt, &editedAt, &c.Minimized, &minimizedReason, &c.Version,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("comment not found")
		}
		return nil, fmt.Errorf("query comment: %w", err)
	}

	if editedAt.Valid {
		t := editedAt.Time
		c.EditedAt = &t
	}
	if minimizedReason.Valid {
		c.MinimizedReason = comments.MinimizedReason(minimizedReason.String)
	}

	return &c, nil
}

// Update updates a comment's body and sets edited_at timestamp
func (r *CommentRepository) Update(ctx context.Context, organizationID string, comment *comments.Comment) (*comments.Comment, error) {
	result, err := r.store.pool.Exec(ctx, `
		UPDATE comments
		SET body = $1, updated_at = $2, edited_at = $3, version = version + 1
		WHERE organization_id = $4 AND id = $5 AND version = $6 AND `+visibleComment, comment.Body, comment.UpdatedAt, comment.EditedAt, organizationID, comment.ID, comment.Version)

	if err != nil {
		return nil, fmt.Errorf("update comment: %w", err)
	}

	if result.RowsAffected() == 0 {
		return nil, comments.ErrVersionConflict
	}

	comment.Version++
	return comment, nil
}

// Delete removes a comment and decrements the parent resource's comments_count
func (r *CommentRepository) Delete(ctx context.Context, organizationID string, commentID comments.ID) error {
	// Begin transaction
	tx, err := r.store.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Get comment details before deleting (need resource_type and resource_id)
	var resourceType comments.ResourceType
	var resourceID comments.ID

	err = tx.QueryRow(ctx, `
		SELECT resource_type, resource_id
		FROM comments
		WHERE organization_id = $1 AND id = $2 AND `+visibleComment, organizationID, commentID).Scan(&resourceType, &resourceID)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("comment not found")
		}
		return fmt.Errorf("query comment: %w", err)
	}

	// Delete comment
	result, err := tx.Exec(ctx, `
		DELETE FROM comments
		WHERE organization_id = $1 AND id = $2 AND `+visibleComment, organizationID, commentID)

	if err != nil {
		return fmt.Errorf("delete comment: %w", err)
	}

	if result.RowsAffected() == 0 {
		return fmt.Errorf("comment not found")
	}

	// Decrement parent resource's comments_count
	if err := r.decrementCommentsCount(ctx, tx, organizationID, resourceType, resourceID); err != nil {
		return fmt.Errorf("decrement comments count: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	return nil
}

// Minimize collapses a comment with a specific reason
func (r *CommentRepository) Minimize(ctx context.Context, organizationID string, commentID comments.ID, reason comments.MinimizedReason) (*comments.Comment, error) {
	result, err := r.store.pool.Exec(ctx, `
		UPDATE comments
		SET minimized = true, minimized_reason = $1, version = version + 1
		WHERE organization_id = $2 AND id = $3 AND `+visibleComment, reason, organizationID, commentID)

	if err != nil {
		return nil, fmt.Errorf("minimize comment: %w", err)
	}

	if result.RowsAffected() == 0 {
		return nil, fmt.Errorf("comment not found")
	}

	// Fetch the updated comment
	return r.Get(ctx, organizationID, commentID)
}

// Unminimize restores a minimized comment to normal display
func (r *CommentRepository) Unminimize(ctx context.Context, organizationID string, commentID comments.ID) (*comments.Comment, error) {
	result, err := r.store.pool.Exec(ctx, `
		UPDATE comments
		SET minimized = false, minimized_reason = NULL, version = version + 1
		WHERE organization_id = $1 AND id = $2 AND `+visibleComment, organizationID, commentID)

	if err != nil {
		return nil, fmt.Errorf("unminimize comment: %w", err)
	}

	if result.RowsAffected() == 0 {
		return nil, fmt.Errorf("comment not found")
	}

	// Fetch the updated comment
	return r.Get(ctx, organizationID, commentID)
}

// incrementCommentsCount increments the comments_count for the parent resource
func (r *CommentRepository) incrementCommentsCount(ctx context.Context, tx pgx.Tx, organizationID string, resourceType comments.ResourceType, resourceID comments.ID, allowLocked bool) error {
	switch resourceType {
	case comments.ResourceTypeIssue:
		result, err := tx.Exec(ctx, `
			UPDATE issues
			SET comments_count = comments_count + 1
			WHERE organization_id = $1 AND id = $2 AND (NOT locked OR $3)
		`, organizationID, resourceID, allowLocked)
		if err != nil {
			return err
		}
		if result.RowsAffected() == 0 {
			return comments.ErrLocked
		}
		return nil
	case comments.ResourceTypeChangeset:
		// TODO: Implement when changesets table has comments_count field
		return nil
	default:
		return fmt.Errorf("unsupported resource type: %s", resourceType)
	}
}

// decrementCommentsCount decrements the comments_count for the parent resource
func (r *CommentRepository) decrementCommentsCount(ctx context.Context, tx pgx.Tx, organizationID string, resourceType comments.ResourceType, resourceID comments.ID) error {
	switch resourceType {
	case comments.ResourceTypeIssue:
		_, err := tx.Exec(ctx, `
			UPDATE issues
			SET comments_count = comments_count - 1
			WHERE organization_id = $1 AND id = $2
		`, organizationID, resourceID)
		return err
	case comments.ResourceTypeChangeset:
		// TODO: Implement when changesets table has comments_count field
		return nil
	default:
		return fmt.Errorf("unsupported resource type: %s", resourceType)
	}
}
