package delivery

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"
	"unicode"
)

// WebCommitSignoff represents an authenticated contributor's explicit attestation.
// Its canonical no-reply address keeps the account email out of the Git object.
type WebCommitSignoff struct{ name, email string }

func NewWebCommitSignoff(userID, name string) WebCommitSignoff {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 200 || strings.ContainsAny(name, "<>") || strings.ContainsFunc(name, unicode.IsControl) {
		name = "AgentForge contributor"
	}
	return WebCommitSignoff{name: name, email: fmt.Sprintf("%x@users.agentforge.invalid", sha256.Sum256([]byte(userID)))}
}

func writeWebCommit(ctx context.Context, repo, message, tree, parent string, signoff WebCommitSignoff) ([]byte, error) {
	var env []string
	if signoff.email != "" {
		message += "\n\nSigned-off-by: " + signoff.name + " <" + signoff.email + ">"
		env = []string{"GIT_AUTHOR_NAME=" + signoff.name, "GIT_AUTHOR_EMAIL=" + signoff.email}
	}
	return isolatedGit(ctx, repo, strings.NewReader(message+"\n"), env, "commit-tree", tree, "-p", parent)
}
