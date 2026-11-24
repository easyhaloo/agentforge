package postgres

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/easyhaloo/agentforge/backend/api/internal/platform/email"
	"github.com/jackc/pgx/v5"
)

// EnableNotificationMail is called during server setup, before requests can enqueue mail.
func (s *Store) EnableNotificationMail(origin string) { s.notificationMailOrigin = origin }

func (s *Store) GetNotificationEmail(ctx context.Context, user string) (email.NotificationSettings, error) {
	out := email.NotificationSettings{Available: s.notificationMailOrigin != ""}
	err := s.pool.QueryRow(ctx, `SELECT address, participating, watching,
		CASE WHEN requested_at > now() - interval '30 minutes' THEN pending_address ELSE '' END
		FROM notification_email_settings WHERE user_id=$1`, user).
		Scan(&out.Address, &out.Participating, &out.Watching, &out.Pending)
	if errors.Is(err, pgx.ErrNoRows) {
		err = nil
	}
	return out, err
}

func (s *Store) RequestNotificationEmail(ctx context.Context, user, address string) error {
	var token [24]byte
	if _, err := rand.Read(token[:]); err != nil {
		return fmt.Errorf("generate email verification code: %w", err)
	}
	code := hex.EncodeToString(token[:])
	hash := sha256.Sum256([]byte(code))
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin email verification: %w", err)
	}
	defer tx.Rollback(ctx)
	// Serialize requests for the destination across accounts, including its initial request.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended(lower($1), 216))`, address); err != nil {
		return fmt.Errorf("lock verification destination: %w", err)
	}
	var recentlySent bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM email_queue WHERE organization_id=''
		AND lower(to_address)=lower($1) AND created_at > now() - interval '1 minute')`, address).Scan(&recentlySent); err != nil {
		return fmt.Errorf("check verification destination rate: %w", err)
	}
	if recentlySent {
		return email.ErrVerificationThrottled
	}
	tag, err := tx.Exec(ctx, `INSERT INTO notification_email_settings (user_id,pending_address,pending_hash,requested_at)
		VALUES ($1,$2,$3,now()) ON CONFLICT (user_id) DO UPDATE
		SET pending_address=EXCLUDED.pending_address,pending_hash=EXCLUDED.pending_hash,requested_at=EXCLUDED.requested_at
		WHERE notification_email_settings.requested_at IS NULL OR notification_email_settings.requested_at <= now() - interval '1 minute'`, user, address, hash[:])
	if err != nil {
		return fmt.Errorf("store email verification: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return email.ErrVerificationThrottled
	}
	if _, err := tx.Exec(ctx, `INSERT INTO email_queue (id,organization_id,to_address,subject,body,is_html)
		VALUES (gen_random_uuid()::text,'',$1,'Verify your AgentForge notification email',$2,false)`, address,
		"Enter this code in AgentForge notification settings within 30 minutes:\n\n"+code); err != nil {
		return fmt.Errorf("enqueue email verification: %w", err)
	}
	return tx.Commit(ctx)
}

func (s *Store) VerifyNotificationEmail(ctx context.Context, user, code string) error {
	hash := sha256.Sum256([]byte(code))
	tag, err := s.pool.Exec(ctx, `UPDATE notification_email_settings SET address=pending_address,pending_address='',pending_hash=NULL
		WHERE user_id=$1 AND pending_hash=$2 AND requested_at > now() - interval '30 minutes'`, user, hash[:])
	if err != nil {
		return fmt.Errorf("verify notification email: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return email.ErrVerificationInvalid
	}
	return nil
}

func (s *Store) UpdateNotificationEmail(ctx context.Context, user string, participating, watching *bool) error {
	tag, err := s.pool.Exec(ctx, `UPDATE notification_email_settings SET participating=COALESCE($2,participating),watching=COALESCE($3,watching)
		WHERE user_id=$1 AND address<>''`, user, participating, watching)
	if err != nil {
		return fmt.Errorf("save notification email settings: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return email.ErrAddressRequired
	}
	return nil
}
