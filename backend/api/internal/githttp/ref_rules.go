package githttp

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// RefRule restricts writes to matching branches or tags.
type RefRule struct {
	Name               string   `json:"name"`
	Target             string   `json:"target"`
	Enabled            bool     `json:"enabled"`
	Include            []string `json:"include"`
	Exclude            []string `json:"exclude"`
	RestrictCreation   bool     `json:"restrict_creation"`
	RestrictUpdate     bool     `json:"restrict_update"`
	RestrictDeletion   bool     `json:"restrict_deletion"`
	BlockForcePush     bool     `json:"block_force_push"`
	RequirePullRequest bool     `json:"require_pull_request"`
}

func ValidRefRules(rules []RefRule) bool {
	if len(rules) > 10 {
		return false
	}
	for i, rule := range rules {
		if rule.Name == "" || strings.TrimSpace(rule.Name) != rule.Name || utf8.RuneCountInString(rule.Name) > 80 || strings.ContainsFunc(rule.Name, unicode.IsControl) ||
			(rule.Target != "branch" && rule.Target != "tag") || (rule.Target == "tag" && (rule.BlockForcePush || rule.RequirePullRequest)) ||
			!(rule.RestrictCreation || rule.RestrictUpdate || rule.RestrictDeletion || rule.BlockForcePush || rule.RequirePullRequest) ||
			len(rule.Include) == 0 || len(rule.Include)+len(rule.Exclude) > 10 || !validRulePatterns(rule.Target, rule.Include) || !validRulePatterns(rule.Target, rule.Exclude) {
			return false
		}
		for _, other := range rules[:i] {
			if strings.EqualFold(other.Name, rule.Name) {
				return false
			}
		}
	}
	return true
}

func validRulePatterns(target string, patterns []string) bool {
	refs := make([]string, 0, len(patterns))
	seen := make(map[string]bool, len(patterns))
	for _, pattern := range patterns {
		if seen[pattern] || strings.Contains(pattern, "..") || strings.HasSuffix(pattern, ".") || strings.Contains(pattern, "@{") {
			return false
		}
		seen[pattern] = true
		switch pattern {
		case "~ALL":
		case "~DEFAULT_BRANCH":
			if target != "branch" {
				return false
			}
		default:
			refs = append(refs, "refs/heads/"+pattern)
		}
	}
	return ValidProtectedRefs(refs)
}

func matchesRule(patterns []string, name, defaultBranch string) bool {
	for _, pattern := range patterns {
		switch pattern {
		case "~ALL":
			return true
		case "~DEFAULT_BRANCH":
			if name == defaultBranch {
				return true
			}
		default:
			if matchRefGlob(pattern, name) {
				return true
			}
		}
	}
	return false
}

// Ordinary globs stay within one path component. A ** component can span any
// number of components, including zero. The table avoids recursive backtracking.
func matchRefGlob(pattern, name string) bool {
	components := strings.Split(name, "/")
	matched := make([]bool, len(components)+1)
	matched[0] = true
	for glob := range strings.SplitSeq(pattern, "/") {
		if glob == "**" {
			for i := range components {
				matched[i+1] = matched[i+1] || matched[i]
			}
			continue
		}
		for i := len(components) - 1; i >= 0; i-- {
			componentMatch, _ := path.Match(glob, components[i])
			matched[i+1] = matched[i] && componentMatch
		}
		matched[0] = false
	}
	return matched[len(components)]
}

func (rule RefRule) matches(target, name, defaultBranch string) bool {
	return rule.Enabled && rule.Target == target && matchesRule(rule.Include, name, defaultBranch) && !matchesRule(rule.Exclude, name, defaultBranch)
}

var (
	ErrBranchUpdatesRestricted   = errors.New("branch updates are restricted")
	ErrBranchPullRequestRequired = errors.New("a verified pull request is required")
)

// CheckBranchMerge applies matching rules that govern server-authorized branch updates.
// Callers must enforce revision, evidence and review gates independently.
func CheckBranchMerge(rules []RefRule, branch, defaultBranch string, linkedPullRequest bool) error {
	var pullRequestRule string
	for _, rule := range rules {
		if !rule.matches("branch", branch, defaultBranch) {
			continue
		}
		if rule.RestrictUpdate {
			return fmt.Errorf("ruleset %q blocks updates to %s: %w", rule.Name, branch, ErrBranchUpdatesRestricted)
		}
		if rule.RequirePullRequest && !linkedPullRequest {
			pullRequestRule = rule.Name
		}
	}
	if pullRequestRule != "" {
		return fmt.Errorf("ruleset %q applies to %s: %w", pullRequestRule, branch, ErrBranchPullRequestRequired)
	}
	return nil
}

func checkRefRules(rules []RefRule, update RefUpdate, defaultBranch string) error {
	target := "branch"
	name, isTag := strings.CutPrefix(update.Ref, "refs/tags/")
	if isTag {
		target = "tag"
	} else {
		name = strings.TrimPrefix(update.Ref, "refs/heads/")
	}
	isCreation := strings.Trim(update.Old, "0") == ""
	isDeletion := strings.Trim(update.New, "0") == ""
	var forceRule string
	for _, rule := range rules {
		if !rule.matches(target, name, defaultBranch) {
			continue
		}
		switch {
		case isCreation && rule.RestrictCreation:
			return fmt.Errorf("ruleset %q blocks creation of %s", rule.Name, update.Ref)
		case isDeletion && rule.RestrictDeletion:
			return fmt.Errorf("ruleset %q blocks deletion of %s", rule.Name, update.Ref)
		case !isCreation && !isDeletion && rule.RestrictUpdate:
			return fmt.Errorf("ruleset %q blocks updates to %s", rule.Name, update.Ref)
		case !isCreation && !isDeletion && target == "branch" && rule.RequirePullRequest:
			return fmt.Errorf("ruleset %q requires a pull request to update %s", rule.Name, update.Ref)
		case !isCreation && !isDeletion && rule.BlockForcePush:
			forceRule = rule.Name
		}
	}
	if forceRule == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	// Inherit receive-pack's quarantine and alternate object directory settings.
	cmd := exec.CommandContext(ctx, os.Getenv("AF_GIT_BINARY"), "merge-base", "--is-ancestor", update.Old, update.New)
	if err := cmd.Run(); err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() == 1 {
			return fmt.Errorf("ruleset %q blocks non-fast-forward updates to %s", forceRule, update.Ref)
		}
		return errors.New("could not verify that the branch update is a fast-forward")
	}
	return nil
}
