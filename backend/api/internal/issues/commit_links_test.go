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
