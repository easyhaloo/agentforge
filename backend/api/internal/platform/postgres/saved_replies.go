package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

func (s *Store) ListSavedReplies(ctx context.Context, userID string) ([]identity.SavedReply, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, title, body FROM saved_replies
		WHERE user_id = $1 ORDER BY created_at DESC, id`, userID)
	if err != nil {
		return nil, fmt.Errorf("query saved replies: %w", err)
	}
	items, err := pgx.CollectRows(rows, pgx.RowToStructByPos[identity.SavedReply])
	if err != nil {
		return nil, fmt.Errorf("read saved replies: %w", err)
	}
	return items, nil
}

func (s *Store) CreateSavedReply(ctx context.Context, userID, title, body string) (identity.SavedReply, error) {
	var reply identity.SavedReply
	err := s.pool.QueryRow(ctx, `INSERT INTO saved_replies (user_id, title, body) VALUES ($1, $2, $3)
		RETURNING id, title, body`, userID, title, body).Scan(&reply.ID, &reply.Title, &reply.Body)
	if err != nil {
		return identity.SavedReply{}, fmt.Errorf("create saved reply: %w", err)
	}
	return reply, nil
}

func (s *Store) UpdateSavedReply(ctx context.Context, userID, replyID, title, body string) (identity.SavedReply, error) {
	var reply identity.SavedReply
	err := s.pool.QueryRow(ctx, `UPDATE saved_replies SET title = $3, body = $4, updated_at = now()
		WHERE user_id = $1 AND id = $2 RETURNING id, title, body`, userID, replyID, title, body).
		Scan(&reply.ID, &reply.Title, &reply.Body)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.SavedReply{}, identity.ErrSavedReplyNotFound
	}
	if err != nil {
		return identity.SavedReply{}, fmt.Errorf("update saved reply: %w", err)
	}
	return reply, nil
}

func (s *Store) DeleteSavedReply(ctx context.Context, userID, replyID string) error {
	result, err := s.pool.Exec(ctx, `DELETE FROM saved_replies WHERE user_id = $1 AND id = $2`, userID, replyID)
	if err != nil {
		return fmt.Errorf("delete saved reply: %w", err)
	}
	if result.RowsAffected() == 0 {
		return identity.ErrSavedReplyNotFound
	}
	return nil
}
