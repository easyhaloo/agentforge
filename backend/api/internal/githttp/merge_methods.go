package githttp

import (
	"errors"
	"fmt"
	"slices"
)

var pullRequestMethods = [...]string{"merge", "squash", "rebase"}

var ErrMergeMethodDisabled = errors.New("repository does not allow this merge method")

type MergeMessageFormats struct {
	MergeCommitMessageFormat  string `json:"merge_commit_message_format,omitempty"`
	SquashCommitMessageFormat string `json:"squash_commit_message_format,omitempty"`
}

// ValidMergeMessageFormat checks a supplied setting. An omitted setting is handled by the caller.
func ValidMergeMessageFormat(format string, squash bool) bool {
	return format == "default" || format == "title" || format == "description" || (squash && format == "commits")
}

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

// CheckBranch checks the repository setting and all matching PR rulesets.
func (m MergeMethods) CheckBranch(strategy string, rules []RefRule, branch, defaultBranch string) error {
	if err := m.Check(strategy); err != nil {
		return err
	}
	method := strategy
	if strategy == "merge-commit" {
		method = "merge"
	}
	for _, rule := range rules {
		if rule.RequirePullRequest && len(rule.AllowedMergeMethods) > 0 && rule.matches("branch", branch, defaultBranch) && !slices.Contains(rule.AllowedMergeMethods, method) {
			return fmt.Errorf("ruleset %q: %w: %s", rule.Name, ErrMergeMethodDisabled, method)
		}
	}
	return nil
}

// PullRequestMethods lists available native PR methods in default selection order.
func (m MergeMethods) PullRequestMethods(rules []RefRule, branch, defaultBranch string) []string {
	linear := LinearHistoryRule(rules, branch, defaultBranch) != ""
	methods := make([]string, 0, len(pullRequestMethods))
	for _, method := range pullRequestMethods {
		if (!linear || method != "merge") && m.CheckBranch(PullRequestMergeStrategy(method), rules, branch, defaultBranch) == nil {
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
