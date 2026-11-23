package delivery

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

var initializationSegmentPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`)
var repositoryNameLetter = regexp.MustCompile(`[A-Za-z]`)

var initializationGitignoreTemplates = map[string]string{
	"node": `node_modules/
npm-debug.log
yarn-error.log
.env
.DS_Store
dist/
build/
*.log
`,
	"python": `__pycache__/
*.py[cod]
*$py.class
*.so
.Python
env/
venv/
.env
.venv
pip-log.txt
*.egg-info/
dist/
build/
`,
	"go": `*.exe
*.exe~
*.dll
*.so
*.dylib
*.test
*.out
vendor/
.env
`,
}

// RepositoryInitializer creates new Git repositories with optional initialization templates.
type RepositoryInitializer interface {
	// InitializeRepository creates a new bare Git repository at ROOT/organizationID/owner/name
	// where slug is "owner/name". The repository is created with exactly one commit on main.
	//
	// Returns a cleanup function that removes the created repository directory. The cleanup
	// function is safe to call once or repeatedly, and only deletes the originally created
	// directory. On error, cleanup is nil.
	//
	// Caller contract: invoke cleanup only before DB write or on definitive DB conflict
	// (e.g., unique constraint violation). Never call cleanup on ambiguous commit result.
	// On success, simply discard the cleanup function without calling it.
	//
	// Errors:
	//   - ErrRepositoryInvalid: invalid organizationID, slug, or init parameters; unsafe path
	//   - ErrVersionConflict: destination already occupied (directory, file, or symlink)
	//   - ErrProviderUnavailable: configured root is unavailable or invalid
	InitializeRepository(ctx context.Context, organizationID, slug string, init RepositoryInitialization) (cleanup func(), err error)
}

// RepositoryInitialization specifies optional initialization templates for a new repository.
type RepositoryInitialization struct {
	Description string // UTF-8, max 350 chars, no NUL
	Readme      bool
	Gitignore   string // "", "node", "python", "go"
	License     string // "", "mit"
}

var _ RepositoryInitializer = (*LocalGitProvider)(nil)

// InitializeRepository uses a service-owned directory tree. Git requires a path
// for its subprocesses, so local users must not have write access to that tree.
func (p *LocalGitProvider) InitializeRepository(ctx context.Context, organizationID, slug string, init RepositoryInitialization) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	owner, name, _ := strings.Cut(slug, "/")
	for _, segment := range []string{organizationID, owner, name} {
		if !initializationSegmentPattern.MatchString(segment) || !filepath.IsLocal(segment) || strings.HasSuffix(segment, ".") {
			return nil, fmt.Errorf("%w: invalid path segment", ErrRepositoryInvalid)
		}
	}
	if !repositoryNameLetter.MatchString(name) {
		return nil, fmt.Errorf("%w: repository name must contain at least one ASCII letter", ErrRepositoryInvalid)
	}
	ignore := initializationGitignoreTemplates[init.Gitignore]
	if (init.Gitignore != "" && ignore == "") || (init.License != "" && init.License != "mit") {
		return nil, fmt.Errorf("%w: unsupported initialization template", ErrRepositoryInvalid)
	}
	if !utf8.ValidString(init.Description) || strings.ContainsRune(init.Description, 0) || utf8.RuneCountInString(init.Description) > 350 {
		return nil, fmt.Errorf("%w: invalid description", ErrRepositoryInvalid)
	}

	rootPath := p.Root
	parent, err := openInitializationParent(rootPath, organizationID, owner, true)
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	parentInfo, err := parent.Stat(".")
	if err != nil {
		return nil, err
	}
	if err := parent.Mkdir(name, 0700); err != nil {
		if errors.Is(err, os.ErrExist) {
			return nil, ErrVersionConflict
		}
		return nil, err
	}
	repo, repoInfo, err := openInitializationDir(parent, name, false)
	if err != nil {
		return nil, err
	}
	defer repo.Close()
	initialized := false
	defer func() {
		if !initialized {
			removeInitializedRepository(parent, name, repoInfo)
		}
	}()

	repoPath := filepath.Join(rootPath, organizationID, owner, name)
	if _, err := p.runWithEnvInput(ctx, repoPath, nil, nil, "--git-dir=.", "init", "--bare", "--quiet", "--initial-branch=main", "--template="); err != nil {
		return nil, fmt.Errorf("initialize Git repository: %w", err)
	}
	if init.Description != "" {
		if err := repo.WriteFile("description", []byte(init.Description+"\n"), 0600); err != nil {
			return nil, fmt.Errorf("write repository description: %w", err)
		}
	}
	scratch, err := os.MkdirTemp("", "agentforge-git-init-*")
	if err != nil {
		return nil, fmt.Errorf("create initialization workspace: %w", err)
	}
	defer os.RemoveAll(scratch)
	workTree := filepath.Join(scratch, "work")
	if err := os.Mkdir(workTree, 0700); err != nil {
		return nil, fmt.Errorf("create initialization work tree: %w", err)
	}
	env := map[string]string{"GIT_ATTR_NOSYSTEM": "1", "GIT_INDEX_FILE": filepath.Join(scratch, "index")}
	git := func(args ...string) error {
		_, err := p.runWithEnvInput(ctx, workTree, env, nil,
			append([]string{"--git-dir=" + repoPath, "--work-tree=.", "-c", "core.hooksPath=/dev/null"}, args...)...)
		return err
	}
	files := map[string]string{".gitignore": ignore}
	if init.Readme {
		files["README.md"] = "# " + name + "\n"
		if init.Description != "" {
			files["README.md"] += "\n" + init.Description + "\n"
		}
	}
	if init.License == "mit" {
		files["LICENSE"] = generateMIT(owner)
	}
	for file, content := range files {
		if content != "" {
			if err := os.WriteFile(filepath.Join(workTree, file), []byte(content), 0600); err != nil {
				return nil, fmt.Errorf("write starter file %s: %w", file, err)
			}
		}
	}
	if err := git("add", "--all", "--"); err != nil {
		return nil, fmt.Errorf("stage starter files: %w", err)
	}
	if err := git("-c", "user.name=AgentForge", "-c", "user.email=agentforge@localhost", "commit", "--allow-empty", "-m", "Initial commit"); err != nil {
		return nil, fmt.Errorf("create initial commit: %w", err)
	}
	gitInfo, err := repo.Lstat("objects")
	if err != nil {
		return nil, fmt.Errorf("identify Git metadata: %w", err)
	}
	initialized = true

	return sync.OnceFunc(func() {
		parent, err := openInitializationParent(rootPath, organizationID, owner, false)
		if err != nil {
			return
		}
		defer parent.Close()
		if info, err := parent.Stat("."); err != nil || !os.SameFile(parentInfo, info) {
			return
		}
		repo, info, err := openInitializationDir(parent, name, false)
		if err != nil {
			return
		}
		defer repo.Close()
		if !os.SameFile(repoInfo, info) {
			return
		}
		// The object directory identity also guards against reuse of the directory inode.
		if info, err := repo.Lstat("objects"); err == nil && os.SameFile(gitInfo, info) {
			removeInitializedRepository(parent, name, repoInfo)
		}
	}), nil
}

func openInitializationParent(path, organizationID, owner string, create bool) (*os.Root, error) {
	canonical, err := filepath.EvalSymlinks(path)
	if err != nil || canonical != path || !filepath.IsAbs(path) {
		return nil, ErrProviderUnavailable
	}
	root, err := os.OpenRoot(path)
	if err != nil {
		return nil, fmt.Errorf("%w: open Git root: %w", ErrProviderUnavailable, err)
	}
	defer root.Close()
	org, _, err := openInitializationDir(root, organizationID, create)
	if err != nil {
		return nil, err
	}
	defer org.Close()
	parent, _, err := openInitializationDir(org, owner, create)
	return parent, err
}

func openInitializationDir(parent *os.Root, name string, create bool) (*os.Root, os.FileInfo, error) {
	if create {
		if err := parent.Mkdir(name, 0700); err != nil && !errors.Is(err, os.ErrExist) {
			return nil, nil, err
		}
	}
	info, err := parent.Lstat(name)
	if err != nil {
		return nil, nil, err
	}
	if !info.IsDir() {
		return nil, nil, fmt.Errorf("%w: expected a real directory", ErrRepositoryInvalid)
	}
	child, err := parent.OpenRoot(name)
	if err != nil {
		return nil, nil, err
	}
	actual, err := child.Stat(".")
	if err != nil || !os.SameFile(info, actual) {
		child.Close()
		return nil, nil, fmt.Errorf("%w: directory changed", ErrRepositoryInvalid)
	}
	return child, info, nil
}

func removeInitializedRepository(parent *os.Root, name string, original os.FileInfo) {
	if info, err := parent.Lstat(name); err == nil && os.SameFile(original, info) {
		_ = parent.RemoveAll(name)
	}
}

func generateMIT(owner string) string {
	year := strconv.Itoa(time.Now().Year())
	return `MIT License

Copyright (c) ` + year + ` ` + owner + `

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`
}
