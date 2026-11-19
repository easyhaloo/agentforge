package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

const agentPreferencesColumns = `user_id, output_verbosity, confirmation_strategy, automation_level,
	cross_session_memory_enabled, auto_evaluate_on_push, notify_evaluation_results,
	evaluation_strictness, agent_review_enabled, agent_can_approve_low_risk, review_focus,
	updated_at`

func scanAgentPreferences(row pgx.Row) (identity.AgentPreferences, error) {
	var prefs identity.AgentPreferences
	err := row.Scan(
		&prefs.UserID, &prefs.OutputVerbosity, &prefs.ConfirmationStrategy, &prefs.AutomationLevel,
		&prefs.CrossSessionMemory, &prefs.AutoEvaluateOnPush, &prefs.NotifyEvaluationResults,
		&prefs.EvaluationStrictness, &prefs.AgentReviewEnabled, &prefs.AgentCanApproveLowRisk,
		&prefs.ReviewFocus, &prefs.UpdatedAt,
	)
	return prefs, err
}

func (s *Store) GetAgentPreferences(ctx context.Context, userID string) (identity.AgentPreferences, error) {
	if strings.TrimSpace(userID) == "" {
		return identity.AgentPreferences{}, errors.New("user ID is required")
	}
	prefs, err := scanAgentPreferences(s.pool.QueryRow(ctx, `SELECT `+agentPreferencesColumns+` FROM agent_preferences WHERE user_id = $1`, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return s.UpdateAgentPreferences(ctx, userID, identity.AgentPreferencesPatch{})
	}
	if err != nil {
		return identity.AgentPreferences{}, fmt.Errorf("get agent preferences: %w", err)
	}
	return prefs, nil
}

func (s *Store) UpdateAgentPreferences(ctx context.Context, userID string, patch identity.AgentPreferencesPatch) (identity.AgentPreferences, error) {
	if strings.TrimSpace(userID) == "" {
		return identity.AgentPreferences{}, errors.New("user ID is required")
	}
	if v := patch.OutputVerbosity; v != nil && *v != "concise" && *v != "standard" && *v != "verbose" {
		return identity.AgentPreferences{}, errors.New("output_verbosity must be 'concise', 'standard', or 'verbose'")
	}
	if v := patch.ConfirmationStrategy; v != nil && *v != "always" && *v != "batch" && *v != "auto" {
		return identity.AgentPreferences{}, errors.New("confirmation_strategy must be 'always', 'batch', or 'auto'")
	}
	if v := patch.AutomationLevel; v != nil && *v != "conservative" && *v != "balanced" && *v != "aggressive" {
		return identity.AgentPreferences{}, errors.New("automation_level must be 'conservative', 'balanced', or 'aggressive'")
	}
	if v := patch.EvaluationStrictness; v != nil && *v != "strict" && *v != "standard" && *v != "lenient" {
		return identity.AgentPreferences{}, errors.New("evaluation_strictness must be 'strict', 'standard', or 'lenient'")
	}
	prefs, err := scanAgentPreferences(s.pool.QueryRow(ctx, `
		INSERT INTO agent_preferences (user_id, output_verbosity, confirmation_strategy, automation_level,
		    cross_session_memory_enabled, auto_evaluate_on_push, notify_evaluation_results,
		    evaluation_strictness, agent_review_enabled, agent_can_approve_low_risk,
		    review_focus)
		VALUES ($1, COALESCE($2, 'standard'),
		        COALESCE($3, 'batch'),
		        COALESCE($4, 'balanced'),
		        COALESCE($5, true),
		        COALESCE($6, false),
		        COALESCE($7, true),
		        COALESCE($8, 'standard'),
		        COALESCE($9, false),
		        COALESCE($10, false),
		        '{"security":true,"performance":true,"code_style":false,"test_coverage":true,"documentation":false}'::jsonb || $11::jsonb)
		ON CONFLICT (user_id) DO UPDATE SET
		    output_verbosity = COALESCE($2, agent_preferences.output_verbosity),
		    confirmation_strategy = COALESCE($3, agent_preferences.confirmation_strategy),
		    automation_level = COALESCE($4, agent_preferences.automation_level),
		    cross_session_memory_enabled = COALESCE($5, agent_preferences.cross_session_memory_enabled),
		    auto_evaluate_on_push = COALESCE($6, agent_preferences.auto_evaluate_on_push),
		    notify_evaluation_results = COALESCE($7, agent_preferences.notify_evaluation_results),
		    evaluation_strictness = COALESCE($8, agent_preferences.evaluation_strictness),
		    agent_review_enabled = COALESCE($9, agent_preferences.agent_review_enabled),
		    agent_can_approve_low_risk = COALESCE($10, agent_preferences.agent_can_approve_low_risk),
		    review_focus = agent_preferences.review_focus || $11::jsonb,
		    updated_at = now()
		RETURNING `+agentPreferencesColumns, userID,
		patch.OutputVerbosity, patch.ConfirmationStrategy, patch.AutomationLevel,
		patch.CrossSessionMemory, patch.AutoEvaluateOnPush, patch.NotifyEvaluationResults,
		patch.EvaluationStrictness, patch.AgentReviewEnabled, patch.AgentCanApproveLowRisk,
		patch.ReviewFocus,
	))
	if err != nil {
		return identity.AgentPreferences{}, fmt.Errorf("update agent preferences: %w", err)
	}
	return prefs, nil
}
