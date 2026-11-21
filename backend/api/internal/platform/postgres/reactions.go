package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/easyhaloo/agentforge/backend/api/internal/reactions"
	"github.com/jackc/pgx/v5/pgconn"
)

type ReactionRepository struct {
	store *Store
}

func NewReactionRepository(store *Store) *ReactionRepository {
	return &ReactionRepository{store: store}
}

// Add creates a new reaction
// Returns error if the same user already reacted with the same emoji (uniqueness constraint)
func (r *ReactionRepository) Add(ctx context.Context, organizationID string, reaction *reactions.Reaction) (*reactions.Reaction, error) {
	_, err := r.store.pool.Exec(ctx, `
		INSERT INTO reactions (
			organization_id, id, reactable_type, reactable_id, user_id, content, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, organizationID, reaction.ID, reaction.ReactableType, reaction.ReactableID,
		reaction.UserID, reaction.Content, reaction.CreatedAt)

	if err != nil {
		// Check for unique constraint violation (duplicate reaction)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
			return nil, fmt.Errorf("user already reacted with this emoji")
		}
		return nil, fmt.Errorf("insert reaction: %w", err)
	}

	return reaction, nil
}

// List retrieves all reactions for a specific resource
func (r *ReactionRepository) List(ctx context.Context, organizationID string, reactableType reactions.ReactableType, reactableID reactions.ID) ([]*reactions.Reaction, error) {
	rows, err := r.store.pool.Query(ctx, `
		SELECT id, reactable_type, reactable_id, user_id, content, created_at
		FROM reactions
		WHERE organization_id = $1 AND reactable_type = $2 AND reactable_id = $3
		ORDER BY created_at ASC
	`, organizationID, reactableType, reactableID)

	if err != nil {
		return nil, fmt.Errorf("query reactions: %w", err)
	}
	defer rows.Close()

	var reactionsList []*reactions.Reaction
	for rows.Next() {
		var reaction reactions.Reaction

		err := rows.Scan(
			&reaction.ID, &reaction.ReactableType, &reaction.ReactableID,
			&reaction.UserID, &reaction.Content, &reaction.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan reaction: %w", err)
		}

		reactionsList = append(reactionsList, &reaction)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate reactions: %w", err)
	}

	return reactionsList, nil
}

// Remove deletes a reaction by ID
func (r *ReactionRepository) Remove(ctx context.Context, organizationID string, reactionID reactions.ID) error {
	result, err := r.store.pool.Exec(ctx, `
		DELETE FROM reactions
		WHERE organization_id = $1 AND id = $2
	`, organizationID, reactionID)

	if err != nil {
		return fmt.Errorf("delete reaction: %w", err)
	}

	if result.RowsAffected() == 0 {
		return fmt.Errorf("reaction not found")
	}

	return nil
}
