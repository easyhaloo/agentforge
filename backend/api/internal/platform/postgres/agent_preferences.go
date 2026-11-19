package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

// GetAgentPreferences retrieves agent preferences, creating defaults if they don't exist.
func (s *Store) GetAgentPreferences(ctx context.Context, userID string) (identity.AgentPreferences, error) {
	if strings.TrimSpace(userID) == "" {
		return identity.AgentPreferences{}, errors.New("user ID is required")
	}

	var prefs identity.AgentPreferences
	var reviewFocusJSON []byte

	err := s.pool.QueryRow(ctx, `
		SELECT user_id, output_verbosity, confirmation_strategy, automation_level,
		       cross_session_memory_enabled, auto_evaluate_on_push, notify_evaluation_results,
		       evaluation_strictness, agent_review_enabled, agent_can_approve_low_risk,
		       review_focus, updated_at
		FROM agent_preferences
		WHERE user_id = $1
	`, userID).Scan(
		&prefs.UserID, &prefs.OutputVerbosity, &prefs.ConfirmationStrategy, &prefs.AutomationLevel,
		&prefs.CrossSessionMemory, &prefs.AutoEvaluateOnPush, &prefs.NotifyEvaluationResults,
		&prefs.EvaluationStrictness, &prefs.AgentReviewEnabled, &prefs.AgentCanApproveLowRisk,
		&reviewFocusJSON, &prefs.UpdatedAt,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		// Create default preferences
		return s.createDefaultAgentPreferences(ctx, userID)
	}
	if err != nil {
		return identity.AgentPreferences{}, fmt.Errorf("get agent preferences: %w", err)
	}

	// Parse review focus JSON
	if err := json.Unmarshal(reviewFocusJSON, &prefs.ReviewFocus); err != nil {
		return identity.AgentPreferences{}, fmt.Errorf("parse review focus: %w", err)
	}

	return prefs, nil
}

// createDefaultAgentPreferences creates default agent preferences.
func (s *Store) createDefaultAgentPreferences(ctx context.Context, userID string) (identity.AgentPreferences, error) {
	now := time.Now().UTC()
	defaultReviewFocus := identity.ReviewFocus{
		Security:      true,
		Performance:   true,
		CodeStyle:     false,
		TestCoverage:  true,
		Documentation: false,
	}

	reviewFocusJSON, err := json.Marshal(defaultReviewFocus)
	if err != nil {
		return identity.AgentPreferences{}, fmt.Errorf("marshal default review focus: %w", err)
	}

	prefs := identity.AgentPreferences{
		UserID:                  userID,
		OutputVerbosity:         "standard",
		ConfirmationStrategy:    "batch",
		AutomationLevel:         "balanced",
		CrossSessionMemory:      true,
		AutoEvaluateOnPush:      false,
		NotifyEvaluationResults: true,
		EvaluationStrictness:    "standard",
		AgentReviewEnabled:      false,
		AgentCanApproveLowRisk:  false,
		ReviewFocus:             defaultReviewFocus,
		UpdatedAt:               now,
	}

	_, err = s.pool.Exec(ctx, `
		INSERT INTO agent_preferences (
			user_id, output_verbosity, confirmation_strategy, automation_level,
			cross_session_memory_enabled, auto_evaluate_on_push, notify_evaluation_results,
			evaluation_strictness, agent_review_enabled, agent_can_approve_low_risk,
			review_focus, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (user_id) DO NOTHING
	`, userID, prefs.OutputVerbosity, prefs.ConfirmationStrategy, prefs.AutomationLevel,
		prefs.CrossSessionMemory, prefs.AutoEvaluateOnPush, prefs.NotifyEvaluationResults,
		prefs.EvaluationStrictness, prefs.AgentReviewEnabled, prefs.AgentCanApproveLowRisk,
		reviewFocusJSON, now)

	if err != nil {
		return identity.AgentPreferences{}, fmt.Errorf("create default agent preferences: %w", err)
	}

	return prefs, nil
}

