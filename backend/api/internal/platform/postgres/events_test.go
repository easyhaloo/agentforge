package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/events"
)

func TestEventRepository_RecordAndList(t *testing.T) {
	// Test recording events and retrieving timeline
	ctx := context.Background()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL not set, skipping integration test")
	}

	store, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("failed to open store: %v", err)
	}
	defer store.Close()

	repo := NewEventRepository(store)
	orgID := "test-org-events"
	ensureIssueTestFixtures(t, store, orgID)
	issueID := "issue-123"

	// Create organization
	_, err = store.pool.Exec(ctx, "INSERT INTO organizations (id, name) VALUES ($1, $2)", orgID, orgID)
	if err != nil {
		t.Fatalf("failed to create organization: %v", err)
	}

	// Record multiple events
	event1 := &events.Event{
		ID:        "event-001",
		IssueID:   issueID,
		EventType: events.EventCreated,
		ActorID:   "user-001",
		Metadata: map[string]interface{}{
			"title": "Test issue",
		},
		CreatedAt: time.Now().UTC().Add(-1 * time.Hour),
	}

	if err := repo.Record(ctx, orgID, event1); err != nil {
		t.Fatalf("failed to record event 1: %v", err)
	}

	event2 := &events.Event{
		ID:        "event-002",
		IssueID:   issueID,
		EventType: events.EventLabeled,
		ActorID:   "user-002",
		Metadata: map[string]interface{}{
			"label": "bug",
			"color": "d73a4a",
		},
		CreatedAt: time.Now().UTC().Add(-30 * time.Minute),
	}

	if err := repo.Record(ctx, orgID, event2); err != nil {
		t.Fatalf("failed to record event 2: %v", err)
	}

	event3 := &events.Event{
		ID:        "event-003",
		IssueID:   issueID,
		EventType: events.EventClosed,
		ActorID:   "user-001",
		Metadata: map[string]interface{}{
			"reason": "completed",
		},
		CreatedAt: time.Now().UTC(),
	}

	if err := repo.Record(ctx, orgID, event3); err != nil {
		t.Fatalf("failed to record event 3: %v", err)
	}

	// Test 1: List all events in chronological order
	timeline, err := repo.List(ctx, orgID, issueID)
	if err != nil {
		t.Fatalf("failed to list events: %v", err)
	}

	if len(timeline) != 3 {
		t.Errorf("expected 3 events, got %d", len(timeline))
	}

	// Verify chronological order
	if timeline[0].EventType != events.EventCreated {
		t.Errorf("expected first event to be 'created', got %q", timeline[0].EventType)
	}
	if timeline[1].EventType != events.EventLabeled {
		t.Errorf("expected second event to be 'labeled', got %q", timeline[1].EventType)
	}
	if timeline[2].EventType != events.EventClosed {
		t.Errorf("expected third event to be 'closed', got %q", timeline[2].EventType)
	}

	// Verify metadata is preserved
	if label, ok := timeline[1].Metadata["label"].(string); !ok || label != "bug" {
		t.Errorf("expected label metadata to be 'bug', got %v", timeline[1].Metadata["label"])
	}

	// Test 2: List events by type
	labelEvents, err := repo.ListByType(ctx, orgID, issueID, events.EventLabeled)
	if err != nil {
		t.Fatalf("failed to list events by type: %v", err)
	}

	if len(labelEvents) != 1 {
		t.Errorf("expected 1 labeled event, got %d", len(labelEvents))
	}
	if labelEvents[0].ID != "event-002" {
		t.Errorf("expected event-002, got %s", labelEvents[0].ID)
	}

	// Test 3: Event without actor
	event4 := &events.Event{
		ID:        "event-004",
		IssueID:   issueID,
		EventType: events.EventReferenced,
		ActorID:   "", // System event, no actor
		Metadata:  map[string]interface{}{},
		CreatedAt: time.Now().UTC(),
	}

	if err := repo.Record(ctx, orgID, event4); err != nil {
		t.Fatalf("failed to record event without actor: %v", err)
	}

	updated, err := repo.List(ctx, orgID, issueID)
	if err != nil {
		t.Fatalf("failed to list updated events: %v", err)
	}

	if len(updated) != 4 {
		t.Errorf("expected 4 events after adding one more, got %d", len(updated))
	}

	// Find the system event and verify no actor
	var systemEvent *events.Event
	for _, e := range updated {
		if e.EventType == events.EventReferenced {
			systemEvent = e
			break
		}
	}

	if systemEvent == nil {
		t.Fatal("system event not found in timeline")
	}
	if systemEvent.ActorID != "" {
		t.Errorf("expected empty actor for system event, got %q", systemEvent.ActorID)
	}
}
