package pipeline

import (
	"context"
	"errors"
	"path"
	"strings"
)

type TriggerBinding struct {
	ID           string `json:"id"`
	Kind         string `json:"kind"`
	Version      int    `json:"version"`
	EverySeconds int    `json:"everySeconds,omitempty"`
	TagPattern   string `json:"tagPattern,omitempty"`
}

type TriggerStore interface {
	WorkflowTriggers(ctx context.Context, org, id string) ([]TriggerBinding, error)
	EnableWorkflowTrigger(ctx context.Context, org, id, actor, kind, tagPattern string, version, everySeconds int) (TriggerBinding, error)
	DisableWorkflowTrigger(ctx context.Context, org, id, binding string) error
}

// A tag pattern is a Git-style glob over the tag name: `v*`, `release-*`. It must stay a
// single path-free segment so patterns cannot escape the refs/tags namespace.
const MaxTagPatternLength = 128

var ErrTagPattern = errors.New("invalid tag pattern")

// ValidateTagPattern reports whether pattern is a safe single-segment tag glob.
func ValidateTagPattern(pattern string) bool {
	if pattern == "" || len(pattern) > MaxTagPatternLength {
		return false
	}
	if strings.ContainsAny(pattern, "/\\") || strings.ContainsAny(pattern, "\x00") {
		return false
	}
	for _, r := range pattern {
		if r <= ' ' || r == 127 {
			return false
		}
	}
	if _, err := path.Match(pattern, ""); err != nil {
		return false
	}
	return true
}

// MatchTagPattern reports whether the tag name matches the binding pattern.
// A malformed pattern never matches.
func MatchTagPattern(pattern, tag string) bool {
	if !ValidateTagPattern(pattern) || tag == "" || len(tag) > MaxTagPatternLength {
		return false
	}
	matched, err := path.Match(pattern, tag)
	return err == nil && matched
}
