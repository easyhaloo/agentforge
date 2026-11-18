package workspace

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"path"
	"strings"
	"time"
)

type Status string

const (
	StatusActive  Status = "active"
	StatusExpired Status = "expired"
	StatusClosed  Status = "closed"
	MaxFileBytes         = 2 << 20
)

var (
	ErrInvalidInput    = errors.New("invalid workspace input")
	ErrVersionConflict = errors.New("workspace file version conflict")
	ErrUnavailable     = errors.New("workspace is not active")
)

type Workspace struct {
	ID             string    `json:"id"`
	OrganizationID string    `json:"organization_id"`
	Repository     string    `json:"repository"`
	OwnerID        string    `json:"owner_id"`
	BaseCommitSHA  string    `json:"base_commit_sha"`
	BaseRef        string    `json:"base_ref"`
	Status         Status    `json:"status"`
	ExpiresAt      time.Time `json:"expires_at"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type File struct {
	WorkspaceID string    `json:"workspace_id"`
	Path        string    `json:"path"`
	Content     []byte    `json:"content"`
	SHA256      string    `json:"sha256"`
	Version     int64     `json:"version"`
	UpdatedBy   string    `json:"updated_by"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func New(input Workspace, now time.Time) (Workspace, error) {
	input.ID = strings.TrimSpace(input.ID)
	input.OrganizationID = strings.TrimSpace(input.OrganizationID)
	input.Repository = strings.TrimSpace(input.Repository)
	input.OwnerID = strings.TrimSpace(input.OwnerID)
	input.BaseCommitSHA = strings.TrimSpace(input.BaseCommitSHA)
	input.BaseRef = strings.TrimSpace(input.BaseRef)
	if input.ID == "" || input.OrganizationID == "" || input.OwnerID == "" ||
		!validRepository(input.Repository) || !validCommitSHA(input.BaseCommitSHA) ||
		input.ExpiresAt.IsZero() || !input.ExpiresAt.After(now) {
		return Workspace{}, ErrInvalidInput
	}
	input.Status = StatusActive
	input.CreatedAt = now.UTC()
	input.UpdatedAt = now.UTC()
	input.ExpiresAt = input.ExpiresAt.UTC()
	return input, nil
}

// PutFile applies an optimistic compare-and-swap. expectedVersion=0 creates a new file;
// an existing file must be updated with its exact current version.
func (w Workspace) PutFile(existing *File, filePath string, content []byte, expectedVersion int64, actor string, now time.Time) (File, error) {
	if w.Status != StatusActive || !w.ExpiresAt.After(now) {
		return File{}, ErrUnavailable
	}
	if !ValidPath(filePath) || len(content) > MaxFileBytes || strings.TrimSpace(actor) == "" || expectedVersion < 0 {
		return File{}, ErrInvalidInput
	}
	version := int64(1)
	if existing == nil {
		if expectedVersion != 0 {
			return File{}, ErrVersionConflict
		}
	} else {
		if existing.WorkspaceID != w.ID || existing.Path != filePath || existing.Version != expectedVersion {
			return File{}, ErrVersionConflict
		}
		version = existing.Version + 1
	}
	digest := sha256.Sum256(content)
	return File{
		WorkspaceID: w.ID,
		Path: filePath,
		Content: append([]byte(nil), content...),
		SHA256: hex.EncodeToString(digest[:]),
		Version: version,
		UpdatedBy: actor,
		UpdatedAt: now.UTC(),
	}, nil
}

func (w Workspace) Close(now time.Time) (Workspace, error) {
	if w.Status != StatusActive {
		return Workspace{}, ErrUnavailable
	}
	w.Status = StatusClosed
	w.UpdatedAt = now.UTC()
	return w, nil
}

func (w Workspace) Expire(now time.Time) (Workspace, error) {
	if w.Status != StatusActive || w.ExpiresAt.After(now) {
		return Workspace{}, ErrUnavailable
	}
	w.Status = StatusExpired
	w.UpdatedAt = now.UTC()
	return w, nil
}

func ValidPath(value string) bool {
	if value == "" || len(value) > 1024 || strings.ContainsAny(value, "\x00\\") || strings.HasPrefix(value, "/") {
		return false
	}
	clean := path.Clean(value)
	return clean == value && clean != "." && clean != ".." && !strings.HasPrefix(clean, "../")
}

func validRepository(value string) bool {
	parts := strings.Split(value, "/")
	if len(parts) != 2 {
		return false
	}
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || strings.ContainsAny(part, "\x00\\:") {
			return false
		}
	}
	return true
}

func validCommitSHA(value string) bool {
	if len(value) != 40 && len(value) != 64 {
		return false
	}
	for _, char := range value {
		if !(char >= '0' && char <= '9') && !(char >= 'a' && char <= 'f') {
			return false
		}
	}
	return true
}
