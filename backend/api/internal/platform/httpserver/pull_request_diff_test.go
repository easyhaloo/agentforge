package httpserver

import "testing"

func TestPullRequestDiffAnchorsMatchFileSideAndHunk(t *testing.T) {
	patch := "diff --git a/other.md b/other.md\n@@ -20 +20 @@\n-old\n+new\n" +
		`diff --git "a/\346\265\213\350\257\225.md" "b/\346\265\213\350\257\225.md"` + "\n@@ -7,0 +8,2 @@\n+new\n+text\n"
	for _, test := range []struct {
		path, side string
		line       int
		want       bool
	}{
		{"测试.md", "right", 8, true},
		{"测试.md", "right", 9, true},
		{"测试.md", "right", 10, false},
		{"测试.md", "right", 20, false},
		{"测试.md", "left", 7, false},
		{"other.md", "left", 20, true},
	} {
		if got := diffContainsLine(patch, test.path, test.side, test.line); got != test.want {
			t.Errorf("%s %s:%d = %t, want %t", test.path, test.side, test.line, got, test.want)
		}
	}
}