// UpdateAgentPreferences updates agent preferences.
func (s *Store) UpdateAgentPreferences(ctx context.Context, userID string, prefs identity.AgentPreferences) (identity.AgentPreferences, error) {
	if strings.TrimSpace(userID) == "" {
		return identity.AgentPreferences{}, errors.New("user ID is required")
	}

	// Validate enums
	if prefs.OutputVerbosity != "concise" && prefs.OutputVerbosity != "standard" && prefs.OutputVerbosity != "verbose" {
		return identity.AgentPreferences{}, errors.New("output_verbosity must be 'concise', 'standard', or 'verbose'")
	}
	if prefs.ConfirmationStrategy != "always" && prefs.ConfirmationStrategy != "batch" && prefs.ConfirmationStrategy != "auto" {
		return identity.AgentPreferences{}, errors.New("confirmation_strategy must be 'always', 'batch', or 'auto'")
	}
	if prefs.AutomationLevel != "conservative" && prefs.AutomationLevel != "balanced" && prefs.AutomationLevel != "aggressive" {
		return identity.AgentPreferences{}, errors.New("automation_level must be 'conservative', 'balanced', or 'aggressive'")
	}
	if prefs.EvaluationStrictness != "strict" && prefs.EvaluationStrictness != "standard" && prefs.EvaluationStrictness != "lenient" {
		return identity.AgentPreferences{}, errors.New("evaluation_strictness must be 'strict', 'standard', or 'lenient'")
	}

	// Marshal review focus
	reviewFocusJSON, err := json.Marshal(prefs.ReviewFocus)
	if err != nil {
		return identity.AgentPreferences{}, fmt.Errorf("marshal review focus: %w", err)
	}

	now := time.Now().UTC()
	var updated identity.AgentPreferences
	var reviewFocusResult []byte

	err = s.pool.QueryRow(ctx, `
		INSERT INTO agent_preferences (
			user_id, output_verbosity, confirmation_strategy, automation_level,
			cross_session_memory_enabled, auto_evaluate_on_push, notify_evaluation_results,
			evaluation_strictness, agent_review_enabled, agent_can_approve_low_risk,
			review_focus, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (user_id) DO UPDATE
		SET output_verbosity = $2, confirmation_strategy = $3, automation_level = $4,
		    cross_session_memory_enabled = $5, auto_evaluate_on_push = $6,
		    notify_evaluation_results = $7, evaluation_strictness = $8,
		    agent_review_enabled = $9, agent_can_approve_low_risk = $10,
		    review_focus = $11, updated_at = $12
		RETURNING user_id, output_verbosity, confirmation_strategy, automation_level,
		          cross_session_memory_enabled, auto_evaluate_on_push, notify_evaluation_results,
		          evaluation_strictness, agent_review_enabled, agent_can_approve_low_risk,
		          review_focus, updated_at
	`, userID, prefs.OutputVerbosity, prefs.ConfirmationStrategy, prefs.AutomationLevel,
		prefs.CrossSessionMemory, prefs.AutoEvaluateOnPush, prefs.NotifyEvaluationResults,
		prefs.EvaluationStrictness, prefs.AgentReviewEnabled, prefs.AgentCanApproveLowRisk,
		reviewFocusJSON, now,
	).Scan(
		&updated.UserID, &updated.OutputVerbosity, &updated.ConfirmationStrategy, &updated.AutomationLevel,
		&updated.CrossSessionMemory, &updated.AutoEvaluateOnPush, &updated.NotifyEvaluationResults,
		&updated.EvaluationStrictness, &updated.AgentReviewEnabled, &updated.AgentCanApproveLowRisk,
		&reviewFocusResult, &updated.UpdatedAt,
	)

	if err != nil {
		return identity.AgentPreferences{}, fmt.Errorf("update agent preferences: %w", err)
	}

	// Parse returned review focus
	if err := json.Unmarshal(reviewFocusResult, &updated.ReviewFocus); err != nil {
		return identity.AgentPreferences{}, fmt.Errorf("parse updated review focus: %w", err)
	}

	return updated, nil
}
