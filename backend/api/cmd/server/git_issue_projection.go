package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/postgres"
)

func projectGitIssues(ctx context.Context, git *delivery.LocalGitProvider, issues *postgres.IssueRepository, logger *slog.Logger) {
	journal := filepath.Join(git.Root, ".agentforge-push-events")
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for ctx.Err() == nil {
		entries, err := os.ReadDir(journal)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			logger.Error("read Git push journal", "error", err)
		}
		for _, entry := range entries {
			if ctx.Err() != nil {
				return
			}
			if !entry.Type().IsRegular() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			eventCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			err := projectGitIssueEvent(eventCtx, journal, entry.Name(), git, issues)
			cancel()
			if err != nil && ctx.Err() == nil {
				logger.Error("project Git push issue links", "event", entry.Name(), "error", err)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func projectGitIssueEvent(ctx context.Context, journal, name string, git *delivery.LocalGitProvider, issues *postgres.IssueRepository) error {
	path := filepath.Join(journal, name)
	payload, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil // Another consumer may have already archived the event.
	}
	if err != nil {
		return err
	}
	var event githttp.PushEvent
	if err := json.Unmarshal(payload, &event); err != nil {
		return fmt.Errorf("read push event: %w", err)
	}
	for _, update := range event.Updates {
		if !strings.HasPrefix(update.Ref, "refs/heads/") || strings.Trim(update.New, "0") == "" {
			continue
		}
		base := update.Old
		if strings.Trim(base, "0") == "" {
			base = event.Base
		}
		if err := git.VisitPushedCommits(ctx, event.Organization, event.Repository, base, update.New, func(sha, subject, message string) error {
			return issues.LinkCommitIssues(ctx, event.Organization, event.Repository, sha, subject, message)
		}); err != nil {
			return err
		}
	}
	archive := filepath.Join(journal, "projected")
	if err := os.MkdirAll(archive, 0700); err != nil {
		return err
	}
	if err := os.Rename(path, filepath.Join(archive, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
