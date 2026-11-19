package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

// GetUserPreferences retrieves user preferences, creating defaults if they don't exist.
func (s *Store) GetUserPreferences(ctx context.Context, userID string) (identity.UserPreferences, error) {
	if strings.TrimSpace(userID) == "" {
		return identity.UserPreferences{}, errors.New("user ID is required")
	}

	var prefs identity.UserPreferences
	err := s.pool.QueryRow(ctx, `
		SELECT user_id, theme, language, timezone, updated_at
		FROM user_preferences
		WHERE user_id = $1
	`, userID).Scan(&prefs.UserID, &prefs.Theme, &prefs.Language, &prefs.Timezone, &prefs.UpdatedAt)

	if errors.Is(err, pgx.ErrNoRows) {
		// Create default preferences
		return s.createDefaultPreferences(ctx, userID)
	}
	if err != nil {
		return identity.UserPreferences{}, fmt.Errorf("get user preferences: %w", err)
	}

	return prefs, nil
}

// createDefaultPreferences creates default preferences for a new user.
func (s *Store) createDefaultPreferences(ctx context.Context, userID string) (identity.UserPreferences, error) {
	now := time.Now().UTC()
	prefs := identity.UserPreferences{
		UserID:    userID,
		Theme:     "auto",
		Language:  "en-US",
		Timezone:  "UTC",
		UpdatedAt: now,
	}

	_, err := s.pool.Exec(ctx, `
		INSERT INTO user_preferences (user_id, theme, language, timezone, updated_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id) DO NOTHING
	`, prefs.UserID, prefs.Theme, prefs.Language, prefs.Timezone, prefs.UpdatedAt)

	if err != nil {
		return identity.UserPreferences{}, fmt.Errorf("create default preferences: %w", err)
	}

	return prefs, nil
}

// UpdateUserPreferences updates user preferences.
func (s *Store) UpdateUserPreferences(ctx context.Context, userID, theme, language, timezone string) (identity.UserPreferences, error) {
	if strings.TrimSpace(userID) == "" {
		return identity.UserPreferences{}, errors.New("user ID is required")
	}

	// Validate theme
	if theme != "light" && theme != "dark" && theme != "auto" {
		return identity.UserPreferences{}, errors.New("theme must be 'light', 'dark', or 'auto'")
	}

	// Validate language
	if language != "en-US" && language != "zh-CN" {
		return identity.UserPreferences{}, errors.New("language must be 'en-US' or 'zh-CN'")
	}

	// Basic timezone validation (could be more sophisticated)
	if strings.TrimSpace(timezone) == "" {
		return identity.UserPreferences{}, errors.New("timezone is required")
	}

	now := time.Now().UTC()
	var prefs identity.UserPreferences

	err := s.pool.QueryRow(ctx, `
		INSERT INTO user_preferences (user_id, theme, language, timezone, updated_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id) DO UPDATE
		SET theme = $2, language = $3, timezone = $4, updated_at = $5
		RETURNING user_id, theme, language, timezone, updated_at
	`, userID, theme, language, timezone, now).Scan(
		&prefs.UserID, &prefs.Theme, &prefs.Language, &prefs.Timezone, &prefs.UpdatedAt,
	)

	if err != nil {
		return identity.UserPreferences{}, fmt.Errorf("update user preferences: %w", err)
	}

	return prefs, nil
}
