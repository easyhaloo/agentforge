package githttp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

func (t *Transport) journal() string { return filepath.Join(t.root, ".agentforge-push-events") }

func intentDirectory(journal string) string { return filepath.Join(journal, ".intents") }

func finishPush(journal, intent string, event PushEvent) error {
	if len(event.Updates) > 0 {
		if err := writePushEvent(filepath.Join(journal, event.ID+".json"), event); err != nil {
			return err
		}
	}
	if err := os.Remove(intent); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return syncDirectory(filepath.Dir(intent))
}

// Reconcile publishes events for interrupted receives. The same database lock
// used by normal pushes must cover each recovery attempt.
func (t *Transport) Reconcile(ctx context.Context, lock func(context.Context, string, string) (string, int, func(), error)) error {
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	return t.walkIntents(ctx, func(path string, event PushEvent) error {
		_, _, release, err := lock(ctx, event.Organization, event.Repository)
		if err != nil {
			return err
		}
		defer release()
		return t.recoverIntent(ctx, path, event)
	})
}

func (t *Transport) reconcileRepository(ctx context.Context, organization, repository string) error {
	return t.walkIntents(ctx, func(path string, event PushEvent) error {
		if event.Organization != organization || event.Repository != repository {
			return nil
		}
		return t.recoverIntent(ctx, path, event)
	})
}

func (t *Transport) walkIntents(ctx context.Context, visit func(string, PushEvent) error) error {
	dir := intentDirectory(t.journal())
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var firstErr error
	for _, entry := range entries {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if _, err := uuid.Parse(entry.Name()); err != nil || !entry.Type().IsRegular() {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		file, err := os.Open(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		var event PushEvent
		err = json.NewDecoder(io.LimitReader(file, 512<<10)).Decode(&event)
		_ = file.Close()
		if err != nil || event.ID != entry.Name() || len(event.Updates) > 128 || len(event.Updates) == 0 {
			return errors.New("invalid Git push intent")
		}
		if err := visit(path, event); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (t *Transport) recoverIntent(ctx context.Context, intent string, event PushEvent) error {
	if _, err := os.Stat(intent); errors.Is(err, os.ErrNotExist) {
		return nil // The original receive finalized while recovery was acquiring the lock.
	} else if err != nil {
		return err
	}
	for _, dir := range []string{t.journal(), filepath.Join(t.journal(), "projected")} {
		if _, err := os.Stat(filepath.Join(dir, event.ID+".json")); err == nil {
			if err := syncDirectory(dir); err != nil {
				return err
			}
			if err := syncDirectory(t.journal()); err != nil {
				return err
			}
			event.Updates = nil
			return finishPush(t.journal(), intent, event)
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	path, err := t.repositoryPath(event.Organization, event.Repository)
	if err != nil {
		return err
	}
	accepted := make([]RefUpdate, 0, len(event.Updates))
	for _, update := range event.Updates {
		if !validObjectID(update.New) || !validObjectID(update.Old) || len(update.New) != len(update.Old) ||
			(!strings.HasPrefix(update.Ref, "refs/heads/") && !strings.HasPrefix(update.Ref, "refs/tags/")) {
			return errors.New("invalid Git ref in push intent")
		}
		// Exact refs sort ahead of descendants. Match the whole name because
		// for-each-ref can also return a descendant of a deleted ref.
		cmd := exec.CommandContext(ctx, t.git, "--git-dir="+path, "for-each-ref",
			"--sort=refname", "--count=1", "--format=%(objectname) %(refname)", "--", update.Ref)
		cmd.Env = []string{"PATH=" + t.runtime + ":/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_TERMINAL_PROMPT=0", "GIT_NO_REPLACE_OBJECTS=1"}
		out, err := cmd.Output()
		if err != nil {
			return fmt.Errorf("resolve interrupted push ref: %w", err)
		}
		current := strings.Repeat("0", len(update.New))
		if sha, ref, ok := strings.Cut(strings.TrimSuffix(string(out), "\n"), " "); ok && ref == update.Ref {
			current = sha
		}
		switch current {
		case update.Old:
		case update.New:
			accepted = append(accepted, update)
		default:
			// A writer outside Smart HTTP changed this ref while the intent was outstanding.
			return errors.New("interrupted push ref diverged from its recorded old and new values")
		}
	}
	event.Updates = accepted
	return finishPush(t.journal(), intent, event)
}
