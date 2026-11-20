package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

const notificationPreferencesColumns = `user_id, email_evaluation_complete, email_review_assigned, email_changeset_status,
	email_org_invitation, web_push_enabled, notification_frequency, updated_at`

func scanNotificationPreferences(row pgx.Row) (identity.NotificationPreferences, error) {
	var prefs identity.NotificationPreferences
	err := row.Scan(
		&prefs.UserID, &prefs.EmailNotifications.EvaluationComplete, &prefs.EmailNotifications.ReviewAssigned,
		&prefs.EmailNotifications.ChangesetStatus, &prefs.EmailNotifications.OrgInvitation,
		&prefs.WebPushEnabled, &prefs.NotificationFrequency, &prefs.UpdatedAt,
	)
	return prefs, err
}

func (s *Store) GetNotificationPreferences(ctx context.Context, userID string) (identity.NotificationPreferences, error) {
	if strings.TrimSpace(userID) == "" {
		return identity.NotificationPreferences{}, errors.New("user ID is required")
	}
	prefs, err := scanNotificationPreferences(s.pool.QueryRow(ctx, `SELECT `+notificationPreferencesColumns+` FROM notification_preferences WHERE user_id = $1`, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return s.UpdateNotificationPreferences(ctx, userID, identity.NotificationPreferencesPatch{})
	}
	if err != nil {
		return identity.NotificationPreferences{}, fmt.Errorf("get notification preferences: %w", err)
	}
	return prefs, nil
}

func (s *Store) UpdateNotificationPreferences(ctx context.Context, userID string, patch identity.NotificationPreferencesPatch) (identity.NotificationPreferences, error) {
	if strings.TrimSpace(userID) == "" {
		return identity.NotificationPreferences{}, errors.New("user ID is required")
	}
	if v := patch.NotificationFrequency; v != nil && *v != "real-time" && *v != "hourly" && *v != "daily" {
		return identity.NotificationPreferences{}, errors.New("notification_frequency must be 'real-time', 'hourly', or 'daily'")
	}
	prefs, err := scanNotificationPreferences(s.pool.QueryRow(ctx, `
		INSERT INTO notification_preferences (user_id, email_evaluation_complete, email_review_assigned, email_changeset_status,
		    email_org_invitation, web_push_enabled, notification_frequency)
		VALUES ($1, COALESCE($2, true),
		        COALESCE($3, true),
		        COALESCE($4, true),
		        COALESCE($5, true),
		        COALESCE($6, false),
		        COALESCE($7, 'real-time'))
		ON CONFLICT (user_id) DO UPDATE SET
		    email_evaluation_complete = COALESCE($2, notification_preferences.email_evaluation_complete),
		    email_review_assigned = COALESCE($3, notification_preferences.email_review_assigned),
		    email_changeset_status = COALESCE($4, notification_preferences.email_changeset_status),
		    email_org_invitation = COALESCE($5, notification_preferences.email_org_invitation),
		    web_push_enabled = COALESCE($6, notification_preferences.web_push_enabled),
		    notification_frequency = COALESCE($7, notification_preferences.notification_frequency),
		    updated_at = now()
		RETURNING `+notificationPreferencesColumns, userID,
		patch.EmailNotifications.EvaluationComplete, patch.EmailNotifications.ReviewAssigned,
		patch.EmailNotifications.ChangesetStatus, patch.EmailNotifications.OrgInvitation,
		patch.WebPushEnabled, patch.NotificationFrequency,
	))
	if err != nil {
		return identity.NotificationPreferences{}, fmt.Errorf("update notification preferences: %w", err)
	}
	return prefs, nil
}
