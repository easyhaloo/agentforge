package httpserver

import (
	"regexp"
	"strconv"
	"strings"
)

var diffHunkRange = regexp.MustCompile(`^@@ -([0-9]+)(?:,([0-9]+))? \+([0-9]+)(?:,([0-9]+))? @@`)

// The preview disables rename detection. The same path appears twice in every diff header.
func diffContainsLine(patch, path, side string, line int) bool {
	fileHeader := "diff --git a/" + path + " b/" + path
	selected := false
	for _, row := range strings.Split(patch, "\n") {
		if strings.HasPrefix(row, "diff --git ") {
			selected = row == fileHeader
			if quoted, ok := strings.CutPrefix(row, `diff --git "`); !selected && ok {
				header := `"` + quoted
				left, err := strconv.QuotedPrefix(header)
				if err == nil {
					decoded, leftErr := strconv.Unquote(left)
					right, rightErr := strconv.Unquote(strings.TrimSpace(strings.TrimPrefix(header, left)))
					selected = leftErr == nil && rightErr == nil && decoded == "a/"+path && right == "b/"+path
				}
			}
		}
		if !selected || !strings.HasPrefix(row, "@@ ") {
			continue
		}
		match := diffHunkRange.FindStringSubmatch(row)
		if match == nil {
			continue
		}
		index := 1
		if side == "right" {
			index = 3
		}
		start, startErr := strconv.Atoi(match[index])
		count, countErr := strconv.Atoi(match[index+1])
		if match[index+1] == "" {
			count, countErr = 1, nil
		}
		if startErr == nil && countErr == nil && line >= start && line-start < count {
			return true
		}
	}
	return false
}
