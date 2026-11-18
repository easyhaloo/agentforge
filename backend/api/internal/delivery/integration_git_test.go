package delivery

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeBindings(t *testing.T, bindings []RemoteGitRepository) string {
	t.Helper()
	data, err := json.Marshal(bindings)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "bindings.json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoadIntegrationGit(t *testing.T) {
	root := t.TempDir()
	provider, err := LoadIntegrationGit("", root, time.Minute)
	if _, local := provider.(*LocalGitProvider); !local || err != nil {
		t.Fatalf("local binding: %T %v", provider, err)
	}
	path := filepath.Join(root, "bindings.json")
	if p, err := LoadIntegrationGit(path, root, time.Minute); p != nil || !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("missing configuration: %T %v", p, err)
	}
	const binding = `{"provider":"gitlab","organizationId":"one","repository":"team/repo","url":"https://git.example/team/sub/repo.git"}`
	for name, input := range map[string]string{
		"empty": "", "null": "null", "empty list": "[]", "non-array": binding,
		"truncated": "[", "unknown field": "[" + strings.Replace(binding, `"provider"`, `"token":"invalid","provider"`, 1) + "]",
		"trailing document": "[" + binding + "] []", "oversize": "[" + binding + "]" + strings.Repeat(" ", 1<<20),
	} {
		t.Run(name, func(t *testing.T) {
			if err := os.WriteFile(path, []byte(input), 0600); err != nil {
				t.Fatal(err)
			}
			if p, err := LoadIntegrationGit(path, root, time.Minute); p != nil || !errors.Is(err, ErrRepositoryInvalid) {
				t.Fatalf("invalid configuration: %T %v", p, err)
			}
		})
	}
}

func TestLoadIntegrationGitDuplicateUpstream(t *testing.T) {
	for _, urls := range [][2]string{
		{"https://git.example/Team/Group/Repo.git", "https://GIT.EXAMPLE.:443/team/group/repo"},
		{"https://[::1]/team/repo", "https://[0:0:0:0:0:0:0:1]:443/team/REPO.git"},
	} {
		bindings := []RemoteGitRepository{
			{Provider: "github", OrganizationID: "one", Repository: "a/repo", URL: urls[0]},
			{Provider: "gitlab", OrganizationID: "two", Repository: "b/repo", URL: urls[1]},
		}
		if p, err := LoadIntegrationGit(writeBindings(t, bindings), "", 0); p != nil || !errors.Is(err, ErrRepositoryInvalid) {
			t.Fatalf("duplicate upstream accepted: %T %v", p, err)
		}
		bindings[1].URL += "-other"
		if _, err := LoadIntegrationGit(writeBindings(t, bindings), "", 0); err != nil {
			t.Fatalf("distinct upstreams: %v", err)
		}
	}
}
