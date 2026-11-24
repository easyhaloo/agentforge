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

// ClosingReference identifies an issue named after a closing keyword in a pull
// request description or commit message. An empty repository means the source repository.
type ClosingReference struct {
	Repository string `json:"repository"`
	Number     int32  `json:"number"`
}

var closingIssueReference = regexp.MustCompile(`(?i)\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?):?[\t ]+((?:[a-z0-9_.-]+/[a-z0-9_.-]+)?)#([1-9][0-9]*)`)

func ClosingIssueReferences(message string) []ClosingReference {
	var refs []ClosingReference
	seen := map[ClosingReference]bool{}
	for _, match := range closingIssueReference.FindAllStringSubmatchIndex(message, -1) {
		before, _ := utf8.DecodeLastRuneInString(message[:match[0]])
		after, _ := utf8.DecodeRuneInString(message[match[1]:])
		if strings.ContainsRune("/@`-", before) || unicode.IsLetter(after) || unicode.IsNumber(after) || strings.ContainsRune("_/-", after) {
			continue
		}
		n, err := strconv.ParseInt(message[match[4]:match[5]], 10, 32)
		ref := ClosingReference{Repository: strings.ToLower(message[match[2]:match[3]]), Number: int32(n)}
		if err == nil && !seen[ref] {
			seen[ref] = true
			refs = append(refs, ref)
		}
	}
	return refs
}
