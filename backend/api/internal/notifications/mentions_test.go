package notifications

import (
	"reflect"
	"testing"
)

func TestParseMentions(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected []string
	}{
		{
			name:     "single mention",
			input:    "Hey @john, can you review this?",
			expected: []string{"john"},
		},
		{
			name:     "multiple mentions",
			input:    "@alice and @bob please check this issue",
			expected: []string{"alice", "bob"},
		},
		{
			name:     "duplicate mentions",
			input:    "@user1 told @USER1 about this",
			expected: []string{"user1"},
		},
		{
			name:     "username with hyphens and underscores",
			input:    "@user-name and @user_name",
			expected: []string{"user-name", "user_name"},
		},
		{
			name:     "username with numbers",
			input:    "@user123 and @123user",
			expected: []string{"user123", "123user"},
		},
		{
			name:     "no mentions",
			input:    "This is a comment without mentions",
			expected: nil,
		},
		{
			name:     "mention in markdown",
			input:    "cc @reviewer in `code @fake` and **@bold**",
			expected: []string{"reviewer", "bold"},
		},
		{
			name:     "non-prose and escaped syntax",
			input:    "\\@escaped <person@domain.test> [work @alice](https://github.com/@url)\n\n```go\n@fenced\n```\n\n    @indented\n\n![alt @image](image.png)",
			expected: []string{"alice"},
		},
		{
			name:     "email should not be a mention",
			input:    "Contact user@example.com for details",
			expected: nil,
		},
		{
			name:     "email and mention together",
			input:    "Email admin@company.com but @alice should be notified",
			expected: []string{"alice"},
		},
		{
			name:     "multiple mentions on different lines",
			input:    "First line @user1\nSecond line @user2\n@user3 on third",
			expected: []string{"user1", "user2", "user3"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ParseMentions(tt.input)
			if !reflect.DeepEqual(result, tt.expected) {
				t.Errorf("ParseMentions(%q) = %v, want %v", tt.input, result, tt.expected)
			}
		})
	}
}
