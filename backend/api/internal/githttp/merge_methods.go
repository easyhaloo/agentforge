package githttp

import (
	"errors"
	"fmt"
)

var ErrMergeMethodDisabled = errors.New("repository does not allow this merge method")

// MergeMethods represents repository settings and partial updates. An unset
// setting is enabled, including for catalogs that predate these controls.
type MergeMethods struct {
	AllowMergeCommit *bool `json:"allow_merge_commit,omitempty"`
	AllowSquashMerge *bool `json:"allow_squash_merge,omitempty"`
	AllowRebaseMerge *bool `json:"allow_rebase_merge,omitempty"`
}

func (m MergeMethods) Specified() bool {
	return m.AllowMergeCommit != nil || m.AllowSquashMerge != nil || m.AllowRebaseMerge != nil
}

// Check accepts canonical candidate strategies. Callers select ff-only for the
// native linear-history path, which introduces no new merge commit or rewrite.
func (m MergeMethods) Check(strategy string) error {
	var allowed *bool
	switch strategy {
	case "merge-commit":
		allowed = m.AllowMergeCommit
	case "squash":
		allowed = m.AllowSquashMerge
	case "rebase":
		allowed = m.AllowRebaseMerge
	case "ff-only":
		return nil
	default:
		return fmt.Errorf("%w: unknown strategy %q", ErrMergeMethodDisabled, strategy)
	}
	if allowed != nil && !*allowed {
		return fmt.Errorf("%w: %s", ErrMergeMethodDisabled, strategy)
	}
	return nil
}

// PullRequestMethods lists available native PR methods in default selection order.
func (m MergeMethods) PullRequestMethods(linear bool) []string {
	methods := make([]string, 0, 3)
	for _, method := range []string{"merge", "squash", "rebase"} {
		if (!linear || method != "merge") && m.Check(PullRequestMergeStrategy(method)) == nil {
			methods = append(methods, method)
		}
	}
	return methods
}

func PullRequestMergeStrategy(method string) string {
	if method == "merge" {
		return "merge-commit"
	}
	return method
}
