package issues

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

var commitIssueReference = regexp.MustCompile(`#[1-9][0-9]*`)

// CommitIssueNumbers accepts only unqualified references, such as "See #12".
func CommitIssueNumbers(message string) []int32 {
	var numbers []int32
	seen := map[int32]bool{}
	for _, match := range commitIssueReference.FindAllStringIndex(message, -1) {
		before, _ := utf8.DecodeLastRuneInString(message[:match[0]])
		after, _ := utf8.DecodeRuneInString(message[match[1]:])
		if match[0] > 0 && !unicode.IsSpace(before) && !strings.ContainsRune("([{,;:", before) {
			continue
		}
		if unicode.IsLetter(after) || unicode.IsNumber(after) || strings.ContainsRune("_/-", after) {
			continue
		}
		n, err := strconv.ParseInt(message[match[0]+1:match[1]], 10, 32)
		if number := int32(n); err == nil && !seen[number] {
			seen[number] = true
			numbers = append(numbers, number)
		}
	}
	return numbers
}
