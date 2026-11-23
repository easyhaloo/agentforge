package email

import (
	"context"
	"errors"
	"log/slog"
	"time"
)

func DeliverQueued(ctx context.Context, queue *PostgresQueue, provider Provider, logger *slog.Logger) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for ctx.Err() == nil {
		queued, err := queue.Dequeue(ctx)
		if err == nil {
			// Keep the send deadline below the first retry delay so another worker cannot claim it mid-send.
			sendCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			sendErr := provider.Send(sendCtx, Message{To: queued.ToAddress, Subject: queued.Subject, Body: queued.Body, IsHTML: queued.IsHTML})
			cancel()
			if sendErr == nil {
				err = queue.MarkSent(ctx, queued.ID)
			} else {
				logger.Warn("notification email delivery failed", "queue_id", queued.ID, "attempt", queued.Attempts)
				err = queue.MarkFailed(ctx, queued.ID, "provider did not accept delivery")
			}
			if err == nil {
				continue
			}
		}
		if !errors.Is(err, ErrQueueEmpty) && ctx.Err() == nil {
			logger.Error("notification email queue error", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
