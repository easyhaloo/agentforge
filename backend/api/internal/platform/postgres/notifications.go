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

// GetNotificationPreferences retrieves notification preferences, creating defaults if they don't exist.
func (s *Store) GetNotificationPreferences(ctx context.Context, userID string) (identity.NotificationPreferences, error) {
	if strings.TrimSpace(userID) == "" {
		return identity.NotificationPreferences{}, errors.New("user ID is required")
	}

	var prefs identity.NotificationPreferences
	var emailEvalComplete, emailReviewAssigned, emailChangesetStatus, emailOrgInvitation bool

	err := s.pool.QueryRow(ctx, `
		SELECT user_id, email_evaluation_complete, email_review_assigned,
		       email_changeset_status, email_org_invitation, web_push_enabled,
		       notification_frequency, updated_at
		FROM notification_preferences
		WHERE user_id = $1
	`, userID).Scan(
		&prefs.UserID,
		&emailEvalComplete, &emailReviewAssigned, &emailChangesetStatus, &emailOrgInvitation,
		&prefs.WebPushEnabled, &prefs.NotificationFrequency, &prefs.UpdatedAt,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		// Create default preferences
		return s.createDefaultNotificationPreferences(ctx, userID)
	}
	if err != nil {
		return identity.NotificationPreferences{}, fmt.Errorf("get notification preferences: %w", err)
	}

	prefs.EmailNotifications = identity.EmailNotificationSettings{
		EvaluationComplete: emailEvalComplete,
		ReviewAssigned:     emailReviewAssigned,
		ChangesetStatus:    emailChangesetStatus,
		OrgInvitation:      emailOrgInvitation,
	}

	return prefs, nil
}

// createDefaultNotificationPreferences creates default notification preferences.
func (s *Store) createDefaultNotificationPreferences(ctx context.Context, userID string) (identity.NotificationPreferences, error) {
	now := time.Now().UTC()
	prefs := identity.NotificationPreferences{
		UserID: userID,
		EmailNotifications: identity.EmailNotificationSettings{
			EvaluationComplete: true,
			ReviewAssigned:     true,
			ChangesetStatus:    true,
			OrgInvitation:      true,
		},
		WebPushEnabled:        false,
		NotificationFrequency: "real-time",
		UpdatedAt:             now,
	}

	_, err := s.pool.Exec(ctx, `
		INSERT INTO notification_preferences (
			user_id, email_evaluation_complete, email_review_assigned,
			email_changeset_status, email_org_invitation, web_push_enabled,
			notification_frequency, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (user_id) DO NOTHING
	`, userID, true, true, true, true, false, "real-time", now)

	if err != nil {
		return identity.NotificationPreferences{}, fmt.Errorf("create default notification preferences: %w", err)
	}

	return prefs, nil
}

// UpdateNotificationPreferences updates notification preferences.
func (s *Store) UpdateNotificationPreferences(ctx context.Context, userID string, emailNotifs identity.EmailNotificationSettings, webPushEnabled bool, frequency string) (identity.NotificationPreferences, error) {
	if strings.TrimSpace(userID) == "" {
		return identity.NotificationPreferences{}, errors.New("user ID is required")
	}

	// Validate frequency
	if frequency != "real-time" && frequency != "hourly" && frequency != "daily" {
		return identity.NotificationPreferences{}, errors.New("notification_frequency must be 'real-time', 'hourly', or 'daily'")
	}

	now := time.Now().UTC()
	var prefs identity.NotificationPreferences
	var emailEvalComplete, emailReviewAssigned, emailChangesetStatus, emailOrgInvitation bool

	err := s.pool.QueryRow(ctx, `
		INSERT INTO notification_preferences (
			user_id, email_evaluation_complete, email_review_assigned,
			email_changeset_status, email_org_invitation, web_push_enabled,
			notification_frequency, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (user_id) DO UPDATE
		SET email_evaluation_complete = $2, email_review_assigned = $3,
		    email_changeset_status = $4, email_org_invitation = $5,
		    web_push_enabled = $6, notification_frequency = $7, updated_at = $8
		RETURNING user_id, email_evaluation_complete, email_review_assigned,
		          email_changeset_status, email_org_invitation, web_push_enabled,
		          notification_frequency, updated_at
	`, userID,
		emailNotifs.EvaluationComplete, emailNotifs.ReviewAssigned,
		emailNotifs.ChangesetStatus, emailNotifs.OrgInvitation,
		webPushEnabled, frequency, now,
	).Scan(
		&prefs.UserID,
		&emailEvalComplete, &emailReviewAssigned, &emailChangesetStatus, &emailOrgInvitation,
		&prefs.WebPushEnabled, &prefs.NotificationFrequency, &prefs.UpdatedAt,
	)

	if err != nil {
		return identity.NotificationPreferences{}, fmt.Errorf("update notification preferences: %w", err)
	}

	prefs.EmailNotifications = identity.EmailNotificationSettings{
		EvaluationComplete: emailEvalComplete,
		ReviewAssigned:     emailReviewAssigned,
		ChangesetStatus:    emailChangesetStatus,
		OrgInvitation:      emailOrgInvitation,
	}

	return prefs, nil
}
