package githttp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// RefRule restricts writes to matching branches or tags.
type RefRule struct {
	Name               string           `json:"name"`
	Target             string           `json:"target"`
	Enabled            bool             `json:"enabled"`
	Include            []string         `json:"include"`
	Exclude            []string         `json:"exclude"`
	RestrictCreation   bool             `json:"restrict_creation"`
	RestrictUpdate     bool             `json:"restrict_update"`
	RestrictDeletion   bool             `json:"restrict_deletion"`
	BlockForcePush     bool             `json:"block_force_push"`
	RequirePullRequest bool             `json:"require_pull_request"`
	RequireMergeQueue  bool             `json:"require_merge_queue,omitempty"`
	NamePatterns       []RefNamePattern `json:"name_patterns,omitempty"`
}

func ValidRefRules(rules []RefRule) bool {
	if len(rules) > 10 {
		return false
	}
	for i, rule := range rules {
		if rule.Name == "" || strings.TrimSpace(rule.Name) != rule.Name || utf8.RuneCountInString(rule.Name) > 80 || strings.ContainsFunc(rule.Name, unicode.IsControl) ||
			(rule.Target != "branch" && rule.Target != "tag") || (rule.Target == "tag" && (rule.BlockForcePush || rule.RequirePullRequest || rule.RequireMergeQueue)) ||
			!(rule.RestrictCreation || rule.RestrictUpdate || rule.RestrictDeletion || rule.BlockForcePush || rule.RequirePullRequest || rule.RequireMergeQueue || len(rule.NamePatterns) > 0) ||
			!validNamePatterns(rule.NamePatterns) || len(rule.Include) == 0 || len(rule.Include)+len(rule.Exclude) > 10 || !validRulePatterns(rule.Target, rule.Include) || !validRulePatterns(rule.Target, rule.Exclude) {
			return false
		}
		if rule.RequireMergeQueue && (!slices.Equal(rule.Include, []string{"~DEFAULT_BRANCH"}) || len(rule.Exclude) != 0) {
			return false
		}
		for _, other := range rules[:i] {
			if strings.EqualFold(other.Name, rule.Name) {
				return false
			}
		}
	}
	// The complete policy is passed as one environment variable to receive-pack.
	encoded, err := json.Marshal(rules)
	return err == nil && len(encoded) <= 64<<10
}

// RefNamePattern matches the short name of a branch or tag.
type RefNamePattern struct {
	Operator string `json:"operator"`
	Pattern  string `json:"pattern"`
	Negate   bool   `json:"negate,omitempty"`
	Name     string `json:"name,omitempty"`
}

func validNamePatterns(patterns []RefNamePattern) bool {
	if len(patterns) > 10 {
		return false
	}
	for _, pattern := range patterns {
		if pattern.Pattern == "" || len(pattern.Pattern) > 1024 || strings.ContainsFunc(pattern.Pattern, unicode.IsControl) ||
			utf8.RuneCountInString(pattern.Name) > 80 || strings.ContainsFunc(pattern.Name, unicode.IsControl) {
			return false
		}
		switch pattern.Operator {
		case "starts_with", "ends_with", "contains":
		case "regex":
			if _, err := regexp.Compile(pattern.Pattern); err != nil {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func (rule RefRule) checkName(name string) error {
	for _, pattern := range rule.NamePatterns {
		var matches bool
		switch pattern.Operator {
		case "starts_with":
			matches = strings.HasPrefix(name, pattern.Pattern)
		case "ends_with":
			matches = strings.HasSuffix(name, pattern.Pattern)
		case "contains":
			matches = strings.Contains(name, pattern.Pattern)
		case "regex":
			var err error
			matches, err = regexp.MatchString(pattern.Pattern, name)
			if err != nil {
				return fmt.Errorf("ruleset %q has an invalid name pattern: %w", rule.Name, ErrRefNameRestricted)
			}
		default:
			return fmt.Errorf("ruleset %q has an invalid name pattern operator: %w", rule.Name, ErrRefNameRestricted)
		}
		if matches == pattern.Negate {
			return fmt.Errorf("ruleset %q: %w: %s", rule.Name, ErrRefNameRestricted, name)
		}
	}
	return nil
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
	ErrRefNameRestricted         = errors.New("ref name does not match the required pattern")
	ErrBranchCreationRestricted  = errors.New("branch creation is restricted")
	ErrBranchUpdatesRestricted   = errors.New("branch updates are restricted")
	ErrBranchPullRequestRequired = errors.New("a verified pull request is required")
	ErrBranchMergeQueueRequired  = errors.New("the merge queue is required")
)

// CheckBranchWrite checks a platform writer's exact destination ref. The caller
// must use the same observed ref state for the policy check and the Git CAS.
func (policy PushPolicy) CheckBranchWrite(ref string, creating bool) error {
	branch, isBranch := strings.CutPrefix(ref, "refs/heads/")
	if !isBranch {
		return nil
	}
	if !creating {
		return CheckBranchMerge(policy.RefRules, branch, policy.DefaultBranch, false, false)
	}
	for _, rule := range policy.RefRules {
		if !rule.matches("branch", branch, policy.DefaultBranch) {
			continue
		}
		if err := rule.checkName(branch); err != nil {
			return err
		}
		if rule.RestrictCreation {
			return fmt.Errorf("ruleset %q blocks creation of %s: %w", rule.Name, ref, ErrBranchCreationRestricted)
		}
	}
	return nil
}

// CheckBranchMerge applies matching rules that govern server-authorized branch updates.
// Callers must enforce revision, evidence and review gates independently.
func CheckBranchMerge(rules []RefRule, branch, defaultBranch string, linkedPullRequest, queued bool) error {
	var pullRequestRule, queueRule string
	for _, rule := range rules {
		if !rule.matches("branch", branch, defaultBranch) {
			continue
		}
		if err := rule.checkName(branch); err != nil {
			return err
		}
		if rule.RestrictUpdate {
			return fmt.Errorf("ruleset %q blocks updates to %s: %w", rule.Name, branch, ErrBranchUpdatesRestricted)
		}
		if rule.RequireMergeQueue && !queued {
			queueRule = rule.Name
		}
		if (rule.RequirePullRequest || rule.RequireMergeQueue) && !linkedPullRequest {
			pullRequestRule = rule.Name
		}
	}
	if queueRule != "" {
		return fmt.Errorf("ruleset %q applies to %s: %w", queueRule, branch, ErrBranchMergeQueueRequired)
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
		if !isDeletion {
			if err := rule.checkName(name); err != nil {
				return err
			}
		}
		switch {
		case isCreation && rule.RestrictCreation:
			return fmt.Errorf("ruleset %q blocks creation of %s", rule.Name, update.Ref)
		case isDeletion && rule.RestrictDeletion:
			return fmt.Errorf("ruleset %q blocks deletion of %s", rule.Name, update.Ref)
		case !isCreation && !isDeletion && rule.RestrictUpdate:
			return fmt.Errorf("ruleset %q blocks updates to %s", rule.Name, update.Ref)
		case !isCreation && !isDeletion && target == "branch" && rule.RequireMergeQueue:
			return fmt.Errorf("ruleset %q requires the merge queue to update %s", rule.Name, update.Ref)
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
