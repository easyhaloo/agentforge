package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

const userPreferencesColumns = `user_id, theme, language, timezone, updated_at`

func scanUserPreferences(row pgx.Row) (identity.UserPreferences, error) {
	var prefs identity.UserPreferences
	err := row.Scan(
		&prefs.UserID, &prefs.Theme, &prefs.Language, &prefs.Timezone, &prefs.UpdatedAt,
	)
	return prefs, err
}

func (s *Store) GetUserPreferences(ctx context.Context, userID string) (identity.UserPreferences, error) {
	if strings.TrimSpace(userID) == "" {
		return identity.UserPreferences{}, errors.New("user ID is required")
	}
	prefs, err := scanUserPreferences(s.pool.QueryRow(ctx, `SELECT `+userPreferencesColumns+` FROM user_preferences WHERE user_id = $1`, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return s.UpdateUserPreferences(ctx, userID, identity.UserPreferencesPatch{})
	}
	if err != nil {
		return identity.UserPreferences{}, fmt.Errorf("get user preferences: %w", err)
	}
	return prefs, nil
}

func (s *Store) UpdateUserPreferences(ctx context.Context, userID string, patch identity.UserPreferencesPatch) (identity.UserPreferences, error) {
	if strings.TrimSpace(userID) == "" {
		return identity.UserPreferences{}, errors.New("user ID is required")
	}
	if v := patch.Theme; v != nil && *v != "light" && *v != "dark" && *v != "auto" {
		return identity.UserPreferences{}, errors.New("theme must be 'light', 'dark', or 'auto'")
	}

	if v := patch.Language; v != nil && *v != "en-US" && *v != "zh-CN" {
		return identity.UserPreferences{}, errors.New("language must be 'en-US' or 'zh-CN'")
	}

	if patch.Timezone != nil && strings.TrimSpace(*patch.Timezone) == "" {
		return identity.UserPreferences{}, errors.New("timezone is required")
	}
	prefs, err := scanUserPreferences(s.pool.QueryRow(ctx, `
		INSERT INTO user_preferences (user_id, theme, language, timezone)
		VALUES ($1, COALESCE($2, 'auto'),
		        COALESCE($3, 'en-US'),
		        COALESCE($4, 'UTC'))
		ON CONFLICT (user_id) DO UPDATE SET
		    theme = COALESCE($2, user_preferences.theme),
		    language = COALESCE($3, user_preferences.language),
		    timezone = COALESCE($4, user_preferences.timezone),
		    updated_at = now()
		RETURNING `+userPreferencesColumns, userID,
		patch.Theme, patch.Language, patch.Timezone,
	))
	if err != nil {
		return identity.UserPreferences{}, fmt.Errorf("update user preferences: %w", err)
	}
	return prefs, nil
}
