package httpserver

import (
	"strings"
	"testing"
)

func TestPRTriggerPinsSameRepositoryHead(t *testing.T) {
	b := hookBinding{Event: "pull_request", RepositoryID: 2, Branch: "main"}
	sha := strings.Repeat("3", 40)
	body := `{"repository":{"id":2},"action":"synchronize","pull_request":{"base":{"repo":{"id":2},"ref":"main"},"head":{"repo":{"id":2},"sha":"` + sha + `"}}}`
	if b.revision([]byte(body)) != sha {
		t.Fatal("wrong PR head")
	}
	for _, s := range []string{strings.Replace(body, `"head":{"repo":{"id":2}`, `"head":{"repo":{"id":1}`, 1), strings.Replace(body, "main", "other", 1), strings.Replace(body, "synchronize", "closed", 1)} {
		if b.revision([]byte(s)) != "" {
			t.Fatal("accepted unbound PR")
		}
	}
}
