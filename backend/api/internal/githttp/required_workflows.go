package githttp

import (
	"errors"
	"slices"
	"strings"
	"unicode"
)

var (
	ErrRequiredWorkflows          = errors.New("required repository workflows have not passed for the current revision")
	ErrIneligibleRequiredWorkflow = errors.New("required workflows must be published in this repository with an enabled Changeset revision trigger")
	ErrStrictWorkflowBase         = errors.New("update the source branch with the latest target commit and refresh the pull request")
)

// RequiredWorkflows identifies trusted repository workflows by stable pipeline ID.
type RequiredWorkflows struct {
	PipelineIDs  []string `json:"pipeline_ids"`
	Strict       bool     `json:"strict"`
	SkipCreation bool     `json:"skip_creation"`
}

type RequiredWorkflowStatus struct {
	PipelineID string `json:"pipeline_id"`
	Name       string `json:"name"`
	Status     string `json:"status"`
}

func (checks RequiredWorkflows) valid() bool {
	if len(checks.PipelineIDs) == 0 || len(checks.PipelineIDs) > 20 {
		return false
	}
	for i, id := range checks.PipelineIDs {
		if id == "" || len(id) > 128 || strings.TrimSpace(id) != id || strings.ContainsFunc(id, unicode.IsControl) || slices.Contains(checks.PipelineIDs[:i], id) {
			return false
		}
	}
	return true
}

// BranchRequiredWorkflows combines matching rules. A strict rule wins if more
// than one ruleset requires the same workflow.
func BranchRequiredWorkflows(rules []RefRule, branch, defaultBranch string) map[string]bool {
	checks := make(map[string]bool)
	for _, rule := range rules {
		if rule.RequiredWorkflows == nil || !rule.matches("branch", branch, defaultBranch) {
			continue
		}
		for _, id := range rule.RequiredWorkflows.PipelineIDs {
			checks[id] = checks[id] || rule.RequiredWorkflows.Strict
		}
	}
	return checks
}
