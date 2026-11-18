package workspace

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestNewPinsCommitAndRequiresFutureExpiry(t *testing.T) {
	now := time.Date(2026, 11, 18, 0, 0, 0, 0, time.UTC)
	input := Workspace{ID: "ws-1", OrganizationID: "org-1", Repository: "team/repo", OwnerID: "user-1", BaseCommitSHA: strings.Repeat("a", 40), BaseRef: "main", ExpiresAt: now.Add(time.Hour)}
	got, err := New(input, now)
	if err != nil { t.Fatal(err) }
	if got.Status != StatusActive || got.BaseCommitSHA != input.BaseCommitSHA || !got.CreatedAt.Equal(now) { t.Fatalf("unexpected workspace: %#v", got) }
	input.BaseCommitSHA = "main"
	if _, err := New(input, now); !errors.Is(err, ErrInvalidInput) { t.Fatalf("expected invalid commit SHA, got %v", err) }
	input.BaseCommitSHA = strings.Repeat("a", 40)
	input.ExpiresAt = now
	if _, err := New(input, now); !errors.Is(err, ErrInvalidInput) { t.Fatalf("expected future expiry validation, got %v", err) }
}

func TestPutFileUsesOptimisticVersionAndCopiesContent(t *testing.T) {
	now := time.Now().UTC()
	w, err := New(Workspace{ID:"ws", OrganizationID:"org", Repository:"team/repo", OwnerID:"user", BaseCommitSHA:strings.Repeat("b",40), ExpiresAt:now.Add(time.Hour)}, now)
	if err != nil { t.Fatal(err) }
	first, err := w.PutFile(nil, "src/main.go", []byte("one"), 0, "user", now)
	if err != nil { t.Fatal(err) }
	if first.Version != 1 || first.SHA256 == "" { t.Fatalf("unexpected file: %#v", first) }
	if _, err := w.PutFile(&first, first.Path, []byte("two"), 0, "user", now); !errors.Is(err, ErrVersionConflict) { t.Fatalf("expected stale write conflict, got %v", err) }
	second, err := w.PutFile(&first, first.Path, []byte("two"), 1, "user", now)
	if err != nil { t.Fatal(err) }
	if second.Version != 2 || string(first.Content) != "one" || string(second.Content) != "two" { t.Fatalf("unexpected version transition: %#v %#v", first, second) }
}

func TestPathValidationAndWriteLimits(t *testing.T) {
	for _, invalid := range []string{"", "../secret", "a/../secret", "/etc/passwd", "a//b", "a\\b", "."} {
		if ValidPath(invalid) { t.Errorf("accepted invalid path %q", invalid) }
	}
	if !ValidPath("src/main.go") { t.Fatal("valid path rejected") }
	now := time.Now().UTC()
	w, err := New(Workspace{ID:"ws", OrganizationID:"org", Repository:"team/repo", OwnerID:"user", BaseCommitSHA:strings.Repeat("c",40), ExpiresAt:now.Add(time.Hour)}, now)
	if err != nil { t.Fatal(err) }
	if _, err := w.PutFile(nil, "large.bin", make([]byte, MaxFileBytes+1), 0, "user", now); !errors.Is(err, ErrInvalidInput) { t.Fatalf("expected bounded file rejection, got %v", err) }
}

func TestClosedAndExpiredWorkspacesRejectWrites(t *testing.T) {
	now := time.Now().UTC()
	w, err := New(Workspace{ID:"ws", OrganizationID:"org", Repository:"team/repo", OwnerID:"user", BaseCommitSHA:strings.Repeat("d",40), ExpiresAt:now.Add(time.Minute)}, now)
	if err != nil { t.Fatal(err) }
	closed, err := w.Close(now)
	if err != nil { t.Fatal(err) }
	if _, err := closed.PutFile(nil, "a.txt", []byte("x"), 0, "user", now); !errors.Is(err, ErrUnavailable) { t.Fatalf("closed workspace accepted write: %v", err) }
	expired, err := w.Expire(now.Add(2*time.Minute))
	if err != nil { t.Fatal(err) }
	if expired.Status != StatusExpired { t.Fatalf("unexpected expired state: %s", expired.Status) }
}
