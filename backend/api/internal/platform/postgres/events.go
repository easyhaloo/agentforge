package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/easyhaloo/agentforge/backend/api/internal/events"
)

type EventRepository struct {
	store *Store
}

func NewEventRepository(store *Store) *EventRepository {
	return &EventRepository{store: store}
}

// Record persists a new event in the timeline
func (r *EventRepository) Record(ctx context.Context, organizationID string, event *events.Event) error {
	// Serialize metadata to JSON
	var metadataJSON []byte
	var err error
	if event.Metadata != nil && len(event.Metadata) > 0 {
		metadataJSON, err = json.Marshal(event.Metadata)
		if err != nil {
			return fmt.Errorf("marshal metadata: %w", err)
		}
	}

	// Insert event
	var actorID sql.NullString
	if event.ActorID != "" {
		actorID.String = event.ActorID
		actorID.Valid = true
	}

	_, err = r.store.pool.Exec(ctx, `
		INSERT INTO issue_events (
			organization_id, id, issue_id, event_type, actor_id, metadata, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, organizationID, event.ID, event.IssueID, event.EventType, actorID, metadataJSON, event.CreatedAt)

	if err != nil {
		return fmt.Errorf("insert event: %w", err)
	}

	return nil
}

// List retrieves all events for an issue in chronological order
func (r *EventRepository) List(ctx context.Context, organizationID string, issueID string) ([]*events.Event, error) {
	rows, err := r.store.pool.Query(ctx, `
		SELECT id, issue_id, event_type, actor_id, metadata, created_at
		FROM issue_events
		WHERE organization_id = $1 AND issue_id = $2
		ORDER BY created_at ASC
	`, organizationID, issueID)
	if err != nil {
		return nil, fmt.Errorf("query events: %w", err)
	}
	defer rows.Close()

	var result []*events.Event
	for rows.Next() {
		var event events.Event
		var actorID sql.NullString
		var metadataJSON []byte

		if err := rows.Scan(
			&event.ID, &event.IssueID, &event.EventType,
			&actorID, &metadataJSON, &event.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}

		if actorID.Valid {
			event.ActorID = actorID.String
		}

		// Deserialize metadata
		if len(metadataJSON) > 0 {
			if err := json.Unmarshal(metadataJSON, &event.Metadata); err != nil {
				return nil, fmt.Errorf("unmarshal metadata: %w", err)
			}
		}

		result = append(result, &event)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate events: %w", err)
	}

	return result, nil
}

// ListByType retrieves events of a specific type for an issue
func (r *EventRepository) ListByType(ctx context.Context, organizationID string, issueID string, eventType events.EventType) ([]*events.Event, error) {
	rows, err := r.store.pool.Query(ctx, `
		SELECT id, issue_id, event_type, actor_id, metadata, created_at
		FROM issue_events
		WHERE organization_id = $1 AND issue_id = $2 AND event_type = $3
		ORDER BY created_at ASC
	`, organizationID, issueID, eventType)
	if err != nil {
		return nil, fmt.Errorf("query events: %w", err)
	}
	defer rows.Close()

	var result []*events.Event
	for rows.Next() {
		var event events.Event
		var actorID sql.NullString
		var metadataJSON []byte

		if err := rows.Scan(
			&event.ID, &event.IssueID, &event.EventType,
			&actorID, &metadataJSON, &event.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}

		if actorID.Valid {
			event.ActorID = actorID.String
		}

		// Deserialize metadata
		if len(metadataJSON) > 0 {
			if err := json.Unmarshal(metadataJSON, &event.Metadata); err != nil {
				return nil, fmt.Errorf("unmarshal metadata: %w", err)
			}
		}

		result = append(result, &event)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate events: %w", err)
	}

	return result, nil
}
