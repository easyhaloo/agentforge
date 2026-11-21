package notifications

import (
	"regexp"
	"strings"
)

// mentionPattern matches @username patterns
// Usernames can contain letters, numbers, hyphens, and underscores
// Requires whitespace or start-of-line before @ to avoid matching email addresses
var mentionPattern = regexp.MustCompile(`(?:^|\s)@([a-zA-Z0-9_-]+)`)

// ParseMentions extracts all @username mentions from text
func ParseMentions(text string) []string {
	matches := mentionPattern.FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return nil
	}

	// Use a map to deduplicate
	seen := make(map[string]bool)
	var mentions []string

	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		username := strings.TrimSpace(match[1])
		if !seen[username] {
			seen[username] = true
			mentions = append(mentions, username)
		}
	}

	return mentions
}
