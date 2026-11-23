package notifications

import (
	"regexp"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/text"
)

var mentionMarkdown = goldmark.New(goldmark.WithExtensions(extension.GFM))
var mentionPattern = regexp.MustCompile(`(?:^|[^\p{L}\p{N}_.@/\\-])@([a-zA-Z0-9_-]+)`)

// ParseMentions returns unique, case-insensitive handles from Markdown prose.
func ParseMentions(body string) []string {
	if !strings.Contains(body, "@") {
		return nil
	}
	source := []byte(body)
	document := mentionMarkdown.Parser().Parse(text.NewReader(source))
	seen := make(map[string]bool)
	var mentions []string
	var prose []byte
	flush := func() {
		for _, match := range mentionPattern.FindAllSubmatch(prose, -1) {
			handle := strings.ToLower(string(match[1]))
			if !seen[handle] {
				seen[handle] = true
				mentions = append(mentions, handle)
			}
		}
		prose = prose[:0]
	}
	_ = ast.Walk(document, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if value, ok := node.(*ast.Text); ok {
			if entering {
				prose = append(prose, value.Value(source)...)
				if value.SoftLineBreak() || value.HardLineBreak() {
					flush()
				}
			}
			return ast.WalkContinue, nil
		}
		flush()
		switch node.(type) {
		case *ast.CodeSpan, *ast.CodeBlock, *ast.FencedCodeBlock, *ast.AutoLink, *ast.Image, *ast.HTMLBlock:
			return ast.WalkSkipChildren, nil
		default:
			return ast.WalkContinue, nil
		}
	})
	return mentions
}
