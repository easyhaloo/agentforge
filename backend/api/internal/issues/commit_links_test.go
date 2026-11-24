package issues

import (
	"slices"
	"testing"
)

func TestCommitIssueNumbers(t *testing.T) {
	message := "Fix #2 and (#1), retry #2.\nSee elsewhere/repo#4, #0, #33a, #5/6, #2147483648.\n#10"
	if got := CommitIssueNumbers(message); !slices.Equal(got, []int32{2, 1, 10}) {
		t.Fatalf("CommitIssueNumbers = %v", got)
	}
}

func TestClosingIssueReferences(t *testing.T) {
	message := "CLOSE: #1. closes #2, closed #3. FIX #4, fixes #5; fixed Org/Repo#6.\n" +
		"Resolve #7, resolves #8, RESOLVED: #9. Fixes #1. See #10. Ignore #11.\n" +
		"Do not match prefix-fixes #12, `fix #13`, closes #14/15, closes #16things or fixes #2147483648."
	var want []ClosingReference
	for n := int32(1); n <= 9; n++ {
		ref := ClosingReference{Number: n}
		if n == 6 {
			ref.Repository = "org/repo"
		}
		want = append(want, ref)
	}
	if got := ClosingIssueReferences(message); !slices.Equal(got, want) {
		t.Fatalf("ClosingIssueReferences = %v, want %v", got, want)
	}
}
