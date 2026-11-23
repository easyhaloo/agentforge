package githttp

import (
	"errors"
	"strings"
	"testing"
)

func TestRequirePullRequestRefRule(t *testing.T) {
	rule := RefRule{Name: "verified PR", Target: "branch", Enabled: true, Include: []string{"~ALL"}, Exclude: []string{"topic/**"}, RequirePullRequest: true}
	if !ValidRefRules([]RefRule{rule}) {
		t.Fatal("require_pull_request should be valid as the only branch restriction")
	}
	tag := rule
	tag.Target = "tag"
	tag.RestrictDeletion = true
	if ValidRefRules([]RefRule{tag}) {
		t.Fatal("tag rules must reject require_pull_request")
	}
	a, b, zero := strings.Repeat("a", 40), strings.Repeat("b", 40), strings.Repeat("0", 40)
	for _, tc := range []struct {
		name, ref, old, next string
		denied               bool
	}{
		{"update", "refs/heads/main", a, b, true},
		{"creation", "refs/heads/new", zero, b, false},
		{"deletion", "refs/heads/main", a, zero, false},
		{"excluded", "refs/heads/topic/nested/exception", a, b, false},
		{"tag", "refs/tags/main", a, b, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := checkRefRules([]RefRule{rule}, RefUpdate{Ref: tc.ref, Old: tc.old, New: tc.next}, "main")
			if (err != nil) != tc.denied || err != nil && !strings.Contains(err.Error(), "requires a pull request") {
				t.Fatalf("checkRefRules error = %v, want denied = %t", err, tc.denied)
			}
		})
	}
	rule.Enabled = false
	if err := checkRefRules([]RefRule{rule}, RefUpdate{Ref: "refs/heads/main", Old: a, New: b}, "main"); err != nil {
		t.Fatalf("disabled rule: %v", err)
	}
}

func TestBranchMergeRulesStack(t *testing.T) {
	pr := RefRule{Name: "verified PR", Target: "branch", Enabled: true, Include: []string{"~DEFAULT_BRANCH"}, RequirePullRequest: true}
	update := RefRule{Name: "freeze", Target: "branch", Enabled: true, Include: []string{"release/**"}, Exclude: []string{"release/allowed"}, RestrictUpdate: true}
	rules := []RefRule{pr, update}
	for _, tc := range []struct {
		branch, defaultBranch string
		pullRequest           bool
		want                  error
	}{
		{"main", "main", false, ErrBranchPullRequestRequired},
		{"main", "main", true, nil},
		{"main", "new-default", false, nil},
		{"release/locked", "release/locked", true, ErrBranchUpdatesRestricted},
		{"release/allowed", "main", false, nil},
	} {
		if err := CheckBranchMerge(rules, tc.branch, tc.defaultBranch, tc.pullRequest); !errors.Is(err, tc.want) {
			t.Errorf("branch %s, default %s, linked %t: got %v, want %v", tc.branch, tc.defaultBranch, tc.pullRequest, err, tc.want)
		}
	}
}

func TestRulesetNamePatterns(t *testing.T) {
	rule := RefRule{Name: "Naming", Target: "branch", Enabled: true, Include: []string{"~ALL"}, Exclude: []string{"legacy/**"}, NamePatterns: []RefNamePattern{
		{Operator: "starts_with", Pattern: "release/"},
		{Operator: "ends_with", Pattern: "/candidate"},
		{Operator: "contains", Pattern: "/draft/", Negate: true},
		{Operator: "regex", Pattern: `^release/[a-z]+/candidate$`},
	}}
	if !ValidRefRules([]RefRule{rule}) {
		t.Fatal("a name-only ruleset must be valid")
	}
	for _, tc := range []struct {
		branch string
		denied bool
	}{
		{"release/eu/candidate", false}, {"shipping/eu/candidate", true}, {"release/eu/next", true},
		{"release/draft/candidate", true}, {"release/EU/candidate", true}, {"legacy/invalid", false},
	} {
		err := checkRefRules([]RefRule{rule}, RefUpdate{Ref: "refs/heads/" + tc.branch, Old: "0", New: "a"}, "main")
		if errors.Is(err, ErrRefNameRestricted) != tc.denied {
			t.Errorf("push of %s denied=%v, want %t", tc.branch, err, tc.denied)
		}
		err = CheckBranchMerge([]RefRule{rule}, tc.branch, "main", true)
		if errors.Is(err, ErrRefNameRestricted) != tc.denied {
			t.Errorf("merge into %s denied=%v, want %t", tc.branch, err, tc.denied)
		}
	}
	if err := checkRefRules([]RefRule{rule}, RefUpdate{Ref: "refs/heads/invalid", Old: "a", New: "0"}, "main"); err != nil {
		t.Fatalf("name rule blocked cleanup of an existing invalid ref: %v", err)
	}
	rule.NamePatterns[3].Pattern = `(?=unsupported)`
	if ValidRefRules([]RefRule{rule}) {
		t.Fatal("invalid RE2 syntax was accepted")
	}
}

func TestBranchWriteRulesUseExactRefNamespace(t *testing.T) {
	policy := PushPolicy{DefaultBranch: "trunk", RefRules: []RefRule{
		{Name: "protect default", Target: "branch", Enabled: true, Include: []string{"~DEFAULT_BRANCH"}, RestrictCreation: true},
		{Name: "freeze", Target: "branch", Enabled: true, Include: []string{"~ALL"}, Exclude: []string{"trunk"}, RestrictUpdate: true},
	}}
	for _, tc := range []struct {
		ref      string
		creating bool
		want     error
	}{
		{"refs/heads/trunk", true, ErrBranchCreationRestricted},
		{"refs/heads/trunk", false, nil},
		{"refs/heads/main", true, nil},
		{"refs/heads/agentforge/changesets/one", false, ErrBranchUpdatesRestricted},
		{"refs/agentforge/changesets/one", false, nil},
		{"refs/tags/trunk", true, nil},
	} {
		if err := policy.CheckBranchWrite(tc.ref, tc.creating); !errors.Is(err, tc.want) {
			t.Errorf("ref %s (creating %t): got %v, want %v", tc.ref, tc.creating, err, tc.want)
		}
	}
}
