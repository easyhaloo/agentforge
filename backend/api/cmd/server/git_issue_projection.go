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
)

// The projections depend on these two slices of the store, not on the concrete types, so tests
// can drive the journal loop without a database.
type issueLinker interface {
	LinkCommitIssues(ctx context.Context, org, repository, sha, subject, message string) error
}

type tagEnqueuer interface {
	EnqueueTagRuns(ctx context.Context, org, repository, ref, sha string) error
}

// projectGitIssues is the single consumer of the push journal. Each event walks pushed commits
// for issue links and then enqueues tag trigger runs for refs/tags updates, so one archive
// rename covers both projections and no second cursor can race it for the same file.
func projectGitIssues(ctx context.Context, git *delivery.LocalGitProvider, issues issueLinker, store tagEnqueuer, logger *slog.Logger) {
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
			err := projectPushEvent(eventCtx, journal, entry.Name(), git, issues, store)
			cancel()
			if err != nil && ctx.Err() == nil {
				logger.Error("project Git push event", "event", entry.Name(), "error", err)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func projectPushEvent(ctx context.Context, journal, name string, git *delivery.LocalGitProvider, issues issueLinker, store tagEnqueuer) error {
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
		switch {
		case strings.HasPrefix(update.Ref, "refs/tags/"):
			// Deletions carry a zero SHA; only creations and updates trigger runs. Annotation
			// tags peel to their commit so the run pins a revision Git can check out.
			if strings.Trim(update.New, "0") == "" {
				continue
			}
			revision, err := git.ResolveRevision(ctx, event.Organization, event.Repository, strings.TrimPrefix(update.Ref, "refs/"))
			if err != nil {
				return fmt.Errorf("resolve %s: %w", update.Ref, err)
			}
			if err := store.EnqueueTagRuns(ctx, event.Organization, event.Repository, update.Ref, revision.CommitSHA); err != nil {
				return err
			}
		case strings.HasPrefix(update.Ref, "refs/heads/"):
			if strings.Trim(update.New, "0") == "" {
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
