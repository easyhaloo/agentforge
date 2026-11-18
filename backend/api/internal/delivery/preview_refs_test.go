package delivery

import (
 "context"
 "os"
 "path/filepath"
 "testing"
 "time"
)

func TestLocalGitPreviewListsBranchesAndTags(t *testing.T) {
 root := t.TempDir()
 repository := filepath.Join(root, "org-a", "team", "refs")
 if err := os.MkdirAll(repository, 0700); err != nil { t.Fatal(err) }
 gitTest(t, repository, "init", "-b", "main")
 if err := os.WriteFile(filepath.Join(repository, "README.md"), []byte("first\n"), 0600); err != nil { t.Fatal(err) }
 gitTest(t, repository, "add", ".")
 gitTest(t, repository, "commit", "-m", "first")
 gitTest(t, repository, "branch", "feature/preview")
 gitTest(t, repository, "tag", "v1.0.0")
 provider, err := NewLocalGitProvider(root, 10*time.Second)
 if err != nil { t.Fatal(err) }
 refs, err := provider.ListRefs(context.Background(), "org-a", "team/refs")
 if err != nil { t.Fatal(err) }
 found := map[string]string{}
 for _, ref := range refs { found[ref.Name] = ref.Kind }
 if found["main"] != "branch" || found["feature/preview"] != "branch" || found["v1.0.0"] != "tag" { t.Fatalf("unexpected refs: %#v", refs) }
}
